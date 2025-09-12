import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCompleteInput, taskCompleteOutput } from "@/schemas/task.schema";
import type { TaskCompleteInput, TaskCompleteOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";
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
	@Instrumented(0) // No caching - this operation changes state
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 }, // 20 requests per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => {
				throw new Error("Task completion service temporarily unavailable");
			}
		}
	})
	async handle(input: TaskCompleteInput, ctx: EventContext): Promise<TaskCompleteOutput> {
		// Support both 'id' and 'taskId' fields
		const taskId = input.id || input.taskId;
		if (!taskId) {
			throw new Error("Task ID is required");
		}
		
		// Get task data to calculate duration
		const taskKey = redisKey("task", taskId);
		const taskData = await ctx.redis.stream.hgetall(taskKey);
		
		if (!taskData || Object.keys(taskData).length === 0) {
			throw new Error(`Task not found: ${taskId}`);
		}
		
		// Calculate duration
		const createdAt = new Date(taskData.createdAt as string).getTime();
		const now = Date.now();
		const duration = now - createdAt;
		const completedAt = new Date().toISOString();
		
		// Use Lua script for atomic completion with cleanup
		const result = await redisScripts.completeTask(
			taskId,
			input.result,
			completedAt,
			duration
		);
		
		if (!result.success) {
			throw new Error(result.error || `Failed to complete task: ${taskId}`);
		}
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.task.update({
				where: { id: taskId },
				data: {
					status: result.status as any,
					completedAt: new Date(completedAt),
					metadata: {
						...(taskData.metadata ? JSON.parse(taskData.metadata) : {}),
						result: input.result,
						duration,
					},
				},
			});
		}
		
		// Publish event
		await ctx.publish({
			type: "task.completed",
			payload: {
				id: taskId,
				status: result.status,
				duration,
			},
			metadata: {
				completedBy: input.workerId || taskData.assignedTo,
			},
		});
		
		// Return simplified output per contract
		return {
			id: taskId,
			status: result.status as "completed" | "failed",
			completedAt,
		};
	}
}