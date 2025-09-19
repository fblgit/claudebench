import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskUpdateInput, taskUpdateOutput } from "@/schemas/task.schema";
import type { TaskUpdateInput, TaskUpdateOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";
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
	@Instrumented(0) // No caching - this operation changes state
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
		const now = new Date().toISOString();
		
		// Prepare updates object for Lua script
		const updates: Record<string, any> = {};
		if (input.updates.text !== undefined) updates.text = input.updates.text;
		if (input.updates.status !== undefined) updates.status = input.updates.status;
		if (input.updates.priority !== undefined) updates.priority = input.updates.priority;
		if (input.updates.metadata !== undefined) {
			// Get existing metadata first
			const taskKey = redisKey("task", input.id);
			const existingData = await ctx.redis.stream.hget(taskKey, "metadata");
			const existingMetadata = existingData ? JSON.parse(existingData) : {};
			updates.metadata = JSON.stringify({ ...existingMetadata, ...input.updates.metadata });
		}
		
		// Use Lua script for atomic update with queue repositioning
		const result = await redisScripts.updateTask(
			input.id,
			updates,
			now
		);
		
		if (!result.success) {
			throw new Error(result.error || `Task not found: ${input.id}`);
		}
		
		// Get updated task data for response
		const taskKey = redisKey("task", input.id);
		const updatedData = await ctx.redis.stream.hgetall(taskKey);
		
		const task = {
			id: input.id,
			text: updatedData.text as string,
			status: updatedData.status as any,
			priority: parseInt(updatedData.priority as string),
			createdAt: updatedData.createdAt as string,
			updatedAt: now,
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
					completedAt: updatedData.completedAt ? new Date(updatedData.completedAt) : null,
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