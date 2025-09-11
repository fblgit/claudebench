import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { hookPreToolInput, hookPreToolOutput } from "@/schemas/hook.schema";
import { registry } from "@/core/registry";
import { getRedis } from "@/core/redis";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: hook.pre_tool", () => {
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
		const contractInput = contractSpec.events["hook.pre_tool"].request.properties.params.properties;

		it("should match contract input schema", () => {
			// Contract requires: tool (string), params (any)
			expect(contractInput.tool).toEqual({ type: "string" });
			expect(contractInput.params).toEqual({}); // Empty object means any type
		});

		it("should accept valid input with tool and params", () => {
			const input = {
				tool: "bash",
				params: { command: "ls -la" },
			};
			
			const result = hookPreToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept params as any type (object)", () => {
			const input = {
				tool: "file.write",
				params: { path: "/tmp/test.txt", content: "test" },
			};
			
			const result = hookPreToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept params as any type (string)", () => {
			const input = {
				tool: "echo",
				params: "hello world",
			};
			
			const result = hookPreToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept params as any type (array)", () => {
			const input = {
				tool: "batch",
				params: ["task1", "task2", "task3"],
			};
			
			const result = hookPreToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept params as any type (null)", () => {
			const input = {
				tool: "noop",
				params: null,
			};
			
			const result = hookPreToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should reject input missing required fields", () => {
			const invalidInputs = [
				{ tool: "bash" }, // Missing params
				{ params: { command: "ls" } }, // Missing tool
				{}, // Missing both
			];

			for (const input of invalidInputs) {
				const result = hookPreToolInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Output Schema Contract", () => {
		const contractOutput = contractSpec.events["hook.pre_tool"].response.properties.result.properties;

		it("should match contract output schema", () => {
			// Contract requires: allow (boolean), reason (string optional), modified (any optional)
			expect(contractOutput.allow).toEqual({ type: "boolean" });
			expect(contractOutput.reason).toEqual({ type: "string" });
			expect(contractOutput.modified).toEqual({}); // Empty object means any type
		});

		it("should validate output with allow and reason", () => {
			const output = {
				allow: false,
				reason: "Dangerous command detected",
			};
			
			const result = hookPreToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with allow only", () => {
			const output = {
				allow: true,
			};
			
			const result = hookPreToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with modified params", () => {
			const output = {
				allow: true,
				modified: { command: "ls", timeout: 30000 },
			};
			
			const result = hookPreToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should accept modified as any type", () => {
			const outputs = [
				{ allow: true, modified: "string value" },
				{ allow: true, modified: 123 },
				{ allow: true, modified: [1, 2, 3] },
				{ allow: true, modified: null },
			];

			for (const output of outputs) {
				const result = hookPreToolOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});

		it("should reject output missing required allow field", () => {
			const invalidOutputs = [
				{ reason: "Missing allow" },
				{ modified: { timeout: 5000 } },
				{},
			];

			for (const output of invalidOutputs) {
				const result = hookPreToolOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Contract Field Names", () => {
		it("should use 'tool' not 'toolName' in input", () => {
			const inputWithWrongField = {
				toolName: "bash", // Wrong field name
				params: {},
			};
			
			const result = hookPreToolInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'params' not 'toolParams' in input", () => {
			const inputWithWrongField = {
				tool: "bash",
				toolParams: { command: "ls" }, // Wrong field name
			};
			
			const result = hookPreToolInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'allow' not 'allowed' in output", () => {
			const outputWithWrongField = {
				allowed: true, // Wrong field name
			};
			
			const result = hookPreToolOutput.safeParse(outputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'modified' not 'modifiedParams' in output", () => {
			// This should pass as we don't have modifiedParams field
			const correctOutput = {
				allow: true,
				modified: { timeout: 5000 },
			};
			
			const result = hookPreToolOutput.safeParse(correctOutput);
			expect(result.success).toBe(true);
		});
	});

	describe("Handler Registration", () => {
		it("should register hook.pre_tool handler", () => {
			const handler = registry.getHandler("hook.pre_tool");
			expect(handler).toBeDefined();
			if (handler) {
				expect(handler.event).toBe("hook.pre_tool");
			}
		});
	});
});