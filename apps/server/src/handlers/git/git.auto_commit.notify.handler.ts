import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { gitAutoCommitNotifyInput, gitAutoCommitNotifyOutput } from "@/schemas/git.schema";
import type { GitAutoCommitNotifyInput, GitAutoCommitNotifyOutput } from "@/schemas/git.schema";
import { redisKey } from "@/core/redis";
import { registry } from "@/core/registry";

@EventHandler({
	event: "git.auto_commit.notify",
	inputSchema: gitAutoCommitNotifyInput,
	outputSchema: gitAutoCommitNotifyOutput,
	persist: true, // Persist git commits to database
	rateLimit: 50,
	description: "Notify ClaudeBench about auto-commits",
	mcp: {
		title: "Git Auto-Commit Notification",
		metadata: {
			examples: [{
				description: "Notify about an auto-commit with task context",
				input: {
					instanceId: "worker-1",
					sessionId: "session-123",
					commitHash: "abc123def",
					branch: "main",
					files: ["src/feature.ts"],
					diff: "+ added code\n- removed code",
					taskContext: {
						taskIds: ["t-123"],
						toolUsed: "Edit",
						timestamp: 1234567890,
					},
					commitMessage: '{"task":"Implement feature","files":["src/feature.ts"]}',
				},
				output: {
					acknowledged: true,
					attachmentId: "ta-123-abc",
					eventId: "evt-456",
				},
			}],
			warnings: ["Large diffs may be truncated in attachments"],
			prerequisites: ["Git repository must be initialized"],
			useCases: ["Tracking code evolution", "Audit trail of changes"],
		},
	},
})
export class GitAutoCommitNotifyHandler {
	@Instrumented(0) // No caching - each commit is unique
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 commits per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				acknowledged: false,
			})
		}
	})
	async handle(input: GitAutoCommitNotifyInput, ctx: EventContext): Promise<GitAutoCommitNotifyOutput> {
		const { 
			instanceId, 
			sessionId, 
			commitHash, 
			branch,
			files, 
			diff, 
			stats,
			taskContext, 
			commitMessage 
		} = input;
		
		// Generate event ID
		const eventId = `git-commit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
		
		// Publish git.auto_commit.created event for state processor
		await ctx.publish({
			type: "git.auto_commit.created",
			payload: {
				instanceId,
				sessionId,
				commitHash,
				branch,
				files,
				stats,
				taskContext,
				commitMessage,
				timestamp: Date.now(),
			},
			metadata: {
				eventId,
			},
		});
		
		// Create task attachments for each task with the diff
		let attachmentId: string | undefined;
		
		if (taskContext.taskIds.length > 0) {
			// Use the first task as the primary task for attachment
			const primaryTaskId = taskContext.taskIds[0];
			
			try {
				// Create attachment with git diff
				const attachmentResult = await registry.executeHandler("task.create_attachment", {
					taskId: primaryTaskId,
					key: `git-commit-${commitHash.slice(0, 7)}`,
					type: "json",
					value: {
						commitHash,
						branch,
						files,
						diff: diff.slice(0, 10000), // Limit diff size
						stats,
						toolUsed: taskContext.toolUsed,
						timestamp: taskContext.timestamp,
						commitMessage: JSON.parse(commitMessage),
					},
				}, ctx.metadata?.clientId);
				
				if (attachmentResult && attachmentResult.id) {
					attachmentId = attachmentResult.id;
				}
				
				// For other tasks, create lightweight references
				for (let i = 1; i < taskContext.taskIds.length; i++) {
					const taskId = taskContext.taskIds[i];
					try {
						await registry.executeHandler("task.create_attachment", {
							taskId,
							key: `git-ref-${commitHash.slice(0, 7)}`,
							type: "json",
							value: {
								commitHash,
								branch,
								files: files.length,
								primaryTaskId,
								toolUsed: taskContext.toolUsed,
								timestamp: taskContext.timestamp,
							},
						}, ctx.metadata?.clientId);
					} catch (e) {
						// Log but don't fail if secondary attachments can't be created
						console.warn(`[GitAutoCommit] Failed to create attachment for task ${taskId}:`, e);
					}
				}
			} catch (error) {
				// Log but don't fail if attachment creation fails
				console.error(`[GitAutoCommit] Failed to create attachment for task ${primaryTaskId}:`, error);
			}
		}
		
		// Store commit info in Redis for quick access
		const commitKey = redisKey("git", "commit", commitHash.slice(0, 7));
		await ctx.redis.stream.hset(commitKey, {
			hash: commitHash,
			branch,
			files: JSON.stringify(files),
			filesCount: files.length.toString(),
			additions: (stats?.additions || 0).toString(),
			deletions: (stats?.deletions || 0).toString(),
			taskIds: JSON.stringify(taskContext.taskIds),
			toolUsed: taskContext.toolUsed,
			instanceId,
			sessionId,
			timestamp: taskContext.timestamp.toString(),
		});
		await ctx.redis.stream.expire(commitKey, 86400 * 7); // Keep for 7 days
		
		// Add to session's commit list
		const sessionCommitsKey = redisKey("session", "commits", sessionId);
		await ctx.redis.stream.lpush(sessionCommitsKey, commitHash);
		await ctx.redis.stream.ltrim(sessionCommitsKey, 0, 99); // Keep last 100 commits
		await ctx.redis.stream.expire(sessionCommitsKey, 86400 * 7); // 7 days
		
		// Update metrics
		const metricsKey = redisKey("metrics", "git", "commits");
		await ctx.redis.stream.hincrby(metricsKey, "total", 1);
		await ctx.redis.stream.hincrby(metricsKey, `tool:${taskContext.toolUsed}`, 1);
		await ctx.redis.stream.hincrby(metricsKey, "files", files.length);
		if (stats) {
			await ctx.redis.stream.hincrby(metricsKey, "additions", stats.additions);
			await ctx.redis.stream.hincrby(metricsKey, "deletions", stats.deletions);
		}
		
		return {
			acknowledged: true,
			attachmentId,
			eventId,
		};
	}
}