import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookPostToolInput, hookPostToolOutput } from "@/schemas/hook.schema";
import type { HookPostToolInput, HookPostToolOutput } from "@/schemas/hook.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "hook.post_tool",
	inputSchema: hookPostToolInput,
	outputSchema: hookPostToolOutput,
	persist: false,
	rateLimit: 1000,
	description: "Process tool execution results",
	mcp: {
		visible: false, // Hook handlers are internal infrastructure, not user-facing tools
	}
})
export class PostToolHookHandler {
	@Instrumented(60) // Cache for 1 minute - post-tool results change frequently
	@Resilient({
		rateLimit: { limit: 1000, windowMs: 60000 }, // 1000 requests per minute
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 10, 
			timeout: 30000,
			fallback: () => ({ 
				processed: true // Mark as processed even if circuit is open
			})
		}
	})
	async handle(input: HookPostToolInput, ctx: EventContext): Promise<HookPostToolOutput> {
		// Log tool execution result
		const logKey = redisKey("log", "tool", input.tool, Date.now().toString());
		await ctx.redis.stream.hset(logKey, {
			tool: input.tool,
			result: JSON.stringify(input.result).slice(0, 1000), // Limit size
			timestamp: new Date().toISOString(),
		});
		await ctx.redis.stream.expire(logKey, 86400); // Keep for 24 hours
		
		// Update tool execution metrics
		const metricsKey = redisKey("metrics", "tools", input.tool);
		await ctx.redis.stream.hincrby(metricsKey, "executions", 1);
		
		// Check for errors in result
		let hasError = false;
		if (typeof input.result === 'object' && input.result !== null) {
			hasError = 'error' in input.result || 'failed' in input.result;
			if (hasError) {
				await ctx.redis.stream.hincrby(metricsKey, "errors", 1);
			}
		}
		
		// Process specific tool results
		let processed: any = true;
		
		// Example: Extract created file paths from file operations
		if (input.tool === "file.write" && typeof input.result === 'object' && input.result !== null) {
			const createdFiles = redisKey("created", "files");
			const result = input.result as any;
			if (result.path) {
				await ctx.redis.stream.sadd(createdFiles, result.path);
			}
			processed = { acknowledged: true, path: result.path };
		}
		
		// Example: Track task creation results
		if (input.tool === "task.create" && typeof input.result === 'object' && input.result !== null) {
			const result = input.result as any;
			if (result.id) {
				const tasksKey = redisKey("created", "tasks");
				await ctx.redis.stream.sadd(tasksKey, result.id);
				processed = { acknowledged: true, taskId: result.id };
			}
		}
		
		// Example: Monitor API call results
		if (input.tool === "api.call" && typeof input.result === 'object' && input.result !== null) {
			const apiStatsKey = redisKey("stats", "api");
			const result = input.result as any;
			if (result.status) {
				await ctx.redis.stream.hincrby(apiStatsKey, `status_${result.status}`, 1);
			}
			processed = { 
				acknowledged: true, 
				status: result.status,
				cached: false
			};
		}
		
		// Track consecutive errors for circuit breaker pattern
		if (hasError) {
			const errorKey = redisKey("errors", input.tool);
			const errorCount = await ctx.redis.stream.incr(errorKey);
			await ctx.redis.stream.expire(errorKey, 300); // Reset after 5 minutes
			
			if (errorCount > 5) {
				// Publish alert for too many errors
				await ctx.publish({
					type: "alert.tool_errors",
					payload: {
						tool: input.tool,
						errorCount,
						message: `Tool ${input.tool} has failed ${errorCount} times in the last 5 minutes`,
					},
				});
			}
		}
		
		// Publish post-tool event with full details
		await ctx.publish({
			type: "hook.post_tool.executed",
			payload: {
				tool: input.tool,
				params: input.params,
				result: input.result,
				sessionId: input.sessionId,
				instanceId: input.instanceId,
				timestamp: input.timestamp,
				executionTime: input.executionTime,
				success: input.success,
				hasError,
				processed: true,
			},
		});
		
		return {
			processed,
		};
	}
}