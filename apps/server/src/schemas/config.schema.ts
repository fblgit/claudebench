import { z } from "zod";

// config.get - Get configuration value
export const configGetInput = z.object({
	key: z.string().min(1).describe("Configuration key to retrieve"),
});

export const configGetOutput = z.object({
	key: z.string().describe("Configuration key"),
	value: z.any().describe("Configuration value"),
	exists: z.boolean().describe("Whether the configuration key exists"),
});

// config.set - Set configuration value
export const configSetInput = z.object({
	key: z.string().min(1).describe("Configuration key to set"),
	value: z.any().describe("Configuration value to set"),
});

export const configSetOutput = z.object({
	key: z.string().describe("Configuration key that was set"),
	value: z.any().describe("Configuration value that was set"),
	success: z.boolean().describe("Whether the operation was successful"),
});

// Type exports
export type ConfigGetInput = z.infer<typeof configGetInput>;
export type ConfigGetOutput = z.infer<typeof configGetOutput>;
export type ConfigSetInput = z.infer<typeof configSetInput>;
export type ConfigSetOutput = z.infer<typeof configSetOutput>;