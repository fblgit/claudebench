import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookPreToolInput, hookPreToolOutput } from "@/schemas/hook.schema";
import type { HookPreToolInput, HookPreToolOutput } from "@/schemas/hook.schema";
import { hookValidator } from "@/core/hook-validator";

@EventHandler({
	event: "hook.pre_tool",
	inputSchema: hookPreToolInput,
	outputSchema: hookPreToolOutput,
	persist: false,
	rateLimit: 1000,
	description: "Validate tool execution before it happens",
	mcp: {
		visible: false, // Hook handlers are internal infrastructure, not user-facing tools
	}
})
export class PreToolHookHandler {
	@Instrumented(300) // Cache for 5 minutes - handles caching, metrics, and audit
	@Resilient({
		rateLimit: { limit: 1000, windowMs: 60000 }, // 1000 requests per minute
		timeout: 3000, // 3 second timeout for hook validation
		circuitBreaker: { 
			threshold: 10, // Open after 10 failures
			timeout: 30000, // Try again after 30 seconds
			fallback: () => ({ 
				allow: true, // Allow by default if circuit is open
				reason: "Hook validation circuit breaker open - allowing by default"
			})
		}
	})
	async handle(input: HookPreToolInput, ctx: EventContext): Promise<HookPreToolOutput> {
		// Use the configurable hook validator
		const result = await hookValidator.validate({
			tool: input.tool,
			params: input.params,
			sessionId: ctx.metadata?.sessionId,
			instanceId: ctx.instanceId,
		});

		// Publish pre-tool event with full details
		await ctx.publish({
			type: "hook.pre_tool.executed",
			payload: {
				tool: input.tool,
				params: input.params,
				sessionId: input.sessionId,
				instanceId: input.instanceId,
				timestamp: input.timestamp,
				validationResult: result
			},
		});

		// Return the validation result
		// The decorators handle caching, metrics, audit logging, rate limiting, timeout, and circuit breaker
		return result;
	}
}