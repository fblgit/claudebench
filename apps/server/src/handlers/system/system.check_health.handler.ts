import { EventHandler, Instrumented } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { z } from "zod";
import { redisScripts } from "@/core/redis-scripts";

const checkHealthInput = z.object({
	timeout: z.number().optional().default(10000), // 10 seconds default
});

const checkHealthOutput = z.object({
	healthy: z.array(z.string()),
	failed: z.array(z.string()),
	reassigned: z.record(z.string(), z.number()),
});

@EventHandler({
	event: "system.check_health",
	inputSchema: checkHealthInput,
	outputSchema: checkHealthOutput,
	persist: false,
	rateLimit: 100,
	description: "Check instance health and handle failures",
})
export class SystemCheckHealthHandler {
	@Instrumented(5) // Cache for 5 seconds
	async handle(input: z.infer<typeof checkHealthInput>, ctx: EventContext): Promise<z.infer<typeof checkHealthOutput>> {
		const now = Date.now();
		const timeout = input.timeout;
		
		// Get all instances
		const instanceKeys = await ctx.redis.stream.keys("cb:instance:*");
		const healthy: string[] = [];
		const failed: string[] = [];
		const reassigned: Record<string, number> = {};
		
		for (const key of instanceKeys) {
			const instanceId = key.split(":").pop();
			if (!instanceId) continue;
			
			// Check instance health
			const lastSeen = await ctx.redis.stream.hget(key, "lastSeen");
			const status = await ctx.redis.stream.hget(key, "status");
			
			if (status === "OFFLINE") {
				// Already marked offline
				failed.push(instanceId);
				continue;
			}
			
			if (lastSeen) {
				const lastSeenTime = parseInt(lastSeen);
				const timeSinceLastSeen = now - lastSeenTime;
				
				if (timeSinceLastSeen > timeout) {
					// Instance is stale - mark as failed and reassign tasks
					console.log(`[CheckHealth] Instance ${instanceId} is stale (${timeSinceLastSeen}ms since last seen)`);
					
					// Use Lua script to handle failure and reassignment atomically
					const result = await redisScripts.reassignFailedTasks(instanceId);
					
					if (result.reassigned > 0) {
						console.log(`[CheckHealth] Reassigned ${result.reassigned} tasks from ${instanceId} to ${result.workers} workers`);
						reassigned[instanceId] = result.reassigned;
					}
					
					failed.push(instanceId);
					
					// Publish failure event
					await ctx.publish({
						type: "instance.failed",
						payload: {
							id: instanceId,
							lastSeen: lastSeenTime,
							tasksReassigned: result.reassigned,
						},
					});
				} else {
					healthy.push(instanceId);
				}
			} else {
				// No lastSeen timestamp - consider failed
				failed.push(instanceId);
			}
		}
		
		// Update metrics
		await ctx.redis.stream.hset("cb:metrics:health", {
			healthyInstances: healthy.length.toString(),
			failedInstances: failed.length.toString(),
			lastCheck: now.toString(),
		});
		
		return {
			healthy,
			failed,
			reassigned,
		};
	}
}