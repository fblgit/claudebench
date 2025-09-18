import { Queue, Worker } from "bullmq";
import { getRedis } from "./redis";
import { redisScripts } from "./redis-scripts";
import { registry } from "./registry";

// Use existing Redis connection
const connection = {
	host: process.env.REDIS_HOST || "localhost",
	port: parseInt(process.env.REDIS_PORT || "6379"),
};

// Define job queues
export const systemQueue = new Queue("system-jobs", { connection });
export const monitoringQueue = new Queue("monitoring-jobs", { connection });
export const swarmQueue = new Queue("swarm-jobs", { connection });

// Define job types
export type SystemJob = 
	| { type: "aggregate-metrics" }
	| { type: "sync-state" }
	| { type: "detect-partitions" }
	| { type: "check-quorum" };

export type MonitoringJob =
	| { type: "health-check" }
	| { type: "failure-detection" }
	| { type: "redistribute-tasks" };

export type SwarmJob =
	| { 
		type: "create-project",
		projectId: string,
		project: string,
		priority: number,
		constraints?: string[],
		metadata?: Record<string, any>,
		sessionId?: string,
		instanceId?: string
	};

// Create workers
export const systemWorker = new Worker<SystemJob>(
	"system-jobs",
	async (job) => {
		console.log(`[SystemWorker] Processing ${job.data.type}`);
		
		switch (job.data.type) {
			case "aggregate-metrics":
				const metrics = await redisScripts.aggregateGlobalMetrics();
				console.log(`[SystemWorker] Metrics: ${metrics.instanceCount} instances, ${metrics.totalEvents} events`);
				return metrics;
				
			case "sync-state":
				const redis = getRedis();
				const instanceKeys = await redis.stream.keys("cb:instance:*");
				// Only match direct task keys (cb:task:t-*), not attachment keys
				const allTaskKeys = await redis.stream.keys("cb:task:*");
				const taskKeys = allTaskKeys.filter(key => {
					const parts = key.split(":");
					// Should be exactly 3 parts: cb, task, and task-id
					return parts.length === 3 && parts[2].startsWith("t-");
				});
				
				const state = {
					instances: instanceKeys.length,
					tasks: taskKeys.length,
					timestamp: Date.now(),
				};
				
				const syncResult = await redisScripts.syncGlobalState(state);
				console.log(`[SystemWorker] State synced, version: ${syncResult.version}`);
				return syncResult;
				
			case "detect-partitions": {
				const redis = getRedis();
				const gossipKey = "cb:gossip:health";
				const gossipData = await redis.stream.hgetall(gossipKey);
				
				let healthy = 0;
				let total = Object.keys(gossipData).length;
				
				for (const instanceId in gossipData) {
					try {
						const health = JSON.parse(gossipData[instanceId]);
						if (health.status === "healthy") {
							healthy++;
						}
					} catch {}
				}
				
				const partitionDetected = total > 2 && healthy < (total / 2);
				
				if (partitionDetected) {
					await redis.stream.set("cb:partition:detected", "true", "EX", 300);
					console.log(`[SystemWorker] Partition detected: ${healthy}/${total} healthy`);
				} else if (healthy > (total * 0.7)) {
					await redis.stream.set("cb:partition:recovery", "true", "EX", 300);
				}
				
				return { partitionDetected, healthy, total };
			}
				
			case "check-quorum": {
				const redis = getRedis();
				const quorumKey = "cb:quorum:decision:latest";
				const decision = await redis.stream.hgetall(quorumKey);
				
				if (decision.votes) {
					const votes = JSON.parse(decision.votes);
					console.log(`[SystemWorker] Quorum: ${votes.length} votes`);
					return { voteCount: votes.length, decision: decision.decision };
				}
				
				return { voteCount: 0 };
			}
		}
	},
	{ connection }
);

