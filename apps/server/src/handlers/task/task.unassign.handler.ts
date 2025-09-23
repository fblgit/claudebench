import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskUnassignInput, taskUnassignOutput } from "@/schemas/task.schema";
import type { TaskUnassignInput, TaskUnassignOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "task.unassign",
	inputSchema: taskUnassignInput,
	outputSchema: taskUnassignOutput,
	persist: true,
	rateLimit: 20,
	description: "Remove assignment from a task",
})
export class TaskUnassignHandler {
	@Instrumented(0) // No caching - this operation changes state
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 }, // 20 requests per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => {
				throw new Error("Task unassignment service temporarily unavailable");
			}
		}
	})
	async handle(input: TaskUnassignInput, ctx: EventContext): Promise<TaskUnassignOutput> {
		const taskKey = redisKey("task", input.taskId);
		
		// Verify task exists
		const taskData = await ctx.redis.stream.hgetall(taskKey);
		if (!taskData || Object.keys(taskData).length === 0) {
			throw new Error(`Task not found: ${input.taskId}`);
		}
		
		// Get previous assignment
		const previousAssignment = taskData.assignedTo || null;
		
		if (!previousAssignment) {
			throw new Error(`Task ${input.taskId} is not currently assigned`);
		}
		
		// Check task status - don't unassign completed or failed tasks
		const currentStatus = taskData.status;
		if (currentStatus === "completed" || currentStatus === "failed") {
			throw new Error(`Cannot unassign task ${input.taskId} with status ${currentStatus}`);
		}
		
		const now = new Date().toISOString();
		
		// Remove assignment from task
		await ctx.redis.stream.hdel(taskKey, "assignedTo", "assignedAt");
		
		// Update task status back to pending and update timestamp
		await ctx.redis.stream.hset(taskKey, {
			status: "pending",
			updatedAt: now,
		});
		
		// Add back to pending queue with original priority
		const pendingQueueKey = redisKey("queue", "tasks", "pending");
		const priority = Number(taskData.priority) || 50;
		const score = Date.now() - (priority * 1000); // Higher priority = lower score
		await ctx.redis.stream.zadd(pendingQueueKey, score, input.taskId);
		
		// Remove from instance queue if present
		const instanceQueueKey = redisKey("queue", "instance", previousAssignment);
		await ctx.redis.stream.lrem(instanceQueueKey, 0, input.taskId);
		
		// Track unassignment in history
		const historyKey = redisKey("history", "task", input.taskId, "assignments");
		await ctx.redis.stream.rpush(historyKey, JSON.stringify({
			instanceId: previousAssignment,
			action: "unassigned",
			unassignedAt: now,
			unassignedBy: ctx.instanceId
		}));
		
		// Update instance metrics
		const instanceTasksKey = redisKey("metrics", "instance", previousAssignment);
		await ctx.redis.stream.hincrby(instanceTasksKey, "assignedTasks", -1);
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: input.taskId },
				data: {
					assignedTo: null,
					status: "pending",
				},
			});
		}
		
		// Publish event
		await ctx.publish({
			type: "task.unassigned",
			payload: {
				taskId: input.taskId,
				previousAssignment,
			},
			metadata: {
				unassignedBy: ctx.instanceId,
				unassignedAt: now,
			},
		});
		
		return {
			taskId: input.taskId,
			previousAssignment,
			unassignedAt: now,
		};
	}
}