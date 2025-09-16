import { EventHandler, Instrumented } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { z } from "zod";

const flushInput = z.object({
	confirm: z.literal("FLUSH_ALL_DATA"),
	includePostgres: z.boolean().optional().default(true),
});

const flushOutput = z.object({
	redis: z.object({
		keysDeleted: z.number(),
		patterns: z.array(z.string()),
	}),
	postgres: z.object({
		tasksDeleted: z.number(),
		eventsDeleted: z.number(),
	}).optional(),
	timestamp: z.string(),
});

@EventHandler({
	event: "system.flush",
	inputSchema: flushInput,
	outputSchema: flushOutput,
	persist: false,
	rateLimit: 1, // Very low rate limit - this is a dangerous operation
	description: "Flush all ClaudeBench data from Redis and optionally PostgreSQL",
})
export class SystemFlushHandler {
	@Instrumented(0) // Never cache this operation
	async handle(input: z.infer<typeof flushInput>, ctx: EventContext): Promise<z.infer<typeof flushOutput>> {
		console.warn("[FLUSH] ⚠️  System flush requested - clearing all ClaudeBench data");
		
		// Patterns to clear from Redis
		const patterns = [
			"cb:task:*",
			"cb:instance:*",
			"cb:queue:*",
			"cb:stream:*",
			"cb:metrics:*",
			"cb:circuit:*",
			"cb:ratelimit:*",
			"cb:todo:*",
			"cb:service:*",
			"cb:hook:*",
			"cb:session:*",
			"cb:health:*",
			"cb:quorum:*",
			"cb:batch:*",
			"cb:scaling:*",
		];
		
		let totalKeysDeleted = 0;
		
		// Clear Redis data for each pattern
		for (const pattern of patterns) {
			try {
				const keys = await ctx.redis.stream.keys(pattern);
				if (keys.length > 0) {
					// Delete in batches to avoid blocking Redis
					const batchSize = 100;
					for (let i = 0; i < keys.length; i += batchSize) {
						const batch = keys.slice(i, i + batchSize);
						await ctx.redis.stream.del(...batch);
					}
					console.log(`[FLUSH] Deleted ${keys.length} keys matching pattern: ${pattern}`);
					totalKeysDeleted += keys.length;
				}
			} catch (error: any) {
				console.error(`[FLUSH] Error deleting keys for pattern ${pattern}:`, error?.message);
			}
		}
		
		// Clear PostgreSQL data if requested
		let postgresResult = undefined;
		if (input.includePostgres && ctx.prisma) {
			try {
				console.log("[FLUSH] Clearing PostgreSQL data...");
				
				// Delete all tasks
				const tasksDeleted = await ctx.prisma.task.deleteMany({});
				
				// Delete all events  
				const eventsDeleted = await ctx.prisma.event.deleteMany({});
				
				postgresResult = {
					tasksDeleted: tasksDeleted.count,
					eventsDeleted: eventsDeleted.count,
				};
				
				console.log(`[FLUSH] PostgreSQL: Deleted ${tasksDeleted.count} tasks and ${eventsDeleted.count} events`);
			} catch (error: any) {
				console.error("[FLUSH] Error clearing PostgreSQL:", error?.message);
				// Don't fail the whole operation if Postgres fails
				postgresResult = {
					tasksDeleted: 0,
					eventsDeleted: 0,
				};
			}
		}
		
		// Publish flush event for any listeners
		await ctx.publish({
			type: "system.flushed",
			payload: {
				redis: totalKeysDeleted,
				postgres: postgresResult,
				timestamp: new Date().toISOString(),
			},
		});
		
		console.log(`[FLUSH] ✅ System flush complete - cleared ${totalKeysDeleted} Redis keys`);
		
		return {
			redis: {
				keysDeleted: totalKeysDeleted,
				patterns,
			},
			postgres: postgresResult,
			timestamp: new Date().toISOString(),
		};
	}
}