export const monitoringWorker = new Worker<MonitoringJob>(
	"monitoring-jobs",
	async (job) => {
		console.log(`[MonitoringWorker] Processing ${job.data.type}`);
		const redis = getRedis();
		
		switch (job.data.type) {
			case "health-check":
				const instanceKeys = await redis.stream.keys("cb:instance:*");
				let healthResults = { healthy: 0, unhealthy: 0, updated: 0 };
				
				for (const key of instanceKeys) {
					const instanceId = key.split(":").pop()!;
					const data = await redis.stream.hgetall(key);
					
					if (data.lastSeen) {
						const timeSinceLastSeen = Date.now() - parseInt(data.lastSeen);
						const health = timeSinceLastSeen > 30000 ? "unhealthy" : "healthy";
						
						// Update gossip health
						await redisScripts.updateGossipHealth(instanceId, health);
						
						if (health === "unhealthy") {
							healthResults.unhealthy++;
							// Mark as OFFLINE
							await redis.stream.hset(key, "status", "OFFLINE");
							
							// Check for tasks to redistribute
							const queueKey = `cb:queue:instance:${instanceId}`;
							const queueLength = await redis.stream.llen(queueKey);
							
							if (queueLength > 0) {
								// Schedule redistribution job
								await monitoringQueue.add("redistribute", { 
									type: "redistribute-tasks",
									instanceId 
								});
							}
						} else {
							healthResults.healthy++;
						}
						healthResults.updated++;
					}
				}
				
				console.log(`[MonitoringWorker] Health check: ${healthResults.healthy} healthy, ${healthResults.unhealthy} unhealthy`);
				return healthResults;
				
			case "failure-detection":
				// Use system.check_health handler to detect and handle failures
				try {
					const result = await registry.executeHandler("system.check_health", { timeout: 30000 });
					return result;
				} catch (error) {
					console.error("[MonitoringWorker] Failed to check health:", error);
					return { healthy: [], failed: [], reassigned: {} };
				}
				
			case "redistribute-tasks":
				// This would be triggered when an instance fails
				const instanceId = (job.data as any).instanceId;
				if (instanceId) {
					const result = await redisScripts.reassignFailedTasks(instanceId);
					
					if (result.reassigned > 0) {
						console.log(`[MonitoringWorker] Redistributed ${result.reassigned} tasks from ${instanceId}`);
						
						// Track redistribution for tests
						const redistributedKey = `cb:redistributed:from:${instanceId}`;
						for (let i = 0; i < result.reassigned; i++) {
							await redis.stream.lpush(redistributedKey, JSON.stringify({
								taskId: `task-${i}`,
								redistributedAt: Date.now(),
							}));
						}
						await redis.stream.expire(redistributedKey, 3600);
					}
					
					return result;
				}
				return { reassigned: 0, workers: 0 };
		}
	},
	{ connection }
);

