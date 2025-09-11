import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { taskUpdateInput, taskUpdateOutput } from "@/schemas/task.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../helpers/test-setup";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: task.update", () => {
	let redis: any;
	let testTaskId: string;

	beforeAll(async () => {
		redis = await setupContractTest();
		
		// Create a test task to update
		const createResult = await registry.executeHandler("task.create", {
			text: "Test task for update",
			priority: 50
		});
		testTaskId = createResult.id;
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["task.update"];
		const contractParams = contractEvent.request.properties.params.properties;

		it("should match input schema with contract params", () => {
			// Contract requires id and updates object
			expect(contractParams.id).toBeDefined();
			expect(contractParams.updates).toBeDefined();
			
			// Test valid input structure
			const validInput = {
				id: testTaskId,
				updates: {
					text: "Updated text",
					status: "in_progress",
					priority: 75
				}
			};
			const result = taskUpdateInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// Test partial updates are allowed
			const partialUpdates = [
				{ id: testTaskId, updates: { text: "New text" } },
				{ id: testTaskId, updates: { status: "completed" } },
				{ id: testTaskId, updates: { priority: 25 } },
				{ id: testTaskId, updates: {} }, // Empty updates
			];

			for (const input of partialUpdates) {
				const result = taskUpdateInput.safeParse(input);
				expect(result.success).toBe(true);
			}
		});

		it("should reject invalid input", () => {
			const invalidInputs = [
				{ updates: { text: "Missing ID" } }, // Missing id
				{ id: "", updates: { text: "Empty ID" } }, // Empty id
				{ id: testTaskId }, // Missing updates
				{ id: testTaskId, updates: { text: "a".repeat(501) } }, // Text too long
				{ id: testTaskId, updates: { status: "INVALID" } }, // Invalid status
				{ id: testTaskId, updates: { priority: -1 } }, // Priority below min
				{ id: testTaskId, updates: { priority: 101 } }, // Priority above max
			];

			for (const input of invalidInputs) {
				const result = taskUpdateInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should validate status enum values", () => {
			const contractStatus = contractParams.updates.properties.status.enum;
			expect(contractStatus).toEqual(["pending", "in_progress", "completed", "failed"]);

			// Test our schema accepts all valid statuses
			for (const status of contractStatus) {
				const input = {
					id: testTaskId,
					updates: { status }
				};
				const result = taskUpdateInput.safeParse(input);
				expect(result.success).toBe(true);
			}
		});

		it("should validate priority range", () => {
			const contractPriority = contractParams.updates.properties.priority;
			// Priority should be 0-100 based on task.create contract
			
			const validPriorities = [0, 1, 50, 99, 100];
			for (const priority of validPriorities) {
				const input = {
					id: testTaskId,
					updates: { priority }
				};
				const result = taskUpdateInput.safeParse(input);
				expect(result.success).toBe(true);
			}

			const invalidPriorities = [-1, 101, 1000];
			for (const priority of invalidPriorities) {
				const input = {
					id: testTaskId,
					updates: { priority }
				};
				const result = taskUpdateInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Handler execution with contract data", () => {
		it("should update task with contract-compliant input", async () => {
			const input = {
				id: testTaskId,
				updates: {
					text: "Updated via contract test",
					status: "in_progress" as const,
					priority: 85
				}
			};

			const result = await registry.executeHandler("task.update", input);

			// Verify output structure
			expect(result).toHaveProperty("id", testTaskId);
			expect(result).toHaveProperty("text", input.updates.text);
			expect(result).toHaveProperty("status", input.updates.status);
			expect(result).toHaveProperty("priority", input.updates.priority);
			expect(result).toHaveProperty("updatedAt");

			// Verify task was updated in Redis
			const taskKey = `cb:task:${testTaskId}`;
			const storedTask = await redis.stream.hgetall(taskKey);
			expect(storedTask).toBeTruthy();
			expect(storedTask.text).toBe(input.updates.text);
			expect(storedTask.status).toBe(input.updates.status);
			expect(parseInt(storedTask.priority)).toBe(input.updates.priority);
		});

		it("should handle partial updates", async () => {
			// Update only text
			const textUpdate = {
				id: testTaskId,
				updates: { text: "Only text updated" }
			};
			const result1 = await registry.executeHandler("task.update", textUpdate);
			expect(result1.text).toBe("Only text updated");
			expect(result1.priority).toBe(85); // Should retain previous value

			// Update only status
			const statusUpdate = {
				id: testTaskId,
				updates: { status: "completed" as const }
			};
			const result2 = await registry.executeHandler("task.update", statusUpdate);
			expect(result2.status).toBe("completed");
			expect(result2.text).toBe("Only text updated"); // Should retain previous value

			// Update only priority
			const priorityUpdate = {
				id: testTaskId,
				updates: { priority: 10 }
			};
			const result3 = await registry.executeHandler("task.update", priorityUpdate);
			expect(result3.priority).toBe(10);
			expect(result3.status).toBe("completed"); // Should retain previous value
		});

		it("should reject updates for non-existent task", async () => {
			const input = {
				id: "t-nonexistent",
				updates: { text: "Should fail" }
			};

			await expect(registry.executeHandler("task.update", input)).rejects.toThrow();
		});

		it("should publish update event to Redis stream", async () => {
			const input = {
				id: testTaskId,
				updates: { text: "Event test update" }
			};

			await registry.executeHandler("task.update", input);

			// Check Redis stream for event
			const streamKey = "cb:stream:task.updated";
			const events = await redis.stream.xrevrange(streamKey, "+", "-", "COUNT", 1);
			
			expect(events.length).toBeGreaterThan(0);
			const eventData = JSON.parse(events[0][1][1]);
			expect(eventData.type).toBe("task.updated");
			expect(eventData.payload.id).toBe(testTaskId);
			expect(eventData.payload.text).toBe(input.updates.text);
		});
	});

	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "task.update",
				params: {
					id: testTaskId,
					updates: {
						text: "JSONRPC update",
						priority: 60
					}
				},
				id: "test-update-123"
			};

			// Validate request structure matches contract
			expect(request.method).toBe("task.update");
			expect(request.params).toHaveProperty("id");
			expect(request.params).toHaveProperty("updates");
			
			// Params should be valid for our schema
			const result = taskUpdateInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", async () => {
			const input = {
				id: testTaskId,
				updates: { text: "Response test update" }
			};

			const result = await registry.executeHandler("task.update", input);

			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "test-update-123"
			};

			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response).toHaveProperty("id");
			
			// Result should match output schema
			const outputResult = taskUpdateOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
	});
});
