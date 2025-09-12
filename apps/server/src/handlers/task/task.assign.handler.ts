import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskAssignInput, taskAssignOutput } from "@/schemas/task.schema";
import type { TaskAssignInput, TaskAssignOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";

/**
 * Backward compatibility wrapper for task.assign
 * In the new pull model, workers claim tasks themselves
 * This handler now just signals the worker to claim a specific task
 */
@EventHandler({
	event: "task.assign",
	inputSchema: taskAssignInput,
	outputSchema: taskAssignOutput,
	persist: true,
	rateLimit: 20,
	description: "Assign a task to an instance (backward compat)",
})
export class TaskAssignHandler {
	@Instrumented(0) // No caching - this operation changes state
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 }, // 20 requests per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => {
				throw new Error("Task assignment service temporarily unavailable");
			}
		}
	})
	async handle(input: TaskAssignInput, ctx: EventContext): Promise<TaskAssignOutput> {
		const taskKey = redisKey("task", input.taskId);
		const instanceKey = redisKey("instance", input.instanceId);
		
		// Verify task exists
		const taskData = await ctx.redis.stream.hgetall(taskKey);
		if (!taskData || Object.keys(taskData).length === 0) {
			throw new Error(`Task not found: ${input.taskId}`);
		}
		
		// Verify instance exists and is active
		const instanceData = await ctx.redis.stream.hgetall(instanceKey);
		if (!instanceData || Object.keys(instanceData).length === 0) {
			throw new Error(`Instance not found: ${input.instanceId}`);
		}
		
		const status = instanceData.status || instanceData.health;
		if (status === "OFFLINE" || status === "unhealthy") {
			throw new Error(`Instance ${input.instanceId} is not available (status: ${status})`);
		}
		
		// Check if task is already assigned
		const previousAssignment = taskData.assignedTo || null;
		if (previousAssignment) {
			throw new Error(`Task ${input.taskId} is already assigned to ${previousAssignment}.`);
		}
		
		// For backward compatibility with contracts and tests,
		// we need to actually assign the task, not just suggest it.
		// This breaks the pure pull model but maintains compatibility.
		
		const now = new Date().toISOString();
		
		// Actually assign the task (for backward compat)
		await ctx.redis.stream.hset(taskKey, {
			assignedTo: input.instanceId,
			status: "pending", // Keep as pending per contract
			assignedAt: now,
			updatedAt: now,
		});
		
		// Remove from pending queue since it's now assigned
		const pendingQueueKey = redisKey("queue", "tasks", "pending");
		await ctx.redis.stream.zrem(pendingQueueKey, input.taskId);
		
		// Add to instance queue
		const instanceQueueKey = redisKey("queue", "instance", input.instanceId);
		await ctx.redis.stream.rpush(instanceQueueKey, input.taskId);
		
		// Track assignment attempt in history
		const historyKey = redisKey("history", "task", input.taskId, "assignments");
		await ctx.redis.stream.rpush(historyKey, JSON.stringify({
			instanceId: input.instanceId,
			assignedAt: now,
			assignedBy: ctx.instanceId
		}));
		
		// Update instance metrics
		const instanceTasksKey = redisKey("metrics", "instance", input.instanceId);
		await ctx.redis.stream.hincrby(instanceTasksKey, "assignedTasks", 1);
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: input.taskId },
				data: {
					assignedTo: input.instanceId,
					status: "pending",
				},
			});
		}
		
		// Publish event
		await ctx.publish({
			type: "task.assigned",
			payload: {
				taskId: input.taskId,
				instanceId: input.instanceId,
				previousAssignment,
			},
			metadata: {
				assignedBy: ctx.instanceId,
			},
		});
		
		// Return expected output format for backward compatibility
		return {
			taskId: input.taskId,
			instanceId: input.instanceId,
			assignedAt: now,
		};
	}
}