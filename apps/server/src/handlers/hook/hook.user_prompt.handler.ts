import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookUserPromptInput, hookUserPromptOutput } from "@/schemas/hook.schema";
import type { HookUserPromptInput, HookUserPromptOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

// Keywords that might trigger prompt modifications
const ENHANCEMENT_KEYWORDS = {
	test: "Remember to write tests for your implementation",
	security: "Ensure secure coding practices and input validation",
	performance: "Consider performance implications and optimization",
	documentation: "Include inline documentation and update README if needed",
	accessibility: "Ensure UI components are accessible (ARIA labels, keyboard navigation)",
};

// Dangerous patterns to warn about
const DANGEROUS_PATTERNS = [
	{ pattern: /rm\s+-rf\s+\//gi, warning: "Destructive command detected - use with caution" },
	{ pattern: /drop\s+database/gi, warning: "Database destruction command - verify before execution" },
	{ pattern: /api[_\s]?key|secret|password/gi, warning: "Sensitive information mentioned - avoid hardcoding credentials" },
	{ pattern: /eval\(|exec\(/gi, warning: "Dynamic code execution - potential security risk" },
];

@EventHandler({
	event: "hook.user_prompt",
	inputSchema: hookUserPromptInput,
	outputSchema: hookUserPromptOutput,
	persist: false,
	rateLimit: 100,
	description: "Process and potentially enhance user prompts before execution",
})
export class UserPromptHookHandler {
	async handle(input: HookUserPromptInput, ctx: EventContext): Promise<HookUserPromptOutput> {
		const metricsKey = redisKey("metrics", "hooks", "user_prompt");
		const promptHistoryKey = redisKey("history", "prompts", input.sessionId);
		
		// Track metrics
		await ctx.redis.stream.hincrby(metricsKey, "total_calls", 1);
		
		// Store prompt in history
		await ctx.redis.stream.lpush(promptHistoryKey, JSON.stringify({
			prompt: input.prompt,
			instanceId: input.instanceId,
			timestamp: new Date().toISOString(),
			context: input.context,
		}));
		// Keep only last 50 prompts
		await ctx.redis.stream.ltrim(promptHistoryKey, 0, 49);
		
		// Check for context-aware modifications
		const additions: string[] = [];
		let modifiedPrompt = input.prompt;
		
		// Add contextual enhancements based on keywords
		const lowerPrompt = input.prompt.toLowerCase();
		for (const [keyword, enhancement] of Object.entries(ENHANCEMENT_KEYWORDS)) {
			if (lowerPrompt.includes(keyword)) {
				additions.push(enhancement);
			}
		}
		
		// Check for dangerous patterns
		for (const { pattern, warning } of DANGEROUS_PATTERNS) {
			if (pattern.test(input.prompt)) {
				additions.push(`⚠️ ${warning}`);
				await ctx.redis.stream.hincrby(metricsKey, "dangerous_patterns", 1);
			}
		}
		
		// Project-specific context additions
		if (input.context?.project) {
			const projectKey = redisKey("project", "context", input.context.project);
			const projectContext = await ctx.redis.stream.hgetall(projectKey);
			
			if (projectContext?.guidelines) {
				additions.push(`Project guidelines: ${projectContext.guidelines}`);
			}
			
			if (projectContext?.conventions) {
				additions.push(`Follow conventions: ${projectContext.conventions}`);
			}
		}
		
		// Check for continuation context
		const lastPrompts = await ctx.redis.stream.lrange(promptHistoryKey, 1, 3);
		if (lastPrompts.length > 0 && lowerPrompt.includes("continue")) {
			const recentContext = lastPrompts.map(p => {
				const parsed = JSON.parse(p);
				return parsed.prompt;
			}).join(" -> ");
			
			additions.push(`Continuing from recent context: ${recentContext.slice(0, 100)}...`);
		}
		
		// Apply smart prompt enhancements
		if (input.context?.smartMode) {
			// Add best practices based on detected intent
			if (lowerPrompt.includes("create") || lowerPrompt.includes("implement")) {
				additions.push("Follow SOLID principles and clean code practices");
			}
			
			if (lowerPrompt.includes("fix") || lowerPrompt.includes("debug")) {
				additions.push("Include error handling and edge case considerations");
			}
			
			if (lowerPrompt.includes("optimize") || lowerPrompt.includes("improve")) {
				additions.push("Measure performance impact and document improvements");
			}
		}
		
		// Check for prompt templates
		const templateMatch = input.prompt.match(/\{\{(\w+)\}\}/g);
		if (templateMatch) {
			const templateKey = redisKey("templates", input.instanceId);
			const templates = await ctx.redis.stream.hgetall(templateKey);
			
			for (const match of templateMatch) {
				const templateName = match.slice(2, -2);
				if (templates?.[templateName]) {
					modifiedPrompt = modifiedPrompt.replace(match, templates[templateName]);
				}
			}
		}
		
		// Track modification statistics
		const modified = modifiedPrompt !== input.prompt || additions.length > 0;
		if (modified) {
			await ctx.redis.stream.hincrby(metricsKey, "modified", 1);
			
			// Store modification for analysis
			const modificationKey = redisKey("modifications", "prompts", Date.now().toString());
			await ctx.redis.stream.hset(modificationKey, {
				original: input.prompt,
				modified: modifiedPrompt,
				additions: JSON.stringify(additions),
				instanceId: input.instanceId,
				sessionId: input.sessionId,
				timestamp: new Date().toISOString(),
			});
			await ctx.redis.stream.expire(modificationKey, 86400); // Keep for 24 hours
		} else {
			await ctx.redis.stream.hincrby(metricsKey, "unchanged", 1);
		}
		
		// Build final prompt with additions
		if (additions.length > 0 && modifiedPrompt === input.prompt) {
			// If we have additions but haven't modified the prompt itself,
			// append additions as context
			const additionsText = additions.map(a => `\n- ${a}`).join("");
			modifiedPrompt = `${input.prompt}\n\nAdditional context:${additionsText}`;
		}
		
		// Publish event for tracking
		await ctx.publish({
			type: "hook.user_prompt_processed",
			payload: {
				instanceId: input.instanceId,
				modified,
				additionsCount: additions.length,
			},
			metadata: {
				sessionId: input.sessionId,
			},
		});
		
		return {
			modified,
			prompt: modifiedPrompt,
			additions: additions.length > 0 ? additions : undefined,
		};
	}
}