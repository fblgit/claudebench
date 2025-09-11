import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookPreToolInput, hookPreToolOutput } from "@/schemas/hook.schema";
import type { HookPreToolInput, HookPreToolOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

// Dangerous commands to block
const DANGEROUS_COMMANDS = [
	"rm -rf",
	"sudo rm",
	"format",
	"del /f",
	"drop database",
	"truncate",
];

// Tool-specific parameter validation rules
const TOOL_RULES: Record<string, (params: any) => { allowed: boolean; reason?: string }> = {
	"file.write": (params) => {
		if (params.path?.includes("/etc/") || params.path?.includes("/sys/")) {
			return { allowed: false, reason: "Cannot write to system directories" };
		}
		return { allowed: true };
	},
	"bash.execute": (params) => {
		const command = params.command?.toLowerCase() || "";
		for (const dangerous of DANGEROUS_COMMANDS) {
			if (command.includes(dangerous)) {
				return { allowed: false, reason: `Dangerous command detected: ${dangerous}` };
			}
		}
		return { allowed: true };
	},
	"api.call": (params) => {
		if (params.url?.includes("localhost") || params.url?.includes("127.0.0.1")) {
			return { allowed: false, reason: "Cannot call localhost APIs" };
		}
		return { allowed: true };
	},
};

@EventHandler({
	event: "hook.pre_tool",
	inputSchema: hookPreToolInput,
	outputSchema: hookPreToolOutput,
	persist: false,
	rateLimit: 1000,
	description: "Validate and authorize tool execution before it happens",
})
export class PreToolHookHandler {
	async handle(input: HookPreToolInput, ctx: EventContext): Promise<HookPreToolOutput> {
		const hookKey = redisKey("hook", "pre_tool", input.instanceId);
		const metricsKey = redisKey("metrics", "hooks", "pre_tool");
		
		// Check if hook is registered for this instance
		const registeredKey = redisKey("hook", "registered", input.instanceId);
		const isRegistered = await ctx.redis.stream.exists(registeredKey);
		
		// Track hook execution metrics
		await ctx.redis.stream.hincrby(metricsKey, "total_calls", 1);
		await ctx.redis.stream.hincrby(metricsKey, input.toolName, 1);
		
		// Default allow if no hook registered
		if (!isRegistered) {
			await ctx.redis.stream.hincrby(metricsKey, "no_hook", 1);
			return {
				allowed: true,
				warnings: ["No pre-tool hook registered for this instance"],
			};
		}
		
		// Apply tool-specific rules
		const toolRule = TOOL_RULES[input.toolName];
		if (toolRule) {
			const ruleResult = toolRule(input.toolParams);
			if (!ruleResult.allowed) {
				await ctx.redis.stream.hincrby(metricsKey, "blocked", 1);
				
				// Store blocked attempt for audit
				const blockedKey = redisKey("audit", "blocked", Date.now().toString());
				await ctx.redis.stream.hset(blockedKey, {
					toolName: input.toolName,
					instanceId: input.instanceId,
					sessionId: input.sessionId,
					reason: ruleResult.reason || "Rule violation",
					timestamp: new Date().toISOString(),
					params: JSON.stringify(input.toolParams),
				});
				
				// Publish event for monitoring
				await ctx.publish({
					type: "hook.tool_blocked",
					payload: {
						toolName: input.toolName,
						instanceId: input.instanceId,
						reason: ruleResult.reason,
					},
					metadata: {
						sessionId: input.sessionId,
					},
				});
				
				return {
					allowed: false,
					reason: ruleResult.reason,
				};
			}
		}
		
		// Check for parameter modifications
		let modifiedParams = undefined;
		const warnings: string[] = [];
		
		// Example: Add safety parameters for certain tools
		if (input.toolName === "bash.execute") {
			modifiedParams = {
				...input.toolParams,
				timeout: input.toolParams.timeout || 30000, // Add default timeout
				safeMode: true,
			};
			warnings.push("Added safety parameters to bash execution");
		}
		
		// Store hook execution for debugging
		const executionKey = redisKey("hook", "execution", Date.now().toString());
		await ctx.redis.stream.hset(executionKey, {
			type: "pre_tool",
			toolName: input.toolName,
			instanceId: input.instanceId,
			sessionId: input.sessionId,
			allowed: "true",
			timestamp: new Date().toISOString(),
		});
		await ctx.redis.stream.expire(executionKey, 3600); // Keep for 1 hour
		
		// Update allowed metrics
		await ctx.redis.stream.hincrby(metricsKey, "allowed", 1);
		
		// Publish event for tracking
		await ctx.publish({
			type: "hook.pre_tool_executed",
			payload: {
				toolName: input.toolName,
				instanceId: input.instanceId,
				allowed: true,
				modified: !!modifiedParams,
			},
			metadata: {
				sessionId: input.sessionId,
			},
		});
		
		return {
			allowed: true,
			modifiedParams,
			warnings: warnings.length > 0 ? warnings : undefined,
		};
	}
}