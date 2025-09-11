import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemGetStateInput, systemGetStateOutput } from "@/schemas/system.schema";
import type { SystemGetStateInput, SystemGetStateOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "system.get_state",
	inputSchema: systemGetStateInput,
	outputSchema: systemGetStateOutput,
	persist: false,
	rateLimit: 50,
	description: "Retrieve current system state including tasks, instances, events, and metrics",
})
export class SystemGetStateHandler {
	async handle(input: SystemGetStateInput, ctx: EventContext): Promise<SystemGetStateOutput> {
		const timestamp = new Date().toISOString();
		const scope = input.scope || "all";
		const response: SystemGetStateOutput = {
			timestamp,
			scope,
		};
		
		// Get tasks state if requested
		if (scope === "all" || scope === "tasks") {
			const tasks = await this.getTasksState(ctx, input.limit || 100);
			response.tasks = tasks;
		}
		
		// Get instances state if requested
		if (scope === "all" || scope === "instances") {
			const instances = await this.getInstancesState(ctx, input.instanceId);
			response.instances = instances;
		}
		
		// Get events state if requested
		if (scope === "all" || scope === "events") {
			const events = await this.getEventsState(ctx, input.since, input.limit || 100);
			response.events = events;
		}
		
		// Get metrics if requested
		if (scope === "all" || scope === "metrics") {
			const metrics = await this.getMetricsState(ctx);
			response.metrics = metrics;
		}
		
		// Store state query for auditing
		const auditKey = redisKey("audit", "state_queries", Date.now().toString());
		await ctx.redis.stream.hset(auditKey, {
			scope,
			instanceId: input.instanceId || "all",
			timestamp,
			requestedBy: ctx.instanceId,
		});
		await ctx.redis.stream.expire(auditKey, 3600); // Keep for 1 hour
		
		// Publish state query event
		await ctx.publish({
			type: "system.state_queried",
			payload: {
				scope,
				instanceId: input.instanceId,
			},
			metadata: {
				timestamp,
			},
		});
		
		return response;
	}
	
	private async getTasksState(ctx: EventContext, limit: number) {
		// Get all task queues
		const pendingQueueKey = redisKey("queue", "tasks", "pending");
		const activeQueueKey = redisKey("queue", "tasks", "active");
		const completedQueueKey = redisKey("queue", "tasks", "completed");
		
		// Count tasks by status
		const pendingCount = await ctx.redis.stream.zcard(pendingQueueKey);
		const activeCount = await ctx.redis.stream.zcard(activeQueueKey);
		const completedCount = await ctx.redis.stream.zcard(completedQueueKey);
		
		// Get sample of tasks from queue
		const pendingTasks = await ctx.redis.stream.zrange(pendingQueueKey, 0, Math.min(limit, 50) - 1);
		const activeTasks = await ctx.redis.stream.zrange(activeQueueKey, 0, Math.min(limit, 50) - 1);
		
		// Fetch task details
		const queue = [];
		for (const taskId of [...pendingTasks, ...activeTasks].slice(0, limit)) {
			const taskKey = redisKey("task", taskId);
			const taskData = await ctx.redis.stream.hgetall(taskKey);
			if (taskData) {
				queue.push({
					id: taskData.id,
					title: taskData.title,
					status: taskData.status,
					priority: parseInt(taskData.priority || "0"),
					assignedTo: taskData.assignedTo,
					createdAt: taskData.createdAt,
					updatedAt: taskData.updatedAt,
				});
			}
		}
		
		// Get failed tasks count
		const failedTasksKey = redisKey("tasks", "failed");
		const failedCount = await ctx.redis.stream.scard(failedTasksKey);
		
		return {
			total: pendingCount + activeCount + completedCount + failedCount,
			byStatus: {
				PENDING: pendingCount,
				IN_PROGRESS: activeCount,
				COMPLETED: completedCount,
				FAILED: failedCount,
			},
			queue,
		};
	}
	
	private async getInstancesState(ctx: EventContext, instanceId?: string) {
		const instances = [];
		const byStatus: Record<string, number> = {
			ACTIVE: 0,
			IDLE: 0,
			BUSY: 0,
			OFFLINE: 0,
		};
		
		if (instanceId) {
			// Get specific instance
			const instanceKey = redisKey("instances", instanceId);
			const instanceData = await ctx.redis.stream.hgetall(instanceKey);
			if (instanceData) {
				instances.push(this.formatInstanceData(instanceData));
				byStatus[instanceData.status || "OFFLINE"]++;
			}
		} else {
			// Get all instances
			const instancesPattern = redisKey("instances", "*");
			const instanceKeys = await ctx.redis.stream.keys(instancesPattern);
			
			for (const key of instanceKeys) {
				const instanceData = await ctx.redis.stream.hgetall(key);
				if (instanceData && instanceData.id) {
					const formatted = this.formatInstanceData(instanceData);
					instances.push(formatted);
					byStatus[formatted.status]++;
				}
			}
		}
		
		// Sort by last heartbeat (most recent first)
		instances.sort((a, b) => 
			new Date(b.lastHeartbeat).getTime() - new Date(a.lastHeartbeat).getTime()
		);
		
		return {
			total: instances.length,
			byStatus,
			list: instances,
		};
	}
	
