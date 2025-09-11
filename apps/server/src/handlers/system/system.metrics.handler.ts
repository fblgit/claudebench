import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemMetricsInput, systemMetricsOutput } from "@/schemas/system.schema";
import type { SystemMetricsInput, SystemMetricsOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "system.metrics",
	inputSchema: systemMetricsInput,
	outputSchema: systemMetricsOutput,
	persist: false,
	rateLimit: 20,
	description: "Retrieve system metrics for specified time period",
})
export class SystemMetricsHandler {
	async handle(input: SystemMetricsInput, ctx: EventContext): Promise<SystemMetricsOutput> {
		const period = input.period || "5m";
		const periodMs = this.getPeriodInMs(period);
		const now = Date.now();
		const since = now - periodMs;
		
		// Get event metrics
		const eventMetrics = await this.getEventMetrics(ctx, since, now, input.instanceId);
		
		// Get task metrics
		const taskMetrics = await this.getTaskMetrics(ctx, since, now, input.instanceId);
		
		// Get instance metrics
		const instanceMetrics = await this.getInstanceMetrics(ctx, since, now);
		
		// Get error metrics
		const errorMetrics = await this.getErrorMetrics(ctx, since, now, input.instanceId);
		
		// Store metrics query for analysis
		const queryKey = redisKey("metrics", "queries", Date.now().toString());
		await ctx.redis.stream.hset(queryKey, {
			period,
			instanceId: input.instanceId || "all",
			timestamp: new Date().toISOString(),
			requestedBy: ctx.instanceId,
		});
		await ctx.redis.stream.expire(queryKey, 3600); // Keep for 1 hour
		
		// Update global metrics access counter
		const accessKey = redisKey("metrics", "access");
		await ctx.redis.stream.hincrby(accessKey, "total", 1);
		await ctx.redis.stream.hincrby(accessKey, period, 1);
		
		// Publish metrics query event
		await ctx.publish({
			type: "system.metrics_queried",
			payload: {
				period,
				instanceId: input.instanceId,
			},
			metadata: {
				timestamp: new Date().toISOString(),
			},
		});
		
		return {
			period,
			events: eventMetrics,
			tasks: taskMetrics,
			instances: instanceMetrics,
			errors: errorMetrics,
		};
	}
	
	private getPeriodInMs(period: string): number {
		const periods: Record<string, number> = {
			"1m": 60000,
			"5m": 300000,
			"15m": 900000,
			"1h": 3600000,
			"24h": 86400000,
		};
		return periods[period] || 300000; // Default to 5 minutes
	}
	
	private async getEventMetrics(
		ctx: EventContext,
		since: number,
		now: number,
		instanceId?: string
	) {
		const eventTypes: Record<string, number> = {};
		let totalEvents = 0;
		
		// Get event streams
		const streamPattern = instanceId ? 
			redisKey("stream", instanceId, "*") : 
			redisKey("stream", "*");
		const streamKeys = await ctx.redis.stream.keys(streamPattern);
		
		for (const streamKey of streamKeys) {
			// Extract event type
			const parts = streamKey.split(":");
			const eventType = parts[parts.length - 1];
			
			// Count events in time range using xrange
			const entries = await ctx.redis.stream.xrange(
				streamKey,
				since.toString(),
				now.toString(),
				"COUNT",
				"10000"
			).catch(() => []);
			const count = entries.length;
			
			if (count > 0) {
				eventTypes[eventType] = (eventTypes[eventType] || 0) + count;
				totalEvents += count;
			}
		}
		
		// Calculate rate (events per second)
		const durationSeconds = (now - since) / 1000;
		const rate = totalEvents / durationSeconds;
		
		// Get more detailed rate metrics from time series
		const rateKey = redisKey("metrics", "events", "rate");
		const rateData = await ctx.redis.stream.zrangebyscore(
			rateKey,
			since.toString(),
			now.toString(),
			"WITHSCORES"
		);
		
		// Calculate average rate from samples
		let avgRate = rate;
		if (rateData.length >= 2) {
			let totalRate = 0;
			let samples = 0;
			for (let i = 1; i < rateData.length; i += 2) {
				totalRate += parseFloat(rateData[i]);
				samples++;
			}
			if (samples > 0) {
				avgRate = totalRate / samples;
			}
		}
		
		return {
			total: totalEvents,
			byType: eventTypes,
			rate: Math.round(avgRate * 100) / 100,
		};
	}
	
