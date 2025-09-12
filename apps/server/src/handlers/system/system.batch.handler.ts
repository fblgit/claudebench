import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { z } from "zod";
import { redisScripts } from "@/core/redis-scripts";

// Input/Output schemas for batch processing
const systemBatchProcessInput = z.object({
	batchId: z.string(),
	instanceId: z.string(),
	items: z.array(z.any()),
});

const systemBatchProcessOutput = z.object({
	processed: z.boolean(),
	processorId: z.string().optional(),
	itemsProcessed: z.number().optional(),
});

type SystemBatchProcessInput = z.infer<typeof systemBatchProcessInput>;
type SystemBatchProcessOutput = z.infer<typeof systemBatchProcessOutput>;

@EventHandler({
	event: "system.batch.process",
	inputSchema: systemBatchProcessInput,
	outputSchema: systemBatchProcessOutput,
	persist: false,
	rateLimit: 10,
	description: "Coordinate batch processing across instances",
})
export class SystemBatchProcessHandler {
	@Instrumented(0) // No caching for batch coordination
	@Resilient({
		rateLimit: { limit: 10, windowMs: 60000 }, // 10 batches per minute
		timeout: 30000, // 30 second timeout for batch processing
		circuitBreaker: { 
			threshold: 3, 
			timeout: 60000,
			fallback: () => ({ 
				processed: false // Fail batch if circuit is open
			})
		}
	})
	async handle(input: SystemBatchProcessInput, ctx: EventContext): Promise<SystemBatchProcessOutput> {
		// Try to coordinate batch processing using Lua script
		const coordination = await redisScripts.coordinateBatch(
			input.instanceId,
			input.batchId,
			input.items.length
		);
		
		if (!coordination.lockAcquired) {
			// Another instance is processing this batch
			return {
				processed: false,
				processorId: coordination.currentProcessor,
				itemsProcessed: coordination.progress,
			};
		}
		
		// We got the lock, process the batch
		let itemsProcessed = 0;
		
		try {
			// Process each item (simplified for testing)
			for (const item of input.items) {
				// Simulate processing
				await new Promise(resolve => setTimeout(resolve, 10));
				itemsProcessed++;
				
				// Update progress periodically
				if (itemsProcessed % 10 === 0) {
					await ctx.redis.stream.hset("cb:batch:progress", "processed", itemsProcessed.toString());
				}
			}
			
			// Update final progress
			await ctx.redis.stream.hset("cb:batch:progress", "processed", itemsProcessed.toString());
			
			// Emit batch completion event
			await ctx.publish({
				type: "batch.completed",
				payload: {
					batchId: input.batchId,
					processorId: input.instanceId,
					itemsProcessed,
				},
			});
			
			return {
				processed: true,
				processorId: input.instanceId,
				itemsProcessed,
			};
		} finally {
			// Release the lock
			await ctx.redis.stream.del("cb:batch:lock");
		}
	}
}