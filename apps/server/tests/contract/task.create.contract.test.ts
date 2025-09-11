import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import { registry } from "@/core/registry";
import { getRedis } from "@/core/redis";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: task.create", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		// Initialize registry
		await registry.discover();
		
		// Clear test data
		try {
			const keys = await redis.stream.keys("cb:task:*");
			if (keys.length > 0) {
				await redis.stream.del(...keys);
			}
		} catch {
			// Ignore - Redis might not be ready yet
		}
	});

	afterAll(async () => {
		// Don't quit Redis - let the process handle cleanup on exit
		// This prevents interference between parallel test files
	});

	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["task.create"];
		const contractParams = contractEvent.request.properties.params.properties;
		const contractResult = contractEvent.response.properties.result;

		it("should match input schema with contract params", () => {
			// Contract specifies: text (1-500), priority (0-100, default 50)
			const contractInput = {
				text: { minLength: 1, maxLength: 500 },
				priority: { minimum: 0, maximum: 100, default: 50 }
			};

			// Test our schema accepts contract-valid data
			const validInput = {
				text: "Test task",
				priority: 50
			};
			const result = taskCreateInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// Test our schema rejects contract-invalid data
			const invalidInputs = [
				{ text: "", priority: 50 }, // Empty text
				{ text: "a".repeat(501), priority: 50 }, // Text too long
				{ text: "Test", priority: -1 }, // Priority too low
				{ text: "Test", priority: 101 }, // Priority too high
			];

			for (const input of invalidInputs) {
				const result = taskCreateInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should match output schema with contract response", () => {
			// Contract specifies these required fields
			const requiredFields = contractResult.required;
			expect(requiredFields).toEqual(["id", "text", "status", "priority", "createdAt"]);

			// Test our output schema has correct structure
			const validOutput = {
				id: "t-1234567890",
				text: "Test task",
				status: "pending",
				priority: 50,
				createdAt: new Date().toISOString()
			};
			const result = taskCreateOutput.safeParse(validOutput);
			expect(result.success).toBe(true);
		});

		it("should validate status enum values", () => {
			const contractStatus = contractResult.properties.status.enum;
			expect(contractStatus).toEqual(["pending", "in_progress", "completed", "failed"]);

			// Test our schema accepts all valid statuses
			for (const status of contractStatus) {
				const output = {
					id: "t-123",
					text: "Test",
					status,
					priority: 50,
					createdAt: new Date().toISOString()
				};
				const result = taskCreateOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});

		it("should validate task ID format", () => {
			const idPattern = contractResult.properties.id.pattern;
			expect(idPattern).toBe("^t-\\d+$");

			// Test valid IDs
			const validIds = ["t-123", "t-1234567890", "t-0"];
			for (const id of validIds) {
				expect(id).toMatch(new RegExp(idPattern));
			}

			// Test invalid IDs
			const invalidIds = ["task-123", "123", "t_123", "t-abc"];
			for (const id of invalidIds) {
				expect(id).not.toMatch(new RegExp(idPattern));
			}
		});
	});

	describe("Handler execution with contract data", () => {
		it("should create task with contract-compliant input", async () => {
			const input = {
				text: "Contract test task",
				priority: 75
			};

			// Execute handler through registry
			const result = await registry.executeHandler("task.create", input);

			// Validate output matches contract
			expect(result).toHaveProperty("id");
			expect(result.id).toMatch(/^t-\d+$/);
			expect(result).toHaveProperty("text", input.text);
			expect(result).toHaveProperty("status", "pending");
			expect(result).toHaveProperty("priority", input.priority);
			expect(result).toHaveProperty("createdAt");

			// Verify task was stored in Redis
			const taskKey = `cb:task:${result.id}`;
			const storedTask = await redis.stream.hgetall(taskKey);
			expect(storedTask).toBeTruthy();
			expect(storedTask.text).toBe(input.text);
			expect(parseInt(storedTask.priority)).toBe(input.priority);
		});

		it("should reject input that violates contract", async () => {
			const invalidInputs = [
				{ text: "", priority: 50 }, // Empty text
				{ text: "a".repeat(501), priority: 50 }, // Text too long
				{ text: "Test", priority: -1 }, // Priority below minimum
				{ text: "Test", priority: 101 }, // Priority above maximum
				{ priority: 50 }, // Missing text
				{ text: "Test" }, // Missing priority should use default
			];

			for (const input of invalidInputs.slice(0, -1)) {
				// All except last should fail
				await expect(registry.executeHandler("task.create", input)).rejects.toThrow();
			}

			// Last one (missing priority) should succeed with default
			const result = await registry.executeHandler("task.create", { text: "Test" });
			expect(result.priority).toBe(50); // Default from contract
		});

		it("should publish event to Redis stream", async () => {
			const input = {
				text: "Event test task",
				priority: 25
			};

			const result = await registry.executeHandler("task.create", input);

			// Check Redis stream for event (the handler publishes "task.created")
			const streamKey = "cb:stream:task.created";
			const events = await redis.stream.xrevrange(streamKey, "+", "-", "COUNT", 1);
			
			expect(events.length).toBeGreaterThan(0);
			const eventData = JSON.parse(events[0][1][1]);
			expect(eventData.type).toBe("task.created");
			expect(eventData.payload.id).toBe(result.id);
			expect(eventData.payload.text).toBe(input.text);
		});
	});

	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "task.create",
				params: {
					text: "JSONRPC test task",
					priority: 60
				},
				id: "test-123"
			};

			// Validate request structure matches contract
			expect(request.method).toBe("task.create");
			expect(request.params).toHaveProperty("text");
			expect(request.params).toHaveProperty("priority");
			
			// Params should be valid for our schema
			const result = taskCreateInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", async () => {
			const input = {
				text: "Response test task",
				priority: 40
			};

			const result = await registry.executeHandler("task.create", input);

			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "test-123"
			};

			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response).toHaveProperty("id");
			
			// Result should match contract output schema
			const outputResult = taskCreateOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
	});
});