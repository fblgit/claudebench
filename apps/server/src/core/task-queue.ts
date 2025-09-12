import { getRedis, redisKey } from "./redis";
import { redisScripts } from "./redis-scripts";

export interface QueuedTask {
	id: string;
	priority: number;
	text: string;
	assignedTo?: string;
	createdAt: number;
}

export interface InstanceCapacity {
	instanceId: string;
	maxTasks: number;
	currentTasks: number;
}

export class TaskQueueManager {
	private redis = getRedis();
	private defaultCapacity = 10;

	// Add task to global pending queue
	async enqueueTask(taskId: string, priority: number = 50): Promise<void> {
		const globalQueueKey = redisKey("queue", "tasks", "pending");
		// Use negative priority for descending order (higher priority first)
		await this.redis.stream.zadd(globalQueueKey, -priority, taskId);
		
		// Metrics are now tracked centrally in Registry
	}

	// Assign tasks to available workers
	async assignTasksToWorkers(): Promise<void> {
		const globalQueueKey = redisKey("queue", "tasks", "pending");
		
		// Get pending tasks (sorted by priority)
		const pendingTasks = await this.redis.stream.zrange(globalQueueKey, 0, -1);
		if (pendingTasks.length === 0) return;
		
		// Use Lua script for atomic load-balanced assignment
		for (const taskId of pendingTasks) {
			const result = await redisScripts.assignTaskWithLoadBalancing(taskId);
			
			if (result.success && result.assignedTo) {
				console.log(`Task ${taskId} assigned to ${result.assignedTo} (queue depth: ${result.queueDepth})`);
			}
		}
	}

	// Assign a specific task to an instance
	private async assignTaskToInstance(taskId: string, instanceKeys: string[]): Promise<boolean> {
		// Find instance with least load
		let bestInstance: string | null = null;
		let minLoad = Infinity;
		
		for (const instanceKey of instanceKeys) {
			const instanceId = instanceKey.split(":").pop()!;
			const capacity = await this.getInstanceCapacity(instanceId);
			
			if (capacity.currentTasks < capacity.maxTasks && capacity.currentTasks < minLoad) {
				minLoad = capacity.currentTasks;
				bestInstance = instanceId;
			}
		}
		
		if (!bestInstance) return false;
		
		// Assign task to instance queue
		const instanceQueueKey = redisKey("queue", "instance", bestInstance);
		await this.redis.stream.rpush(instanceQueueKey, taskId);
		
		// NOTE: Don't update task.assignedTo here - that should be done by task.assign handler
		// This method is for queue management only
		
		// Track assignment history
		const historyKey = redisKey("history", "assignments");
		const historyEntry = JSON.stringify({
			taskId,
			instanceId: bestInstance,
			timestamp: Date.now(),
		});
		await this.redis.stream.lpush(historyKey, historyEntry);
		await this.redis.stream.ltrim(historyKey, 0, 999); // Keep last 1000
		await this.redis.stream.expire(historyKey, 86400); // 24 hours
		
		return true;
	}

	// Get instance capacity and current load
	async getInstanceCapacity(instanceId: string): Promise<InstanceCapacity> {
		const capacityKey = redisKey("capacity", instanceId);
		const maxTasks = await this.redis.stream.hget(capacityKey, "maxTasks");
		
		const queueKey = redisKey("queue", "instance", instanceId);
		const currentTasks = await this.redis.stream.llen(queueKey);
		
		return {
			instanceId,
			maxTasks: parseInt(maxTasks || String(this.defaultCapacity)),
			currentTasks,
		};
	}

	// Set instance capacity
	async setInstanceCapacity(instanceId: string, maxTasks: number): Promise<void> {
		const capacityKey = redisKey("capacity", instanceId);
		await this.redis.stream.hset(capacityKey, "maxTasks", maxTasks.toString());
		await this.redis.stream.expire(capacityKey, 3600); // 1 hour
	}

