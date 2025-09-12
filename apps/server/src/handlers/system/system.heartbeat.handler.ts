import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemHeartbeatInput, systemHeartbeatOutput } from "@/schemas/system.schema";
import type { SystemHeartbeatInput, SystemHeartbeatOutput } from "@/schemas/system.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.heartbeat",
	inputSchema: systemHeartbeatInput,
	outputSchema: systemHeartbeatOutput,
	persist: false,
	rateLimit: 1000,
	description: "Simple heartbeat check atomically via Lua script",
})
export class SystemHeartbeatHandler {
	@Instrumented(10)
	@Resilient({
		rateLimit: { limit: 1000, windowMs: 60000 },
		timeout: 2000,
		circuitBreaker: { 
			threshold: 20,
			timeout: 10000,
			fallback: () => ({ 
				alive: false
			})
		}
	})
	async handle(input: SystemHeartbeatInput, ctx: EventContext): Promise<SystemHeartbeatOutput> {
		const ttl = 30; // 30 seconds TTL for heartbeat
		
		try {
			const result = await redisScripts.instanceHeartbeat(
				input.instanceId,
				ttl
			);
			
			if (result.success && result.isLeader) {
				console.log(`[SystemHeartbeat] Instance ${input.instanceId} is leader`);
			}
			
			if (result.error) {
				console.error(`[SystemHeartbeat] Error for ${input.instanceId}: ${result.error}`);
			}
			
			return {
				alive: result.success,
			};
		} catch (error) {
			console.error(`[SystemHeartbeat] Exception for ${input.instanceId}:`, error);
			return {
				alive: false,
			};
		}
	}
}