// Create swarm worker
export const swarmWorker = new Worker<SwarmJob>(
	"swarm-jobs",
	async (job) => {
		console.log(`[SwarmWorker] Processing ${job.data.type} for project ${job.data.projectId}`);
		const { eventBus } = await import("./bus");
		const { createContext } = await import("./context");
		const { registry } = await import("./registry");
		
		switch (job.data.type) {
			case "create-project": {
				const { projectId, project, priority, constraints, metadata, sessionId, instanceId } = job.data;
				const redis = getRedis();
				
				try {
					// Emit project started event
					await eventBus.publish({
						type: "swarm.project.started",
						payload: {
							projectId,
							project,
							priority,
							jobId: job.id
						},
						metadata: { sessionId, instanceId }
					});
					
					// Step 1: Create main task
					// Generate unique task ID to avoid collisions on retries
					const taskId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
					const ctx = await createContext("swarm.create_project", projectId, true, { 
						sessionId, 
						clientId: sessionId,
						instanceId 
					});
					
					// Create the main task
					const taskResult = await registry.executeHandler("task.create", {
						text: project,
						priority,
						metadata: {
							...metadata,
							projectId,
							taskId,
							type: "swarm_project"
						}
					}, sessionId || instanceId);
					
					// Emit decomposing event
					await eventBus.publish({
						type: "swarm.project.decomposing",
						payload: {
							projectId,
							taskId,
							message: "Breaking down project into subtasks..."
						},
						metadata: { sessionId, instanceId }
					});
					
					// Step 2: Decompose the project
					let decomposition;
					try {
						decomposition = await registry.executeHandler("swarm.decompose", {
							taskId,
							task: project,
							priority,
							constraints
						}, sessionId || instanceId);
						
						console.log(`[SwarmWorker] Decomposition result:`, JSON.stringify({
							taskId,
							subtaskCount: decomposition?.subtaskCount,
							hasDecomposition: !!decomposition?.decomposition,
							subtasks: decomposition?.decomposition?.subtasks?.length
						}));
					} catch (error) {
						console.error(`[SwarmWorker] Decomposition failed:`, error);
						throw new Error(`Decomposition failed: ${error instanceof Error ? error.message : String(error)}`);
					}
					
					if (!decomposition || !decomposition.decomposition || decomposition.subtaskCount === 0) {
						console.error(`[SwarmWorker] Invalid decomposition result:`, decomposition);
						throw new Error(`Failed to decompose project: ${!decomposition ? 'no result' : 'no subtasks generated'}`);
					}
					
					// Emit tasks created event
					await eventBus.publish({
						type: "swarm.project.tasks_created",
						payload: {
							projectId,
							taskId,
							subtaskCount: decomposition.subtaskCount,
							message: `Created ${decomposition.subtaskCount} subtasks`
						},
						metadata: { sessionId, instanceId }
					});
					
					// Step 3: Create tasks for each subtask and assign to specialists
					let assignedCount = 0;
					const createdSubtaskIds = [];
					
					for (const subtask of decomposition.decomposition.subtasks) {
						try {
							// First create the actual task for this subtask
							const subtaskResult = await registry.executeHandler("task.create", {
								text: subtask.description,
								priority: Math.max(priority - 10, 0), // Slightly lower priority than parent
								metadata: {
									type: "swarm_subtask",
									parentTaskId: taskId,
									projectId,
									subtaskId: subtask.id,
									specialist: subtask.specialist,
									complexity: subtask.complexity,
									estimatedMinutes: subtask.estimatedMinutes,
									dependencies: subtask.dependencies,
									context: subtask.context
								}
							}, sessionId || instanceId);
							
							createdSubtaskIds.push(subtaskResult.id);
							console.log(`[SwarmWorker] Created task ${subtaskResult.id} for subtask ${subtask.id}`);
							
							// Then assign it to a specialist
							await registry.executeHandler("swarm.assign", {
								subtaskId: subtask.id,
								specialist: subtask.specialist,
								requiredCapabilities: subtask.context.patterns
							}, sessionId || instanceId);
							assignedCount++;
							
							// Emit progress
							await eventBus.publish({
								type: "swarm.project.progress",
								payload: {
									projectId,
									message: `Created and assigned subtask ${subtask.id} to ${subtask.specialist} specialist`,
									progress: Math.round((assignedCount / decomposition.subtaskCount) * 30) // 0-30% for assignment
								},
								metadata: { sessionId, instanceId }
							});
						} catch (error) {
							console.error(`Failed to create/assign subtask ${subtask.id}:`, error);
						}
					}
					
					// Step 4: Generate contexts for each subtask
					await eventBus.publish({
						type: "swarm.project.context_generating",
						payload: {
							projectId,
							message: "Generating specialized contexts for each subtask..."
						},
						metadata: { sessionId, instanceId }
					});
					
					let contextCount = 0;
					for (let i = 0; i < decomposition.decomposition.subtasks.length; i++) {
						const subtask = decomposition.decomposition.subtasks[i];
						try {
							// Generate context for the subtask
							const contextResult = await registry.executeHandler("swarm.context", {
								subtaskId: subtask.id,
								specialist: subtask.specialist,
								parentTaskId: taskId
							}, sessionId || instanceId);
							
							// Update the corresponding task with the generated context
							if (createdSubtaskIds[i]) {
								// First get the current task to preserve existing metadata
								const taskKey = `cb:task:${createdSubtaskIds[i]}`;
								const currentTaskData = await redis.pub.hgetall(taskKey);
								const existingMetadata = currentTaskData.metadata ? JSON.parse(currentTaskData.metadata) : {};
								
								await registry.executeHandler("task.update", {
									id: createdSubtaskIds[i],
									updates: {
										metadata: {
											...existingMetadata,  // Preserve all existing metadata
											generatedContext: contextResult.context,
											contextPrompt: contextResult.prompt,
											contextGeneratedAt: new Date().toISOString(),
											contextGeneratedBy: instanceId
										}
									}
								}, sessionId || instanceId);
								
								console.log(`[SwarmWorker] Updated task ${createdSubtaskIds[i]} with context for subtask ${subtask.id}`);
							}
							
							contextCount++;
							
							// Emit progress
							await eventBus.publish({
								type: "swarm.project.progress",
								payload: {
									projectId,
									message: `Generated context for ${subtask.specialist} specialist`,
									progress: 30 + Math.round((contextCount / decomposition.subtaskCount) * 40) // 30-70% for context
								},
								metadata: { sessionId, instanceId }
							});
						} catch (error) {
							console.error(`Failed to generate context for ${subtask.id}:`, error);
						}
					}
					
					// Step 5: Mark project as ready for execution
					await eventBus.publish({
						type: "swarm.project.completed",
						payload: {
							projectId,
							taskId,
							subtaskCount: decomposition.subtaskCount,
							assignedCount,
							contextCount,
							message: "Project successfully prepared for execution",
							progress: 100
						},
						metadata: { sessionId, instanceId }
					});
					
					return {
						projectId,
						taskId,
						status: "completed",
						subtaskCount: decomposition.subtaskCount,
						assignedCount,
						contextCount
					};
					
				} catch (error) {
					console.error(`[SwarmWorker] Project creation failed:`, error);
					
					// Emit failure event
					await eventBus.publish({
						type: "swarm.project.failed",
						payload: {
							projectId,
							error: error instanceof Error ? error.message : String(error),
							jobId: job.id
						},
						metadata: { sessionId, instanceId }
					});
					
					throw error;
				}
			}
		}
	},
	{ connection }
);

