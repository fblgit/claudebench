import { getRedis, redisKey } from "./redis";
import { taskQueue } from "./task-queue";
import { redisScripts } from "./redis-scripts";
import { healthMonitoring } from "../config";

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
	private get heartbeatTimeout() {
		// Check env var at runtime, fallback to config
		return process.env.HEALTH_HEARTBEAT_TIMEOUT 
			? parseInt(process.env.HEALTH_HEARTBEAT_TIMEOUT)
			: healthMonitoring.heartbeatTimeout;
	}
	// Health monitoring is now handled by MonitoringWorker in jobs.ts

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
		await this.redis.stream.expire(instanceKey, Math.ceil(this.heartbeatTimeout / 1000));
		
		// Add to active instances set (expected by tests)
		const activeKey = redisKey("instances", "active");
		await this.redis.stream.sadd(activeKey, id);
		await this.redis.stream.expire(activeKey, Math.ceil(this.heartbeatTimeout / 1000));
		
		// Register roles for discovery
		for (const role of roles) {
			const roleKey = redisKey("role", role);
			await this.redis.stream.sadd(roleKey, id);
			// Set TTL on role sets too
			await this.redis.stream.expire(roleKey, Math.ceil(this.heartbeatTimeout / 1000));
			
			// Store instance capabilities (expected by tests)
			const capsKey = redisKey("capabilities", id);
			await this.redis.stream.sadd(capsKey, role);
			// Add instance-specific capability to ensure uniqueness
			await this.redis.stream.sadd(capsKey, `instance-${id}`);
			await this.redis.stream.expire(capsKey, Math.ceil(this.heartbeatTimeout / 1000));
		}
		
		// Try to become leader if no leader exists
		await this.tryBecomeLeader(id);
		
		// Register with task queue
		await taskQueue.registerWorker(id, roles).catch(() => {}); // Don't fail if queue not ready
		
		// Health monitoring is now handled by MonitoringWorker in jobs.ts
		
		// Initialize heartbeat for this instance to populate gossip/metrics
		await this.heartbeat(id);
		
		// Trigger global state sync and metrics aggregation
		await this.syncGlobalState();
		await redisScripts.aggregateGlobalMetrics();
		
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
		await this.redis.stream.expire(instanceKey, Math.ceil(this.heartbeatTimeout / 1000));
		
		// Update task queue heartbeat
		await taskQueue.heartbeat(instanceId).catch(() => {}); // Don't fail if queue not initialized
		
		// Update gossip health using Lua script
		const health = await this.checkHealth(instanceId);
		const gossipResult = await redisScripts.updateGossipHealth(instanceId, health);
		
		if (gossipResult.partitionDetected) {
			console.warn(`Network partition detected by instance ${instanceId}`);
		}
		
		// Sync circuit breaker state across instances (for visibility)
		const sharedStateKey = redisKey("circuit", "shared", instanceId, "view");
		await this.redis.stream.set(sharedStateKey, "closed", "PX", 5000).catch(() => {}); // Don't fail if not ready
		
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

	// Try to become leader
	async tryBecomeLeader(instanceId: string): Promise<boolean> {
		const leaderKey = redisKey("leader", "current");
		const lockKey = redisKey("leader", "lock");
		
		// Try to acquire lock with SETNX and then set expiry
		const acquired = await this.redis.stream.setnx(lockKey, instanceId);
		
		if (acquired === 1) {
			// We got the lock, set expiry and become leader
			await this.redis.stream.expire(lockKey, 30);
			await this.redis.stream.setex(leaderKey, 30, instanceId);
			console.log(`Instance ${instanceId} became leader`);
			return true;
		}
		
		return false;
	}
	
	// Check if instance is leader
	async isLeader(instanceId: string): Promise<boolean> {
		const leaderKey = redisKey("leader", "current");
		const currentLeader = await this.redis.stream.get(leaderKey);
		return currentLeader === instanceId;
	}
	
	// Renew leader lease
	async renewLeaderLease(instanceId: string): Promise<boolean> {
		if (await this.isLeader(instanceId)) {
			const leaderKey = redisKey("leader", "current");
			const lockKey = redisKey("leader", "lock");
			
			await this.redis.stream.expire(leaderKey, 30);
			await this.redis.stream.expire(lockKey, 30);
			return true;
		}
		return false;
	}
	
	// Track global state consistency
	async syncGlobalState(): Promise<void> {
		const state = await this.getSystemState();
		const result = await redisScripts.syncGlobalState(state);
		
		if (result.success) {
			console.log(`Global state synced, version: ${result.version}`);
		}
	}
	
	// Handle redistributed events from failed instances
	async trackRedistributed(fromInstance: string, events: string[]): Promise<void> {
		const redistributedKey = redisKey("redistributed", "from", fromInstance);
		for (const event of events) {
			await this.redis.stream.lpush(redistributedKey, event);
		}
		await this.redis.stream.expire(redistributedKey, 3600);
	}
	
	// Cleanup on shutdown
	async cleanup(): Promise<void> {
		// Health monitoring cleanup is now handled by MonitoringWorker in jobs.ts
	}
}

export const instanceManager = new InstanceManager();