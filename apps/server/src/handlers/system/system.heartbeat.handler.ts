import { EventHandler } from "@/core/decorator";
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
	async handle(input: SystemHeartbeatInput, ctx: EventContext): Promise<SystemHeartbeatOutput> {
		// Use instance manager for centralized heartbeat management
		const alive = await instanceManager.heartbeat(input.instanceId);
		
		// Per contract, we simply return whether the instance is alive
		return {
			alive,
		};
	}
}