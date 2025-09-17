import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookAgentStopInput, hookAgentStopOutput } from "@/schemas/hook.schema";
import type { HookAgentStopInput, HookAgentStopOutput } from "@/schemas/hook.schema";

@EventHandler({
	event: "hook.agent_stop",
	inputSchema: hookAgentStopInput,
	outputSchema: hookAgentStopOutput,
	persist: false,
	rateLimit: 50,
	description: "Handle agent termination events from Claude Code hooks",
	mcp: {
		visible: false, // Hook handlers are internal infrastructure, not user-facing tools
	}
})
export class HookAgentStopHandler {
	@Instrumented(60)
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 3000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				acknowledged: false,
				cleanedUp: false
			})
		}
	})
	async handle(input: HookAgentStopInput, ctx: EventContext): Promise<HookAgentStopOutput> {
		console.log(`[HookAgentStop] Agent stop event for ${input.instanceId}:`, {
			sessionId: input.sessionId,
			agentType: input.agentType,
			timestamp: new Date(input.timestamp).toISOString()
		});
		
		let cleanedUp = false;
		
		try {
			// Update instance status if this is the main agent
			if (input.agentType === "main") {
				const instanceKey = `cb:instance:${input.instanceId}`;
				const exists = await ctx.redis.stream.exists(instanceKey);
				
				if (exists) {
					// Mark instance as stopping
					await ctx.redis.stream.hset(instanceKey, {
						status: "STOPPING",
						lastSeen: Date.now(),
						stoppedAt: input.timestamp
					});
					
					// Store stop event in stream for audit
					const stopEventKey = `cb:events:agent_stop:${input.instanceId}`;
					await ctx.redis.stream.xadd(
						stopEventKey,
						"*",
						"instanceId", input.instanceId,
						"sessionId", input.sessionId,
						"agentType", input.agentType,
						"timestamp", input.timestamp.toString()
					);
					
					// Set TTL for cleanup (keep stop events for 1 hour)
					await ctx.redis.stream.expire(stopEventKey, 3600);
					
					cleanedUp = true;
				}
			}
			
			// Emit stop event for monitoring
			await ctx.publish({
				type: "agent.stopped",
				payload: {
					instanceId: input.instanceId,
					sessionId: input.sessionId,
					agentType: input.agentType,
					timestamp: input.timestamp,
					cleanedUp
				},
			});
			
			// Log subagent stops for debugging
			if (input.agentType === "subagent" || input.agentType === "unknown") {
				console.log(`[HookAgentStop] Subagent stop recorded:`, {
					instanceId: input.instanceId,
					agentType: input.agentType
				});
			}
		} catch (error) {
			console.error(`[HookAgentStop] Error handling agent stop:`, error);
			// Still acknowledge even if cleanup fails
		}
		
		return {
			acknowledged: true,
			cleanedUp
		};
	}
}