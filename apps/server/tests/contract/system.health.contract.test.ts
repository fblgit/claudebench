import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";
import { systemHealthInput, systemHealthOutput } from "@/schemas/system.schema";
import { registry } from "@/core/registry";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: system.health", () => {
	let redis: ReturnType<typeof getRedis>;
	
	beforeAll(async () => {
		redis = getRedis();
		// Initialize registry
		await registry.discover();
	});
	
	afterAll(async () => {
		await redis.disconnect();
	});
	
	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["system.health"];
		const contractParams = contractEvent.request.properties.params;
		const contractResult = contractEvent.response.properties.result;
		
		it("should have empty input per contract", () => {
			// Contract specifies params as just "type": "object" with no required fields
			expect(contractParams.type).toBe("object");
			expect((contractParams as any).required).toBeUndefined();
			
			// Our schema should accept empty object
			const result = systemHealthInput.safeParse({});
			expect(result.success).toBe(true);
		});
		
		it("should match output schema with contract response", () => {
			// Contract requires status and services
			const requiredFields = contractResult.required;
			expect(requiredFields).toEqual(["status", "services"]);
			
			// Test valid outputs
			const validOutputs = [
				{
					status: "healthy",
					services: { redis: true, postgres: true, mcp: true },
				},
				{
					status: "degraded",
					services: { redis: true, postgres: false, mcp: true },
				},
				{
					status: "unhealthy",
					services: { redis: false, postgres: false, mcp: false },
				},
			];
			
			for (const output of validOutputs) {
				const result = systemHealthOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
		
		it("should validate status enum values", () => {
			const contractStatus = contractResult.properties.status.enum;
			expect(contractStatus).toEqual(["healthy", "degraded", "unhealthy"]);
			
			// Test our schema accepts all valid statuses
			for (const status of contractStatus) {
				const output = {
					status,
					services: { redis: true, postgres: true, mcp: true },
				};
				const result = systemHealthOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
		
		it("should validate services structure", () => {
			const servicesProps = contractResult.properties.services.properties;
			expect(servicesProps).toHaveProperty("redis");
			expect(servicesProps).toHaveProperty("postgres");
			expect(servicesProps).toHaveProperty("mcp");
			
			// All service fields should be boolean
			expect(servicesProps.redis.type).toBe("boolean");
			expect(servicesProps.postgres.type).toBe("boolean");
			expect(servicesProps.mcp.type).toBe("boolean");
		});
		
		it("should reject invalid outputs", () => {
			const invalidOutputs = [
				{}, // Missing required fields
				{ status: "healthy" }, // Missing services
				{ services: { redis: true, postgres: true, mcp: true } }, // Missing status
				{ status: "unknown", services: {} }, // Invalid status enum
				{ status: "healthy", services: { redis: "yes" } }, // Wrong type for service
			];
			
			for (const output of invalidOutputs) {
				const result = systemHealthOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
	});
	
	describe("Handler execution with contract data", () => {
		it("should return health status with all services", async () => {
			// Execute handler through registry
			const result = await registry.executeHandler("system.health", {});
			
			// Verify output matches contract
			expect(result).toHaveProperty("status");
			expect(["healthy", "degraded", "unhealthy"]).toContain(result.status);
			
			expect(result).toHaveProperty("services");
			expect(result.services).toHaveProperty("redis");
			expect(result.services).toHaveProperty("postgres");
			expect(result.services).toHaveProperty("mcp");
			
			expect(typeof result.services.redis).toBe("boolean");
			expect(typeof result.services.postgres).toBe("boolean");
			expect(typeof result.services.mcp).toBe("boolean");
		});
		
		it("should handle service failures gracefully", async () => {
			// Even if services are down, handler should return valid response
			const result = await registry.executeHandler("system.health", {});
			
			// Response should always be valid per contract
			const validation = systemHealthOutput.safeParse(result);
			expect(validation.success).toBe(true);
		});
		
		it("should determine overall status based on services", async () => {
			const result = await registry.executeHandler("system.health", {});
			
			const { redis, postgres, mcp } = result.services;
			const allHealthy = redis && postgres && mcp;
			const someHealthy = redis || postgres || mcp;
			
			if (allHealthy) {
				expect(result.status).toBe("healthy");
			} else if (someHealthy) {
				expect(result.status).toBe("degraded");
			} else {
				expect(result.status).toBe("unhealthy");
			}
		});
	});
	
	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "system.health",
				params: {},
				id: "health-check-1",
			};
			
			// Validate request structure matches contract
			expect(request.method).toBe("system.health");
			expect(request.params).toEqual({});
			
			// Params should be valid for our schema
			const result = systemHealthInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});
		
		it("should produce JSONRPC response format", async () => {
			const result = await registry.executeHandler("system.health", {});
			
			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "health-check-1",
			};
			
			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			expect(response.result).toHaveProperty("status");
			expect(response.result).toHaveProperty("services");
			
			// Result should match contract output schema
			const outputResult = systemHealthOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
		
		it("should work as notification (no response expected)", () => {
			const notification = {
				jsonrpc: "2.0",
				method: "system.health",
				params: {},
				// No id field - this is a notification
			};
			
			// Validate notification structure
			expect(notification).not.toHaveProperty("id");
			expect(notification.method).toBe("system.health");
			
			// Params should still be valid
			const result = systemHealthInput.safeParse(notification.params);
			expect(result.success).toBe(true);
		});
	});
});