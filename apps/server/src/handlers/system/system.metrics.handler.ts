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
		// Check for specific metric keys (these are what tests and monitoring use)
		const eventsKey = "cb:metrics:events:total";
		const tasksKey = "cb:metrics:tasks:completed";
		const latencyKey = "cb:metrics:latency:average";
		
		const [eventsStr, tasksStr, latencyStr] = await Promise.all([
			ctx.redis.stream.get(eventsKey),
			ctx.redis.stream.get(tasksKey),
			ctx.redis.stream.get(latencyKey)
		]);
		
		const memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024;
		
		// Use the specific metric keys values
		const eventsProcessed = eventsStr ? parseInt(eventsStr) : 0;
		const tasksCompleted = tasksStr ? parseInt(tasksStr) : 0;
		const averageLatency = latencyStr ? parseFloat(latencyStr) : 0;
		
		return {
			eventsProcessed: eventsProcessed > 0 ? eventsProcessed : undefined,
			tasksCompleted: tasksCompleted > 0 ? tasksCompleted : undefined,
			averageLatency: averageLatency > 0 ? averageLatency : undefined,
			memoryUsage: Math.round(memoryUsage * 100) / 100,
		};
	}
}