/**
 * Redis Script Executor
 * Provides typed interfaces for executing Lua scripts
 */

import { getRedis, redisKey } from "./redis";
import * as scripts from "./lua-scripts";

export class RedisScriptExecutor {
	private redis = getRedis();
	
	/**
	 * Ensures exactly-once event delivery
	 */
	async ensureExactlyOnce(eventId: string): Promise<{ isDuplicate: boolean; duplicateCount: number }> {
		const result = await this.redis.stream.eval(
			scripts.EXACTLY_ONCE_DELIVERY,
			2,
			redisKey("processed", "events"),
			redisKey("duplicates", "prevented"),
			eventId
		) as [number, number];
		
		return {
			isDuplicate: result[0] === 1,
			duplicateCount: result[1],
		};
	}
	
	/**
	 * Assigns task to best available instance
	 */
	async assignTaskWithLoadBalancing(taskId: string): Promise<{ 
		assignedTo: string | null;
		queueDepth: number;
		success: boolean;
	}> {
		const result = await this.redis.stream.eval(
			scripts.ASSIGN_TASK_WITH_LOAD_BALANCING,
			3,
			redisKey("instance", "*"),
			redisKey("queue", "tasks", "pending"),
			redisKey("history", "assignments"),
			taskId,
			Date.now().toString()
		) as [string | null, number, number];
		
		return {
			assignedTo: result[0],
			queueDepth: result[1],
			success: result[2] === 1,
		};
	}
	
	/**
	 * Updates gossip health data
	 */
	async updateGossipHealth(
		instanceId: string,
		healthStatus: string
	): Promise<{ updated: boolean; partitionDetected: boolean }> {
		const result = await this.redis.stream.eval(
			scripts.GOSSIP_HEALTH_UPDATE,
			3,
			redisKey("gossip", "health"),
			redisKey("partition", "detected"),
			redisKey("partition", "recovery"),
			instanceId,
			healthStatus,
			Date.now().toString()
		) as [number, number];
		
		return {
			updated: result[0] === 1,
			partitionDetected: result[1] === 1,
		};
	}
	
	/**
	 * Adds vote and checks for quorum
	 */
	async addQuorumVote(
		voteId: string,
		voteValue: string,
		totalInstances: number
	): Promise<{ 
		quorumReached: boolean;
		decision: string | null;
		voteCount: number;
	}> {
		const result = await this.redis.stream.eval(
			scripts.QUORUM_VOTE,
			2,
			redisKey("quorum", "decision", "latest"),
			redisKey("quorum", "result"),
			voteId,
			voteValue,
			totalInstances.toString(),
			Date.now().toString()
		) as [number, string | null, number];
		
		return {
			quorumReached: result[0] === 1,
			decision: result[1],
			voteCount: result[2],
		};
	}
	
	/**
	 * Aggregates global metrics
	 */
	async aggregateGlobalMetrics(): Promise<{
		totalEvents: number;
		totalTasks: number;
		avgLatency: number;
		throughput: number;
		instanceCount: number;
	}> {
		const result = await this.redis.stream.eval(
			scripts.AGGREGATE_GLOBAL_METRICS,
			3,
			redisKey("metrics", "global"),
			redisKey("instance", "*"),
			redisKey("metrics", "scaling"),
		) as [number, number, number, number, number];
		
		return {
			totalEvents: result[0],
			totalTasks: result[1],
			avgLatency: result[2],
			throughput: result[3],
			instanceCount: result[4],
		};
	}
	
	/**
	 * Adds event to partition with ordering
	 */
	async partitionEvent(
		partitionKey: string,
		eventId: string,
		eventData: any
	): Promise<{ success: boolean; listLength: number }> {
		const result = await this.redis.stream.eval(
			scripts.PARTITION_EVENT,
			1,
			redisKey("partition", partitionKey),
			eventId,
			Date.now().toString(),
			JSON.stringify(eventData)
		) as [number, number];
		
		return {
			success: result[0] === 1,
			listLength: result[1],
		};
	}
	
