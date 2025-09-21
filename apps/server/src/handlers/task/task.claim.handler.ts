import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskClaimInput, taskClaimOutput } from "@/schemas/task.schema";
import type { TaskClaimInput, TaskClaimOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";
import { redisKey } from "@/core/redis";
import { registry } from "@/core/registry";

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
		
		// Update task status to in_progress using task.update handler
		// This ensures both Redis and PostgreSQL are updated
		try {
			await registry.executeHandler("task.update", {
				id: result.taskId!,
				updates: {
					status: "in_progress",
					metadata: task.metadata ? {
						...JSON.parse(task.metadata),
						assignedTo: input.workerId,
						assignedAt: new Date().toISOString()
					} : {
						assignedTo: input.workerId,
						assignedAt: new Date().toISOString()
					}
				}
			}, ctx.metadata?.clientId);
		} catch (updateError) {
			console.error(`[TaskClaim] Failed to update task status for ${result.taskId}:`, updateError);
			// Continue - task was claimed in Redis, status update failure shouldn't fail the claim
		}
		
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
		
		// Fetch attachments using batch operation to avoid N+1 queries
		let attachments: Record<string, any> = {};
		try {
			// First list available attachments
			const attachmentList = await registry.executeHandler("task.list_attachments", {
				taskId: task.id,
				limit: 100 // Get all attachments (reasonable limit)
			}, ctx.metadata?.clientId);
			
			if (attachmentList && attachmentList.attachments && attachmentList.attachments.length > 0) {
				// Fetch all attachments in a single batch operation
				const batchResult = await registry.executeHandler("task.get_attachments_batch", {
					requests: attachmentList.attachments.map((a: { key: string }) => ({
						taskId: task.id,
						key: a.key
					}))
				}, ctx.metadata?.clientId);
				
				if (batchResult && batchResult.attachments) {
					// Transform batch result into record format
					for (const attachment of batchResult.attachments) {
						attachments[attachment.key] = {
							type: attachment.type,
							value: attachment.value,
							createdAt: attachment.createdAt
						};
					}
				}
			}
		} catch (error) {
			// Log but don't fail the claim if attachments can't be fetched
			console.warn(`[TaskClaim] Failed to fetch attachments for task ${task.id}:`, error);
		}
		
		// Get result from attachments
		let resultData = null;
		if (attachments['result']) {
			resultData = attachments['result'].value;
		}
		
		// Return complete task details including metadata and attachments
		return {
			claimed: true,
			taskId: result.taskId!,
			task: {
				id: task.id,
				text: task.text,
				priority: parseInt(task.priority) || 50,
				status: "in_progress" as const,
				assignedTo: input.workerId,
				metadata: task.metadata ? JSON.parse(task.metadata) : null,
				result: resultData,
				error: task.error || null,
				createdAt: task.createdAt,
				updatedAt: task.updatedAt || task.createdAt,
				completedAt: task.completedAt || null,
				attachments: attachments, // Include all attachment data
				attachmentCount: Object.keys(attachments).length
			},
		};
	}
}