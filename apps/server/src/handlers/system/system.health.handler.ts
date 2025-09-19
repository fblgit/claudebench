import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemHealthInput, systemHealthOutput } from "@/schemas/system.schema";
import type { SystemHealthInput, SystemHealthOutput } from "@/schemas/system.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.health",
	inputSchema: systemHealthInput,
	outputSchema: systemHealthOutput,
	persist: false,
	rateLimit: 100,
	description: "Get system health status atomically via Lua script",
})
export class SystemHealthHandler {
	@Instrumented(30)
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 3000,
		circuitBreaker: { 
			threshold: 10, 
			timeout: 20000,
			fallback: () => ({ 
				status: "unhealthy" as const,
				services: {
					redis: false,
					postgres: false,
					mcp: false,
				}
			})
		}
	})
	async handle(input: SystemHealthInput, ctx: EventContext): Promise<SystemHealthOutput> {
		const timeout = 5000; // 5 seconds timeout for health check
		
		const result = await redisScripts.getSystemHealth(timeout);
		
		return {
			status: result.status as "healthy" | "degraded" | "unhealthy",
			services: result.services,
		};
	}
}