	/**
	 * Coordinates batch processing
	 */
	async coordinateBatch(
		processorId: string,
		batchId: string,
		totalItems: number
	): Promise<{
		lockAcquired: boolean;
		currentProcessor: string;
		progress: number;
	}> {
		const result = await this.redis.stream.eval(
			scripts.COORDINATE_BATCH,
			3,
			redisKey("batch", "lock"),
			redisKey("batch", "progress"),
			redisKey("batch", "current"),
			processorId,
			batchId,
			totalItems.toString()
		) as [number, string, number];
		
		return {
			lockAcquired: result[0] === 1,
			currentProcessor: result[1],
			progress: result[2],
		};
	}
	
	/**
	 * Syncs global state with versioning
	 */
	async syncGlobalState(stateData: any): Promise<{
		success: boolean;
		version: number;
	}> {
		const result = await this.redis.stream.eval(
			scripts.SYNC_GLOBAL_STATE,
			1,
			redisKey("state", "global"),
			JSON.stringify(stateData),
			Date.now().toString()
		) as [number, number];
		
		return {
			success: result[0] === 1,
			version: result[1],
		};
	}
	
	/**
	 * Creates task atomically with queue addition
	 */
	async createTask(
		taskId: string,
		text: string,
		priority: number,
		status: string,
		createdAt: string,
		metadata: any
	): Promise<{ success: boolean; taskId: string | null; error?: string }> {
		const result = await this.redis.stream.eval(
			scripts.TASK_CREATE,
			2,
			redisKey("task", taskId),
			redisKey("queue", "tasks", "pending"),
			taskId,
			text,
			priority.toString(),
			status,
			createdAt,
			JSON.stringify(metadata || {})
		) as [number, string];
		
		return {
			success: result[0] === 1,
			taskId: result[0] === 1 ? result[1] : null,
			error: result[0] === 0 ? result[1] : undefined,
		};
	}
	
	/**
	 * Worker claims next available task
	 */
	async claimTask(
		workerId: string
	): Promise<{ claimed: boolean; taskId: string | null; task: any }> {
		const result = await this.redis.stream.eval(
			scripts.TASK_CLAIM,
			3,
			redisKey("queue", "tasks", "pending"),
			redisKey("queue", "instance", workerId),
			redisKey("history", "assignments"),
			workerId,
			Date.now().toString()
		) as [number, string | null, string | null];
		
		return {
			claimed: result[0] === 1,
			taskId: result[1],
			task: result[2] ? JSON.parse(result[2]) : null,
		};
	}
	
	/**
	 * Reassign task with deny list (taint/toleration)
	 */
	async reassignTask(
		taskId: string,
		targetWorker: string | null,
		reason: string = "rebalance"
	): Promise<{ success: boolean; target: string; error?: string }> {
		const response = await this.redis.stream.eval(
			scripts.TASK_REASSIGN,
			2,
			redisKey("task", taskId),
			redisKey("queue", "tasks", "pending"),
			taskId,
			targetWorker || "",
			reason
		) as [number, string];
		
		if (response[0] === 0) {
			return { success: false, target: "", error: response[1] };
		}
		
		return { success: true, target: response[1] };
	}
	
	/**
	 * Completes task with cleanup
	 */
	async completeTask(
		taskId: string,
		result: any,
		completedAt: string,
		duration: number
	): Promise<{ success: boolean; status: string; error?: string }> {
		const response = await this.redis.stream.eval(
			scripts.TASK_COMPLETE,
			1,
			redisKey("task", taskId),
			taskId,
			JSON.stringify(result || null),
			completedAt,
			duration.toString()
		) as [number, string];
		
		return {
			success: response[0] === 1,
			status: response[0] === 1 ? response[1] : "failed",
			error: response[0] === 0 ? response[1] : undefined,
		};
	}
	
	/**
	 * Updates task with queue repositioning
	 */
	async updateTask(
		taskId: string,
		updates: any,
		updatedAt: string
	): Promise<{ success: boolean; taskId: string | null; error?: string }> {
		const result = await this.redis.stream.eval(
			scripts.TASK_UPDATE,
			2,
			redisKey("task", taskId),
			redisKey("queue", "tasks", "pending"),
			taskId,
			JSON.stringify(updates),
			updatedAt
		) as [number, string];
		
		return {
			success: result[0] === 1,
			taskId: result[0] === 1 ? result[1] : null,
			error: result[0] === 0 ? result[1] : undefined,
		};
	}
	
