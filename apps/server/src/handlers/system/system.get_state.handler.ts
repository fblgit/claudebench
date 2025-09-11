import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemGetStateInput, systemGetStateOutput } from "@/schemas/system.schema";
import type { SystemGetStateInput, SystemGetStateOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";
import { instanceManager } from "@/core/instance-manager";

@EventHandler({
	event: "system.get_state",
	inputSchema: systemGetStateInput,
	outputSchema: systemGetStateOutput,
	persist: false,
	rateLimit: 50,
	description: "Get system state per JSONRPC contract",
})
export class SystemGetStateHandler {
	async handle(input: SystemGetStateInput, ctx: EventContext): Promise<SystemGetStateOutput> {
		// Use instance manager to get centralized system state
		const state = await instanceManager.getSystemState();
		
		// Per contract, return optional arrays
		return {
			tasks: state.tasks?.length > 0 ? state.tasks : undefined,
			instances: state.instances?.length > 0 ? state.instances : undefined,
			recentEvents: state.recentEvents?.length > 0 ? state.recentEvents : undefined,
		};
	}
}