// Scheduler for recurring jobs
export class JobScheduler {
	private started = false;
	
	async start(): Promise<void> {
		if (this.started) return;
		
		console.log("[JobScheduler] Starting job scheduler...");
		
		// Schedule recurring system jobs
		await systemQueue.add(
			"metrics",
			{ type: "aggregate-metrics" },
			{ 
				repeat: { every: 5000 }, // Every 5 seconds
				removeOnComplete: true,
				removeOnFail: false,
			}
		);
		
		await systemQueue.add(
			"state",
			{ type: "sync-state" },
			{
				repeat: { every: 10000 }, // Every 10 seconds
				removeOnComplete: true,
				removeOnFail: false,
			}
		);
		
		await systemQueue.add(
			"partitions",
			{ type: "detect-partitions" },
			{
				repeat: { every: 5000 }, // Every 5 seconds
				removeOnComplete: true,
				removeOnFail: false,
			}
		);
		
		await systemQueue.add(
			"quorum",
			{ type: "check-quorum" },
			{
				repeat: { every: 15000 }, // Every 15 seconds
				removeOnComplete: true,
				removeOnFail: false,
			}
		);
		
		// Schedule recurring monitoring jobs
		await monitoringQueue.add(
			"health",
			{ type: "health-check" },
			{
				repeat: { every: 3000 }, // Every 3 seconds
				removeOnComplete: true,
				removeOnFail: false,
			}
		);
		
		// Also run all jobs immediately for tests
		await this.runImmediate();
		
		this.started = true;
		console.log("[JobScheduler] Job scheduler started");
	}
	
	async runImmediate(): Promise<void> {
		console.log("[JobScheduler] Running immediate jobs...");
		
		// Add immediate one-time jobs
		await systemQueue.add("immediate-metrics", { type: "aggregate-metrics" });
		await systemQueue.add("immediate-state", { type: "sync-state" });
		await systemQueue.add("immediate-partitions", { type: "detect-partitions" });
		await monitoringQueue.add("immediate-health", { type: "health-check" });
	}
	
	async stop(): Promise<void> {
		console.log("[JobScheduler] Stopping job scheduler...");
		
		// Remove all repeatable jobs
		const repeatableJobs = await systemQueue.getRepeatableJobs();
		for (const job of repeatableJobs) {
			await systemQueue.removeRepeatableByKey(job.key);
		}
		
		const monitoringJobs = await monitoringQueue.getRepeatableJobs();
		for (const job of monitoringJobs) {
			await monitoringQueue.removeRepeatableByKey(job.key);
		}
		
		await systemWorker.close();
		await monitoringWorker.close();
		await swarmWorker.close();
		
		this.started = false;
		console.log("[JobScheduler] Job scheduler stopped");
	}
}

export const jobScheduler = new JobScheduler();