	/**
	 * Check for tasks needing auto-assignment after delay
	 */
	async checkDelayedTasks(delayMs: number, maxTasks: number = 10): Promise<string[]> {
		const tasks = await this.redis.stream.eval(
			scripts.CHECK_DELAYED_TASKS,
			1,
			redisKey("queue", "tasks", "pending"),
			delayMs.toString(),
			maxTasks.toString()
		) as string[];
		
		return tasks;
	}
	
	/**
	 * Auto-assigns tasks to a worker
	 */
	async autoAssignTasks(
		workerId: string
	): Promise<{ assigned: number; total: number }> {
		const result = await this.redis.stream.eval(
			scripts.AUTO_ASSIGN_TASKS,
			1,
			redisKey("queue", "tasks", "pending"),
			workerId
		) as [number, number];
		
		return {
			assigned: result[0],
			total: result[1],
		};
	}
	
	/**
	 * Registers instance atomically
	 */
	async registerInstance(
		instanceId: string,
		roles: string[],
		ttl: number
	): Promise<{ success: boolean; becameLeader: boolean }> {
		const result = await this.redis.stream.eval(
			scripts.INSTANCE_REGISTER,
			2,
			redisKey("instance", instanceId),
			redisKey("instances", "active"),
			instanceId,
			JSON.stringify(roles),
			Date.now().toString(),
			ttl.toString()
		) as [number, number];
		
		return {
			success: result[0] === 1,
			becameLeader: result[1] === 1,
		};
	}
	
	/**
	 * Updates instance heartbeat
	 */
	async instanceHeartbeat(
		instanceId: string,
		ttl: number
	): Promise<{ success: boolean; isLeader: boolean; error?: string }> {
		const result = await this.redis.stream.eval(
			scripts.INSTANCE_HEARTBEAT,
			2,
			redisKey("instance", instanceId),
			redisKey("gossip", "health"),
			instanceId,
			Date.now().toString(),
			ttl.toString(),
			new Date().toISOString()  // Pass ISO string for lastHeartbeat
		) as [number, string | number];
		
		return {
			success: result[0] === 1,
			isLeader: result[0] === 1 ? (result[1] as number) === 1 : false,
			error: result[0] === 0 ? (result[1] as string) : undefined,
		};
	}
	
	/**
	 * Gets system health
	 */
	async getSystemHealth(
		timeout: number
	): Promise<{ 
		status: string;
		services: { redis: boolean; postgres: boolean; mcp: boolean };
		healthy: number;
		total: number;
	}> {
		const result = await this.redis.stream.eval(
			scripts.GET_SYSTEM_HEALTH,
			2,
			"cb:instance:*",
			redisKey("gossip", "health"),
			Date.now().toString(),
			timeout.toString()
		) as [string, number, number, number, number, number];
		
		return {
			status: result[0],
			services: {
				redis: result[1] === 1,
				postgres: result[2] === 1,
				mcp: result[3] === 1,
			},
			healthy: result[4],
			total: result[5],
		};
	}
	
	/**
	 * Gets system state
	 */
	async getSystemState(): Promise<{ 
		instances: any[];
		tasks: any[];
		recentEvents: any[];
	}> {
		const result = await this.redis.stream.eval(
			scripts.GET_SYSTEM_STATE,
			3,
			"cb:instance:*",
			"cb:task:*",
			redisKey("stream", "events"),
		) as [string, string, string];
		
		return {
			instances: JSON.parse(result[0]),
			tasks: JSON.parse(result[1]),
			recentEvents: JSON.parse(result[2]),
		};
	}
	
	/**
	 * Reassigns tasks from failed instance to healthy workers
	 */
	async reassignFailedTasks(
		failedInstanceId: string
	): Promise<{ reassigned: number; workers: number; error?: string }> {
		const result = await this.redis.stream.eval(
			scripts.REASSIGN_FAILED_TASKS,
			0,
			failedInstanceId
		) as [number, number | string];
		
		if (typeof result[1] === 'string') {
			return {
				reassigned: 0,
				workers: 0,
				error: result[1],
			};
		}
		
		return {
			reassigned: result[0],
			workers: result[1],
		};
	}
	
	/**
	 * SWARM INTELLIGENCE OPERATIONS
	 */
	
