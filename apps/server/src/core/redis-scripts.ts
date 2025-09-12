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
}

export const redisScripts = new RedisScriptExecutor();