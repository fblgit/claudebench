import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemHeartbeatInput, systemHeartbeatOutput } from "@/schemas/system.schema";
import type { SystemHeartbeatInput, SystemHeartbeatOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "system.heartbeat",
	inputSchema: systemHeartbeatInput,
	outputSchema: systemHeartbeatOutput,
	persist: false,
	rateLimit: 1000,
	description: "Process instance heartbeat and return any pending commands",
})
export class SystemHeartbeatHandler {
	async handle(input: SystemHeartbeatInput, ctx: EventContext): Promise<SystemHeartbeatOutput> {
		const now = new Date().toISOString();
		const instanceKey = redisKey("instances", input.instanceId);
		
		// Check if instance exists
		const instanceExists = await ctx.redis.stream.exists(instanceKey);
		if (!instanceExists) {
			return {
				acknowledged: false,
				nextHeartbeat: 0,
				warnings: ["Instance not registered. Please register first."],
			};
		}
		
		// Get current instance data
		const instanceData = await ctx.redis.stream.hgetall(instanceKey);
		const registeredAt = instanceData.registeredAt ? 
			new Date(instanceData.registeredAt).getTime() : Date.now();
		const uptime = Math.floor((Date.now() - registeredAt) / 1000); // in seconds
		
		// Update instance heartbeat data
		const updates: Record<string, string> = {
			lastHeartbeat: now,
			uptime: uptime.toString(),
		};
		
		// Update status if provided
		if (input.status) {
			updates.status = input.status;
		}
		
		// Store metrics if provided
		if (input.metrics) {
			const metricsKey = redisKey("metrics", "instances", input.instanceId);
			const metricsUpdates: Record<string, string> = {
				lastActivity: now,
			};
			
			if (input.metrics.cpuUsage !== undefined) {
				metricsUpdates.cpuUsage = input.metrics.cpuUsage.toString();
			}
			if (input.metrics.memoryUsage !== undefined) {
				metricsUpdates.memoryUsage = input.metrics.memoryUsage.toString();
			}
			if (input.metrics.tasksProcessed !== undefined) {
				await ctx.redis.stream.hincrby(metricsKey, "tasksProcessed", input.metrics.tasksProcessed);
			}
			if (input.metrics.errors !== undefined) {
				await ctx.redis.stream.hincrby(metricsKey, "errors", input.metrics.errors);
			}
			
			await ctx.redis.stream.hset(metricsKey, metricsUpdates);
			
			// Store time-series metrics for monitoring
			const timeSeriesKey = redisKey("timeseries", input.instanceId, "metrics");
			await ctx.redis.stream.zadd(
				timeSeriesKey,
				Date.now(),
				JSON.stringify({
					cpu: input.metrics.cpuUsage,
					memory: input.metrics.memoryUsage,
					timestamp: now,
				})
			);
			// Keep only last 1000 data points
			await ctx.redis.stream.zremrangebyrank(timeSeriesKey, 0, -1001);
		}
		
		// Update instance data
		await ctx.redis.stream.hset(instanceKey, updates);
		
		// Refresh TTL
		await ctx.redis.stream.expire(instanceKey, 120); // 2 minutes
		
		// Check for warnings
		const warnings: string[] = [];
		
		// Check resource usage warnings
		if (input.metrics?.cpuUsage && input.metrics.cpuUsage > 80) {
			warnings.push(`High CPU usage: ${input.metrics.cpuUsage}%`);
		}
		if (input.metrics?.memoryUsage && input.metrics.memoryUsage > 85) {
			warnings.push(`High memory usage: ${input.metrics.memoryUsage}%`);
		}
		if (input.metrics?.errors && input.metrics.errors > 10) {
			warnings.push(`High error count: ${input.metrics.errors} errors`);
		}
		
		// Check for pending commands
		const commandsKey = redisKey("commands", input.instanceId);
		const pendingCommands = await ctx.redis.stream.lrange(commandsKey, 0, -1);
		const commands = [];
		
		if (pendingCommands.length > 0) {
			// Process and clear commands
			for (const cmdStr of pendingCommands) {
				try {
					const command = JSON.parse(cmdStr);
					commands.push(command);
				} catch (error) {
					console.error("Failed to parse command:", error);
				}
			}
			// Clear processed commands
			await ctx.redis.stream.del(commandsKey);
		}
		
		// Check for role-specific tasks
		const role = instanceData.role;
		if (role === "worker") {
			// Check for assigned tasks
			const workerQueueKey = redisKey("queue", "worker", input.instanceId);
			const taskCount = await ctx.redis.stream.llen(workerQueueKey);
			
			if (taskCount > 0) {
				commands.push({
					type: "assign_task" as const,
					payload: {
						queueKey: workerQueueKey,
						taskCount,
					},
				});
			}
		} else if (role === "coordinator") {
			// Check if leader election is needed
			const coordinatorKey = redisKey("coordinators", "leader");
			const currentLeader = await ctx.redis.stream.get(coordinatorKey);
			
			if (!currentLeader) {
				commands.push({
					type: "update_config" as const,
					payload: {
						action: "participate_election",
						role: "coordinator",
					},
				});
			}
		}
		
		// Update heartbeat statistics
		const statsKey = redisKey("stats", "heartbeats");
		await ctx.redis.stream.hincrby(statsKey, "total", 1);
		await ctx.redis.stream.hincrby(statsKey, input.instanceId, 1);
		
		// Track instance health
		const healthScore = this.calculateHealthScore(input.metrics);
		const healthKey = redisKey("health", "instances", input.instanceId);
		await ctx.redis.stream.hset(healthKey, {
			score: healthScore.toString(),
			status: input.status || instanceData.status || "ACTIVE",
			lastCheck: now,
		});
		
		// Check if instance needs intervention
		if (healthScore < 50) {
			warnings.push("Instance health is poor. Consider scaling or maintenance.");
			
			// Notify monitoring systems
			await ctx.publish({
				type: "system.instance_unhealthy",
				payload: {
					instanceId: input.instanceId,
					healthScore,
					metrics: input.metrics,
				},
				metadata: {
					timestamp: now,
				},
			});
		}
		
		// Calculate next heartbeat interval
		const baseInterval = parseInt(instanceData.heartbeatInterval || "30000");
		let nextHeartbeat = baseInterval;
		
		// Adjust based on health and load
		if (healthScore < 70) {
			nextHeartbeat = Math.max(baseInterval / 2, 10000); // More frequent when unhealthy
		} else if (input.status === "IDLE") {
			nextHeartbeat = Math.min(baseInterval * 2, 60000); // Less frequent when idle
		}
		
		// Publish heartbeat event for monitoring
		await ctx.publish({
			type: "system.heartbeat_received",
			payload: {
				instanceId: input.instanceId,
				status: input.status || instanceData.status,
				uptime,
				healthScore,
			},
			metadata: {
				metrics: input.metrics,
			},
		});
		
		return {
			acknowledged: true,
			nextHeartbeat,
			warnings: warnings.length > 0 ? warnings : undefined,
			commands: commands.length > 0 ? commands : undefined,
		};
	}
	
	private calculateHealthScore(metrics?: {
		cpuUsage?: number;
		memoryUsage?: number;
		tasksProcessed?: number;
		errors?: number;
	}): number {
		if (!metrics) return 100;
		
		let score = 100;
		
		// CPU impact (0-30 points deduction)
		if (metrics.cpuUsage !== undefined) {
			score -= Math.min(30, metrics.cpuUsage * 0.3);
		}
		
		// Memory impact (0-30 points deduction)
		if (metrics.memoryUsage !== undefined) {
			score -= Math.min(30, metrics.memoryUsage * 0.3);
		}
		
		// Error rate impact (0-40 points deduction)
		if (metrics.errors !== undefined && metrics.tasksProcessed !== undefined) {
			const errorRate = metrics.tasksProcessed > 0 ? 
				(metrics.errors / metrics.tasksProcessed) * 100 : 0;
			score -= Math.min(40, errorRate * 4);
		}
		
		return Math.max(0, Math.round(score));
	}
}