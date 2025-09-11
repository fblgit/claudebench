import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRegisterInput, systemRegisterOutput } from "@/schemas/system.schema";
import type { SystemRegisterInput, SystemRegisterOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";
import { randomBytes } from "crypto";

@EventHandler({
	event: "system.register",
	inputSchema: systemRegisterInput,
	outputSchema: systemRegisterOutput,
	persist: true,
	rateLimit: 10,
	description: "Register a new instance in the system",
})
export class SystemRegisterHandler {
	async handle(input: SystemRegisterInput, ctx: EventContext): Promise<SystemRegisterOutput> {
		// Generate unique instance ID
		const instanceId = `instance-${input.role}-${Date.now()}-${randomBytes(4).toString("hex")}`;
		const registeredAt = new Date().toISOString();
		
		// Generate session token for authentication
		const sessionToken = randomBytes(32).toString("hex");
		
		// Store instance registration
		const instanceKey = redisKey("instances", instanceId);
		const instanceData = {
			id: instanceId,
			name: input.name,
			role: input.role,
			status: "ACTIVE",
			capabilities: JSON.stringify(input.capabilities),
			metadata: input.metadata ? JSON.stringify(input.metadata) : "{}",
			registeredAt,
			lastHeartbeat: registeredAt,
			uptime: "0",
			sessionToken,
			heartbeatInterval: "30000", // 30 seconds default
		};
		
		await ctx.redis.stream.hset(instanceKey, instanceData);
		
		// Set TTL for instance data (will be refreshed by heartbeats)
		await ctx.redis.stream.expire(instanceKey, 120); // 2 minutes
		
		// Register capabilities for discovery
		for (const capability of input.capabilities) {
			const capabilityKey = redisKey("capabilities", capability);
			await ctx.redis.stream.sadd(capabilityKey, instanceId);
		}
		
		// Register role mapping
		const roleKey = redisKey("roles", input.role);
		await ctx.redis.stream.sadd(roleKey, instanceId);
		
		// Initialize instance metrics
		const metricsKey = redisKey("metrics", "instances", instanceId);
		await ctx.redis.stream.hset(metricsKey, {
			registered: registeredAt,
			eventsProcessed: "0",
			tasksCompleted: "0",
			errors: "0",
			lastActivity: registeredAt,
		});
		
		// Store in instance registry (sorted by registration time)
		const registryKey = redisKey("registry", "instances");
		await ctx.redis.stream.zadd(registryKey, Date.now(), instanceId);
		
		// Persist to PostgreSQL if configured
		if (ctx.persist) {
			await ctx.prisma.instance.create({
				data: {
					id: instanceId,
					name: input.name,
					role: input.role,
					status: "ACTIVE",
					capabilities: input.capabilities,
					metadata: input.metadata,
					lastHeartbeat: new Date(registeredAt),
				},
			});
		}
		
		// Check for role-specific initialization
		if (input.role === "worker") {
			// Add worker to task assignment pool
			const workerPoolKey = redisKey("pool", "workers");
			await ctx.redis.stream.sadd(workerPoolKey, instanceId);
			
			// Initialize worker task queue
			const workerQueueKey = redisKey("queue", "worker", instanceId);
			await ctx.redis.stream.del(workerQueueKey); // Clear any old data
		} else if (input.role === "monitor") {
			// Register monitor for event subscriptions
			const monitorKey = redisKey("monitors", instanceId);
			await ctx.redis.stream.hset(monitorKey, {
				subscriptions: JSON.stringify(["*"]), // Subscribe to all events by default
				active: "true",
			});
		} else if (input.role === "coordinator") {
			// Register as potential coordinator for consensus
			const coordinatorKey = redisKey("coordinators", "active");
			await ctx.redis.stream.sadd(coordinatorKey, instanceId);
		}
		
		// Update global instance count
		const globalMetricsKey = redisKey("metrics", "global");
		await ctx.redis.stream.hincrby(globalMetricsKey, "totalInstances", 1);
		await ctx.redis.stream.hincrby(globalMetricsKey, `instances_${input.role}`, 1);
		
		// Notify other instances of new registration
		await ctx.publish({
			type: "system.instance_registered",
			payload: {
				instanceId,
				name: input.name,
				role: input.role,
				capabilities: input.capabilities,
			},
			metadata: {
				registeredAt,
			},
		});
		
		// Check if this role requires special coordination
		const roleCount = await ctx.redis.stream.scard(roleKey);
		if (input.role === "coordinator" && roleCount > 1) {
			// Trigger leader election if multiple coordinators
			await ctx.publish({
				type: "system.leader_election_required",
				payload: {
					role: "coordinator",
					candidates: await ctx.redis.stream.smembers(roleKey),
				},
				metadata: {
					triggeredBy: instanceId,
				},
			});
		}
		
		// Set up instance hooks if specified
		if (input.metadata?.hooks) {
			const hooksKey = redisKey("hook", "registered", instanceId);
			await ctx.redis.stream.hset(hooksKey, {
				instanceId,
				hooks: JSON.stringify(input.metadata.hooks),
				registeredAt,
			});
		}
		
		// Log registration event
		const auditKey = redisKey("audit", "registrations", Date.now().toString());
		await ctx.redis.stream.hset(auditKey, {
			instanceId,
			name: input.name,
			role: input.role,
			capabilities: JSON.stringify(input.capabilities),
			timestamp: registeredAt,
		});
		await ctx.redis.stream.expire(auditKey, 86400); // Keep for 24 hours
		
		return {
			id: instanceId,
			name: input.name,
			role: input.role,
			status: "ACTIVE",
			registeredAt,
			heartbeatInterval: 30000,
			sessionToken,
		};
	}
}