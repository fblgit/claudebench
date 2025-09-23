import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskClaimInput, taskClaimOutput } from "@/schemas/task.schema";
import type { TaskClaimInput, TaskClaimOutput } from "@/schemas/task.schema";
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
		
		// Use task.list handler to find pending tasks ordered by priority
		const pendingTasks = await registry.executeHandler("task.list", {
			status: "pending",
			orderBy: "priority",
			order: "desc",
			limit: 10  // Check up to 10 pending tasks
		}, ctx.metadata?.clientId);
		
		if (!pendingTasks || !pendingTasks.tasks || pendingTasks.tasks.length === 0) {
			// No pending tasks available
			return {
				claimed: false,
			};
		}
		
		// Try to claim the highest priority pending task
		let claimedTask = null;
		for (const task of pendingTasks.tasks) {
			try {
				// First assign the task to the worker
				await registry.executeHandler("task.assign", {
					taskId: task.id,
					instanceId: input.workerId
				}, ctx.metadata?.clientId);
				
				// Then update the status to in_progress
				await registry.executeHandler("task.update", {
					id: task.id,
					updates: {
						status: "in_progress"
					}
				}, ctx.metadata?.clientId);
				
				// Successfully claimed this task
				claimedTask = task;
				break;
			} catch (error) {
				// Task might have been claimed by another worker, continue to next task
				console.debug(`[TaskClaim] Failed to claim task ${task.id}, trying next:`, error);
				continue;
			}
		}
		
		if (!claimedTask) {
			// Could not claim any task (all were taken by other workers)
			return {
				claimed: false,
			};
		}
		
		// Emit task.claimed event
		await ctx.publish({
			type: "task.claimed",
			payload: {
				taskId: claimedTask.id,
				workerId: input.workerId,
			},
			metadata: {
				claimedAt: new Date().toISOString(),
			},
		});
		
		// Fetch attachments for the claimed task
		let attachments: Record<string, any> = {};
		try {
			const attachmentList = await registry.executeHandler("task.list_attachments", {
				taskId: claimedTask.id,
				limit: 100
			}, ctx.metadata?.clientId);
			
			if (attachmentList && attachmentList.attachments && attachmentList.attachments.length > 0) {
				const batchResult = await registry.executeHandler("task.get_attachments_batch", {
					requests: attachmentList.attachments.map((a: { key: string }) => ({
						taskId: claimedTask.id,
						key: a.key
					}))
				}, ctx.metadata?.clientId);
				
				if (batchResult && batchResult.attachments) {
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
			console.warn(`[TaskClaim] Failed to fetch attachments for task ${claimedTask.id}:`, error);
		}
		
		// Return the claimed task details
		return {
			claimed: true,
			taskId: claimedTask.id,
			task: {
				id: claimedTask.id,
				text: claimedTask.text,
				priority: claimedTask.priority,
				status: "in_progress" as const,
				assignedTo: input.workerId,
				metadata: claimedTask.metadata,
				result: claimedTask.result,
				error: claimedTask.error,
				createdAt: claimedTask.createdAt,
				updatedAt: claimedTask.updatedAt || claimedTask.createdAt,
				completedAt: claimedTask.completedAt,
				attachments: attachments,
				attachmentCount: Object.keys(attachments).length
			},
		};
	}
}