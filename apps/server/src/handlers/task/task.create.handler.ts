import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import type { TaskCreateInput, TaskCreateOutput } from "@/schemas/task.schema";
import { redisKey } from "@/core/redis";
import { taskQueue } from "@/core/task-queue";

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
		const taskId = `t-${Date.now()}`; // Format per data model: t-{timestamp}
		const now = new Date().toISOString();
		
		const task = {
			id: taskId,
			text: input.text, // Changed from title to text
			status: "pending" as const, // Lowercase per contract
			priority: input.priority || 50, // Default 50 per contract
			assignedTo: null,
			result: null,
			error: null,
			metadata: input.metadata || null,
			createdAt: now,
			updatedAt: now,
		};

		// Store in Redis
		const taskKey = redisKey("task", taskId);
		await ctx.redis.stream.hset(taskKey, {
			...task,
			metadata: JSON.stringify(task.metadata),
		});

		// Add to task queue using task queue manager
		await taskQueue.enqueueTask(taskId, task.priority);
		
		// Don't auto-assign - let task.assign handler or orchestrator handle assignment

		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.create({
				data: {
					id: taskId,
					text: task.text, // Changed from title to text
					status: task.status,
					priority: task.priority,
					metadata: task.metadata as any || undefined,
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
			text: task.text,
			status: task.status,
			priority: task.priority,
			createdAt: task.createdAt,
		};
	}
}