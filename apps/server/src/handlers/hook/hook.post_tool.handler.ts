import { EventHandler } from "@/core/decorator";
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
})
export class PostToolHookHandler {
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
		if (input.tool === "file.write" && typeof input.result === 'object') {
			const createdFiles = redisKey("created", "files");
			if (input.result.path) {
				await ctx.redis.stream.sadd(createdFiles, input.result.path);
			}
			processed = { acknowledged: true, path: input.result.path };
		}
		
		// Example: Track task creation results
		if (input.tool === "task.create" && typeof input.result === 'object') {
			if (input.result.id) {
				const tasksKey = redisKey("created", "tasks");
				await ctx.redis.stream.sadd(tasksKey, input.result.id);
				processed = { acknowledged: true, taskId: input.result.id };
			}
		}
		
		// Example: Monitor API call results
		if (input.tool === "api.call" && typeof input.result === 'object') {
			const apiStatsKey = redisKey("stats", "api");
			if (input.result.status) {
				await ctx.redis.stream.hincrby(apiStatsKey, `status_${input.result.status}`, 1);
			}
			processed = { 
				acknowledged: true, 
				status: input.result.status,
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
		
		// Publish post-tool event
		await ctx.publish({
			type: "hook.post_tool.executed",
			payload: {
				tool: input.tool,
				hasError,
				processed: true,
			},
		});
		
		return {
			processed,
		};
	}
}