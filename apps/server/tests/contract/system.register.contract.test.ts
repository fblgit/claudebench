import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { systemRegisterInput, systemRegisterOutput } from "@/schemas/system.schema";
import { registry } from "@/core/registry";
import { redisKey } from "@/core/redis";
import { setupContractTest, cleanupContractTest } from "../helpers/test-setup";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: system.register", () => {
	let redis: any;
	
	beforeAll(async () => {
		redis = await setupContractTest();
	});
	
	afterAll(async () => {
		await cleanupContractTest();
	});
	
	beforeEach(async () => {
		// Try to clean up test data
		try {
			const keys = await redis.stream.keys("cb:instance:*");
			if (keys.length > 0) {
				await redis.stream.del(...keys);
			}
			const roleKeys = await redis.stream.keys("cb:role:*");
			if (roleKeys.length > 0) {
				await redis.stream.del(...roleKeys);
			}
		} catch {
			// Ignore cleanup errors
		}
	});
	
	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["system.register"];
		const contractParams = contractEvent.request.properties.params.properties;
		const contractResult = contractEvent.response.properties.result.properties;
		
		it("should match input schema with contract params", () => {
			// Contract requires id and roles
			const requiredFields = contractEvent.request.properties.params.required;
			expect(requiredFields).toEqual(["id", "roles"]);
			
			// Test valid inputs
			const validInputs = [
				{ id: "worker-1", roles: ["worker"] },
				{ id: "monitor-1", roles: ["monitor", "worker"] },
				{ id: "coordinator-1", roles: [] }, // Empty roles array is valid
			];
			
			for (const input of validInputs) {
				const result = systemRegisterInput.safeParse(input);
				expect(result.success).toBe(true);
			}
		});
		
		it("should reject invalid inputs", () => {
			const invalidInputs = [
				{}, // Missing required fields
				{ id: "worker-1" }, // Missing roles
				{ roles: ["worker"] }, // Missing id
				{ id: "", roles: ["worker"] }, // Empty id
				{ id: 123, roles: ["worker"] }, // Wrong type for id
				{ id: "worker-1", roles: "worker" }, // Wrong type for roles
				{ id: "worker-1", roles: [123] }, // Wrong type in roles array
			];
			
			for (const input of invalidInputs) {
				const result = systemRegisterInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});
		
		it("should match output schema with contract response", () => {
			// Contract requires only registered boolean
			const requiredFields = contractEvent.response.properties.result.required;
			expect(requiredFields).toEqual(["registered"]);
			
			// Test valid outputs
			const validOutputs = [
				{ registered: true },
				{ registered: false },
			];
			
			for (const output of validOutputs) {
				const result = systemRegisterOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
		
		it("should validate that output only has boolean registered field", () => {
			const registeredProperty = contractResult.registered;
			expect(registeredProperty.type).toBe("boolean");
			
			// Our schema should only return registered field
			const parsed = systemRegisterOutput.parse({ registered: true });
			expect(Object.keys(parsed)).toEqual(["registered"]);
		});
		
		it("should validate roles as array of strings", () => {
			const rolesProperty = contractParams.roles;
			expect(rolesProperty.type).toBe("array");
			expect(rolesProperty.items.type).toBe("string");
		});
	});
	
	describe("Handler execution with contract data", () => {
		it("should register new instance successfully", async () => {
			const input = {
				id: "test-worker-1",
				roles: ["worker", "monitor"],
			};
			
			// Execute handler through registry
			const result = await registry.executeHandler("system.register", input);
			
			// Should return registered: true
			expect(result).toEqual({ registered: true });
			
			// Verify instance was stored in Redis
			const instanceKey = redisKey("instance", input.id);
			const instanceData = await redis.stream.hgetall(instanceKey);
			expect(instanceData).toBeTruthy();
			expect(instanceData.id).toBe(input.id);
			expect(JSON.parse(instanceData.roles)).toEqual(input.roles);
		});
		
		it("should register instance with empty roles", async () => {
			const input = {
				id: "test-generic-1",
				roles: [],
			};
			
			const result = await registry.executeHandler("system.register", input);
			expect(result).toEqual({ registered: true });
			
			// Verify instance was stored
			const instanceKey = redisKey("instance", input.id);
			const instanceData = await redis.stream.hgetall(instanceKey);
			expect(instanceData).toBeTruthy();
			expect(JSON.parse(instanceData.roles)).toEqual([]);
		});
		
		it("should update existing instance when re-registering", async () => {
			const input = {
				id: "test-worker-2",
				roles: ["worker"],
			};
			
			// First registration
			const result1 = await registry.executeHandler("system.register", input);
			expect(result1).toEqual({ registered: true });
			
			// Update roles and re-register
			const updatedInput = {
				id: "test-worker-2",
				roles: ["worker", "coordinator"],
			};
			
			const result2 = await registry.executeHandler("system.register", updatedInput);
			expect(result2).toEqual({ registered: true });
			
			// Verify roles were updated
			const instanceKey = redisKey("instance", input.id);
			const instanceData = await redis.stream.hgetall(instanceKey);
			expect(JSON.parse(instanceData.roles)).toEqual(["worker", "coordinator"]);
		});
		
		it("should register roles for discovery", async () => {
			const input = {
				id: "test-multi-role",
				roles: ["worker", "monitor", "coordinator"],
			};
			
			const result = await registry.executeHandler("system.register", input);
			expect(result).toEqual({ registered: true });
			
			// Verify instance is registered under each role
			for (const role of input.roles) {
				const roleKey = redisKey("role", role);
				const members = await redis.stream.smembers(roleKey);
				expect(members).toContain(input.id);
			}
		});
		
		it("should set TTL on instance data", async () => {
			const input = {
				id: "test-ttl-instance",
				roles: ["worker"],
			};
			
			const result = await registry.executeHandler("system.register", input);
			expect(result).toEqual({ registered: true });
			
			// Check TTL is set
			const instanceKey = redisKey("instance", input.id);
			const ttl = await redis.stream.ttl(instanceKey);
			expect(ttl).toBeGreaterThan(0);
			expect(ttl).toBeLessThanOrEqual(120); // 2 minutes max
		});
	});
	
	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "system.register",
				params: {
					id: "worker-123",
					roles: ["worker", "monitor"],
				},
				id: "register-1",
			};
			
			// Validate request structure matches contract
			expect(request.method).toBe("system.register");
			expect(request.params).toHaveProperty("id");
			expect(request.params).toHaveProperty("roles");
			
			// Params should be valid for our schema
			const result = systemRegisterInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});
		
		it("should produce JSONRPC response format", async () => {
			const input = {
				id: "worker-jsonrpc",
				roles: ["worker"],
			};
			
			const result = await registry.executeHandler("system.register", input);
			
			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "register-1",
			};
			
			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response.result).toHaveProperty("registered");
			expect(typeof response.result.registered).toBe("boolean");
			
			// Result should match contract output schema
			const outputResult = systemRegisterOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
		
		it("should work as notification (no response expected)", () => {
			const notification = {
				jsonrpc: "2.0",
				method: "system.register",
				params: {
					id: "worker-notification",
					roles: ["worker"],
				},
				// No id field - this is a notification
			};
			
			// Validate notification structure
			expect(notification).not.toHaveProperty("id");
			expect(notification.method).toBe("system.register");
			
			// Params should still be valid
			const result = systemRegisterInput.safeParse(notification.params);
			expect(result.success).toBe(true);
		});
	});
});
