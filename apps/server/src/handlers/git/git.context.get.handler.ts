import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { gitContextGetInput, gitContextGetOutput } from "@/schemas/git.schema";
import type { GitContextGetInput, GitContextGetOutput } from "@/schemas/git.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "git.context.get",
	inputSchema: gitContextGetInput,
	outputSchema: gitContextGetOutput,
	persist: false,
	rateLimit: 100,
	description: "Get task context for git commits",
	mcp: {
		title: "Get Git Context",
		metadata: {
			description: "Retrieve current task context for creating structured git commit messages",
			examples: [{
				input: {
					instanceId: "worker-1",
					sessionId: "session-123",
				},
				output: {
					tasks: [{
						id: "t-123",
						text: "Implement feature X",
						status: "in_progress",
						priority: 75,
					}],
					recentTools: ["Edit", "Write"],
					currentTodos: [],
				},
			}],
			warnings: ["Returns empty arrays if no active tasks or tools"],
			useCases: ["Auto-generating commit messages with task context"],
		},
	},
})
export class GitContextGetHandler {
	@Instrumented(5) // Cache for 5 seconds - context changes frequently
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 requests per minute
		timeout: 3000, // 3 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				tasks: [],
				recentTools: [],
				currentTodos: [],
				metadata: {},
			})
		}
	})
	async handle(input: GitContextGetInput, ctx: EventContext): Promise<GitContextGetOutput> {
		const { instanceId, sessionId, limit = 5 } = input;
		
		// Get tasks assigned to this instance
		const tasks: GitContextGetOutput['tasks'] = [];
		
		// Query tasks by assignedTo field
		const taskKeys = await ctx.redis.stream.keys(redisKey("task", "*"));
		for (const taskKey of taskKeys.slice(0, limit)) {
			const taskData = await ctx.redis.stream.hgetall(taskKey);
			if (taskData.assignedTo === instanceId && 
				(taskData.status === "in_progress" || taskData.status === "pending")) {
				tasks.push({
					id: taskData.id,
					text: taskData.text || "",
					status: taskData.status as any,
					priority: parseInt(taskData.priority || "50"),
					assignedAt: taskData.updatedAt || taskData.createdAt,
				});
			}
		}
		
		// Get recent tools from session context
		const toolsKey = redisKey("session", "tools", sessionId);
		const recentTools = await ctx.redis.stream.lrange(toolsKey, 0, 9);
		
		// Get current todos from session context
		const contextKey = redisKey("session", "context", sessionId);
		const contextData = await ctx.redis.stream.hgetall(contextKey);
		
		let currentTodos: GitContextGetOutput['currentTodos'] = [];
		if (contextData.activeTodos) {
			try {
				currentTodos = JSON.parse(contextData.activeTodos);
			} catch (e) {
				// Ignore parse errors
			}
		}
		
		// Get last prompt
		const lastPrompt = contextData.lastPrompt || undefined;
		
		// Get session state for metadata
		const stateKey = redisKey("session", "state", sessionId);
		const stateData = await ctx.redis.stream.hgetall(stateKey);
		
		// Build metadata
		const metadata: GitContextGetOutput['metadata'] = {
			sessionId,
			instanceId,
			projectDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
			eventCount: parseInt(stateData.eventCount || "0"),
		};
		
		// Get tasks from session if no directly assigned tasks
		if (tasks.length === 0) {
			const sessionTasksKey = redisKey("session", "tasks", sessionId);
			const sessionTaskIds = await ctx.redis.stream.lrange(sessionTasksKey, 0, limit - 1);
			
			for (const taskId of sessionTaskIds) {
				const taskData = await ctx.redis.stream.hgetall(redisKey("task", taskId));
				if (taskData.id) {
					tasks.push({
						id: taskData.id,
						text: taskData.text || "",
						status: taskData.status as any || "unknown",
						priority: parseInt(taskData.priority || "50"),
						assignedAt: taskData.updatedAt || taskData.createdAt,
					});
				}
			}
		}
		
		return {
			tasks,
			recentTools,
			currentTodos,
			lastPrompt,
			metadata,
		};
	}
}