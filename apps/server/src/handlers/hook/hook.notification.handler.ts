import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { hookNotificationInput, hookNotificationOutput } from "@/schemas/hook.schema";
import type { HookNotificationInput, HookNotificationOutput } from "@/schemas/hook.schema";

@EventHandler({
	event: "hook.notification",
	inputSchema: hookNotificationInput,
	outputSchema: hookNotificationOutput,
	persist: false,
	rateLimit: 100,
	description: "Handle notifications from Claude Code hooks",
	mcp: {
		visible: false, // Hook handlers are internal infrastructure, not user-facing tools
	}
})
export class HookNotificationHandler {
	@Instrumented(60)
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 2000,
		circuitBreaker: { 
			threshold: 10, 
			timeout: 30000,
			fallback: () => ({ 
				received: true,
				broadcasted: false
			})
		}
	})
	async handle(input: HookNotificationInput, ctx: EventContext): Promise<HookNotificationOutput> {
		console.log(`[HookNotification] ${input.type.toUpperCase()}: ${input.message}`, {
			instanceId: input.instanceId,
			sessionId: input.sessionId,
			timestamp: new Date(input.timestamp).toISOString()
		});
		
		let broadcasted = false;
		
		try {
			// Store notification in Redis stream for history
			const notificationStreamKey = `cb:notifications:${input.sessionId}`;
			await ctx.redis.stream.xadd(
				notificationStreamKey,
				"*",
				"message", input.message,
				"type", input.type,
				"instanceId", input.instanceId,
				"sessionId", input.sessionId,
				"timestamp", input.timestamp.toString()
			);
			
			// Keep notification history for 24 hours
			await ctx.redis.stream.expire(notificationStreamKey, 86400);
			
			// Store latest notification for quick access
			const latestKey = `cb:notification:latest:${input.instanceId}`;
			await ctx.redis.stream.hset(latestKey, {
				message: input.message,
				type: input.type,
				sessionId: input.sessionId,
				timestamp: input.timestamp.toString()
			});
			await ctx.redis.stream.expire(latestKey, 3600); // Keep for 1 hour
			
			// Count notifications by type for metrics
			const metricsKey = `cb:metrics:notifications:${input.type}`;
			await ctx.redis.stream.incr(metricsKey);
			await ctx.redis.stream.expire(metricsKey, 86400); // Reset daily
			
			// Emit notification event for subscribers (dashboard, monitoring, etc.)
			await ctx.publish({
				type: "notification.received",
				payload: {
					message: input.message,
					notificationType: input.type,
					instanceId: input.instanceId,
					sessionId: input.sessionId,
					timestamp: input.timestamp,
				},
			});
			
			broadcasted = true;
			
			// Special handling for error notifications
			if (input.type === "error") {
				console.error(`[HookNotification] ERROR from ${input.instanceId}: ${input.message}`);
				
				// Track error count for circuit breaker consideration
				const errorKey = `cb:errors:${input.instanceId}`;
				const errorCount = await ctx.redis.stream.incr(errorKey);
				await ctx.redis.stream.expire(errorKey, 300); // 5 minute window
				
				if (errorCount > 10) {
					console.warn(`[HookNotification] High error rate detected for ${input.instanceId}: ${errorCount} errors in 5 minutes`);
				}
			}
			
			// Special handling for warning notifications
			if (input.type === "warning") {
				console.warn(`[HookNotification] WARNING from ${input.instanceId}: ${input.message}`);
			}
			
			// Log success notifications for positive tracking
			if (input.type === "success") {
				const successKey = `cb:metrics:success:${input.instanceId}`;
				await ctx.redis.stream.incr(successKey);
				await ctx.redis.stream.expire(successKey, 3600);
			}
		} catch (error) {
			console.error(`[HookNotification] Error handling notification:`, error);
			// Still acknowledge receipt even if broadcasting fails
		}
		
		return {
			received: true,
			broadcasted
		};
	}
}