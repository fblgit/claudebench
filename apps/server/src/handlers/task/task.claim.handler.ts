import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskClaimInput, taskClaimOutput } from "@/schemas/task.schema";
import type { TaskClaimInput, TaskClaimOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "task.claim",
	inputSchema: taskClaimInput,
	outputSchema: taskClaimOutput,
	persist: false,
	rateLimit: 100,
	description: "Worker claims next available task (pull model)",
})
export class TaskClaimHandler {
	@Instrumented(0) // No caching - workers need fresh tasks
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 claims per minute per worker
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 10, 
			timeout: 30000,
			fallback: () => ({ 
				claimed: false // Can't claim if circuit is open
			})
		}
	})
	async handle(input: TaskClaimInput, ctx: EventContext): Promise<TaskClaimOutput> {
		// Verify worker is registered and active
		const workerKey = redisKey("instance", input.workerId);
		const workerData = await ctx.redis.stream.hgetall(workerKey);
		
		if (!workerData || Object.keys(workerData).length === 0) {
			throw new Error(`Worker not registered: ${input.workerId}`);
		}
		
		// Check worker health/status
		const status = workerData.status || workerData.health;
		if (status === "OFFLINE" || status === "unhealthy") {
			throw new Error(`Worker ${input.workerId} is not available (status: ${status})`);
		}
		
		// Use Lua script for atomic task claiming
		const result = await redisScripts.claimTask(input.workerId);
		
		if (!result.claimed) {
			// No tasks available
			return {
				claimed: false,
			};
		}
		
		// Parse task data from Lua script response
		const task = result.task;
		
		// Emit event
		await ctx.publish({
			type: "task.claimed",
			payload: {
				taskId: result.taskId!,
				workerId: input.workerId,
			},
			metadata: {
				claimedAt: new Date().toISOString(),
			},
		});
		
		// Return task details
		return {
			claimed: true,
			taskId: result.taskId!,
			task: {
				id: task.id,
				text: task.text,
				priority: parseInt(task.priority) || 50,
				status: "in_progress" as const,
				createdAt: task.createdAt,
			},
		};
	}
}