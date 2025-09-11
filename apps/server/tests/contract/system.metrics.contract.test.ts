import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { getRedis, redisKey } from "@/core/redis";
import { systemMetricsInput, systemMetricsOutput } from "@/schemas/system.schema";
import { registry } from "@/core/registry";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: system.metrics", () => {
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
		// Clean up metric keys
		const metricKeys = await redis.stream.keys("cb:metrics:*");
		if (metricKeys.length > 0) {
			await redis.stream.del(...metricKeys);
		}
	});
	
	describe("Schema validation against contract", () => {
		const contractEvent = contractSpec.events["system.metrics"];
		const contractParams = contractEvent.request.properties.params;
		const contractResult = contractEvent.response.properties.result.properties;
		
		it("should have empty input per contract", () => {
			// Contract specifies params as just "type": "object" with no properties
			expect(contractParams.type).toBe("object");
			expect(contractParams.required).toBeUndefined();
			expect(contractParams.properties).toBeUndefined();
			
			// Our schema should accept empty object
			const result = systemMetricsInput.safeParse({});
			expect(result.success).toBe(true);
		});
		
		it("should match output schema with contract response", () => {
			// Contract specifies optional numeric metrics
			expect(contractResult.eventsProcessed).toBeDefined();
			expect(contractResult.eventsProcessed.type).toBe("number");
			
			expect(contractResult.tasksCompleted).toBeDefined();
			expect(contractResult.tasksCompleted.type).toBe("number");
			
			expect(contractResult.averageLatency).toBeDefined();
			expect(contractResult.averageLatency.type).toBe("number");
			
			expect(contractResult.memoryUsage).toBeDefined();
			expect(contractResult.memoryUsage.type).toBe("number");
			
			// No required fields - all are optional
			const requiredFields = contractEvent.response.properties.result.required;
			expect(requiredFields).toBeUndefined();
		});
		
		it("should accept outputs with optional numeric fields", () => {
			const validOutputs = [
				{}, // All fields optional
				{ eventsProcessed: 100 },
				{ tasksCompleted: 50 },
				{ averageLatency: 25.5 },
				{ memoryUsage: 128.75 },
				{
					eventsProcessed: 1000,
					tasksCompleted: 500,
				},
				{
					averageLatency: 15.2,
					memoryUsage: 256.0,
				},
				{
					eventsProcessed: 5000,
					tasksCompleted: 2500,
					averageLatency: 12.3,
					memoryUsage: 512.25,
				},
			];
			
			for (const output of validOutputs) {
				const result = systemMetricsOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
		
		it("should reject invalid outputs", () => {
			const invalidOutputs = [
				{ eventsProcessed: "100" }, // String instead of number
				{ tasksCompleted: null }, // null is not undefined
				{ averageLatency: "fast" }, // String instead of number
				{ memoryUsage: true }, // Boolean instead of number
			];
			
			for (const output of invalidOutputs) {
				const result = systemMetricsOutput.safeParse(output);
				expect(result.success).toBe(false);
			}
		});
		
		it("should handle undefined vs missing fields correctly", () => {
			// When a field is undefined, it should not be included in output
			const output = {
				tasksCompleted: 100,
				memoryUsage: 50.5,
			};
			
			const result = systemMetricsOutput.parse(output);
			expect(result).toHaveProperty("tasksCompleted", 100);
			expect(result).toHaveProperty("memoryUsage", 50.5);
			// Fields not provided should not exist
			expect("eventsProcessed" in result).toBe(false);
			expect("averageLatency" in result).toBe(false);
		});
	});
	
	describe("Handler execution with contract data", () => {
		it("should return metrics with all optional fields", async () => {
			// Execute handler through registry
			const result = await registry.executeHandler("system.metrics", {});
			
			// All fields are optional, so result could be empty or have any combination
			const validation = systemMetricsOutput.safeParse(result);
			expect(validation.success).toBe(true);
			
			// If fields are present, they should be numbers
			if (result.eventsProcessed !== undefined) {
				expect(typeof result.eventsProcessed).toBe("number");
			}
			if (result.tasksCompleted !== undefined) {
				expect(typeof result.tasksCompleted).toBe("number");
			}
			if (result.averageLatency !== undefined) {
				expect(typeof result.averageLatency).toBe("number");
			}
			if (result.memoryUsage !== undefined) {
				expect(typeof result.memoryUsage).toBe("number");
			}
		});
		
		it("should return memory usage as a number", async () => {
			const result = await registry.executeHandler("system.metrics", {});
			
			// Memory usage should always be available (from process.memoryUsage())
			expect(result.memoryUsage).toBeDefined();
			expect(typeof result.memoryUsage).toBe("number");
			expect(result.memoryUsage).toBeGreaterThan(0);
			
			// Should be in MB (reasonable range)
			expect(result.memoryUsage).toBeLessThan(10000); // Less than 10GB
		});
		
		it("should return stored metrics when available", async () => {
			// Store some metric values
			const eventsKey = redisKey("metrics", "events", "total");
			await redis.stream.set(eventsKey, "150");
			
			const tasksKey = redisKey("metrics", "tasks", "completed");
			await redis.stream.set(tasksKey, "75");
			
			const latencyKey = redisKey("metrics", "latency", "average");
			await redis.stream.set(latencyKey, "23.5");
			
			const result = await registry.executeHandler("system.metrics", {});
			
			// Should return the stored values
			expect(result.eventsProcessed).toBe(150);
			expect(result.tasksCompleted).toBe(75);
			expect(result.averageLatency).toBe(23.5);
		});
		
		it("should omit metrics with zero values", async () => {
			// Store zero values
			const eventsKey = redisKey("metrics", "events", "total");
			await redis.stream.set(eventsKey, "0");
			
			const tasksKey = redisKey("metrics", "tasks", "completed");
			await redis.stream.set(tasksKey, "0");
			
			const result = await registry.executeHandler("system.metrics", {});
			
			// Zero values should be omitted (undefined)
			expect(result.eventsProcessed).toBeUndefined();
			expect(result.tasksCompleted).toBeUndefined();
			
			// Memory usage should still be present (always > 0)
			expect(result.memoryUsage).toBeDefined();
			expect(result.memoryUsage).toBeGreaterThan(0);
		});
		
		it("should handle missing metric keys gracefully", async () => {
			// No metrics stored in Redis
			
			const result = await registry.executeHandler("system.metrics", {});
			
			// Should return valid response (possibly empty except for memory)
			const validation = systemMetricsOutput.safeParse(result);
			expect(validation.success).toBe(true);
			
			// Only memory usage should be present
			expect(result.memoryUsage).toBeDefined();
			expect(result.eventsProcessed).toBeUndefined();
			expect(result.tasksCompleted).toBeUndefined();
			expect(result.averageLatency).toBeUndefined();
		});
	});
	
	describe("JSONRPC protocol compliance", () => {
		it("should handle JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "system.metrics",
				params: {},
				id: "metrics-1",
			};
			
			// Validate request structure matches contract
			expect(request.method).toBe("system.metrics");
			expect(request.params).toEqual({});
			
			// Params should be valid for our schema
			const result = systemMetricsInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});
		
		it("should produce JSONRPC response format", async () => {
			const result = await registry.executeHandler("system.metrics", {});
			
			// Build JSONRPC response
			const response = {
				jsonrpc: "2.0",
				result: result,
				id: "metrics-1",
			};
			
			// Validate response structure
			expect(response).toHaveProperty("jsonrpc", "2.0");
			expect(response).toHaveProperty("result");
			
			// Result should match contract output schema
			const outputResult = systemMetricsOutput.safeParse(response.result);
			expect(outputResult.success).toBe(true);
		});
		
		it("should work as notification (no response expected)", () => {
			const notification = {
				jsonrpc: "2.0",
				method: "system.metrics",
				params: {},
				// No id field - this is a notification
			};
			
			// Validate notification structure
			expect(notification).not.toHaveProperty("id");
			expect(notification.method).toBe("system.metrics");
			
			// Params should still be valid
			const result = systemMetricsInput.safeParse(notification.params);
			expect(result.success).toBe(true);
		});
		
		it("should handle error responses correctly", async () => {
			// If handler throws an error, JSONRPC should return error response
			// This is more of a transport-level concern, but good to document
			
			const errorResponse = {
				jsonrpc: "2.0",
				error: {
					code: -32603,
					message: "Internal error",
					data: "Failed to retrieve metrics",
				},
				id: "metrics-error",
			};
			
			// Error response should not have result field
			expect(errorResponse).not.toHaveProperty("result");
			expect(errorResponse).toHaveProperty("error");
			expect(errorResponse.error).toHaveProperty("code");
			expect(errorResponse.error).toHaveProperty("message");
		});
	});
});