import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { swarmContextInput, swarmContextOutput } from "@/schemas/swarm.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../../helpers/test-setup";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: swarm.context", () => {
	let redis: any;

	beforeAll(async () => {
		redis = await setupContractTest();
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Schema validation", () => {
		it("should validate input schema", () => {
			// Valid input
			const validInput = {
				subtaskId: "st-123",
				specialist: "frontend",
				parentTaskId: "t-456"
			};
			const result = swarmContextInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// Invalid inputs
			const invalidInputs = [
				{ subtaskId: "", specialist: "frontend", parentTaskId: "t-1" }, // Empty subtaskId
				{ subtaskId: "st-1", specialist: "invalid", parentTaskId: "t-1" }, // Invalid specialist
				{ subtaskId: "st-1", specialist: "backend", parentTaskId: "" }, // Empty parentTaskId
			];

			for (const input of invalidInputs) {
				const result = swarmContextInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should validate output schema", () => {
			const validOutput = {
				subtaskId: "st-123",
				context: {
					taskId: "t-456",
					description: "Implement toggle component",
					scope: "Create a reusable dark mode toggle",
					mandatoryReadings: [
						{
							title: "Component Guidelines",
							path: "docs/components.md"
						}
					],
					architectureConstraints: [
						"Use existing theme context",
						"Follow atomic design principles"
					],
					relatedWork: [
						{
							instanceId: "specialist-2",
							status: "in_progress",
							summary: "Working on theme provider"
						}
					],
					successCriteria: [
						"Toggle changes theme immediately",
						"State persists on refresh"
					]
				},
				prompt: "You are a frontend specialist..."
			};
			const result = swarmContextOutput.safeParse(validOutput);
			expect(result.success).toBe(true);
		});

		it("should validate specialist enum values", () => {
			const validSpecialists = ["frontend", "backend", "testing", "docs", "general"];
			
			for (const specialist of validSpecialists) {
				const input = {
					subtaskId: "st-123",
					specialist,
					parentTaskId: "t-456"
				};
				const result = swarmContextInput.safeParse(input);
				expect(result.success).toBe(true);
			}

			// Invalid specialist
			const invalidInput = {
				subtaskId: "st-123",
				specialist: "devops",
				parentTaskId: "t-456"
			};
			const result = swarmContextInput.safeParse(invalidInput);
			expect(result.success).toBe(false);
		});

		it("should handle arrays in context properly", () => {
			const contextWithEmptyArrays = {
				taskId: "t-456",
				description: "Test task",
				scope: "Test scope",
				mandatoryReadings: [],
				architectureConstraints: [],
				relatedWork: [],
				successCriteria: []
			};

			const output = {
				subtaskId: "st-123",
				context: contextWithEmptyArrays,
				prompt: "Test prompt"
			};

			const result = swarmContextOutput.safeParse(output);
			expect(result.success).toBe(true);
		});
	});

	describe("Handler registration", () => {
		it("should have registered the swarm.context handler", () => {
			const handler = registry.getHandler("swarm.context");
			expect(handler).toBeDefined();
			expect(handler?.config.event).toBe("swarm.context");
		});

		it("should have MCP metadata configured", () => {
			const handler = registry.getHandler("swarm.context");
			expect(handler?.config.mcp).toBeDefined();
			expect(handler?.config.mcp?.title).toBe("Generate Specialist Context");
			expect(handler?.config.mcp?.metadata?.tags).toContain("swarm");
			expect(handler?.config.mcp?.metadata?.tags).toContain("context");
			expect(handler?.config.mcp?.metadata?.tags).toContain("specialist");
		});

		it("should have persistence disabled", () => {
			const handler = registry.getHandler("swarm.context");
			expect(handler?.config.persist).toBe(false);
		});

		it("should have rate limiting configured", () => {
			const handler = registry.getHandler("swarm.context");
			expect(handler?.config.rateLimit).toBe(50);
		});
	});

	describe("JSONRPC compliance", () => {
		it("should accept JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "swarm.context",
				params: {
					subtaskId: "st-123",
					specialist: "frontend",
					parentTaskId: "t-456"
				},
				id: "req-789"
			};
			
			// Validate params match input schema
			const result = swarmContextInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", () => {
			const response = {
				subtaskId: "st-123",
				context: {
					taskId: "t-456",
					description: "Test",
					scope: "Test",
					mandatoryReadings: [],
					architectureConstraints: [],
					relatedWork: [],
					successCriteria: []
				},
				prompt: "Generated prompt"
			};
			
			// Validate response matches output schema
			const result = swarmContextOutput.safeParse(response);
			expect(result.success).toBe(true);
		});
	});
});