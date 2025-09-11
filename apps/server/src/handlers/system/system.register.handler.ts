import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRegisterInput, systemRegisterOutput } from "@/schemas/system.schema";
import type { SystemRegisterInput, SystemRegisterOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";
import { instanceManager } from "@/core/instance-manager";

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
		// Use instance manager for centralized registration
		const registered = await instanceManager.register(input.id, input.roles);
		
		// Publish registration event if successful
		if (registered) {
			await ctx.publish({
				type: "instance.registered",
				payload: {
					id: input.id,
					roles: input.roles,
					timestamp: Date.now(),
				},
			});
		}
		
		// Per contract, we simply return whether registration succeeded
		return {
			registered,
		};
	}
}