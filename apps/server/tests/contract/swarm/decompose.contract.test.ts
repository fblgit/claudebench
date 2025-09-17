import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { swarmDecomposeInput, swarmDecomposeOutput } from "@/schemas/swarm.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../../helpers/test-setup";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: swarm.decompose", () => {
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
				taskId: "t-123456",
				task: "Implement dark mode toggle",
				priority: 75
			};
			const result = swarmDecomposeInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// Test with optional constraints
			const withConstraints = {
				...validInput,
				constraints: ["Use React hooks", "Minimize bundle size"]
			};
			const result2 = swarmDecomposeInput.safeParse(withConstraints);
			expect(result2.success).toBe(true);

			// Invalid inputs
			const invalidInputs = [
				{ taskId: "", task: "Test", priority: 50 }, // Empty taskId
				{ taskId: "t-123", task: "", priority: 50 }, // Empty task
				{ taskId: "t-123", task: "Test", priority: -1 }, // Invalid priority
				{ taskId: "t-123", task: "Test", priority: 101 }, // Priority too high
			];

			for (const input of invalidInputs) {
				const result = swarmDecomposeInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should validate output schema", () => {
			const validOutput = {
				taskId: "t-123456",
				subtaskCount: 3,
				decomposition: {
					subtasks: [
						{
							id: "st-1",
							description: "Create UI component",
							specialist: "frontend",
							complexity: 60,
							estimatedMinutes: 120,
							dependencies: [],
							context: {
								files: ["src/components/Toggle.tsx"],
								patterns: ["React hooks"],
								constraints: []
							}
						}
					],
					executionStrategy: "parallel",
					totalComplexity: 180,
					reasoning: "Task requires UI, state management, and testing"
				}
			};
			const result = swarmDecomposeOutput.safeParse(validOutput);
			expect(result.success).toBe(true);
		});

		it("should validate specialist types", () => {
			const validSpecialists = ["frontend", "backend", "testing", "docs", "general"];
			
			for (const specialist of validSpecialists) {
				const subtask = {
					id: "st-1",
					description: "Test",
					specialist,
					complexity: 50,
					estimatedMinutes: 60,
					dependencies: [],
					context: { files: [], patterns: [], constraints: [] }
				};
				
				const output = {
					taskId: "t-123",
					subtaskCount: 1,
					decomposition: {
						subtasks: [subtask],
						executionStrategy: "sequential",
						totalComplexity: 50,
						reasoning: "Test"
					}
				};
				
				const result = swarmDecomposeOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});

		it("should validate execution strategies", () => {
			const validStrategies = ["parallel", "sequential", "mixed"];
			
			for (const strategy of validStrategies) {
				const output = {
					taskId: "t-123",
					subtaskCount: 1,
					decomposition: {
						subtasks: [{
							id: "st-1",
							description: "Test",
							specialist: "general",
							complexity: 50,
							estimatedMinutes: 60,
							dependencies: [],
							context: { files: [], patterns: [], constraints: [] }
						}],
						executionStrategy: strategy,
						totalComplexity: 50,
						reasoning: "Test"
					}
				};
				
				const result = swarmDecomposeOutput.safeParse(output);
				expect(result.success).toBe(true);
			}
		});
	});

	describe("Handler registration", () => {
		it("should have registered the swarm.decompose handler", () => {
			const handler = registry.getHandler("swarm.decompose");
			expect(handler).toBeDefined();
			expect(handler?.config.event).toBe("swarm.decompose");
		});

		it("should have MCP metadata configured", () => {
			const handler = registry.getHandler("swarm.decompose");
			expect(handler?.config.mcp).toBeDefined();
			expect(handler?.config.mcp?.title).toBe("Decompose Task");
			expect(handler?.config.mcp?.metadata?.tags).toContain("swarm");
			expect(handler?.config.mcp?.metadata?.tags).toContain("decomposition");
		});

		it("should validate persistence flag", () => {
			const handler = registry.getHandler("swarm.decompose");
			expect(handler?.config.persist).toBe(true);
		});

		it("should have rate limiting configured", () => {
			const handler = registry.getHandler("swarm.decompose");
			expect(handler?.config.rateLimit).toBe(10);
		});
	});

	describe("JSONRPC compliance", () => {
		it("should accept JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "swarm.decompose",
				params: {
					taskId: "t-123456",
					task: "Implement feature",
					priority: 75
				},
				id: "req-123"
			};
			
			// Validate params match input schema
			const result = swarmDecomposeInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", () => {
			const response = {
				taskId: "t-123456",
				subtaskCount: 2,
				decomposition: {
					subtasks: [],
					executionStrategy: "parallel",
					totalComplexity: 100,
					reasoning: "Decomposition complete"
				}
			};
			
			// Validate response matches output schema
			const result = swarmDecomposeOutput.safeParse(response);
			expect(result.success).toBe(true);
		});
	});
});