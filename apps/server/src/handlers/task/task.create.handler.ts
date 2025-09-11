import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import type { TaskCreateInput, TaskCreateOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "task.create",
	inputSchema: taskCreateInput,
	outputSchema: taskCreateOutput,
	persist: true,
	rateLimit: 10,
	description: "Create a new task and add it to the queue",
})
export class TaskCreateHandler {
	async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
		const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const now = new Date().toISOString();
		
		const task = {
			id: taskId,
			title: input.title,
			description: input.description || null,
			status: "PENDING" as const,
			priority: input.priority || 0,
			assignedTo: null,
			metadata: input.metadata || null,
			createdAt: now,
			updatedAt: now,
			completedAt: null,
		};

		// Store in Redis
		const taskKey = redisKey("task", taskId);
		await ctx.redis.stream.hset(taskKey, {
			...task,
			metadata: JSON.stringify(task.metadata),
		});

		// Add to task queue (sorted by priority)
		const queueKey = redisKey("queue", "tasks", "pending");
		await ctx.redis.stream.zadd(queueKey, -task.priority, taskId); // Negative for descending order

		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.create({
				data: {
					id: taskId,
					title: task.title,
					description: task.description,
					status: task.status,
					priority: task.priority,
					metadata: task.metadata || undefined,
				},
			});
		}

		// Publish event for subscribers
		await ctx.publish({
			type: "task.created",
			payload: task,
			metadata: {
				createdBy: ctx.instanceId,
			},
		});

		return {
			id: task.id,
			title: task.title,
			description: task.description,
			status: task.status,
			priority: task.priority,
			assignedTo: task.assignedTo,
			metadata: task.metadata,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
		};
	}
}