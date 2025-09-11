import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRegisterInput, systemRegisterOutput } from "@/schemas/system.schema";
import type { SystemRegisterInput, SystemRegisterOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";
import { instanceManager } from "@/core/instance-manager";
import { taskQueue } from "@/core/task-queue";

@EventHandler({
	event: "system.register",
	inputSchema: systemRegisterInput,
	outputSchema: systemRegisterOutput,
	persist: false,
	rateLimit: 10,
	description: "Register an instance per JSONRPC contract",
})
export class SystemRegisterHandler {
	@Instrumented(60) // Cache for 1 minute - instance registration changes frequently
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 }, // 100 registrations per minute (increased for testing)
		timeout: 5000, // 5 second timeout
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				registered: false // Fail registration if circuit is open
			})
		}
	})
	async handle(input: SystemRegisterInput, ctx: EventContext): Promise<SystemRegisterOutput> {
		// Use instance manager for centralized registration
		const registered = await instanceManager.register(input.id, input.roles);
		
		// Publish registration event if successful
		if (registered) {
			await ctx.publish({
				type: "instance.registered",
				payload: {
					id: input.id,
					roles: input.roles,
					timestamp: Date.now(),
				},
			});
			
			// AUTO-ASSIGN TASKS: When a worker registers, assign pending tasks
			if (input.roles.includes("worker")) {
				// Register worker in task queue system
				await taskQueue.registerWorker(input.id, input.roles);
				
				// Trigger automatic task assignment to all workers
				await taskQueue.assignTasksToWorkers();
				
				// Log task assignment for debugging
				const assignedCount = await ctx.redis.stream.llen(redisKey("queue", "instance", input.id));
				if (assignedCount > 0) {
					console.log(`[SystemRegister] Assigned ${assignedCount} tasks to worker ${input.id}`);
				}
			}
		}
		
		// Per contract, we simply return whether registration succeeded
		return {
			registered,
		};
	}
}