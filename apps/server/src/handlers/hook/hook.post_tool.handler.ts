import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookPostToolInput, hookPostToolOutput } from "@/schemas/hook.schema";
import type { HookPostToolInput, HookPostToolOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

// Side effects to trigger based on tool and result
const SIDE_EFFECT_RULES: Record<string, (input: HookPostToolInput) => string[]> = {
	"file.write": (input) => {
		const effects: string[] = [];
		if (input.toolParams.path?.endsWith(".md")) {
			effects.push("documentation_updated");
		}
		if (input.toolParams.path?.includes("test")) {
			effects.push("test_file_changed");
		}
		return effects;
	},
	"api.call": (input) => {
		const effects: string[] = [];
		if (!input.success) {
			effects.push("api_failure_logged");
		}
		if (input.executionTime > 5000) {
			effects.push("slow_api_detected");
		}
		return effects;
	},
	"task.create": () => ["task_queue_updated"],
	"git.commit": () => ["code_committed", "trigger_ci"],
};

// Notification rules based on tool results
const NOTIFICATION_RULES: Record<string, (input: HookPostToolInput) => Array<{ type: "info" | "warning" | "error"; message: string }>> = {
	"bash.execute": (input) => {
		const notifications = [];
		if (!input.success && input.error) {
			notifications.push({
				type: "error" as const,
				message: `Command failed: ${input.error}`,
			});
		}
		if (input.executionTime > 10000) {
			notifications.push({
				type: "warning" as const,
				message: "Command took longer than 10 seconds",
			});
		}
		return notifications;
	},
	"file.delete": (input) => {
		return [{
			type: "warning" as const,
			message: `File deleted: ${input.toolParams.path}`,
		}];
	},
};

@EventHandler({
	event: "hook.post_tool",
	inputSchema: hookPostToolInput,
	outputSchema: hookPostToolOutput,
	persist: false,
	rateLimit: 1000,
	description: "Process tool execution results and trigger side effects",
})
export class PostToolHookHandler {
	async handle(input: HookPostToolInput, ctx: EventContext): Promise<HookPostToolOutput> {
		const metricsKey = redisKey("metrics", "hooks", "post_tool");
		const toolStatsKey = redisKey("stats", "tools", input.toolName);
		
		// Update metrics
		await ctx.redis.stream.hincrby(metricsKey, "total_calls", 1);
		await ctx.redis.stream.hincrby(metricsKey, input.success ? "successful" : "failed", 1);
		
		// Update tool-specific statistics
		await ctx.redis.stream.hincrby(toolStatsKey, "executions", 1);
		await ctx.redis.stream.hincrby(toolStatsKey, input.success ? "successes" : "failures", 1);
		
		// Track execution time statistics
		const timeKey = redisKey("stats", "execution_time", input.toolName);
		await ctx.redis.stream.zadd(
			timeKey,
			input.executionTime,
			`${input.sessionId}:${Date.now()}`
		);
		
		// Keep only last 1000 entries for rolling statistics
		await ctx.redis.stream.zremrangebyrank(timeKey, 0, -1001);
		
		// Calculate and store average execution time
		const times = await ctx.redis.stream.zrange(timeKey, 0, -1, "WITHSCORES");
		if (times.length >= 2) {
			let totalTime = 0;
			let count = 0;
			for (let i = 1; i < times.length; i += 2) {
				totalTime += parseFloat(times[i]);
				count++;
			}
			const avgTime = totalTime / count;
			await ctx.redis.stream.hset(toolStatsKey, {
				avg_execution_time: avgTime.toString(),
				last_execution: new Date().toISOString(),
			});
		}
		
		// Log tool execution result
		const logKey = redisKey("log", "tool_execution", Date.now().toString());
		await ctx.redis.stream.hset(logKey, {
			toolName: input.toolName,
			instanceId: input.instanceId,
			sessionId: input.sessionId,
			success: input.success.toString(),
			executionTime: input.executionTime.toString(),
			error: input.error || "",
			timestamp: new Date().toISOString(),
			params: JSON.stringify(input.toolParams),
			result: JSON.stringify(input.toolResult).slice(0, 1000), // Limit result size
		});
		await ctx.redis.stream.expire(logKey, 86400); // Keep for 24 hours
		
		// Check for side effects to trigger
		const sideEffectRule = SIDE_EFFECT_RULES[input.toolName];
		const sideEffects = sideEffectRule ? sideEffectRule(input) : [];
		
		// Process side effects
		for (const effect of sideEffects) {
			const effectKey = redisKey("side_effect", effect, Date.now().toString());
			await ctx.redis.stream.hset(effectKey, {
				trigger: input.toolName,
				instanceId: input.instanceId,
				sessionId: input.sessionId,
				timestamp: new Date().toISOString(),
			});
			
			// Publish side effect event
			await ctx.publish({
				type: `side_effect.${effect}`,
				payload: {
					toolName: input.toolName,
					effect,
					toolResult: input.toolResult,
				},
				metadata: {
					instanceId: input.instanceId,
					sessionId: input.sessionId,
				},
			});
		}
		
		// Check for notifications
		const notificationRule = NOTIFICATION_RULES[input.toolName];
		const notifications = notificationRule ? notificationRule(input) : [];
		
		// Handle long-running tool notification
		if (input.executionTime > 30000) {
			notifications.push({
				type: "warning",
				message: `Tool ${input.toolName} took ${(input.executionTime / 1000).toFixed(1)}s to execute`,
			});
		}
		
		// Store notifications for delivery
		if (notifications.length > 0) {
			const notificationKey = redisKey("notifications", input.instanceId);
			for (const notification of notifications) {
				await ctx.redis.stream.lpush(
					notificationKey,
					JSON.stringify({
						...notification,
						toolName: input.toolName,
						timestamp: new Date().toISOString(),
					})
				);
			}
			// Keep only last 100 notifications
			await ctx.redis.stream.ltrim(notificationKey, 0, 99);
		}
		
		// Track failed tool executions specially
		if (!input.success) {
			const failureKey = redisKey("failures", input.toolName, input.sessionId);
			await ctx.redis.stream.hincrby(failureKey, "count", 1);
			await ctx.redis.stream.hset(failureKey, {
				lastError: input.error || "Unknown error",
				lastFailure: new Date().toISOString(),
			});
			await ctx.redis.stream.expire(failureKey, 3600); // Track failures for 1 hour
		}
		
		// Apply result transformations for specific tools
		let metadata: Record<string, any> | undefined;
		if (input.toolName === "api.call" && input.success) {
			metadata = {
				responseSize: JSON.stringify(input.toolResult).length,
				cached: false,
			};
		}
		
		// Publish post-tool event
		await ctx.publish({
			type: "hook.post_tool_executed",
			payload: {
				toolName: input.toolName,
				instanceId: input.instanceId,
				success: input.success,
				executionTime: input.executionTime,
				sideEffects,
			},
			metadata: {
				sessionId: input.sessionId,
			},
		});
		
		return {
			processed: true,
			sideEffects: sideEffects.length > 0 ? sideEffects : undefined,
			notifications: notifications.length > 0 ? notifications : undefined,
			metadata,
		};
	}
}