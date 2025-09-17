import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { swarmAssignInput, swarmAssignOutput } from "@/schemas/swarm.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../../helpers/test-setup";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: swarm.assign", () => {
	let redis: any;

	beforeAll(async () => {
		redis = await setupContractTest();
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Schema validation", () => {
		it("should validate input schema", () => {
			// Valid input with minimal fields
			const validInput = {
				subtaskId: "st-123",
				specialist: "frontend"
			};
			const result = swarmAssignInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// With optional capabilities
			const withCapabilities = {
				subtaskId: "st-456",
				specialist: "backend",
				requiredCapabilities: ["node", "typescript", "postgresql"]
			};
			const result2 = swarmAssignInput.safeParse(withCapabilities);
			expect(result2.success).toBe(true);
		});

		it("should validate specialist enum values", () => {
			const validSpecialists = ["frontend", "backend", "testing", "docs", "general"];
			
			for (const specialist of validSpecialists) {
				const input = {
					subtaskId: "st-123",
					specialist
				};
				const result = swarmAssignInput.safeParse(input);
				expect(result.success).toBe(true);
			}

			// Invalid specialist
			const invalidInput = {
				subtaskId: "st-123",
				specialist: "infrastructure"
			};
			const result = swarmAssignInput.safeParse(invalidInput);
			expect(result.success).toBe(false);
		});

		it("should reject invalid inputs", () => {
			const invalidInputs = [
				// Empty subtaskId
				{
					subtaskId: "",
					specialist: "frontend"
				},
				// Invalid specialist type
				{
					subtaskId: "st-123",
					specialist: "invalid"
				},
				// Missing required fields
				{
					subtaskId: "st-123"
				}
			];

			for (const input of invalidInputs) {
				const result = swarmAssignInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should validate output schema", () => {
			// Successful assignment
			const validOutput = {
				subtaskId: "st-123",
				assignment: {
					specialistId: "specialist-frontend-1",
					score: 95,
					assignedAt: new Date().toISOString()
				}
			};
			const result = swarmAssignOutput.safeParse(validOutput);
			expect(result.success).toBe(true);

			// Assignment queued (no specialist available)
			const queuedOutput = {
				subtaskId: "st-456",
				assignment: {
					specialistId: "queue",
					score: 0,
					assignedAt: new Date().toISOString(),
					queuePosition: 3
				}
			};
			const result2 = swarmAssignOutput.safeParse(queuedOutput);
			expect(result2.success).toBe(true);
		});

		it("should validate assignment details", () => {
			// Test score range
			const scores = [0, 50, 100, 85.5];
			for (const score of scores) {
				const output = {
					subtaskId: "st-123",
					assignment: {
						specialistId: "specialist-1",
						score,
						assignedAt: new Date().toISOString()
					}
				};
				const result = swarmAssignOutput.safeParse(output);
				expect(result.success).toBe(true);
			}

			// Test assignedAt format
			const output = {
				subtaskId: "st-123",
				assignment: {
					specialistId: "specialist-1",
					score: 90,
					assignedAt: "2024-01-15T10:30:00.000Z"
				}
			};
			const result = swarmAssignOutput.safeParse(output);
			expect(result.success).toBe(true);
		});
	});

	describe("Handler registration", () => {
		it("should have registered the swarm.assign handler", () => {
			const handler = registry.getHandler("swarm.assign");
			expect(handler).toBeDefined();
			expect(handler?.event).toBe("swarm.assign");
		});

		it("should have MCP metadata configured", () => {
			const handler = registry.getHandler("swarm.assign");
			expect(handler?.mcp).toBeDefined();
			expect(handler?.mcp?.title).toBe("Assign Specialist");
			expect(handler?.mcp?.metadata?.tags).toContain("swarm");
			expect(handler?.mcp?.metadata?.tags).toContain("assignment");
			expect(handler?.mcp?.metadata?.tags).toContain("specialist");
		});

		it("should have persistence enabled", () => {
			const handler = registry.getHandler("swarm.assign");
			expect(handler?.persist).toBe(true);
		});

		it("should have rate limiting configured", () => {
			const handler = registry.getHandler("swarm.assign");
			expect(handler?.rateLimit).toBe(50);
		});
	});

	describe("JSONRPC compliance", () => {
		it("should accept JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "swarm.assign",
				params: {
					subtaskId: "st-789",
					specialist: "testing",
					requiredCapabilities: ["jest", "playwright"]
				},
				id: "req-101"
			};
			
			// Validate params match input schema
			const result = swarmAssignInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", () => {
			const response = {
				subtaskId: "st-789",
				assignment: {
					specialistId: "specialist-testing-2",
					score: 88,
					assignedAt: "2024-01-15T12:00:00.000Z"
				}
			};
			
			// Validate response matches output schema
			const result = swarmAssignOutput.safeParse(response);
			expect(result.success).toBe(true);
		});

		it("should handle notification format (no id)", () => {
			const notification = {
				jsonrpc: "2.0",
				method: "swarm.assign",
				params: {
					subtaskId: "st-999",
					specialist: "docs"
				}
				// No id field for notifications
			};
			
			// Validate params still match input schema
			const result = swarmAssignInput.safeParse(notification.params);
			expect(result.success).toBe(true);
		});
	});
});