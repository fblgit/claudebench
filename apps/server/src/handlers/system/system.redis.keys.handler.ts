import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRedisKeysInput, systemRedisKeysOutput } from "@/schemas/system.schema";
import type { SystemRedisKeysInput, SystemRedisKeysOutput } from "@/schemas/system.schema";

@EventHandler({
	event: "system.redis.keys",
	inputSchema: systemRedisKeysInput,
	outputSchema: systemRedisKeysOutput,
	persist: false,
	rateLimit: 50, // Lower rate limit for potentially expensive operations
	description: "Scan Redis keys with pattern matching and pagination",
})
export class SystemRedisKeysHandler {
	@Instrumented(60) // Cache for 1 minute
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 }, // 50 requests per minute
		timeout: 10000, // 10 second timeout for Redis operations
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				keys: [],
				cursor: 0,
				pattern: "*",
				total: 0,
				keysByType: {}
			})
		}
	})
	async handle(input: SystemRedisKeysInput, ctx: EventContext): Promise<SystemRedisKeysOutput> {
		const { pattern, cursor, count } = input;
		
		try {
			// Use SCAN command for efficient key iteration
			const result = await ctx.redis.stream.scan(
				cursor,
				"MATCH", pattern,
				"COUNT", count
			);
			
			const [nextCursor, keys] = result;
			const nextCursorNum = parseInt(nextCursor);
			
			// Get key types for categorization if we have keys
			let keysByType: Record<string, number> = {};
			if (keys.length > 0 && keys.length <= 50) { // Only type-check small batches for performance
				const pipeline = ctx.redis.stream.pipeline();
				keys.forEach(key => pipeline.type(key));
				const types = await pipeline.exec();
				
				if (types) {
					keysByType = types.reduce((acc, typeResult, index) => {
						if (typeResult && !typeResult[0]) { // No error
							const type = typeResult[1] as string;
							acc[type] = (acc[type] || 0) + 1;
						}
						return acc;
					}, {} as Record<string, number>);
				}
			}
			
			// If this is the first scan and we want to get a total count estimate
			let total: number | undefined;
			if (cursor === 0 && pattern === "*") {
				try {
					// For wildcard patterns, we can get dbsize
					total = await ctx.redis.stream.dbsize();
				} catch (error) {
					// Ignore errors getting total count
				}
			}
			
			await ctx.publish({
				type: "system.redis.keys.scanned",
				payload: {
					pattern,
					keysFound: keys.length,
					cursor: nextCursorNum,
					keyTypes: Object.keys(keysByType),
				},
			});
			
			return {
				keys,
				cursor: nextCursorNum,
				pattern,
				total,
				keysByType: Object.keys(keysByType).length > 0 ? keysByType : undefined,
			};
		} catch (error: any) {
			// Log the error but still try to return useful information
			console.error(`Redis keys scan failed for pattern "${pattern}":`, error?.message || error);
			
			await ctx.publish({
				type: "system.redis.keys.error",
				payload: {
					pattern,
					error: error?.message || "Unknown Redis error",
					cursor,
				},
			});
			
			throw new Error(`Failed to scan Redis keys: ${error?.message || "Unknown error"}`);
		}
	}
}