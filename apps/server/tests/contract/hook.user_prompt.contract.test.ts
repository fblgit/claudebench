import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { hookUserPromptInput, hookUserPromptOutput } from "@/schemas/hook.schema";
import { registry } from "@/core/registry";
import { getRedis } from "@/core/redis";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: hook.user_prompt", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		// Initialize registry
		await registry.discover();
	});

	afterAll(async () => {
		// Cleanup
		await redis.stream.quit();
	});

	describe("Input Schema Contract", () => {
		const contractInput = contractSpec.events["hook.user_prompt"].request.properties.params.properties;

		it("should match contract input schema", () => {
			// Contract requires: prompt (string), context (object)
			expect(contractInput.prompt).toEqual({ type: "string" });
			expect(contractInput.context).toEqual({ type: "object" });
		});

		it("should accept valid input with prompt and context", () => {
			const input = {
				prompt: "Write a function to calculate fibonacci",
				context: { sessionId: "123", userId: "user-1" },
			};
			
			const result = hookUserPromptInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept empty context object", () => {
			const input = {
				prompt: "Hello world",
				context: {},
			};
			
			const result = hookUserPromptInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept context with various properties", () => {
			const input = {
				prompt: "Create a REST API",
				context: {
					enhance: true,
					mode: "development",
					flags: ["verbose", "debug"],
					metadata: { timestamp: Date.now() },
				},
			};
			
			const result = hookUserPromptInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept context with nested objects", () => {
			const input = {
				prompt: "Test prompt",
				context: {
					user: {
						id: "123",
						name: "Test User",
						preferences: {
							theme: "dark",
							language: "en",
						},
					},
				},
			};
			
			const result = hookUserPromptInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should reject non-object context", () => {
			const invalidInputs = [
				{ prompt: "test", context: "string" },
				{ prompt: "test", context: 123 },
				{ prompt: "test", context: ["array"] },
				{ prompt: "test", context: null },
			];

			for (const input of invalidInputs) {
				const result = hookUserPromptInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should reject input missing required fields", () => {
			const invalidInputs = [
				{ prompt: "test" }, // Missing context
				{ context: {} }, // Missing prompt
				{}, // Missing both
			];

			for (const input of invalidInputs) {
				const result = hookUserPromptInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Output Schema Contract", () => {
		const contractOutput = contractSpec.events["hook.user_prompt"].response.properties.result.properties;

		it("should match contract output schema", () => {
			// Contract requires: modified (string optional)
			expect(contractOutput.modified).toEqual({ type: "string" });
		});

		it("should validate output with modified string", () => {
			const output = {
				modified: "Modified prompt with additional context",
			};
			
			const result = hookUserPromptOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate empty output (modified is optional)", () => {
			const output = {};
			
			const result = hookUserPromptOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with undefined modified", () => {
			const output = {
				modified: undefined,
			};
			
			const result = hookUserPromptOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should reject non-string modified values", () => {
			const invalidOutputs = [
				{ modified: 123 },
				{ modified: true },
				{ modified: { text: "prompt" } },
				{ modified: ["array"] },
			];

			for (const output of invalidOutputs) {
				const result = hookUserPromptOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});

		it("should accept empty string as modified", () => {
			const output = {
				modified: "",
			};
			
			const result = hookUserPromptOutput.safeParse(output);
			expect(result.success).toBe(true);
		});
	});

	describe("Contract Field Names", () => {
		it("should use 'prompt' not 'userPrompt' in input", () => {
			const inputWithWrongField = {
				userPrompt: "test", // Wrong field name
				context: {},
			};
			
			const result = hookUserPromptInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'context' not 'metadata' in input", () => {
			const inputWithWrongField = {
				prompt: "test",
				metadata: { key: "value" }, // Wrong field name
			};
			
			const result = hookUserPromptInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'modified' not 'modifiedPrompt' in output", () => {
			const outputWithWrongField = {
				modifiedPrompt: "changed prompt", // Wrong field name
			};
			
			const result = hookUserPromptOutput.safeParse(outputWithWrongField as any);
			// Should be valid as an empty object (modified is optional)
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).not.toHaveProperty("modifiedPrompt");
			}
		});

		it("should use 'modified' not 'newPrompt' in output", () => {
			const outputWithWrongField = {
				newPrompt: "changed prompt", // Wrong field name
			};
			
			const result = hookUserPromptOutput.safeParse(outputWithWrongField as any);
			// Should be valid as an empty object (modified is optional)
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data).not.toHaveProperty("newPrompt");
			}
		});
	});

	describe("Handler Registration", () => {
		it("should register hook.user_prompt handler", () => {
			const handler = registry.getHandler("hook.user_prompt");
			expect(handler).toBeDefined();
			if (handler) {
				expect(handler.event).toBe("hook.user_prompt");
			}
		});
	});
});