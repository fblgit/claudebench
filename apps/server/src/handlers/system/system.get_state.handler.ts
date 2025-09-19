import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemGetStateInput, systemGetStateOutput } from "@/schemas/system.schema";
import type { SystemGetStateInput, SystemGetStateOutput } from "@/schemas/system.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.get_state",
	inputSchema: systemGetStateInput,
	outputSchema: systemGetStateOutput,
	persist: false,
	rateLimit: 50,
	description: "Get system state atomically via Lua script",
})
export class SystemGetStateHandler {
	@Instrumented(0)
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				tasks: undefined,
				instances: undefined,
				recentEvents: undefined,
			})
		}
	})
	async handle(input: SystemGetStateInput, ctx: EventContext): Promise<SystemGetStateOutput> {
		const state = await redisScripts.getSystemState();
		
		return {
			tasks: state.tasks?.length > 0 ? state.tasks : undefined,
			instances: state.instances?.length > 0 ? state.instances : undefined,
			recentEvents: state.recentEvents?.length > 0 ? state.recentEvents : undefined,
		};
	}
}