import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import type { TaskCreateInput, TaskCreateOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "task.create",
	inputSchema: taskCreateInput,
	outputSchema: taskCreateOutput,
	persist: true,
	rateLimit: 10,
	description: "Create a new task and add it to the queue",
})
export class TaskCreateHandler {
	@Instrumented(0) // No caching - this operation creates new resources
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 tasks per minute (increased for testing)
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				id: "t-fallback",
				text: "Service temporarily unavailable",
				status: "pending",
				priority: 50,
				createdAt: new Date().toISOString()
			})
		}
	})
	async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
		const taskId = `t-${Date.now()}`; // Format per data model: t-{timestamp}
		const now = new Date().toISOString();
		
		// Use Lua script for atomic task creation and queue addition
		const result = await redisScripts.createTask(
			taskId,
			input.text,
			input.priority || 50,
			"pending",
			now,
			input.metadata || null
		);
		
		if (!result.success) {
			throw new Error(result.error || "Failed to create task");
		}
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.create({
				data: {
					id: taskId,
					text: input.text,
					status: "pending",
					priority: input.priority || 50,
					metadata: input.metadata as any || undefined,
				},
			});
		}
		
		// Publish event for subscribers
		await ctx.publish({
			type: "task.created",
			payload: {
				id: taskId,
				text: input.text,
				status: "pending",
				priority: input.priority || 50,
				createdAt: now,
			},
			metadata: {
				createdBy: ctx.instanceId,
			},
		});
		
		// Update queue metrics
		const metricsKey = "cb:metrics:queues";
		await ctx.redis.stream.hincrby(metricsKey, "totalTasks", 1);
		
		return {
			id: taskId,
			text: input.text,
			status: "pending",
			priority: input.priority || 50,
			createdAt: now,
		};
	}
}