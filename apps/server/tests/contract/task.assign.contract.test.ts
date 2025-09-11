import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { taskAssignInput, taskAssignOutput } from "@/schemas/task.schema";
import { registry } from "@/core/registry";
import { redisKey } from "@/core/redis";
import { setupContractTest, cleanupContractTest } from "../helpers/test-setup";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: task.assign", () => {
	let redis: any;
	let testTaskId: string;
	let testInstanceId: string = "worker-test-1";

	beforeAll(async () => {
		redis = await setupContractTest();
		
		// Create a test task to assign
		const createResult = await registry.executeHandler("task.create", {
			text: "Test task for assignment",
			priority: 50
		});
		testTaskId = createResult.id;
		
		// Register a test instance
		await redis.stream.hset(`cb:instance:${testInstanceId}`, {
			id: testInstanceId,
			roles: JSON.stringify(["worker"]),
			status: "ACTIVE",
			lastSeen: Date.now().toString(),
		});
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["task.assign"];
		const contractParams = contractEvent.request.properties.params.properties;

		it("should match input schema with contract params", () => {
			// Contract requires taskId and instanceId
			expect(contractParams.taskId).toBeDefined();
			expect(contractParams.instanceId).toBeDefined();
			
			const requiredFields = contractEvent.request.properties.params.required;
			expect(requiredFields).toEqual(["taskId", "instanceId"]);
			
			// Test valid input
			const validInput = {
				taskId: testTaskId,
				instanceId: testInstanceId,
			};
			const result = taskAssignInput.safeParse(validInput);
			expect(result.success).toBe(true);
		});

		it("should reject invalid input", () => {
			const invalidInputs = [
				{}, // Missing both fields
				{ taskId: testTaskId }, // Missing instanceId
				{ instanceId: testInstanceId }, // Missing taskId
				{ taskId: "", instanceId: testInstanceId }, // Empty taskId
				{ taskId: testTaskId, instanceId: "" }, // Empty instanceId
			];

			for (const input of invalidInputs) {
				const result = taskAssignInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Handler execution with contract data", () => {
		it("should assign task with contract-compliant input", async () => {
			const input = {
				taskId: testTaskId,
				instanceId: testInstanceId,
			};

			const result = await registry.executeHandler("task.assign", input);

			// Verify output structure
			expect(result).toHaveProperty("taskId", testTaskId);
			expect(result).toHaveProperty("instanceId", testInstanceId);
			expect(result).toHaveProperty("assignedAt");
			
			// Verify assignedAt is a valid datetime
			const assignedAt = new Date(result.assignedAt);
			expect(assignedAt.getTime()).toBeLessThanOrEqual(Date.now());

			// Verify task was assigned in Redis
			const taskKey = `cb:task:${testTaskId}`;
			const storedTask = await redis.stream.hgetall(taskKey);
			expect(storedTask).toBeTruthy();
			expect(storedTask.assignedTo).toBe(testInstanceId);
			expect(storedTask.status).toBe("pending"); // Status should remain pending per contract

			// Verify task was added to instance queue
			const queueKey = `cb:queue:instance:${testInstanceId}`;
			const queueSize = await redis.stream.llen(queueKey);
			expect(queueSize).toBeGreaterThan(0);
		});

		it("should reject assignment to non-existent instance", async () => {
			const input = {
				taskId: testTaskId,
				instanceId: "non-existent-instance",
			};

			await expect(registry.executeHandler("task.assign", input)).rejects.toThrow();
		});

		it("should reject assignment of non-existent task", async () => {
			const input = {
				taskId: "t-nonexistent",
				instanceId: testInstanceId,
			};

			await expect(registry.executeHandler("task.assign", input)).rejects.toThrow();
		});

		it("should prevent double assignment", async () => {
			// Create and assign a new task
			const createResult = await registry.executeHandler("task.create", {
				text: "Test task for double assignment",
				priority: 50
			});
			const newTaskId = createResult.id;

			// First assignment should succeed
			const firstAssign = {
				taskId: newTaskId,
				instanceId: testInstanceId,
			};
			await registry.executeHandler("task.assign", firstAssign);

			// Second assignment to different instance should fail
			const secondInstanceId = "worker-test-2";
			await redis.stream.hset(`cb:instance:${secondInstanceId}`, {
				id: secondInstanceId,
				roles: JSON.stringify(["worker"]),
				status: "ACTIVE",
				lastSeen: Date.now().toString(),
			});

			const secondAssign = {
				taskId: newTaskId,
				instanceId: secondInstanceId,
			};
			await expect(registry.executeHandler("task.assign", secondAssign)).rejects.toThrow();

			// Clean up
			await redis.stream.del(`cb:task:${newTaskId}`, `cb:instance:${secondInstanceId}`);
		});

		it("should track assignment history", async () => {
			// Create a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Test task for history tracking",
				priority: 50
			});
			const historyTaskId = createResult.id;

			const input = {
				taskId: historyTaskId,
				instanceId: testInstanceId,
			};

			await registry.executeHandler("task.assign", input);

			// Check assignment history
			const historyKey = `cb:history:task:${historyTaskId}:assignments`;
			const history = await redis.stream.lrange(historyKey, 0, -1);
			
			expect(history.length).toBeGreaterThan(0);
			const historyEntry = JSON.parse(history[0]);
			expect(historyEntry.instanceId).toBe(testInstanceId);
			expect(historyEntry.assignedAt).toBeDefined();

			// Clean up
			await redis.stream.del(`cb:task:${historyTaskId}`, historyKey);
		});

		it("should publish assignment event to Redis stream", async () => {
			// Create a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Test task for event publishing",
				priority: 50
			});
			const eventTaskId = createResult.id;

			const input = {
				taskId: eventTaskId,
				instanceId: testInstanceId,
			};

			await registry.executeHandler("task.assign", input);

			// Check Redis stream for event
			const streamKey = "cb:stream:task.assigned";
			const events = await redis.stream.xrevrange(streamKey, "+", "-", "COUNT", 1);
			
			expect(events.length).toBeGreaterThan(0);
			const eventData = JSON.parse(events[0][1][1]);
			expect(eventData.type).toBe("task.assigned");
			expect(eventData.payload.taskId).toBe(eventTaskId);
			expect(eventData.payload.instanceId).toBe(testInstanceId);

			// Clean up
			await redis.stream.del(`cb:task:${eventTaskId}`);
		});
	});

	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "task.assign",
				params: {
					taskId: testTaskId,
					instanceId: testInstanceId,
				},
				id: "test-assign-123"
			};

			// Validate request structure matches contract
			expect(request.method).toBe("task.assign");
			expect(request.params).toHaveProperty("taskId");
			expect(request.params).toHaveProperty("instanceId");
			
			// Params should be valid for our schema
			const result = taskAssignInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", async () => {
			// Create a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Test task for JSONRPC response",
				priority: 50
			});
			const rpcTaskId = createResult.id;

			const input = {
				taskId: rpcTaskId,
				instanceId: testInstanceId,
			};

			const result = await registry.executeHandler("task.assign", input);

			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "test-assign-123"
			};

			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response).toHaveProperty("id");
			
			// Result should match output schema
			const outputResult = taskAssignOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);

			// Clean up
			await redis.stream.del(`cb:task:${rpcTaskId}`);
		});
	});
});