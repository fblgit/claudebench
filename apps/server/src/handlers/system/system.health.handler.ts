import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemHealthInput, systemHealthOutput } from "@/schemas/system.schema";
import type { SystemHealthInput, SystemHealthOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "system.health",
	inputSchema: systemHealthInput,
	outputSchema: systemHealthOutput,
	persist: false,
	rateLimit: 100,
	description: "Check system health and return status of all components",
})
export class SystemHealthHandler {
	async handle(input: SystemHealthInput, ctx: EventContext): Promise<SystemHealthOutput> {
		// Check Redis connectivity and latency
		const redisStart = Date.now();
		let redisConnected = false;
		let redisLatency = 0;
		
		try {
			await ctx.redis.stream.ping();
			redisConnected = true;
			redisLatency = Date.now() - redisStart;
		} catch (error) {
			console.error("Redis health check failed:", error);
		}
		
		// Check PostgreSQL connectivity and latency
		const postgresStart = Date.now();
		let postgresConnected = false;
		let postgresLatency = 0;
		
		try {
			await ctx.prisma.$queryRaw`SELECT 1`;
			postgresConnected = true;
			postgresLatency = Date.now() - postgresStart;
		} catch (error) {
			console.error("PostgreSQL health check failed:", error);
		}
		
		// Get all active instances
		const instancesKey = redisKey("instances", "*");
		const instanceKeys = await ctx.redis.stream.keys(instancesKey);
		const instances = [];
		const now = Date.now();
		
		for (const key of instanceKeys) {
			const instanceData = await ctx.redis.stream.hgetall(key);
			if (instanceData && instanceData.id) {
				const lastHeartbeat = instanceData.lastHeartbeat ? 
					new Date(instanceData.lastHeartbeat).getTime() : 0;
				const heartbeatAge = now - lastHeartbeat;
				
				// Determine instance status based on heartbeat age
				let status: "ACTIVE" | "IDLE" | "BUSY" | "OFFLINE" = "OFFLINE";
				if (heartbeatAge < 30000) { // Less than 30 seconds
					status = (instanceData.status as "ACTIVE" | "IDLE" | "BUSY" | "OFFLINE") || "ACTIVE";
				} else if (heartbeatAge < 60000) { // Less than 1 minute
					status = "IDLE";
				}
				
				instances.push({
					id: instanceData.id,
					status,
					lastHeartbeat: instanceData.lastHeartbeat || new Date(0).toISOString(),
					uptime: parseInt(instanceData.uptime || "0"),
				});
			}
		}
		
		// Get handler registry info
		const registryKey = redisKey("registry", "handlers");
		const handlerKeys = await ctx.redis.stream.keys(`${registryKey}:*`);
		const registeredHandlers = handlerKeys.length;
		
		// Count active handlers (those that processed events recently)
		let activeHandlers = 0;
		for (const handlerKey of handlerKeys) {
			const lastProcessed = await ctx.redis.stream.hget(handlerKey, "lastProcessed");
			if (lastProcessed) {
				const age = now - new Date(lastProcessed).getTime();
				if (age < 300000) { // Active in last 5 minutes
					activeHandlers++;
				}
			}
		}
		
		// Determine overall system status
		let systemStatus: "healthy" | "degraded" | "unhealthy" = "healthy";
		
		if (!redisConnected || !postgresConnected) {
			systemStatus = "unhealthy";
		} else if (redisLatency > 100 || postgresLatency > 100) {
			systemStatus = "degraded";
		} else if (instances.filter(i => i.status === "ACTIVE" || i.status === "BUSY").length === 0) {
			systemStatus = "degraded";
		}
		
		// Get optional metrics if verbose mode
		let metrics = undefined;
		if (input.verbose) {
			// Get events processed count
			const eventsKey = redisKey("metrics", "events", "total");
			const eventsProcessed = parseInt(await ctx.redis.stream.get(eventsKey) || "0");
			
			// Get task queue size
			const pendingQueueKey = redisKey("queue", "tasks", "pending");
			const activeQueueKey = redisKey("queue", "tasks", "active");
			const pendingCount = await ctx.redis.stream.zcard(pendingQueueKey);
			const activeCount = await ctx.redis.stream.zcard(activeQueueKey);
			const tasksInQueue = pendingCount + activeCount;
			
			// Calculate error rate
			const errorsKey = redisKey("metrics", "errors", "total");
			const totalErrors = parseInt(await ctx.redis.stream.get(errorsKey) || "0");
			const errorRate = eventsProcessed > 0 ? 
				(totalErrors / eventsProcessed) * 100 : 0;
			
			metrics = {
				eventsProcessed,
				tasksInQueue,
				errorRate: Math.round(errorRate * 100) / 100,
			};
		}
		
		// Store health check result
		const healthKey = redisKey("health", "check", Date.now().toString());
		await ctx.redis.stream.hset(healthKey, {
			status: systemStatus,
			redisLatency: redisLatency.toString(),
			postgresLatency: postgresLatency.toString(),
			activeInstances: instances.filter(i => i.status === "ACTIVE").length.toString(),
			timestamp: new Date().toISOString(),
		});
		await ctx.redis.stream.expire(healthKey, 3600); // Keep for 1 hour
		
		// Update health metrics
		const healthMetricsKey = redisKey("metrics", "health");
		await ctx.redis.stream.hincrby(healthMetricsKey, "checks", 1);
		await ctx.redis.stream.hincrby(healthMetricsKey, systemStatus, 1);
		
		// Publish health status event
		await ctx.publish({
			type: "system.health_checked",
			payload: {
				status: systemStatus,
				instanceCount: instances.length,
				activeInstances: instances.filter(i => i.status === "ACTIVE").length,
			},
			metadata: {
				instanceId: input.instanceId,
			},
		});
		
		return {
			status: systemStatus,
			redis: {
				connected: redisConnected,
				latency: redisLatency,
			},
			postgres: {
				connected: postgresConnected,
				latency: postgresLatency,
			},
			instances,
			handlers: {
				registered: registeredHandlers,
				active: activeHandlers,
			},
			metrics,
		};
	}
}