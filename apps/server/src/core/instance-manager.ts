import { getRedis, redisKey } from "./redis";
import { taskQueue } from "./task-queue";
import { circuitBreaker } from "./circuit-breaker";

export interface Instance {
	id: string;
	roles: string[];
	health: "healthy" | "degraded" | "unhealthy";
	lastSeen: number;
	metadata?: {
		version?: string;
		capabilities?: string[];
		resources?: {
			cpu?: number;
			memory?: number;
		};
	};
}

export class InstanceManager {
	private redis = getRedis();
	private heartbeatTimeout = 30000; // 30 seconds
	private healthCheckInterval: NodeJS.Timeout | null = null;

	// Register an instance
	async register(id: string, roles: string[]): Promise<boolean> {
		const instanceKey = redisKey("instance", id);
		
		const instance: Instance = {
			id,
			roles,
			health: "healthy",
			lastSeen: Date.now(),
		};
		
		await this.redis.stream.hset(instanceKey, {
			id,
			roles: JSON.stringify(roles),
			health: instance.health,
			lastSeen: instance.lastSeen.toString(),
		});
		
		// Set TTL for automatic cleanup
		await this.redis.stream.expire(instanceKey, this.heartbeatTimeout / 1000);
		
		// Register roles for discovery
		for (const role of roles) {
			const roleKey = redisKey("role", role);
			await this.redis.stream.sadd(roleKey, id);
			// Set TTL on role sets too
			await this.redis.stream.expire(roleKey, this.heartbeatTimeout / 1000);
		}
		
		// Register with task queue
		await taskQueue.registerWorker(id, roles).catch(() => {}); // Don't fail if queue not ready
		
		// Start health monitoring if not already running
		if (!this.healthCheckInterval) {
			this.startHealthMonitoring();
		}
		
		return true;
	}

	// Update instance heartbeat
	async heartbeat(instanceId: string): Promise<boolean> {
		const instanceKey = redisKey("instance", instanceId);
		const exists = await this.redis.stream.exists(instanceKey);
		
		if (!exists) {
			return false;
		}
		
		const now = new Date().toISOString();
		await this.redis.stream.hset(instanceKey, {
			lastSeen: Date.now().toString(),
			lastHeartbeat: now, // Keep both for compatibility
		});
		await this.redis.stream.expire(instanceKey, this.heartbeatTimeout / 1000);
		
		// Update task queue heartbeat
		await taskQueue.heartbeat(instanceId).catch(() => {}); // Don't fail if queue not initialized
		
		// Sync circuit breaker state
		await circuitBreaker.syncAcrossInstances("global", instanceId).catch(() => {}); // Don't fail if not ready
		
		return true;
	}

	// Get all active instances
	async getActiveInstances(): Promise<Instance[]> {
		const pattern = redisKey("instance", "*");
		const instanceKeys = await this.redis.stream.keys(pattern);
		const instances: Instance[] = [];
		
		for (const key of instanceKeys) {
			const data = await this.redis.stream.hgetall(key);
			if (data.id) {
				instances.push({
					id: data.id,
					roles: JSON.parse(data.roles || "[]"),
					health: data.health as Instance["health"] || "healthy",
					lastSeen: parseInt(data.lastSeen || "0"),
				});
			}
		}
		
		return instances;
	}

	// Check instance health
	async checkHealth(instanceId: string): Promise<Instance["health"]> {
		const instanceKey = redisKey("instance", instanceId);
		const data = await this.redis.stream.hgetall(instanceKey);
		
		if (!data.lastSeen) {
			return "unhealthy";
		}
		
		const lastSeen = parseInt(data.lastSeen);
		const now = Date.now();
		const timeSinceLastSeen = now - lastSeen;
		
		if (timeSinceLastSeen > this.heartbeatTimeout) {
			return "unhealthy";
		} else if (timeSinceLastSeen > this.heartbeatTimeout / 2) {
			return "degraded";
		}
		
		return "healthy";
	}

	// Start periodic health monitoring
	private startHealthMonitoring(): void {
		this.healthCheckInterval = setInterval(async () => {
			await this.monitorInstances();
		}, 5000); // Check every 5 seconds
	}

	// Monitor all instances
	private async monitorInstances(): Promise<void> {
		const instances = await this.getActiveInstances();
		
		for (const instance of instances) {
			const health = await this.checkHealth(instance.id);
			
			if (health !== instance.health) {
				// Update health status
				const instanceKey = redisKey("instance", instance.id);
				await this.redis.stream.hset(instanceKey, "health", health);
				
				if (health === "unhealthy") {
					// Handle failed instance
					await this.handleFailedInstance(instance.id);
				}
			}
		}
	}

	// Handle failed instance
	private async handleFailedInstance(instanceId: string): Promise<void> {
		// Reassign tasks from failed instance
		await taskQueue.reassignTasksFromFailedInstance(instanceId);
		
		// Clean up instance data
		const instanceKey = redisKey("instance", instanceId);
		await this.redis.stream.del(instanceKey);
		
		// Log the failure
		console.error(`Instance ${instanceId} marked as failed and cleaned up`);
	}

	// Get instance by role
	async getInstancesByRole(role: string): Promise<Instance[]> {
		const allInstances = await this.getActiveInstances();
		return allInstances.filter(instance => instance.roles.includes(role));
	}

	// Distribute event to instances
	async distributeEvent(event: any, targetRole?: string): Promise<void> {
		const instances = targetRole 
			? await this.getInstancesByRole(targetRole)
			: await this.getActiveInstances();
		
		// Publish event to all matching instances
		for (const instance of instances) {
			const eventKey = redisKey("events", instance.id);
			await this.redis.stream.lpush(eventKey, JSON.stringify(event));
			await this.redis.stream.expire(eventKey, 60); // 1 minute TTL
		}
	}

	// Get system state for recovery
	async getSystemState(): Promise<any> {
		const instances = await this.getActiveInstances();
		const tasksKey = redisKey("task", "*");
		const taskKeys = await this.redis.stream.keys(tasksKey);
		
		const tasks = [];
		// Limit to first 10 tasks for performance
		for (const key of taskKeys.slice(0, 10)) {
			const task = await this.redis.stream.hgetall(key);
			if (task.id) {
				tasks.push(task);
			}
		}
		
		// Get recent events from stream
		const eventStreamKey = redisKey("stream", "events");
		const recentEvents = await this.redis.stream.xrevrange(
			eventStreamKey,
			"+",
			"-",
			"COUNT",
			"10"
		).catch(() => []); // Fallback if stream doesn't exist
		
		return {
			instances: instances.slice(0, 10).map(i => ({
				id: i.id,
				roles: i.roles,
				health: i.health,
			})),
			tasks: tasks, // Already limited to 10
			recentEvents: recentEvents.map((e: any) => e[1]), // Extract event data
		};
	}

	// Cleanup on shutdown
	async cleanup(): Promise<void> {
		if (this.healthCheckInterval) {
			clearInterval(this.healthCheckInterval);
			this.healthCheckInterval = null;
		}
	}
}

export const instanceManager = new InstanceManager();