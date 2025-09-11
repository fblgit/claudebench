import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { systemHeartbeatInput, systemHeartbeatOutput } from "@/schemas/system.schema";
import { registry } from "@/core/registry";
import { redisKey } from "@/core/redis";
import { setupContractTest, cleanupContractTest } from "../helpers/test-setup";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: system.heartbeat", () => {
	let redis: any;
	
	beforeAll(async () => {
		redis = await setupContractTest();
	});
	
	afterAll(async () => {
		await cleanupContractTest();
	});
	
	beforeEach(async () => {
		try {
			// Clean up test data
			const keys = await redis.stream.keys("cb:instance:*");
			if (keys.length > 0) {
				await redis.stream.del(...keys);
			}
		} catch {
			// Ignore cleanup errors
		}
	});
	
	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["system.heartbeat"];
		const contractParams = contractEvent.request.properties.params.properties;
		const contractResult = contractEvent.response.properties.result.properties;
		
		it("should match input schema with contract params", () => {
			// Contract specifies only instanceId is required
			const requiredFields = contractEvent.request.properties.params.required;
			expect(requiredFields).toEqual(["instanceId"]);
			
			// Test valid input
			const validInput = { instanceId: "worker-123" };
			const result = systemHeartbeatInput.safeParse(validInput);
			expect(result.success).toBe(true);
			
			// Test invalid inputs
			const invalidInputs = [
				{}, // Missing instanceId
				{ instanceId: "" }, // Empty instanceId (though contract doesn't specify minLength)
				{ instanceId: 123 }, // Wrong type
			];
			
			for (const input of invalidInputs) {
				const result = systemHeartbeatInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
		
		it("should match output schema with contract response", () => {
			// Contract specifies only 'alive' field
			const requiredFields = contractEvent.response.properties.result.required;
			expect(requiredFields).toEqual(["alive"]);
			
			// Verify our schema structure
			const validOutputs = [
				{ alive: true },
				{ alive: false },
			];
			
			for (const output of validOutputs) {
				const result = systemHeartbeatOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
			
			// Test invalid outputs
			const invalidOutputs = [
				{}, // Missing alive
				{ alive: "true" }, // Wrong type
				{ alive: 1 }, // Wrong type
				{ alive: true, extra: "field" }, // Extra fields should still pass (Zod strips them)
			];
			
			for (const output of invalidOutputs.slice(0, 3)) {
				const result = systemHeartbeatOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
		
		it("should validate that output only has boolean alive field", () => {
			const aliveProperty = contractResult.alive;
			expect(aliveProperty.type).toBe("boolean");
			
			// Our schema should only return alive field
			const parsed = systemHeartbeatOutput.parse({ alive: true });
			expect(Object.keys(parsed)).toEqual(["alive"]);
		});
	});
	
	describe("Handler execution with contract data", () => {
		it("should return false for non-existent instance", async () => {
			const input = { instanceId: "non-existent-instance" };
			
			// Execute handler through registry
			const result = await registry.executeHandler("system.heartbeat", input);
			
			// Should return alive: false for non-existent instance
			expect(result).toEqual({ alive: false });
		});
		
		it("should return true for registered instance", async () => {
			const instanceId = "test-worker-1";
			const instanceKey = redisKey("instance", instanceId);
			
			// Register instance first
			await redis.stream.hset(instanceKey, {
				id: instanceId,
				name: "Test Worker",
				role: "worker",
				status: "ACTIVE",
				registeredAt: new Date().toISOString(),
			});
			
			// Execute heartbeat
			const result = await registry.executeHandler("system.heartbeat", { instanceId });
			
			// Should return alive: true for existing instance
			expect(result).toEqual({ alive: true });
			
			// Verify lastHeartbeat was updated
			const lastHeartbeat = await redis.stream.hget(instanceKey, "lastHeartbeat");
			expect(lastHeartbeat).toBeTruthy();
			
			// Verify TTL was set
			const ttl = await redis.stream.ttl(instanceKey);
			expect(ttl).toBeGreaterThan(0);
			expect(ttl).toBeLessThanOrEqual(120);
		});
		
		it("should handle multiple heartbeats from same instance", async () => {
			const instanceId = "test-worker-2";
			const instanceKey = redisKey("instance", instanceId);
			
			// Register instance
			await redis.stream.hset(instanceKey, {
				id: instanceId,
				name: "Test Worker 2",
				registeredAt: new Date().toISOString(),
			});
			
			// Send multiple heartbeats
			for (let i = 0; i < 3; i++) {
				const result = await registry.executeHandler("system.heartbeat", { instanceId });
				expect(result).toEqual({ alive: true });
				
				// Small delay between heartbeats
				await new Promise(resolve => setTimeout(resolve, 10));
			}
			
			// Verify last heartbeat is recent
			const lastHeartbeat = await redis.stream.hget(instanceKey, "lastHeartbeat");
			const heartbeatTime = new Date(lastHeartbeat as string).getTime();
			expect(heartbeatTime).toBeGreaterThan(Date.now() - 1000); // Within last second
		});
	});
	
	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "system.heartbeat",
				params: {
					instanceId: "worker-123",
				},
				id: "test-heartbeat-1",
			};
			
			// Validate request structure matches contract
			expect(request.method).toBe("system.heartbeat");
			expect(request.params).toHaveProperty("instanceId");
			
			// Params should be valid for our schema
			const result = systemHeartbeatInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});
		
		it("should produce JSONRPC response format", async () => {
			const instanceId = "worker-jsonrpc";
			
			// Execute handler
			const result = await registry.executeHandler("system.heartbeat", { instanceId });
			
			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "test-heartbeat-1",
			};
			
			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response.result).toHaveProperty("alive");
			expect(typeof response.result.alive).toBe("boolean");
			
			// Result should match contract output schema
			const outputResult = systemHeartbeatOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
		
		it("should work as notification (no id, no response expected)", () => {
			const notification = {
				jsonrpc: "2.0",
				method: "system.heartbeat",
				params: {
					instanceId: "worker-notification",
				},
				// No id field - this is a notification
			};
			
			// Validate notification structure
			expect(notification).not.toHaveProperty("id");
			expect(notification.method).toBe("system.heartbeat");
			
			// Params should still be valid
			const result = systemHeartbeatInput.safeParse(notification.params);
			expect(result.success).toBe(true);
		});
	});
});
