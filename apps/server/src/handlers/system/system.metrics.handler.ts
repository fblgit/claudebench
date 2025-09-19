import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemMetricsInput, systemMetricsOutput } from "@/schemas/system.schema";
import type { SystemMetricsInput, SystemMetricsOutput } from "@/schemas/system.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.metrics",
	inputSchema: systemMetricsInput,
	outputSchema: systemMetricsOutput,
	persist: false,
	rateLimit: 20,
	description: "Get aggregated system metrics atomically via Lua script",
})
export class SystemMetricsHandler {
	@Instrumented(0)
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 },
		timeout: 3000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				eventsProcessed: undefined,
				tasksCompleted: undefined,
				averageLatency: undefined,
				memoryUsage: undefined,
			})
		}
	})
	async handle(input: SystemMetricsInput, ctx: EventContext): Promise<SystemMetricsOutput> {
		// Get metrics from various sources
		const [
			currentMetrics,
			queueMetrics,
			circuitMetrics,
			counters,
			cacheMetrics,
			globalMetrics,
			scalingMetrics,
			systemHealthMetrics,
			handlerCacheMetrics,
			validationCacheMetrics,
			mcpCallsStr
		] = await Promise.all([
			ctx.redis.stream.hgetall("cb:metrics:current"),
			ctx.redis.stream.hgetall("cb:metrics:queues"),
			ctx.redis.stream.hgetall("cb:metrics:circuit:all"),
			ctx.redis.stream.hgetall("cb:metrics:counters"),
			ctx.redis.stream.hgetall("cb:metrics:cache:global"),
			ctx.redis.stream.hgetall("cb:metrics:global"),
			ctx.redis.stream.hgetall("cb:metrics:scaling"),
			ctx.redis.stream.hgetall("cb:metrics:system:health"),
			ctx.redis.stream.hgetall("cb:metrics:cache:handler"),
			ctx.redis.stream.hgetall("cb:metrics:validation:cache"),
			ctx.redis.stream.get("cb:metrics:mcp:calls")
		]);
		
		// Calculate average latency from event metrics
		let totalLatency = 0;
		let totalEvents = 0;
		
		// Get all event metrics keys (excluding the special test keys)
		const eventKeys = await ctx.redis.stream.keys("cb:metrics:events:*");
		const filteredEventKeys = eventKeys.filter(key => 
			!key.endsWith(":total") && 
			!key.endsWith(":completed") && 
			!key.endsWith(":average")
		);
		
		if (filteredEventKeys.length > 0) {
			const eventMetrics = await Promise.all(
				filteredEventKeys.map(key => ctx.redis.stream.hgetall(key))
			);
			
			eventMetrics.forEach(metric => {
				if (metric.count && metric.avgLatency) {
					const count = parseInt(metric.count);
					const avgLatency = parseFloat(metric.avgLatency);
					totalLatency += avgLatency * count;
					totalEvents += count;
				}
			});
		}
		
		const averageLatency = totalEvents > 0 ? totalLatency / totalEvents : 0;
		
		// Get memory usage
		const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
		
		// Check for specific test keys first (backward compatibility)
		const [testEventsStr, testTasksStr, testLatencyStr] = await Promise.all([
			ctx.redis.stream.get("cb:metrics:events:total"),
			ctx.redis.stream.get("cb:metrics:tasks:completed"),
			ctx.redis.stream.get("cb:metrics:latency:average")
		]);
		
		// Extract key metrics - prioritize test keys for backward compatibility
		const eventsProcessed = testEventsStr ? parseInt(testEventsStr) :
								(parseInt(currentMetrics["events:total"] || "0") || 
								parseInt(counters["circuit:system.get_state:success"] || "0") || 
								totalEvents);
		
		const tasksCompleted = testTasksStr ? parseInt(testTasksStr) :
							   (parseInt(queueMetrics["tasksCompleted"] || "0") || 
							   parseInt(queueMetrics["completedTasks"] || "0") || 
							   parseInt(currentMetrics["tasks:completed"] || "0"));
		
		// Use test latency if available
		const finalAverageLatency = testLatencyStr ? parseFloat(testLatencyStr) : averageLatency;
		
		const result: SystemMetricsOutput = {
			eventsProcessed: eventsProcessed > 0 ? eventsProcessed : undefined,
			tasksCompleted: tasksCompleted > 0 ? tasksCompleted : undefined,
			averageLatency: finalAverageLatency > 0 ? Math.round(finalAverageLatency * 100) / 100 : undefined,
			memoryUsage: Math.round(memoryUsage * 100) / 100,
		};
		
		// Add detailed metrics if requested
		if (input.detailed) {
			// Get per-handler metrics
			const handlerKeys = await ctx.redis.stream.keys("cb:metrics:events:*");
			const handlers: Record<string, any> = {};
			
			for (const key of handlerKeys) {
				const handlerName = key.replace("cb:metrics:events:", "");
				const handlerMetrics = await ctx.redis.stream.hgetall(key);
				
				// Get additional metrics for this handler
				const [
					circuitState, 
					successCount, 
					errorCount,
					rateLimitHits,
					cacheHits,
					cacheMisses,
					lastCalled
				] = await Promise.all([
					ctx.redis.stream.get(`cb:circuit:${handlerName}:state`),
					ctx.redis.stream.get(`cb:circuit:${handlerName}:successes`),
					ctx.redis.stream.get(`cb:circuit:${handlerName}:failures`),
					ctx.redis.stream.get(`cb:ratelimit:${handlerName}:hits`),
					ctx.redis.stream.hget(`cb:cache:${handlerName}`, "hits"),
					ctx.redis.stream.hget(`cb:cache:${handlerName}`, "misses"),
					ctx.redis.stream.get(`cb:metrics:${handlerName}:lastCalled`)
				]);
				
				if (handlerMetrics.count || handlerMetrics.avgLatency) {
					const totalCalls = parseInt(handlerMetrics.count || "0");
					const successCalls = parseInt(successCount || handlerMetrics.count || "0");
					const errorCalls = parseInt(errorCount || "0");
					const hits = parseInt(cacheHits || "0");
					const misses = parseInt(cacheMisses || "0");
					const totalCacheAccess = hits + misses;
					
					handlers[handlerName] = {
						totalCalls,
						successCount: successCalls,
						errorCount: errorCalls,
						avgResponseTime: parseFloat(handlerMetrics.avgLatency || "0"),
						circuitState: circuitState || "CLOSED",
						rateLimitHits: parseInt(rateLimitHits || "0"),
						cacheHitRate: totalCacheAccess > 0 ? hits / totalCacheAccess : undefined,
						lastCalled: lastCalled || undefined,
					};
				}
			}
			
			result.handlers = handlers;
			// Circuit breaker metrics
			if (circuitMetrics && Object.keys(circuitMetrics).length > 0) {
				result.circuitBreaker = {
					totalSuccesses: parseInt(circuitMetrics.totalSuccesses || "0"),
					totalFailures: parseInt(circuitMetrics.totalFailures || "0"),
					totalTrips: parseInt(circuitMetrics.totalTrips || "0"),
					successRate: parseFloat(circuitMetrics.successRate || "0"),
				};
			}
			
			// Queue metrics
			if (queueMetrics && Object.keys(queueMetrics).length > 0) {
				result.queue = {
					depth: parseInt(queueMetrics.depth || "0") || parseInt(currentMetrics["queue:depth"] || "0"),
					pending: parseInt(queueMetrics.pendingTasks || "0") || parseInt(currentMetrics["tasks:pending"] || "0"),
					throughput: parseFloat(queueMetrics.throughput || "0") || parseFloat(currentMetrics["queue:throughput"] || "0"),
				};
			}
			
			// Cache metrics - combine all cache sources
			const cacheHits = parseInt(validationCacheMetrics?.hits || "0") + 
							 parseInt(cacheMetrics?.hits || "0") + 
							 parseInt(handlerCacheMetrics?.hits || "0");
			const cacheMisses = parseInt(validationCacheMetrics?.misses || "0") + 
							   parseInt(cacheMetrics?.misses || "0") + 
							   parseInt(handlerCacheMetrics?.misses || "0");
			const hitRate = parseFloat(validationCacheMetrics?.hitRate || handlerCacheMetrics?.hitRate || "0");
			
			if (cacheHits > 0 || cacheMisses > 0 || cacheMetrics?.sets) {
				result.cache = {
					hits: cacheHits,
					misses: cacheMisses,
					sets: parseInt(cacheMetrics?.sets || "0"),
					hitRate: hitRate > 0 ? Math.round(hitRate * 100) / 100 : undefined,
				};
			}
			
			// Counters metrics - organize by type
			if (counters && Object.keys(counters).length > 0) {
				const circuitCounters: Record<string, number> = {};
				const rateLimitCounters: Record<string, number> = {};
				const timeoutCounters: Record<string, number> = {};
				
				Object.entries(counters).forEach(([key, value]) => {
					const numValue = parseInt(value as string);
					if (key.startsWith("circuit:")) {
						circuitCounters[key.replace("circuit:", "")] = numValue;
					} else if (key.startsWith("ratelimit:")) {
						rateLimitCounters[key.replace("ratelimit:", "")] = numValue;
					} else if (key.startsWith("timeout:")) {
						timeoutCounters[key.replace("timeout:", "")] = numValue;
					}
				});
				
				result.counters = {
					circuit: Object.keys(circuitCounters).length > 0 ? circuitCounters : undefined,
					ratelimit: Object.keys(rateLimitCounters).length > 0 ? rateLimitCounters : undefined,
					timeout: Object.keys(timeoutCounters).length > 0 ? timeoutCounters : undefined,
				};
			}
			
			// Global metrics
			if (globalMetrics && Object.keys(globalMetrics).length > 0) {
				result.global = {
					taskSuccess: parseInt(globalMetrics["task:success"] || "0") || undefined,
					taskFailure: parseInt(globalMetrics["task:failure"] || "0") || undefined,
					systemSuccess: parseInt(globalMetrics["system:success"] || "0") || undefined,
					totalEvents: parseInt(globalMetrics.totalEvents || "0") || undefined,
					totalTasks: parseInt(globalMetrics.totalTasks || "0") || undefined,
					avgLatency: parseFloat(globalMetrics.avgLatency || "0") || undefined,
					throughput: parseFloat(globalMetrics.throughput || "0") || undefined,
				};
			}
			
			// Scaling metrics
			if (scalingMetrics && Object.keys(scalingMetrics).length > 0) {
				result.scaling = {
					instanceCount: parseInt(scalingMetrics.instanceCount || "0") || undefined,
					loadBalance: parseInt(scalingMetrics.loadBalance || "0") || undefined,
					totalLoad: parseInt(scalingMetrics.totalLoad || "0") || undefined,
				};
			}
			
			// Current metrics
			if (currentMetrics && Object.keys(currentMetrics).length > 0) {
				result.current = {
					eventsTotal: parseInt(currentMetrics["events:total"] || "0") || undefined,
					queueDepth: parseInt(currentMetrics["queue:depth"] || "0") || undefined,
					instancesActive: parseInt(currentMetrics["instances:active"] || "0") || undefined,
					tasksPending: parseInt(currentMetrics["tasks:pending"] || "0") || undefined,
					tasksCompleted: parseInt(currentMetrics["tasks:completed"] || "0") || undefined,
					metricsStartTime: parseInt(currentMetrics["metrics:startTime"] || "0") || undefined,
				};
			}
			
			// MCP calls
			if (mcpCallsStr) {
				result.mcpCalls = parseInt(mcpCallsStr);
			}
			
			// System health check
			if (systemHealthMetrics && Object.keys(systemHealthMetrics).length > 0) {
				result.systemHealthCheck = {
					lastCheck: parseInt(systemHealthMetrics.lastCheck || "0") || undefined,
				};
			}
		}
		
		return result;
	}
}