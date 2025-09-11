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
	description: "Simple heartbeat check per JSONRPC contract",
})
export class SystemHeartbeatHandler {
	async handle(input: SystemHeartbeatInput, ctx: EventContext): Promise<SystemHeartbeatOutput> {
		const instanceKey = redisKey("instance", input.instanceId);
		
		// Check if instance exists
		const instanceExists = await ctx.redis.stream.exists(instanceKey);
		
		if (instanceExists) {
			// Update last heartbeat timestamp
			await ctx.redis.stream.hset(instanceKey, {
				lastHeartbeat: new Date().toISOString(),
			});
			
			// Refresh TTL
			await ctx.redis.stream.expire(instanceKey, 120); // 2 minutes
		}
		
		// Per contract, we simply return whether the instance is alive
		return {
			alive: instanceExists === 1,
		};
	}
}