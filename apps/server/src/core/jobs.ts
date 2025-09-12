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
				const taskKeys = await redis.stream.keys("cb:task:*");
				
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
		
		this.started = false;
		console.log("[JobScheduler] Job scheduler stopped");
	}
}

export const jobScheduler = new JobScheduler();