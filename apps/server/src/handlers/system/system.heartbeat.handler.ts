import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemHeartbeatInput, systemHeartbeatOutput } from "@/schemas/system.schema";
import type { SystemHeartbeatInput, SystemHeartbeatOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";
import { instanceManager } from "@/core/instance-manager";

@EventHandler({
	event: "system.heartbeat",
	inputSchema: systemHeartbeatInput,
	outputSchema: systemHeartbeatOutput,
	persist: false,
	rateLimit: 1000,
	description: "Simple heartbeat check per JSONRPC contract",
})
export class SystemHeartbeatHandler {
	@Instrumented(10) // Cache for 10 seconds - heartbeats are very frequent
	@Resilient({
		rateLimit: { limit: 1000, windowMs: 60000 }, // 1000 requests per minute
		timeout: 2000, // 2 second timeout
		circuitBreaker: { 
			threshold: 20, // Higher threshold for heartbeats
			timeout: 10000, // Recover faster
			fallback: () => ({ 
				alive: false // Instance not alive if circuit is open
			})
		}
	})
	async handle(input: SystemHeartbeatInput, ctx: EventContext): Promise<SystemHeartbeatOutput> {
		// Use instance manager for centralized heartbeat management
		const alive = await instanceManager.heartbeat(input.instanceId);
		
		// Per contract, we simply return whether the instance is alive
		return {
			alive,
		};
	}
}