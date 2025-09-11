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
	description: "Get system metrics per JSONRPC contract",
})
export class SystemMetricsHandler {
	async handle(input: SystemMetricsInput, ctx: EventContext): Promise<SystemMetricsOutput> {
		// Get events processed count
		const eventsKey = redisKey("metrics", "events", "total");
		const eventsProcessed = parseInt(await ctx.redis.stream.get(eventsKey) || "0");
		
		// Get tasks completed count
		const tasksKey = redisKey("metrics", "tasks", "completed");
		const tasksCompleted = parseInt(await ctx.redis.stream.get(tasksKey) || "0");
		
		// Calculate average latency (simplified)
		const latencyKey = redisKey("metrics", "latency", "average");
		const averageLatency = parseFloat(await ctx.redis.stream.get(latencyKey) || "0");
		
		// Get memory usage (if available)
		const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024; // Convert to MB
		
		// Per contract, all fields are optional
		return {
			eventsProcessed: eventsProcessed > 0 ? eventsProcessed : undefined,
			tasksCompleted: tasksCompleted > 0 ? tasksCompleted : undefined,
			averageLatency: averageLatency > 0 ? averageLatency : undefined,
			memoryUsage: Math.round(memoryUsage * 100) / 100, // Round to 2 decimal places
		};
	}
}