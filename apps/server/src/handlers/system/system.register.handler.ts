import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemRegisterInput, systemRegisterOutput } from "@/schemas/system.schema";
import type { SystemRegisterInput, SystemRegisterOutput } from "@/schemas/system.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
	event: "system.register",
	inputSchema: systemRegisterInput,
	outputSchema: systemRegisterOutput,
	persist: false,
	rateLimit: 10,
	description: "Register an instance atomically via Lua script",
})
export class SystemRegisterHandler {
	@Instrumented(60)
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 5000,
		circuitBreaker: { 
			threshold: 5, 
			timeout: 30000,
			fallback: () => ({ 
				registered: false
			})
		}
	})
	async handle(input: SystemRegisterInput, ctx: EventContext): Promise<SystemRegisterOutput> {
		const ttl = 30; // 30 seconds TTL for instance registration
		
		console.log(`[SystemRegister] Registering instance ${input.id} with roles:`, input.roles);
		
		const result = await redisScripts.registerInstance(
			input.id,
			input.roles,
			ttl
		);
		
		console.log(`[SystemRegister] Registration result for ${input.id}:`, result);
		
		if (result.success) {
			// Check what was actually created
			const instanceKey = `cb:instance:${input.id}`;
			const exists = await ctx.redis.stream.exists(instanceKey);
			console.log(`[SystemRegister] Instance key ${instanceKey} exists:`, exists);
			
			// Update gossip health immediately after registration
			const gossipResult = await redisScripts.updateGossipHealth(
				input.id,
				"healthy"
			);
			console.log(`[SystemRegister] Gossip health updated for ${input.id}:`, gossipResult);
			
			// Sync global state after new instance joins
			const stateData = {
				action: "instance_registered",
				instanceId: input.id,
				roles: input.roles,
				timestamp: Date.now()
			};
			const syncResult = await redisScripts.syncGlobalState(stateData);
			console.log(`[SystemRegister] Global state synced, version: ${syncResult.version}`);
			
			// Aggregate metrics after instance change
			const metricsResult = await redisScripts.aggregateGlobalMetrics();
			console.log(`[SystemRegister] Global metrics aggregated:`, {
				instances: metricsResult.instanceCount,
				events: metricsResult.totalEvents,
				tasks: metricsResult.totalTasks
			});
			
			await ctx.publish({
				type: "instance.registered",
				payload: {
					id: input.id,
					roles: input.roles,
					becameLeader: result.becameLeader,
					timestamp: Date.now(),
				},
			});
			
			if (result.becameLeader) {
				console.log(`[SystemRegister] Instance ${input.id} became leader`);
			}
			
			// AUTO-ASSIGN TASKS: When a worker registers, assign pending tasks
			if (input.roles.includes("worker")) {
				// Check global queue before assignment
				const globalQueueKey = "cb:queue:tasks:pending";
				const queueSize = await ctx.redis.stream.zcard(globalQueueKey);
				console.log(`[SystemRegister] Global queue has ${queueSize} tasks before assignment`);
				
				// Use Lua script to atomically assign tasks
				const assignResult = await redisScripts.autoAssignTasks(input.id);
				console.log(`[SystemRegister] Assignment result for ${input.id}:`, assignResult);
				
				if (assignResult.assigned > 0) {
					console.log(`[SystemRegister] Assigned ${assignResult.assigned} of ${assignResult.total} tasks to worker ${input.id}`);
				}
			}
		}
		
		return {
			registered: result.success,
		};
	}
}