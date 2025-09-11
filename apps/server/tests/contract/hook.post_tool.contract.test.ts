import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { hookPostToolInput, hookPostToolOutput } from "@/schemas/hook.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../helpers/test-setup";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: hook.post_tool", () => {
	let redis: any;

	beforeAll(async () => {
		redis = await setupContractTest();
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Input Schema Contract", () => {
		const contractInput = contractSpec.events["hook.post_tool"].request.properties.params.properties;

		it("should match contract input schema", () => {
			// Contract requires: tool (string), result (any)
			expect(contractInput.tool).toEqual({ type: "string" });
			expect(contractInput.result).toEqual({}); // Empty object means any type
		});

		it("should accept valid input with tool and result", () => {
			const input = {
				tool: "bash",
				result: { stdout: "hello world", exitCode: 0 },
			};
			
			const result = hookPostToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept result as any type (string)", () => {
			const input = {
				tool: "echo",
				result: "simple string result",
			};
			
			const result = hookPostToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept result as any type (array)", () => {
			const input = {
				tool: "list",
				result: ["item1", "item2", "item3"],
			};
			
			const result = hookPostToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept result as any type (null)", () => {
			const input = {
				tool: "void-operation",
				result: null,
			};
			
			const result = hookPostToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept result as any type (number)", () => {
			const input = {
				tool: "count",
				result: 42,
			};
			
			const result = hookPostToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should accept result with error information", () => {
			const input = {
				tool: "failing-tool",
				result: { error: "Command failed", code: "ENOENT" },
			};
			
			const result = hookPostToolInput.safeParse(input);
			expect(result.success).toBe(true);
		});

		it("should reject input missing required fields", () => {
			const invalidInputs = [
				{ tool: "bash" }, // Missing result
				{ result: "output" }, // Missing tool
				{}, // Missing both
			];

			for (const input of invalidInputs) {
				const result = hookPostToolInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Output Schema Contract", () => {
		const contractOutput = contractSpec.events["hook.post_tool"].response.properties.result.properties;

		it("should match contract output schema", () => {
			// Contract requires: processed (any) - empty object {} means any type
			expect(contractOutput.processed).toEqual({});
		});

		it("should validate output with processed as boolean", () => {
			const output = {
				processed: true,
			};
			
			const result = hookPostToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with processed as object", () => {
			const output = {
				processed: { acknowledged: true, taskId: "t-123" },
			};
			
			const result = hookPostToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with processed as string", () => {
			const output = {
				processed: "completed",
			};
			
			const result = hookPostToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with processed as number", () => {
			const output = {
				processed: 42,
			};
			
			const result = hookPostToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with processed as array", () => {
			const output = {
				processed: [1, 2, 3],
			};
			
			const result = hookPostToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should validate output with processed as null", () => {
			const output = {
				processed: null,
			};
			
			const result = hookPostToolOutput.safeParse(output);
			expect(result.success).toBe(true);
		});

		it("should reject output missing required processed field", () => {
			const invalidOutputs = [
				{ success: true }, // Wrong field name
				{ acknowledged: true }, // Wrong field name
				{}, // Missing processed
			];

			for (const output of invalidOutputs) {
				const result = hookPostToolOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Contract Field Names", () => {
		it("should use 'tool' not 'toolName' in input", () => {
			const inputWithWrongField = {
				toolName: "bash", // Wrong field name
				result: "output",
			};
			
			const result = hookPostToolInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'result' not 'toolResult' in input", () => {
			const inputWithWrongField = {
				tool: "bash",
				toolResult: "output", // Wrong field name
			};
			
			const result = hookPostToolInput.safeParse(inputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'processed' not 'acknowledged' in output", () => {
			const outputWithWrongField = {
				acknowledged: true, // Wrong field name
			};
			
			const result = hookPostToolOutput.safeParse(outputWithWrongField as any);
			expect(result.success).toBe(false);
		});

		it("should use 'processed' not 'success' in output", () => {
			const outputWithWrongField = {
				success: true, // Wrong field name
			};
			
			const result = hookPostToolOutput.safeParse(outputWithWrongField as any);
			expect(result.success).toBe(false);
		});
	});

	describe("Handler Registration", () => {
		it("should register hook.post_tool handler", () => {
			const handler = registry.getHandler("hook.post_tool");
			expect(handler).toBeDefined();
			if (handler) {
				expect(handler.event).toBe("hook.post_tool");
			}
		});
	});
});
