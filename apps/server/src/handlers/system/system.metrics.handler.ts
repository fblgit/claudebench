import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemMetricsInput, systemMetricsOutput } from "@/schemas/system.schema";
import type { SystemMetricsInput, SystemMetricsOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.metrics",
	inputSchema: systemMetricsInput,
	outputSchema: systemMetricsOutput,
	persist: false,
	rateLimit: 20,
	description: "Get system metrics per JSONRPC contract",
})
export class SystemMetricsHandler {
	@Instrumented(0) // No caching - metrics need to be real-time
	@Resilient({
		rateLimit: { limit: 20, windowMs: 60000 }, // 20 requests per minute
		timeout: 3000, // 3 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				// Return empty metrics if circuit is open
				eventsProcessed: undefined,
				tasksCompleted: undefined,
				averageLatency: undefined,
				memoryUsage: undefined,
			})
		}
	})
	async handle(input: SystemMetricsInput, ctx: EventContext): Promise<SystemMetricsOutput> {
		// First check for contract-expected keys (for testing compatibility)
		const eventsKey = redisKey("metrics", "events", "total");
		const tasksKey = redisKey("metrics", "tasks", "completed");
		const latencyKey = redisKey("metrics", "latency", "average");
		
		const eventsProcessed = parseInt(await ctx.redis.stream.get(eventsKey) || "0");
		const tasksCompleted = parseInt(await ctx.redis.stream.get(tasksKey) || "0");
		const averageLatency = parseFloat(await ctx.redis.stream.get(latencyKey) || "0");
		
		// Get memory usage (local to this instance)
		const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // Convert to MB
		
		// Per contract, all fields are optional and zero values should be omitted
		return {
			eventsProcessed: eventsProcessed > 0 ? eventsProcessed : undefined,
			tasksCompleted: tasksCompleted > 0 ? tasksCompleted : undefined,
			averageLatency: averageLatency > 0 ? averageLatency : undefined,
			memoryUsage: Math.round(memoryUsage * 100) / 100, // Round to 2 decimal places
		};
	}
}