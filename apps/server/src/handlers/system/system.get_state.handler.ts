import { EventHandler } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { systemGetStateInput, systemGetStateOutput } from "@/schemas/system.schema";
import type { SystemGetStateInput, SystemGetStateOutput } from "@/schemas/system.schema";
import { redisKey } from "@/core/redis";

@EventHandler({
	event: "system.get_state",
	inputSchema: systemGetStateInput,
	outputSchema: systemGetStateOutput,
	persist: false,
	rateLimit: 50,
	description: "Get system state per JSONRPC contract",
})
export class SystemGetStateHandler {
	async handle(input: SystemGetStateInput, ctx: EventContext): Promise<SystemGetStateOutput> {
		// Get tasks
		const taskKeys = await ctx.redis.stream.keys(redisKey("task", "*"));
		const tasks = [];
		for (const key of taskKeys.slice(0, 10)) { // Limit to 10 for performance
			const taskData = await ctx.redis.stream.hgetall(key);
			if (taskData) {
				tasks.push(taskData);
			}
		}
		
		// Get instances
		const instanceKeys = await ctx.redis.stream.keys(redisKey("instance", "*"));
		const instances = [];
		for (const key of instanceKeys.slice(0, 10)) { // Limit to 10 for performance
			const instanceData = await ctx.redis.stream.hgetall(key);
			if (instanceData) {
				instances.push(instanceData);
			}
		}
		
		// Get recent events from streams
		const eventStreamKey = redisKey("stream", "events");
		const recentEvents = [];
		try {
			const streamEvents = await ctx.redis.stream.xrevrange(
				eventStreamKey,
				"+",
				"-",
				"COUNT",
				10
			);
			for (const [id, fields] of streamEvents) {
				// Redis stream returns array of [id, [field1, value1, field2, value2, ...]]
				const eventData: any = { id };
				for (let i = 0; i < fields.length; i += 2) {
					eventData[fields[i]] = fields[i + 1];
				}
				recentEvents.push(eventData);
			}
		} catch (error) {
			// Stream might not exist yet
			console.debug("No event stream found");
		}
		
		// Per contract, return optional arrays
		return {
			tasks: tasks.length > 0 ? tasks : undefined,
			instances: instances.length > 0 ? instances : undefined,
			recentEvents: recentEvents.length > 0 ? recentEvents : undefined,
		};
	}
}