import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { configGetInput, configGetOutput } from "@/schemas/config.schema";
import type { ConfigGetInput, ConfigGetOutput } from "@/schemas/config.schema";

@EventHandler({
	event: "config.get",
	inputSchema: configGetInput,
	outputSchema: configGetOutput,
	persist: false,
	rateLimit: 100,
	description: "Get configuration value from Redis",
})
export class ConfigGetHandler {
	@Instrumented(10) // Cache for 10 seconds - config changes need to be reflected quickly
	@Resilient({
		rateLimit: { limit: 100, windowMs: 60000 },
		timeout: 2000,
		circuitBreaker: {
			threshold: 5,
			timeout: 30000,
			fallback: () => ({
				key: "",
				value: null,
				exists: false,
			})
		}
	})
	async handle(input: ConfigGetInput, ctx: EventContext): Promise<ConfigGetOutput> {
		const configKey = `cb:config:${input.key}`;

		// Get value from Redis
		const value = await ctx.redis.stream.get(configKey);

		// Parse JSON if the value is a JSON string
		let parsedValue = value;
		if (value && typeof value === "string") {
			try {
				parsedValue = JSON.parse(value);
			} catch {
				// Not JSON, use as-is
				parsedValue = value;
			}
		}

		return {
			key: input.key,
			value: parsedValue,
			exists: value !== null,
		};
	}
}