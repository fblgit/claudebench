import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { getRedis, redisKey } from "@/core/redis";
import { systemGetStateInput, systemGetStateOutput } from "@/schemas/system.schema";
import { registry } from "@/core/registry";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: system.get_state", () => {
	let redis: ReturnType<typeof getRedis>;
	
	beforeAll(async () => {
		redis = getRedis();
		// Initialize registry
		await registry.discover();
	});
	
	afterAll(async () => {
		await redis.disconnect();
	});
	
	beforeEach(async () => {
		// Clean up test data
		const taskKeys = await redis.stream.keys("cb:task:*");
		if (taskKeys.length > 0) {
			await redis.stream.del(...taskKeys);
		}
		const instanceKeys = await redis.stream.keys("cb:instance:*");
		if (instanceKeys.length > 0) {
			await redis.stream.del(...instanceKeys);
		}
	});
	
	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["system.get_state"];
		const contractParams = contractEvent.request.properties.params;
		const contractResult = contractEvent.response.properties.result.properties;
		
		it("should have empty input per contract", () => {
			// Contract specifies params as just "type": "object" with no properties
			expect(contractParams.type).toBe("object");
			expect((contractParams as any).required).toBeUndefined();
			expect((contractParams as any).properties).toBeUndefined();
			
			// Our schema should accept empty object
			const result = systemGetStateInput.safeParse({});
			expect(result.success).toBe(true);
		});
		
		it("should match output schema with contract response", () => {
			// Contract specifies optional arrays for tasks, instances, recentEvents
			expect(contractResult.tasks).toBeDefined();
			expect(contractResult.tasks.type).toBe("array");
			
			expect(contractResult.instances).toBeDefined();
			expect(contractResult.instances.type).toBe("array");
			
			expect(contractResult.recentEvents).toBeDefined();
			expect(contractResult.recentEvents.type).toBe("array");
			
			// No required fields - all are optional
			const requiredFields = (contractEvent.response.properties.result as any).required;
			expect(requiredFields).toBeUndefined();
		});
		
		it("should accept outputs with optional arrays", () => {
			const validOutputs = [
				{}, // All fields optional
				{ tasks: [] },
				{ instances: [] },
				{ recentEvents: [] },
				{ tasks: [{ id: "t-1", status: "pending" }] },
				{ instances: [{ id: "i-1", role: "worker" }] },
				{ recentEvents: [{ type: "test", timestamp: Date.now() }] },
				{
					tasks: [{ id: "t-1" }],
					instances: [{ id: "i-1" }],
					recentEvents: [{ type: "test" }],
				},
			];
			
			for (const output of validOutputs) {
				const result = systemGetStateOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
		
		it("should reject invalid outputs", () => {
			const invalidOutputs = [
				{ tasks: "not-an-array" },
				{ instances: "not-an-array" },
				{ recentEvents: "not-an-array" },
				{ tasks: null }, // null is not undefined
				{ unknownField: [] }, // Unknown fields should be stripped, not cause failure
			];
			
			// Only test the ones that are actually invalid
			for (const output of invalidOutputs.slice(0, 4)) {
				const result = systemGetStateOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
	});
	
	describe("Handler execution with contract data", () => {
		it("should return empty state when no data exists", async () => {
			// Execute handler through registry
			const result = await registry.executeHandler("system.get_state", {});
			
			// With no data, all fields should be undefined (not returned)
			expect(result).toEqual({});
		});
		
		it("should return tasks when they exist", async () => {
			// Create some test tasks
			const taskKey1 = redisKey("task", "t-test-1");
			await redis.stream.hset(taskKey1, {
				id: "t-test-1",
				text: "Test task 1",
				status: "pending",
			});
			
			const taskKey2 = redisKey("task", "t-test-2");
			await redis.stream.hset(taskKey2, {
				id: "t-test-2",
				text: "Test task 2",
				status: "completed",
			});
			
			const result = await registry.executeHandler("system.get_state", {});
			
			// Should have tasks array
			expect(result.tasks).toBeDefined();
			expect(Array.isArray(result.tasks)).toBe(true);
			expect(result.tasks.length).toBeGreaterThan(0);
			
			// Verify task data is included
			const taskIds = result.tasks.map((t: any) => t.id);
			expect(taskIds).toContain("t-test-1");
			expect(taskIds).toContain("t-test-2");
		});
		
		it("should return instances when they exist", async () => {
			// Create some test instances
			const instanceKey1 = redisKey("instance", "worker-1");
			await redis.stream.hset(instanceKey1, {
				id: "worker-1",
				roles: JSON.stringify(["worker"]),
				status: "ACTIVE",
			});
			
			const instanceKey2 = redisKey("instance", "monitor-1");
			await redis.stream.hset(instanceKey2, {
				id: "monitor-1",
				roles: JSON.stringify(["monitor"]),
				status: "IDLE",
			});
			
			const result = await registry.executeHandler("system.get_state", {});
			
			// Should have instances array
			expect(result.instances).toBeDefined();
			expect(Array.isArray(result.instances)).toBe(true);
			expect(result.instances.length).toBeGreaterThan(0);
			
			// Verify instance data is included
			const instanceIds = result.instances.map((i: any) => i.id);
			expect(instanceIds).toContain("worker-1");
			expect(instanceIds).toContain("monitor-1");
		});
		
		it("should limit results for performance", async () => {
			// Create many tasks (more than the limit)
			for (let i = 0; i < 20; i++) {
				const taskKey = redisKey("task", `t-many-${i}`);
				await redis.stream.hset(taskKey, {
					id: `t-many-${i}`,
					text: `Task ${i}`,
					status: "pending",
				});
			}
			
			const result = await registry.executeHandler("system.get_state", {});
			
			// Should limit to reasonable number (handler limits to 10)
			expect(result.tasks).toBeDefined();
			expect(result.tasks.length).toBeLessThanOrEqual(10);
		});
		
		it("should handle mixed state correctly", async () => {
			// Add one task
			const taskKey = redisKey("task", "t-mixed-1");
			await redis.stream.hset(taskKey, {
				id: "t-mixed-1",
				text: "Mixed test task",
				status: "pending",
			});
			
			// No instances or events
			
			const result = await registry.executeHandler("system.get_state", {});
			
			// Should only have tasks, not other fields
			expect(result.tasks).toBeDefined();
			expect(result.instances).toBeUndefined();
			expect(result.recentEvents).toBeUndefined();
		});
	});
	
	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "system.get_state",
				params: {},
				id: "state-1",
			};
			
			// Validate request structure matches contract
			expect(request.method).toBe("system.get_state");
			expect(request.params).toEqual({});
			
			// Params should be valid for our schema
			const result = systemGetStateInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});
		
		it("should produce JSONRPC response format", async () => {
			const result = await registry.executeHandler("system.get_state", {});
			
			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "state-1",
			};
			
			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			
			// Result should match contract output schema
			const outputResult = systemGetStateOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
		
		it("should work as notification (no response expected)", () => {
			const notification = {
				jsonrpc: "2.0",
				method: "system.get_state",
				params: {},
				// No id field - this is a notification
			};
			
			// Validate notification structure
			expect(notification).not.toHaveProperty("id");
			expect(notification.method).toBe("system.get_state");
			
			// Params should still be valid
			const result = systemGetStateInput.safeParse(notification.params);
			expect(result.success).toBe(true);
		});
	});
});