	/**
	 * Decompose and store subtasks atomically
	 */
	async decomposeAndStoreSubtasks(
		parentId: string,
		decomposition: any,
		timestamp: number
	): Promise<{ subtaskCount: number; success: boolean; queuedCount: number }> {
		const result = await this.redis.stream.eval(
			scripts.DECOMPOSE_AND_STORE_SUBTASKS,
			3,
			redisKey("decomposition", parentId),
			redisKey("queue", "subtasks"),
			redisKey("graph", "dependencies"),
			parentId,
			JSON.stringify(decomposition),
			timestamp.toString()
		) as [number, number, number];
		
		return {
			subtaskCount: result[0],
			success: result[1] === 1,
			queuedCount: result[2],
		};
	}
	
	/**
	 * Assign subtask to best specialist
	 */
	async assignToSpecialist(
		subtaskId: string,
		specialistType: string,
		requiredCapabilities: string[]
	): Promise<{ specialistId: string | null; score: number; success: boolean }> {
		const result = await this.redis.stream.eval(
			scripts.ASSIGN_TO_SPECIALIST,
			3,
			redisKey("specialists", specialistType),
			redisKey("subtask", subtaskId),
			redisKey("assignment", subtaskId),
			subtaskId,
			specialistType,
			JSON.stringify(requiredCapabilities),
			Date.now().toString()
		) as [string | null, number, number];
		
		return {
			specialistId: result[0],
			score: result[1],
			success: result[2] === 1,
		};
	}
	
	/**
	 * Detect conflicts and queue for resolution
	 */
	async detectAndQueueConflict(
		taskId: string,
		instanceId: string,
		solution: any
	): Promise<{ conflictDetected: boolean; solutionCount: number }> {
		const result = await this.redis.stream.eval(
			scripts.DETECT_AND_QUEUE_CONFLICT,
			2,
			redisKey("solutions", taskId),
			redisKey("queue", "conflicts"),
			taskId,
			instanceId,
			JSON.stringify(solution),
			Date.now().toString()
		) as [number, number];
		
		return {
			conflictDetected: result[0] === 1,
			solutionCount: result[1],
		};
	}
	
	/**
	 * Track and synthesize progress
	 */
	async synthesizeProgress(
		parentId: string,
		subtaskId: string,
		progress: any
	): Promise<{ readyForSynthesis: boolean; success: boolean; unblockedCount: number }> {
		const result = await this.redis.stream.eval(
			scripts.SYNTHESIZE_PROGRESS,
			3,
			redisKey("progress", parentId),
			redisKey("queue", "integration"),
			redisKey("decomposition", parentId),
			parentId,
			subtaskId,
			JSON.stringify(progress),
			Date.now().toString()
		) as [number, number, number];
		
		return {
			readyForSynthesis: result[0] === 1,
			success: result[1] === 1,
			unblockedCount: result[2],
		};
	}
	
	/**
	 * Get active specialists by type
	 */
	async getActiveSpecialists(): Promise<Array<{
		id: string;
		type: string;
		capabilities: string[];
		currentLoad: number;
		maxCapacity: number;
	}>> {
		const redis = getRedis();
		const instances = await redis.pub.keys("cb:instance:*");
		const specialists = [];
		
		for (const key of instances) {
			const data = await redis.pub.hgetall(key);
			if (data.health === "healthy" && data.capabilities) {
				const id = key.replace("cb:instance:", "");
				const capabilities = JSON.parse(data.capabilities || "[]");
				const load = await redis.pub.llen(`cb:queue:instance:${id}`);
				
				// Determine specialist type from capabilities
				let type = "general";
				if (capabilities.includes("react") || capabilities.includes("vue")) {
					type = "frontend";
				} else if (capabilities.includes("node") || capabilities.includes("python")) {
					type = "backend";
				} else if (capabilities.includes("jest") || capabilities.includes("cypress")) {
					type = "testing";
				} else if (capabilities.includes("markdown") || capabilities.includes("docs")) {
					type = "docs";
				}
				
				specialists.push({
					id,
					type,
					capabilities,
					currentLoad: load,
					maxCapacity: parseInt(data.maxCapacity || "5"),
				});
			}
		}
		
		return specialists;
	}
}

export const redisScripts = new RedisScriptExecutor();