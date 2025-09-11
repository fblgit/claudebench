import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCompleteInput, taskCompleteOutput } from "@/schemas/task.schema";
import type { TaskCompleteInput, TaskCompleteOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "task.complete",
	inputSchema: taskCompleteInput,
	outputSchema: taskCompleteOutput,
	persist: true,
	rateLimit: 20,
	description: "Mark a task as completed or failed",
})
export class TaskCompleteHandler {
	async handle(input: TaskCompleteInput, ctx: EventContext): Promise<TaskCompleteOutput> {
		const taskKey = redisKey("task", input.id);
		
		// Get existing task
		const taskData = await ctx.redis.stream.hgetall(taskKey);
		if (!taskData || Object.keys(taskData).length === 0) {
			throw new Error(`Task not found: ${input.id}`);
		}

		// Verify task is assigned
		if (!taskData.assignedTo) {
			throw new Error(`Task ${input.id} is not assigned to any instance`);
		}

		// Verify task is not already completed
		if (taskData.status === "COMPLETED" || taskData.status === "FAILED") {
			throw new Error(`Task ${input.id} is already ${taskData.status}`);
		}

		// Calculate duration
		const createdAt = new Date(taskData.createdAt as string).getTime();
		const now = Date.now();
		const duration = now - createdAt;

		// Determine final status
		const status = input.error ? "FAILED" : "COMPLETED";
		const completedAt = new Date().toISOString();

		// Update task in Redis
		await ctx.redis.stream.hset(taskKey, {
			status,
			completedAt,
			updatedAt: completedAt,
			result: input.result ? JSON.stringify(input.result) : null,
			error: input.error || null,
			duration: duration.toString(),
		});

		// Remove from instance queue
		const instanceQueueKey = redisKey("queue", "instance", taskData.assignedTo);
		await ctx.redis.stream.lrem(instanceQueueKey, 0, input.id);

		// Update instance metrics
		const instanceMetricsKey = redisKey("metrics", "instance", taskData.assignedTo);
		await ctx.redis.stream.hincrby(instanceMetricsKey, "tasksCompleted", 1);
		if (status === "FAILED") {
			await ctx.redis.stream.hincrby(instanceMetricsKey, "tasksFailed", 1);
		}

		// Track completion in history
		const historyKey = redisKey("history", "task", input.id, "completions");
		await ctx.redis.stream.rpush(historyKey, JSON.stringify({
			status,
			completedAt,
			completedBy: taskData.assignedTo,
			duration,
		}));

		// Update global metrics
		const globalMetricsKey = redisKey("metrics", "global");
		await ctx.redis.stream.hincrby(globalMetricsKey, 
			status === "COMPLETED" ? "tasksCompleted" : "tasksFailed", 1);

		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: input.id },
				data: {
					status,
					completedAt: new Date(completedAt),
					metadata: {
						...(taskData.metadata ? JSON.parse(taskData.metadata) : {}),
						result: input.result,
						error: input.error,
						duration,
					},
				},
			});
		}

		// Publish event
		await ctx.publish({
			type: "task.completed",
			payload: {
				id: input.id,
				status,
				duration,
			},
			metadata: {
				completedBy: taskData.assignedTo,
			},
		});

		return {
			id: input.id,
			title: taskData.title as string,
			status: status as "COMPLETED" | "FAILED",
			result: input.result || null,
			error: input.error || null,
			completedAt,
			completedBy: taskData.assignedTo as string,
			duration,
		};
	}
}