	private async getTaskMetrics(
		ctx: EventContext,
		since: number,
		now: number,
		instanceId?: string
	) {
		// Get created tasks
		const createdKey = instanceId ?
			redisKey("metrics", "tasks", "created", instanceId) :
			redisKey("metrics", "tasks", "created");
		const createdTasks = await ctx.redis.stream.zcount(
			createdKey,
			since.toString(),
			now.toString()
		).catch(() => 0);
		
		// Get completed tasks
		const completedKey = instanceId ?
			redisKey("metrics", "tasks", "completed", instanceId) :
			redisKey("metrics", "tasks", "completed");
		const completedTasks = await ctx.redis.stream.zcount(
			completedKey,
			since.toString(),
			now.toString()
		).catch(() => 0);
		
		// Get failed tasks
		const failedKey = instanceId ?
			redisKey("metrics", "tasks", "failed", instanceId) :
			redisKey("metrics", "tasks", "failed");
		const failedTasks = await ctx.redis.stream.zcount(
			failedKey,
			since.toString(),
			now.toString()
		).catch(() => 0);
		
		// Calculate average duration for completed tasks
		let avgDuration = 0;
		const durationKey = redisKey("metrics", "tasks", "duration");
		const durations = await ctx.redis.stream.zrangebyscore(
			durationKey,
			since.toString(),
			now.toString(),
			"WITHSCORES"
		);
		
		if (durations.length >= 2) {
			let totalDuration = 0;
			let count = 0;
			for (let i = 1; i < durations.length; i += 2) {
				totalDuration += parseFloat(durations[i]);
				count++;
			}
			if (count > 0) {
				avgDuration = totalDuration / count;
			}
		}
		
		return {
			created: createdTasks,
			completed: completedTasks,
			failed: failedTasks,
			avgDuration: Math.round(avgDuration),
		};
	}
	
	private async getInstanceMetrics(
		ctx: EventContext,
		since: number,
		now: number
	) {
		// Get all instances
		const instancesPattern = redisKey("instances", "*");
		const instanceKeys = await ctx.redis.stream.keys(instancesPattern);
		
		let activeCount = 0;
		let totalUptime = 0;
		let instanceCount = 0;
		
		for (const key of instanceKeys) {
			const instanceData = await ctx.redis.stream.hgetall(key);
			if (instanceData && instanceData.id) {
				instanceCount++;
				
				// Check if active (heartbeat within last minute)
				const lastHeartbeat = instanceData.lastHeartbeat ?
					new Date(instanceData.lastHeartbeat).getTime() : 0;
				if (now - lastHeartbeat < 60000) {
					activeCount++;
				}
				
				// Add uptime
				const uptime = parseInt(instanceData.uptime || "0");
				totalUptime += uptime;
			}
		}
		
		const avgUptime = instanceCount > 0 ? totalUptime / instanceCount : 0;
		
		// Get instance registration/deregistration events in period
		const registrationKey = redisKey("audit", "registrations", "*");
		const registrationKeys = await ctx.redis.stream.keys(registrationKey);
		let registrationsInPeriod = 0;
		
		for (const regKey of registrationKeys) {
			const timestamp = parseInt(regKey.split(":").pop() || "0");
			if (timestamp >= since && timestamp <= now) {
				registrationsInPeriod++;
			}
		}
		
		return {
			active: activeCount,
			total: instanceCount,
			avgUptime: Math.round(avgUptime),
		};
	}
	
	private async getErrorMetrics(
		ctx: EventContext,
		since: number,
		now: number,
		instanceId?: string
	) {
		const errorTypes: Record<string, number> = {};
		let totalErrors = 0;
		
		// Get error logs
		const errorPattern = instanceId ?
			redisKey("errors", instanceId, "*") :
			redisKey("errors", "*");
		const errorKeys = await ctx.redis.stream.keys(errorPattern);
		
		for (const errorKey of errorKeys) {
			// Check if error is in time range
			const timestamp = parseInt(errorKey.split(":").pop() || "0");
			if (timestamp >= since && timestamp <= now) {
				const errorData = await ctx.redis.stream.hgetall(errorKey);
				if (errorData) {
					const errorType = errorData.type || "unknown";
					errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
					totalErrors++;
				}
			}
		}
		
		// Get error rate from metrics
		const errorRateKey = redisKey("metrics", "errors", "rate");
		const errorRates = await ctx.redis.stream.zrangebyscore(
			errorRateKey,
			since.toString(),
			now.toString(),
			"WITHSCORES"
		);
		
		let errorRate = 0;
		if (errorRates.length >= 2) {
			let totalRate = 0;
			let samples = 0;
			for (let i = 1; i < errorRates.length; i += 2) {
				totalRate += parseFloat(errorRates[i]);
				samples++;
			}
			if (samples > 0) {
				errorRate = totalRate / samples;
			}
		} else {
			// Calculate from total errors
			const durationSeconds = (now - since) / 1000;
			errorRate = totalErrors / durationSeconds;
		}
		
		// Get specific error categories
		const criticalErrors = errorTypes["critical"] || 0;
		const warningErrors = errorTypes["warning"] || 0;
		const infoErrors = errorTypes["info"] || 0;
		
		// Add circuit breaker trips
		const circuitBreakerKey = redisKey("circuit", "trips");
		const trips = await ctx.redis.stream.zcount(
			circuitBreakerKey,
			since.toString(),
			now.toString()
		).catch(() => 0);
		
		if (trips > 0) {
			errorTypes["circuit_breaker_trip"] = trips;
			totalErrors += trips;
		}
		
		// Add rate limit violations
		const rateLimitKey = redisKey("ratelimit", "violations");
		const violations = await ctx.redis.stream.zcount(
			rateLimitKey,
			since.toString(),
			now.toString()
		).catch(() => 0);
		
		if (violations > 0) {
			errorTypes["rate_limit_violation"] = violations;
			totalErrors += violations;
		}
		
		return {
			total: totalErrors,
			byType: errorTypes,
			rate: Math.round(errorRate * 100) / 100,
		};
	}
}