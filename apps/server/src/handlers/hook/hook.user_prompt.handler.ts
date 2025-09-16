import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookUserPromptInput, hookUserPromptOutput } from "@/schemas/hook.schema";
import type { HookUserPromptInput, HookUserPromptOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "hook.user_prompt",
	inputSchema: hookUserPromptInput,
	outputSchema: hookUserPromptOutput,
	persist: false,
	rateLimit: 100,
	description: "Intercept and potentially modify user prompts",
})
export class UserPromptHookHandler {
	@Instrumented(120) // Cache for 2 minutes - prompts may be repeated
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 requests per minute
		timeout: 3000, // 3 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				modified: undefined // Don't modify on circuit open
			})
		}
	})
	async handle(input: HookUserPromptInput, ctx: EventContext): Promise<HookUserPromptOutput> {
		// Track prompt for history
		const historyKey = redisKey("history", "prompts", Date.now().toString());
		await ctx.redis.stream.hset(historyKey, {
			prompt: input.prompt,
			context: JSON.stringify(input.context),
			timestamp: new Date().toISOString(),
		});
		await ctx.redis.stream.expire(historyKey, 86400); // Keep for 24 hours
		
		// Check for dangerous patterns to warn about
		const DANGEROUS_PATTERNS = [
			{ pattern: /rm\s+-rf\s+\//gi, warning: "⚠️ Destructive command detected" },
			{ pattern: /drop\s+database/gi, warning: "⚠️ Database destruction command" },
			{ pattern: /password|secret|api[_\s]?key/gi, warning: "⚠️ Sensitive information mentioned" },
		];
		
		let modifiedPrompt: string | undefined;
		const warnings: string[] = [];
		
		for (const { pattern, warning } of DANGEROUS_PATTERNS) {
			if (pattern.test(input.prompt)) {
				warnings.push(warning);
			}
		}
		
		// Add warnings to prompt if any found
		if (warnings.length > 0) {
			modifiedPrompt = `${input.prompt}\n\n${warnings.join("\n")}`;
		}
		
		// Check context for special modifications
		if (input.context?.enhance === true) {
			const enhancements: string[] = [];
			const lowerPrompt = input.prompt.toLowerCase();
			
			if (lowerPrompt.includes("test")) {
				enhancements.push("Remember to write comprehensive tests");
			}
			if (lowerPrompt.includes("implement") || lowerPrompt.includes("create")) {
				enhancements.push("Follow clean code principles");
			}
			
			if (enhancements.length > 0) {
				const currentPrompt = modifiedPrompt || input.prompt;
				modifiedPrompt = `${currentPrompt}\n\nContext: ${enhancements.join(", ")}`;
			}
		}
		
		// Publish event with full details
		await ctx.publish({
			type: "hook.user_prompt.executed",
			payload: {
				originalPrompt: input.prompt,
				modifiedPrompt: modifiedPrompt,
				context: input.context,
				sessionId: input.sessionId,
				instanceId: input.instanceId,
				timestamp: input.timestamp,
				modified: !!modifiedPrompt,
			},
		});
		
		// Return modified prompt if changed, otherwise undefined per contract
		return {
			modified: modifiedPrompt,
		};
	}
}