	private formatInstanceData(data: Record<string, string>) {
		const now = Date.now();
		const lastHeartbeat = data.lastHeartbeat ? 
			new Date(data.lastHeartbeat).getTime() : 0;
		const heartbeatAge = now - lastHeartbeat;
		
		// Determine actual status based on heartbeat
		let status = data.status || "OFFLINE";
		if (heartbeatAge > 60000) { // More than 1 minute
			status = "OFFLINE";
		} else if (heartbeatAge > 30000 && status === "ACTIVE") { // More than 30 seconds
			status = "IDLE";
		}
		
		return {
			id: data.id,
			name: data.name,
			role: data.role,
			status,
			capabilities: data.capabilities ? JSON.parse(data.capabilities) : [],
			lastHeartbeat: data.lastHeartbeat || new Date(0).toISOString(),
			uptime: parseInt(data.uptime || "0"),
			metadata: data.metadata ? JSON.parse(data.metadata) : {},
		};
	}
	
	private async getEventsState(ctx: EventContext, since?: string, limit: number = 100) {
		// Get event streams
		const streamPattern = redisKey("stream", "*");
		const streamKeys = await ctx.redis.stream.keys(streamPattern);
		
		const eventCounts: Record<string, number> = {};
		const recentEvents = [];
		let totalEvents = 0;
		
		// Calculate since timestamp
		const sinceTimestamp = since ? new Date(since).getTime() : Date.now() - 300000; // Last 5 minutes by default
		
		// Process each event stream
		for (const streamKey of streamKeys) {
			// Extract event type from key
			const eventType = streamKey.split(":").pop() || "unknown";
			
			// Get stream length using xlen
			const length = await ctx.redis.stream.xlen(streamKey).catch(() => 0);
			if (length > 0) {
				eventCounts[eventType] = length;
				totalEvents += length;
				
				// Get recent entries from this stream
				const entries = await ctx.redis.stream.xrevrange(
					streamKey,
					"+",
					sinceTimestamp.toString(),
					"COUNT",
					Math.min(10, limit)
				);
				
				for (const [id, fields] of entries) {
					const timestamp = parseInt(id.split("-")[0]);
					recentEvents.push({
						id,
						type: eventType,
						timestamp: new Date(timestamp).toISOString(),
						data: this.parseEventFields(fields),
					});
				}
			}
		}
		
		// Sort recent events by timestamp (newest first)
		recentEvents.sort((a, b) => 
			new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
		);
		
		// Get event processing metrics
		const metricsKey = redisKey("metrics", "events", "total");
		const processedCount = parseInt(await ctx.redis.stream.get(metricsKey) || "0");
		
		return {
			total: totalEvents,
			recent: recentEvents.slice(0, limit),
			byType: eventCounts,
		};
	}
	
	private parseEventFields(fields: string[]): any {
		const result: Record<string, any> = {};
		for (let i = 0; i < fields.length; i += 2) {
			const key = fields[i];
			const value = fields[i + 1];
			try {
				// Try to parse JSON values
				result[key] = JSON.parse(value);
			} catch {
				// Keep as string if not JSON
				result[key] = value;
			}
		}
		return result;
	}
	
	private async getMetricsState(ctx: EventContext) {
		// Calculate events per second (from last minute)
		const eventsKey = redisKey("metrics", "events", "rate");
		const eventRates = await ctx.redis.stream.zrange(eventsKey, -60, -1, "WITHSCORES");
		let totalEventsLastMinute = 0;
		for (let i = 1; i < eventRates.length; i += 2) {
			totalEventsLastMinute += parseFloat(eventRates[i]);
		}
		const eventsPerSecond = totalEventsLastMinute / 60;
		
		// Calculate average latency
		const latencyKey = redisKey("metrics", "latency", "samples");
		const latencySamples = await ctx.redis.stream.lrange(latencyKey, -100, -1);
		let averageLatency = 0;
		if (latencySamples.length > 0) {
			const total = latencySamples.reduce((sum, sample) => sum + parseFloat(sample), 0);
			averageLatency = total / latencySamples.length;
		}
		
		// Calculate error rate
		const errorsKey = redisKey("metrics", "errors", "total");
		const eventsKey2 = redisKey("metrics", "events", "total");
		const totalErrors = parseInt(await ctx.redis.stream.get(errorsKey) || "0");
		const totalEvents = parseInt(await ctx.redis.stream.get(eventsKey2) || "0");
		const errorRate = totalEvents > 0 ? (totalErrors / totalEvents) * 100 : 0;
		
		// Calculate throughput (tasks completed per minute)
		const throughputKey = redisKey("metrics", "tasks", "completed");
		const completedTasks = await ctx.redis.stream.zrange(
			throughputKey,
			Date.now() - 60000,
			Date.now(),
			"BYSCORE"
		);
		const throughput = completedTasks.length;
		
		return {
			eventsPerSecond: Math.round(eventsPerSecond * 100) / 100,
			averageLatency: Math.round(averageLatency * 100) / 100,
			errorRate: Math.round(errorRate * 100) / 100,
			throughput,
		};
	}
}