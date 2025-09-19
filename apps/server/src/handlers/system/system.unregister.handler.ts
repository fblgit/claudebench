import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemUnregisterInput, systemUnregisterOutput } from "@/schemas/system.schema";
import type { SystemUnregisterInput, SystemUnregisterOutput } from "@/schemas/system.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.unregister",
	inputSchema: systemUnregisterInput,
	outputSchema: systemUnregisterOutput,
	persist: false,
	rateLimit: 10,
	description: "Clean up instance registration when Claude Code session ends",
	mcp: {
		visible: false, // Internal lifecycle management, not for Claude to use
	}
})
export class SystemUnregisterHandler {
	@Instrumented(60)
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				unregistered: false,
				tasksReassigned: 0
			})
		}
	})
	async handle(input: SystemUnregisterInput, ctx: EventContext): Promise<SystemUnregisterOutput> {
		console.log(`[SystemUnregister] Unregistering instance ${input.instanceId} for session ${input.sessionId}`);
		
		let unregistered = false;
		let tasksReassigned = 0;
		
		try {
			const instanceKey = `cb:instance:${input.instanceId}`;
			const exists = await ctx.redis.stream.exists(instanceKey);
			
			if (exists) {
				// Get instance data before deletion for logging
				const instanceData = await ctx.redis.stream.hgetall(instanceKey);
				const roles = instanceData.roles ? JSON.parse(instanceData.roles) : [];
				
				console.log(`[SystemUnregister] Found instance ${input.instanceId} with roles:`, roles);
				
				// Check for assigned tasks that need reassignment
				if (roles.includes("worker")) {
					// Find tasks assigned to this instance
					const taskPattern = "cb:task:*";
					const taskKeys = await ctx.redis.stream.keys(taskPattern);
					
					for (const taskKey of taskKeys) {
						const taskData = await ctx.redis.stream.hgetall(taskKey);
						if (taskData.assignedTo === input.instanceId && taskData.status === "assigned") {
							// Reassign task to pending queue
							const taskId = taskKey.replace("cb:task:", "");
							console.log(`[SystemUnregister] Reassigning task ${taskId} from ${input.instanceId}`);
							
							// Update task status
							await ctx.redis.stream.hset(taskKey, {
								status: "pending",
								assignedTo: "",
								unassignedAt: Date.now().toString(),
								unassignReason: "instance_unregistered"
							});
							
							// Add back to pending queue
							const queueKey = "cb:queue:tasks:pending";
							const priority = parseInt(taskData.priority || "50");
							await ctx.redis.stream.zadd(queueKey, priority, taskId);
							
							tasksReassigned++;
						}
					}
					
					if (tasksReassigned > 0) {
						console.log(`[SystemUnregister] Reassigned ${tasksReassigned} tasks from ${input.instanceId}`);
					}
				}
				
				// Remove instance from Redis
				await ctx.redis.stream.del(instanceKey);
				
				// Clean up gossip health key
				const gossipKey = `cb:gossip:health:${input.instanceId}`;
				await ctx.redis.stream.del(gossipKey);
				
				// Update global state
				const stateData = {
					action: "instance_unregistered",
					instanceId: input.instanceId,
					sessionId: input.sessionId,
					tasksReassigned,
					timestamp: input.timestamp
				};
				const syncResult = await redisScripts.syncGlobalState(stateData);
				console.log(`[SystemUnregister] Global state synced, version: ${syncResult.version}`);
				
				// Aggregate metrics after instance removal
				const metricsResult = await redisScripts.aggregateGlobalMetrics();
				console.log(`[SystemUnregister] Global metrics updated:`, {
					instances: metricsResult.instanceCount,
					events: metricsResult.totalEvents,
					tasks: metricsResult.totalTasks
				});
				
				unregistered = true;
				
				// Emit unregistered event
				await ctx.publish({
					type: "instance.unregistered",
					payload: {
						id: input.instanceId,
						sessionId: input.sessionId,
						tasksReassigned,
						timestamp: input.timestamp,
					},
				});
				
				// Try to assign reassigned tasks to other workers
				if (tasksReassigned > 0) {
					const workerKeys = await ctx.redis.stream.keys("cb:instance:worker-*");
					if (workerKeys.length > 0) {
						// Pick a random worker to trigger assignment
						const randomWorker = workerKeys[Math.floor(Math.random() * workerKeys.length)];
						const workerId = randomWorker.replace("cb:instance:", "");
						const assignResult = await redisScripts.autoAssignTasks(workerId);
						console.log(`[SystemUnregister] Triggered task assignment to ${workerId}:`, assignResult);
					}
				}
			} else {
				console.log(`[SystemUnregister] Instance ${input.instanceId} not found in registry`);
				// Still return success as the goal is to ensure it's not registered
				unregistered = true;
			}
		} catch (error) {
			console.error(`[SystemUnregister] Error unregistering instance:`, error);
			throw error;
		}
		
		return {
			unregistered,
			tasksReassigned
		};
	}
}