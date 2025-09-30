import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { configSetInput, configSetOutput } from "@/schemas/config.schema";
import type { ConfigSetInput, ConfigSetOutput } from "@/schemas/config.schema";

@EventHandler({
	event: "config.set",
	inputSchema: configSetInput,
	outputSchema: configSetOutput,
	persist: false,
	rateLimit: 50,
	description: "Set configuration value in Redis",
})
export class ConfigSetHandler {
	@Instrumented(0) // No caching for mutations
	@Resilient({
		rateLimit: { limit: 50, windowMs: 60000 },
		timeout: 2000,
		circuitBreaker: {
			threshold: 5,
			timeout: 30000,
			fallback: () => ({
				key: "",
				value: null,
				success: false,
			})
		}
	})
	async handle(input: ConfigSetInput, ctx: EventContext): Promise<ConfigSetOutput> {
		const configKey = `cb:config:${input.key}`;

		// Serialize value to JSON if it's an object
		const serializedValue = typeof input.value === "object"
			? JSON.stringify(input.value)
			: String(input.value);

		// Set value in Redis
		await ctx.redis.stream.set(configKey, serializedValue);

		// Publish config change event
		await ctx.publish({
			type: "config.changed",
			payload: {
				key: input.key,
				value: input.value,
			},
		});

		return {
			key: input.key,
			value: input.value,
			success: true,
		};
	}
}