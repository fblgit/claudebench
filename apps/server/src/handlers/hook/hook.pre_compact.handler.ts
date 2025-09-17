import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookPreCompactInput, hookPreCompactOutput } from "@/schemas/hook.schema";
import type { HookPreCompactInput, HookPreCompactOutput } from "@/schemas/hook.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "hook.pre_compact",
	inputSchema: hookPreCompactInput,
	outputSchema: hookPreCompactOutput,
	persist: false,
	rateLimit: 10,
	description: "Handle pre-compaction events from Claude Code hooks",
	mcp: {
		visible: false, // Hook handlers are internal infrastructure, not user-facing tools
	}
})
export class HookPreCompactHandler {
	@Instrumented(60)
	@Resilient({
		rateLimit: { limit: 10, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 3, 
			timeout: 30000,
			fallback: () => ({ 
				acknowledged: true,
				stateSaved: false
			})
		}
	})
	async handle(input: HookPreCompactInput, ctx: EventContext): Promise<HookPreCompactOutput> {
		console.log(`[HookPreCompact] Pre-compaction event for session ${input.sessionId}`, {
			instanceId: input.instanceId,
			contextSize: input.contextSize,
			timestamp: new Date(input.timestamp).toISOString()
		});
		
		let stateSaved = false;
		
		try {
			// Create a snapshot of current state before compaction
			const snapshotKey = `cb:snapshot:${input.sessionId}:${input.timestamp}`;
			
			// Save instance state
			const instanceKey = `cb:instance:${input.instanceId}`;
			const instanceExists = await ctx.redis.stream.exists(instanceKey);
			
			if (instanceExists) {
				const instanceData = await ctx.redis.stream.hgetall(instanceKey);
				await ctx.redis.stream.hset(`${snapshotKey}:instance`, instanceData);
			}
			
			// Save current tasks assigned to this instance
			const taskPattern = "cb:task:*";
			const taskKeys = await ctx.redis.stream.keys(taskPattern);
			const assignedTasks = [];
			
			for (const taskKey of taskKeys) {
				const taskData = await ctx.redis.stream.hgetall(taskKey);
				if (taskData.assignedTo === input.instanceId) {
					const taskId = taskKey.replace("cb:task:", "");
					assignedTasks.push({
						id: taskId,
						...taskData
					});
				}
			}
			
			if (assignedTasks.length > 0) {
				await ctx.redis.stream.hset(`${snapshotKey}:tasks`, {
					count: assignedTasks.length.toString(),
					tasks: JSON.stringify(assignedTasks)
				});
				console.log(`[HookPreCompact] Saved ${assignedTasks.length} tasks in snapshot`);
			}
			
			// Save recent notifications if any
			const notificationStreamKey = `cb:notifications:${input.sessionId}`;
			const notificationExists = await ctx.redis.stream.exists(notificationStreamKey);
			
			if (notificationExists) {
				// Get last 10 notifications
				const notifications = await ctx.redis.stream.xrevrange(
					notificationStreamKey,
					"+",
					"-",
					"COUNT",
					"10"
				);
				
				if (notifications.length > 0) {
					await ctx.redis.stream.hset(`${snapshotKey}:notifications`, {
						count: notifications.length.toString(),
						data: JSON.stringify(notifications)
					});
				}
			}
			
			// Save context metadata
			await ctx.redis.stream.hset(`${snapshotKey}:metadata`, {
				sessionId: input.sessionId,
				instanceId: input.instanceId,
				contextSize: input.contextSize.toString(),
				timestamp: input.timestamp.toString(),
				createdAt: Date.now().toString()
			});
			
			// Set TTL for snapshot (keep for 2 hours)
			await ctx.redis.stream.expire(snapshotKey, 7200);
			await ctx.redis.stream.expire(`${snapshotKey}:instance`, 7200);
			await ctx.redis.stream.expire(`${snapshotKey}:tasks`, 7200);
			await ctx.redis.stream.expire(`${snapshotKey}:notifications`, 7200);
			await ctx.redis.stream.expire(`${snapshotKey}:metadata`, 7200);
			
			// Track compaction metrics
			const compactionMetricsKey = `cb:metrics:compactions:${input.sessionId}`;
			const compactionCount = await ctx.redis.stream.incr(compactionMetricsKey);
			await ctx.redis.stream.expire(compactionMetricsKey, 86400); // Keep for 24 hours
			
			// Store context size history for analysis
			const contextHistoryKey = `cb:context:history:${input.sessionId}`;
			await ctx.redis.stream.zadd(
				contextHistoryKey,
				input.timestamp,
				`${input.contextSize}:${input.timestamp}`
			);
			await ctx.redis.stream.expire(contextHistoryKey, 86400);
			
			// Update global metrics
			const metricsResult = await redisScripts.aggregateGlobalMetrics();
			console.log(`[HookPreCompact] Compaction #${compactionCount} for session, context size: ${input.contextSize}`);
			
			stateSaved = true;
			
			// Emit compaction event for monitoring
			await ctx.publish({
				type: "context.pre_compact",
				payload: {
					sessionId: input.sessionId,
					instanceId: input.instanceId,
					contextSize: input.contextSize,
					compactionCount,
					snapshotKey,
					timestamp: input.timestamp,
					tasksPreserved: assignedTasks.length
				},
			});
			
			// Log warning if context is getting large
			if (input.contextSize > 100000) {
				console.warn(`[HookPreCompact] Large context detected: ${input.contextSize} tokens for session ${input.sessionId}`);
			}
		} catch (error) {
			console.error(`[HookPreCompact] Error saving pre-compaction state:`, error);
			// Still acknowledge even if state save fails
		}
		
		return {
			acknowledged: true,
			stateSaved
		};
	}
}