import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskUpdateInput, taskUpdateOutput } from "@/schemas/task.schema";
import type { TaskUpdateInput, TaskUpdateOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "task.update",
	inputSchema: taskUpdateInput,
	outputSchema: taskUpdateOutput,
	persist: true,
	rateLimit: 20,
	description: "Update an existing task",
})
export class TaskUpdateHandler {
	async handle(input: TaskUpdateInput, ctx: EventContext): Promise<TaskUpdateOutput> {
		const taskKey = redisKey("task", input.id);
		
		// Get existing task
		const existingData = await ctx.redis.stream.hgetall(taskKey);
		if (!existingData || Object.keys(existingData).length === 0) {
			throw new Error(`Task not found: ${input.id}`);
		}

		// Parse metadata if it exists
		const existingMetadata = existingData.metadata ? JSON.parse(existingData.metadata) : null;
		
		// Prepare updates
		const updates: Record<string, any> = {
			updatedAt: new Date().toISOString(),
		};

		if (input.title !== undefined) updates.title = input.title;
		if (input.description !== undefined) updates.description = input.description || null;
		if (input.status !== undefined) {
			updates.status = input.status;
			// If completing, set completedAt
			if (input.status === "COMPLETED" || input.status === "FAILED") {
				updates.completedAt = new Date().toISOString();
			}
		}
		if (input.priority !== undefined) {
			updates.priority = input.priority;
			
			// Update queue position if still pending
			if (existingData.status === "PENDING") {
				const queueKey = redisKey("queue", "tasks", "pending");
				await ctx.redis.stream.zrem(queueKey, input.id);
				await ctx.redis.stream.zadd(queueKey, -input.priority, input.id);
			}
		}
		if (input.metadata !== undefined) {
			updates.metadata = JSON.stringify({ ...existingMetadata, ...input.metadata });
		}

		// Update in Redis
		await ctx.redis.stream.hset(taskKey, updates);

		// Get updated task
		const updatedData = await ctx.redis.stream.hgetall(taskKey);
		const task = {
			id: input.id,
			title: updatedData.title as string,
			description: updatedData.description || null,
			status: updatedData.status as any,
			priority: parseInt(updatedData.priority as string),
			assignedTo: updatedData.assignedTo || null,
			metadata: updatedData.metadata ? JSON.parse(updatedData.metadata) : null,
			createdAt: updatedData.createdAt as string,
			updatedAt: updatedData.updatedAt as string,
			completedAt: updatedData.completedAt || null,
		};

		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: input.id },
				data: {
					title: task.title,
					description: task.description,
					status: task.status,
					priority: task.priority,
					metadata: task.metadata,
					completedAt: task.completedAt ? new Date(task.completedAt) : null,
				},
			});
		}

		// Publish event
		await ctx.publish({
			type: "task.updated",
			payload: task,
			metadata: {
				updatedBy: ctx.instanceId,
				changes: Object.keys(updates),
			},
		});

		return task;
	}
}