	// Reassign tasks from failed instance
	async reassignTasksFromFailedInstance(failedInstanceId: string): Promise<void> {
		const failedQueueKey = redisKey("queue", "instance", failedInstanceId);
		const reassignedKey = redisKey("reassigned", "from", failedInstanceId);
		
		// Get all tasks from failed instance
		const tasks = await this.redis.stream.lrange(failedQueueKey, 0, -1);
		
		// Clear the failed queue
		await this.redis.stream.del(failedQueueKey);
		
		// Mark instance as offline
		const instanceKey = redisKey("instance", failedInstanceId);
		await this.redis.stream.hset(instanceKey, "status", "OFFLINE");
		
		// Re-add tasks to global queue for reassignment
		for (const taskId of tasks) {
			// Get task priority
			const taskKey = redisKey("task", taskId);
			const priority = await this.redis.stream.hget(taskKey, "priority");
			
			// Add back to global queue
			await this.enqueueTask(taskId, parseInt(priority || "50"));
			
			// Track reassignment
			await this.redis.stream.sadd(reassignedKey, taskId);
		}
		
		await this.redis.stream.expire(reassignedKey, 3600); // 1 hour
		
		// Trigger reassignment
		await this.assignTasksToWorkers();
	}

	// Get task from instance queue
	async getNextTask(instanceId: string): Promise<string | null> {
		const queueKey = redisKey("queue", "instance", instanceId);
		const taskId = await this.redis.stream.lpop(queueKey);
		return taskId;
	}

	// Complete task and remove from queue
	async completeTask(taskId: string, instanceId: string): Promise<void> {
		const queueKey = redisKey("queue", "instance", instanceId);
		await this.redis.stream.lrem(queueKey, 1, taskId);
		
		// Update task status
		const taskKey = redisKey("task", taskId);
		await this.redis.stream.hset(taskKey, "status", "COMPLETED");
		
		// Metrics are now tracked centrally in Registry when task.complete is called
	}

	// Check for duplicate assignments
	async isTaskAssigned(taskId: string): Promise<boolean> {
		const instanceKeys = await this.redis.stream.keys(redisKey("queue", "instance", "*"));
		let foundCount = 0;
		
		for (const queueKey of instanceKeys) {
			const position = await this.redis.stream.lpos(queueKey, taskId);
			if (position !== null) foundCount++;
		}
		
		return foundCount > 0;
	}

	// Load balance check
	async getLoadBalance(): Promise<Map<string, number>> {
		const instanceKeys = await this.redis.stream.keys(redisKey("queue", "instance", "*"));
		const loads = new Map<string, number>();
		
		for (const queueKey of instanceKeys) {
			const instanceId = queueKey.split(":").pop()!;
			const queueLength = await this.redis.stream.llen(queueKey);
			loads.set(instanceId, queueLength);
		}
		
		return loads;
	}

	// Get queue metrics (now reads from centralized metrics)
	async getMetrics(): Promise<any> {
		const metricsKey = redisKey("metrics", "queues");
		const metrics = await this.redis.stream.hgetall(metricsKey);
		
		// Get current queue depth
		const globalQueueKey = redisKey("queue", "tasks", "pending");
		const currentDepth = await this.redis.stream.zcard(globalQueueKey);
		
		// Calculate derived metrics
		const totalTasks = parseInt(metrics.totalTasks || "0");
		const tasksCompleted = parseInt(metrics.tasksCompleted || "0");
		const tasksPending = currentDepth;
		const avgWaitTime = totalTasks > 0 ? ((totalTasks - tasksCompleted) * 1000) / totalTasks : 0;
		
		// Calculate throughput
		const throughput = tasksCompleted / (Date.now() / 1000 / 60); // tasks per minute
		
		return {
			totalTasks,
			tasksCompleted,
			tasksPending,
			avgWaitTime: avgWaitTime.toFixed(2),
			throughput: throughput.toFixed(2),
		};
	}

	// Register worker instance
	async registerWorker(instanceId: string, roles: string[] = ["worker"]): Promise<void> {
		const instanceKey = redisKey("instance", instanceId);
		await this.redis.stream.hset(instanceKey, {
			id: instanceId,
			roles: JSON.stringify(roles),
			status: "ONLINE",
			lastSeen: Date.now().toString(),
		});
		await this.redis.stream.expire(instanceKey, 30); // 30 second heartbeat timeout
		
		// Initialize capacity
		await this.setInstanceCapacity(instanceId, this.defaultCapacity);
		
		// Initialize empty queue
		const queueKey = redisKey("queue", "instance", instanceId);
		await this.redis.stream.del(queueKey); // Clear any old data
	}

	// Update instance heartbeat
	async heartbeat(instanceId: string): Promise<void> {
		const instanceKey = redisKey("instance", instanceId);
		await this.redis.stream.hset(instanceKey, "lastSeen", Date.now().toString());
		await this.redis.stream.expire(instanceKey, 30); // Reset TTL
	}
}

export const taskQueue = new TaskQueueManager();