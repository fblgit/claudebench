import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemHealthInput, systemHealthOutput } from "@/schemas/system.schema";
import type { SystemHealthInput, SystemHealthOutput } from "@/schemas/system.schema";

@EventHandler({
	event: "system.health",
	inputSchema: systemHealthInput,
	outputSchema: systemHealthOutput,
	persist: false,
	rateLimit: 100,
	description: "Check system health status per JSONRPC contract",
})
export class SystemHealthHandler {
	async handle(input: SystemHealthInput, ctx: EventContext): Promise<SystemHealthOutput> {
		// Check Redis connection
		let redisHealthy = false;
		try {
			await ctx.redis.stream.ping();
			redisHealthy = true;
		} catch (error) {
			console.error("Redis health check failed:", error);
		}
		
		// Check PostgreSQL connection
		let postgresHealthy = false;
		try {
			await ctx.prisma.$queryRaw`SELECT 1`;
			postgresHealthy = true;
		} catch (error) {
			console.error("PostgreSQL health check failed:", error);
		}
		
		// MCP is considered healthy if the handler is running
		const mcpHealthy = true;
		
		// Determine overall status
		const allHealthy = redisHealthy && postgresHealthy && mcpHealthy;
		const someHealthy = redisHealthy || postgresHealthy || mcpHealthy;
		
		const status = allHealthy ? "healthy" : someHealthy ? "degraded" : "unhealthy";
		
		return {
			status,
			services: {
				redis: redisHealthy,
				postgres: postgresHealthy,
				mcp: mcpHealthy,
			},
		};
	}
}