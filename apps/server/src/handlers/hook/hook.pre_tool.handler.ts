import { EventHandler, Instrumented } from "@/core/decorator";
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
})
export class PreToolHookHandler {
	@Instrumented(300) // Cache for 5 minutes - handles caching, metrics, and audit
	async handle(input: HookPreToolInput, ctx: EventContext): Promise<HookPreToolOutput> {
		// Use the configurable hook validator
		const result = await hookValidator.validate({
			tool: input.tool,
			params: input.params,
			sessionId: ctx.sessionId,
			instanceId: ctx.instanceId,
		});

		// Return the validation result
		// The decorator handles caching, metrics, and audit logging
		return result;
	}
}