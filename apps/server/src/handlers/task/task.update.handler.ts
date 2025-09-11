import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
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
	@Instrumented(60) // Cache for 1 minute - updates change task state
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 }, // 20 requests per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => {
				throw new Error("Task update service temporarily unavailable");
			}
		}
	})
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

		// Apply updates from the nested updates object
		if (input.updates.text !== undefined) updates.text = input.updates.text;
		if (input.updates.status !== undefined) {
			updates.status = input.updates.status;
			// If completing, set completedAt
			if (input.updates.status === "completed" || input.updates.status === "failed") {
				updates.completedAt = new Date().toISOString();
			}
		}
		if (input.updates.priority !== undefined) {
			updates.priority = input.updates.priority;
			
			// Update queue position if still pending
			if (existingData.status === "pending") {
				const queueKey = redisKey("queue", "tasks", "pending");
				await ctx.redis.stream.zrem(queueKey, input.id);
				await ctx.redis.stream.zadd(queueKey, -input.updates.priority, input.id);
			}
		}
		if (input.updates.metadata !== undefined) {
			updates.metadata = JSON.stringify({ ...existingMetadata, ...input.updates.metadata });
		}

		// Update in Redis
		await ctx.redis.stream.hset(taskKey, updates);

		// Get updated task
		const updatedData = await ctx.redis.stream.hgetall(taskKey);
		const task = {
			id: input.id,
			text: updatedData.text as string,
			status: updatedData.status as any,
			priority: parseInt(updatedData.priority as string),
			assignedTo: updatedData.assignedTo || null,
			result: updatedData.result ? JSON.parse(updatedData.result) : null,
			error: updatedData.error || null,
			createdAt: updatedData.createdAt as string,
			updatedAt: updatedData.updatedAt as string,
			completedAt: updatedData.completedAt || null,
		};

		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: input.id },
				data: {
					text: task.text,
					status: task.status,
					priority: task.priority,
					metadata: updates.metadata ? JSON.parse(updates.metadata) : undefined,
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
				changes: Object.keys(input.updates),
			},
		});

		// Return the full updated task for contract compliance
		return {
			id: task.id,
			text: task.text,
			status: task.status,
			priority: task.priority,
			updatedAt: task.updatedAt,
			createdAt: task.createdAt,
		};
	}
}