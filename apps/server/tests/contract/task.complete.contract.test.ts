import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { taskCompleteInput, taskCompleteOutput } from "@/schemas/task.schema";
import { registry } from "@/core/registry";
import { getRedis } from "@/core/redis";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: task.complete", () => {
	let redis: ReturnType<typeof getRedis>;
	let assignedTaskId: string;
	let unassignedTaskId: string;
	let testInstanceId: string = "worker-complete-test";

	beforeAll(async () => {
		redis = getRedis();
		// Initialize registry
		await registry.discover();
		
		// Register a test instance
		await redis.stream.hset(`cb:instance:${testInstanceId}`, {
			id: testInstanceId,
			roles: JSON.stringify(["worker"]),
			status: "ACTIVE",
			lastSeen: Date.now().toString(),
		});
		
		// Create and assign a task
		const createResult1 = await registry.executeHandler("task.create", {
			text: "Test task for completion",
			priority: 50
		});
		assignedTaskId = createResult1.id;
		
		await registry.executeHandler("task.assign", {
			taskId: assignedTaskId,
			instanceId: testInstanceId,
		});
		
		// Create an unassigned task
		const createResult2 = await registry.executeHandler("task.create", {
			text: "Unassigned task",
			priority: 50
		});
		unassignedTaskId = createResult2.id;
	});

	afterAll(async () => {
		// Try to clean up test data
		try {
			const keys = [
				`cb:task:${assignedTaskId}`,
				`cb:task:${unassignedTaskId}`,
				`cb:instance:${testInstanceId}`,
				`cb:queue:instance:${testInstanceId}`,
				`cb:metrics:instance:${testInstanceId}`,
				`cb:metrics:global`,
			];
			const existingKeys = [];
			for (const key of keys) {
				if (await redis.stream.exists(key)) {
					existingKeys.push(key);
				}
			}
			if (existingKeys.length > 0) {
				await redis.stream.del(...existingKeys);
			}
		} catch {
			// Ignore cleanup errors
		}
		
		// Don't quit Redis - let the process handle cleanup on exit
		// This prevents interference between parallel test files
	});

	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["task.complete"];
		const contractParams = contractEvent.request.properties.params.properties;

		it("should match input schema with contract params", () => {
			// Contract requires id, optional result
			expect(contractParams.id).toBeDefined();
			expect(contractParams.result).toBeDefined();
			
			const requiredFields = contractEvent.request.properties.params.required;
			expect(requiredFields).toEqual(["id"]);
			
			// Test valid inputs
			const validInputs = [
				{ id: assignedTaskId }, // Without result (will mark as failed)
				{ id: assignedTaskId, result: { data: "processed" } }, // With result
				{ id: assignedTaskId, result: "Success string" }, // String result
				{ id: assignedTaskId, result: 42 }, // Number result
				{ id: assignedTaskId, result: null }, // Null result
			];
			
			for (const input of validInputs) {
				const result = taskCompleteInput.safeParse(input);
				expect(result.success).toBe(true);
			}
		});

		it("should reject invalid input", () => {
			const invalidInputs = [
				{}, // Missing id
				{ id: "" }, // Empty id
				{ result: "No ID" }, // Missing id with result
			];

			for (const input of invalidInputs) {
				const result = taskCompleteInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
	});

	describe("Handler execution with contract data", () => {
		it("should complete task with result", async () => {
			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task to complete with result",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			const input = {
				id: taskId,
				result: { success: true, data: "Task completed successfully" }
			};

			const result = await registry.executeHandler("task.complete", input);

			// Verify output structure
			expect(result).toHaveProperty("id", taskId);
			expect(result).toHaveProperty("status", "completed"); // Should be "completed" with result
			expect(result).toHaveProperty("completedAt");
			
			// Verify completedAt is a valid datetime
			const completedAt = new Date(result.completedAt);
			expect(completedAt.getTime()).toBeLessThanOrEqual(Date.now());

			// Verify task was completed in Redis
			const taskKey = `cb:task:${taskId}`;
			const storedTask = await redis.stream.hgetall(taskKey);
			expect(storedTask).toBeTruthy();
			expect(storedTask.status).toBe("completed");
			expect(storedTask.completedAt).toBeDefined();
			expect(storedTask.result).toBeDefined();
			
			// Clean up
			await redis.stream.del(taskKey);
		});

		it("should fail task without result", async () => {
			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task to fail without result",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			const input = {
				id: taskId,
				// No result provided
			};

			const result = await registry.executeHandler("task.complete", input);

			// Verify output structure
			expect(result).toHaveProperty("id", taskId);
			expect(result).toHaveProperty("status", "failed"); // Should be "failed" without result
			expect(result).toHaveProperty("completedAt");

			// Verify task was failed in Redis
			const taskKey = `cb:task:${taskId}`;
			const storedTask = await redis.stream.hgetall(taskKey);
			expect(storedTask).toBeTruthy();
			expect(storedTask.status).toBe("failed");
			expect(storedTask.completedAt).toBeDefined();
			
			// Clean up
			await redis.stream.del(taskKey);
		});

		it("should reject completion of unassigned task", async () => {
			const input = {
				id: unassignedTaskId,
				result: { data: "Should fail" }
			};

			await expect(registry.executeHandler("task.complete", input)).rejects.toThrow();
		});

		it("should reject completion of non-existent task", async () => {
			const input = {
				id: "t-nonexistent",
				result: { data: "Should fail" }
			};

			await expect(registry.executeHandler("task.complete", input)).rejects.toThrow();
		});

		it("should prevent double completion", async () => {
			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task for double completion test",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			// First completion should succeed
			const firstComplete = {
				id: taskId,
				result: { data: "First completion" }
			};
			await registry.executeHandler("task.complete", firstComplete);

			// Second completion should fail
			const secondComplete = {
				id: taskId,
				result: { data: "Second completion" }
			};
			await expect(registry.executeHandler("task.complete", secondComplete)).rejects.toThrow();
			
			// Clean up
			await redis.stream.del(`cb:task:${taskId}`);
		});

		it("should update instance metrics", async () => {
			// Clear metrics first
			const metricsKey = `cb:metrics:instance:${testInstanceId}`;
			await redis.stream.del(metricsKey);

			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task for metrics test",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			const input = {
				id: taskId,
				result: { data: "Completed for metrics" }
			};

			await registry.executeHandler("task.complete", input);

			// Check metrics
			const completedCount = await redis.stream.hget(metricsKey, "tasksCompleted");
			expect(completedCount).toBeTruthy();
			expect(parseInt(completedCount as string)).toBeGreaterThan(0);
			
			// Clean up
			await redis.stream.del(`cb:task:${taskId}`, metricsKey);
		});

		it("should calculate task duration", async () => {
			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task for duration test",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			// Wait a bit to ensure duration > 0
			await new Promise(resolve => setTimeout(resolve, 10));

			const input = {
				id: taskId,
				result: { data: "Completed with duration" }
			};

			await registry.executeHandler("task.complete", input);

			// Check duration was recorded
			const taskKey = `cb:task:${taskId}`;
			const taskData = await redis.stream.hgetall(taskKey);
			expect(taskData.duration).toBeTruthy();
			const duration = parseInt(taskData.duration as string);
			expect(duration).toBeGreaterThan(0);
			
			// Clean up
			await redis.stream.del(taskKey);
		});

		it("should publish completion event to Redis stream", async () => {
			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task for event test",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			const input = {
				id: taskId,
				result: { data: "Completed for event" }
			};

			await registry.executeHandler("task.complete", input);

			// Check Redis stream for event
			const streamKey = "cb:stream:task.completed";
			const events = await redis.stream.xrevrange(streamKey, "+", "-", "COUNT", 1);
			
			expect(events.length).toBeGreaterThan(0);
			const eventData = JSON.parse(events[0][1][1]);
			expect(eventData.type).toBe("task.completed");
			expect(eventData.payload.id).toBe(taskId);
			expect(eventData.payload.status).toBe("completed");
			
			// Clean up
			await redis.stream.del(`cb:task:${taskId}`);
		});
	});

	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "task.complete",
				params: {
					id: assignedTaskId,
					result: { data: "JSONRPC completion" }
				},
				id: "test-complete-123"
			};

			// Validate request structure matches contract
			expect(request.method).toBe("task.complete");
			expect(request.params).toHaveProperty("id");
			expect(request.params).toHaveProperty("result");
			
			// Params should be valid for our schema
			const result = taskCompleteInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", async () => {
			// Create and assign a new task for this test
			const createResult = await registry.executeHandler("task.create", {
				text: "Task for JSONRPC response test",
				priority: 50
			});
			const taskId = createResult.id;
			
			await registry.executeHandler("task.assign", {
				taskId: taskId,
				instanceId: testInstanceId,
			});

			const input = {
				id: taskId,
				result: { data: "JSONRPC response test" }
			};

			const result = await registry.executeHandler("task.complete", input);

			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "test-complete-123"
			};

			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response).toHaveProperty("id");
			
			// Result should match output schema
			const outputResult = taskCompleteOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
			
			// Clean up
			await redis.stream.del(`cb:task:${taskId}`);
		});
	});
});