import { EventHandler } from "@/core/decorator";
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
		
		// Update metrics
		const metricsKey = redisKey("metrics", "hooks", "user_prompt");
		await ctx.redis.stream.hincrby(metricsKey, "total", 1);
		if (modifiedPrompt) {
			await ctx.redis.stream.hincrby(metricsKey, "modified", 1);
		}
		
		// Publish event
		await ctx.publish({
			type: "hook.user_prompt.executed",
			payload: {
				modified: !!modifiedPrompt,
			},
		});
		
		// Return modified prompt if changed, otherwise undefined per contract
		return {
			modified: modifiedPrompt,
		};
	}
}