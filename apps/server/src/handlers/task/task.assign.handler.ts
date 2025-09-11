import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskAssignInput, taskAssignOutput } from "@/schemas/task.schema";
import type { TaskAssignInput, TaskAssignOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "task.assign",
	inputSchema: taskAssignInput,
	outputSchema: taskAssignOutput,
	persist: true,
	rateLimit: 20,
	description: "Assign a task to an instance",
})
export class TaskAssignHandler {
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
		
		if (instanceData.status !== "ACTIVE" && instanceData.status !== "IDLE") {
			throw new Error(`Instance ${input.instanceId} is not available (status: ${instanceData.status})`);
		}

		// Check if task is already assigned
		const previousAssignment = taskData.assignedTo || null;
		if (previousAssignment && !input.force) {
			throw new Error(`Task ${input.taskId} is already assigned to ${previousAssignment}. Use force=true to reassign.`);
		}

		// Remove from old instance queue if reassigning
		if (previousAssignment && previousAssignment !== input.instanceId) {
			const oldQueueKey = redisKey("queue", "instance", previousAssignment);
			await ctx.redis.stream.lrem(oldQueueKey, 0, input.taskId);
		}

		// Remove from pending queue
		const pendingQueueKey = redisKey("queue", "tasks", "pending");
		await ctx.redis.stream.zrem(pendingQueueKey, input.taskId);

		// Add to instance queue
		const instanceQueueKey = redisKey("queue", "instance", input.instanceId);
		await ctx.redis.stream.rpush(instanceQueueKey, input.taskId);

		// Update task assignment
		const now = new Date().toISOString();
		await ctx.redis.stream.hset(taskKey, {
			assignedTo: input.instanceId,
			status: "ASSIGNED",
			updatedAt: now,
		});

		// Track assignment history
		const historyKey = redisKey("history", "task", input.taskId, "assignments");
		await ctx.redis.stream.rpush(historyKey, JSON.stringify({
			instanceId: input.instanceId,
			assignedAt: now,
			assignedBy: ctx.instanceId,
		}));

		// Update instance task count
		const instanceTasksKey = redisKey("metrics", "instance", input.instanceId);
		await ctx.redis.stream.hincrby(instanceTasksKey, "assignedTasks", 1);

		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: input.taskId },
				data: {
					assignedTo: input.instanceId,
					status: "ASSIGNED",
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

		return {
			taskId: input.taskId,
			instanceId: input.instanceId,
			assignedAt: now,
			previousAssignment,
		};
	}
}