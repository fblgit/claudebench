import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRegisterInput, systemRegisterOutput } from "@/schemas/system.schema";
import type { SystemRegisterInput, SystemRegisterOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "system.register",
	inputSchema: systemRegisterInput,
	outputSchema: systemRegisterOutput,
	persist: false,
	rateLimit: 10,
	description: "Register an instance per JSONRPC contract",
})
export class SystemRegisterHandler {
	async handle(input: SystemRegisterInput, ctx: EventContext): Promise<SystemRegisterOutput> {
		// Store instance registration in Redis
		const instanceKey = redisKey("instance", input.id);
		
		// Check if instance already exists
		const exists = await ctx.redis.stream.exists(instanceKey);
		if (exists) {
			// Instance already registered, update roles
			await ctx.redis.stream.hset(instanceKey, {
				roles: JSON.stringify(input.roles),
				lastRegistered: new Date().toISOString(),
			});
		} else {
			// New instance registration
			await ctx.redis.stream.hset(instanceKey, {
				id: input.id,
				roles: JSON.stringify(input.roles),
				status: "ACTIVE",
				registeredAt: new Date().toISOString(),
				lastHeartbeat: new Date().toISOString(),
			});
			
			// Set TTL for instance data (will be refreshed by heartbeats)
			await ctx.redis.stream.expire(instanceKey, 120); // 2 minutes
		}
		
		// Register roles for discovery
		for (const role of input.roles) {
			const roleKey = redisKey("role", role);
			await ctx.redis.stream.sadd(roleKey, input.id);
		}
		
		// Per contract, we simply return whether registration succeeded
		return {
			registered: true,
		};
	}
}