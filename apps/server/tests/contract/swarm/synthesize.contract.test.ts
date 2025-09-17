import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { swarmSynthesizeInput, swarmSynthesizeOutput } from "@/schemas/swarm.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../../helpers/test-setup";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: swarm.synthesize", () => {
	let redis: any;

	beforeAll(async () => {
		redis = await setupContractTest();
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Schema validation", () => {
		it("should validate input schema", () => {
			// Valid input with minimum completed subtasks (1)
			const validInput = {
				taskId: "t-123456",
				completedSubtasks: [
					{
						id: "st-1",
						specialist: "frontend",
						output: "Implemented toggle component with React hooks"
					}
				],
				parentTask: "Add dark mode toggle to settings page"
			};
			const result = swarmSynthesizeInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// With multiple subtasks and artifacts
			const withArtifacts = {
				taskId: "t-123456",
				completedSubtasks: [
					{
						id: "st-1",
						specialist: "frontend",
						output: "Implemented toggle component",
						artifacts: ["components/DarkModeToggle.tsx"]
					},
					{
						id: "st-2",
						specialist: "backend",
						output: "Created preference API",
						artifacts: ["api/preferences.ts", "api/preferences.test.ts"]
					},
					{
						id: "st-3",
						specialist: "testing",
						output: "Added E2E tests",
						artifacts: ["tests/darkmode.e2e.ts"]
					}
				],
				parentTask: "Add dark mode toggle to settings page"
			};
			const result2 = swarmSynthesizeInput.safeParse(withArtifacts);
			expect(result2.success).toBe(true);
		});

		it("should reject invalid inputs", () => {
			const invalidInputs = [
				// Empty taskId
				{
					taskId: "",
					completedSubtasks: [{id: "st-1", specialist: "frontend", output: "Test"}],
					parentTask: "Test task"
				},
				// Empty completedSubtasks array (minimum 1)
				{
					taskId: "t-123",
					completedSubtasks: [],
					parentTask: "Test task"
				},
				// Missing required fields in subtask
				{
					taskId: "t-123",
					completedSubtasks: [{id: "st-1", specialist: "frontend"}], // Missing output
					parentTask: "Test task"
				},
				// Empty parentTask
				{
					taskId: "t-123",
					completedSubtasks: [{id: "st-1", specialist: "frontend", output: "Test"}],
					parentTask: ""
				}
			];

			for (const input of invalidInputs) {
				const result = swarmSynthesizeInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should validate output schema", () => {
			const validOutput = {
				taskId: "t-123456",
				integration: {
					status: "integrated",
					integrationSteps: [
						"Merged frontend toggle component",
						"Connected to backend preference API",
						"Validated with E2E tests"
					],
					potentialIssues: [],
					nextActions: []
				}
			};
			const result = swarmSynthesizeOutput.safeParse(validOutput);
			expect(result.success).toBe(true);

			// With merged code
			const withMergedCode = {
				...validOutput,
				integration: {
					...validOutput.integration,
					mergedCode: "// Integrated solution\nexport const DarkMode = () => { ... }"
				}
			};
			const result2 = swarmSynthesizeOutput.safeParse(withMergedCode);
			expect(result2.success).toBe(true);

			// With issues requiring fixes
			const withIssues = {
				taskId: "t-123456",
				integration: {
					status: "requires_fixes",
					integrationSteps: ["Attempted merge"],
					potentialIssues: [
						"Type mismatch between frontend and backend",
						"Missing error handling"
					],
					nextActions: [
						"Fix TypeScript errors",
						"Add error boundaries"
					]
				}
			};
			const result3 = swarmSynthesizeOutput.safeParse(withIssues);
			expect(result3.success).toBe(true);
		});

		it("should validate integration status enum", () => {
			const validStatuses = ["ready_for_integration", "requires_fixes", "integrated"];
			
			for (const status of validStatuses) {
				const output = {
					taskId: "t-123",
					integration: {
						status,
						integrationSteps: ["Step 1"],
						potentialIssues: [],
						nextActions: []
					}
				};
				const result = swarmSynthesizeOutput.safeParse(output);
				expect(result.success).toBe(true);
			}

			// Invalid status
			const invalidOutput = {
				taskId: "t-123",
				integration: {
					status: "invalid_status",
					integrationSteps: ["Step 1"],
					potentialIssues: [],
					nextActions: []
				}
			};
			const result = swarmSynthesizeOutput.safeParse(invalidOutput);
			expect(result.success).toBe(false);
		});
	});

	describe("Handler registration", () => {
		it("should have registered the swarm.synthesize handler", () => {
			const handler = registry.getHandler("swarm.synthesize");
			expect(handler).toBeDefined();
			expect(handler?.config.event).toBe("swarm.synthesize");
		});

		it("should have MCP metadata configured", () => {
			const handler = registry.getHandler("swarm.synthesize");
			expect(handler?.config.mcp).toBeDefined();
			expect(handler?.config.mcp?.title).toBe("Synthesize Swarm Progress");
			expect(handler?.config.mcp?.metadata?.tags).toContain("swarm");
			expect(handler?.config.mcp?.metadata?.tags).toContain("synthesis");
			expect(handler?.config.mcp?.metadata?.tags).toContain("integration");
		});

		it("should have persistence enabled", () => {
			const handler = registry.getHandler("swarm.synthesize");
			expect(handler?.config.persist).toBe(true);
		});

		it("should have rate limiting configured", () => {
			const handler = registry.getHandler("swarm.synthesize");
			expect(handler?.config.rateLimit).toBe(10);
		});
	});

	describe("JSONRPC compliance", () => {
		it("should accept JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "swarm.synthesize",
				params: {
					taskId: "t-123",
					completedSubtasks: [
						{
							id: "st-1",
							specialist: "frontend",
							output: "Component created"
						}
					],
					parentTask: "Create feature"
				},
				id: "req-789"
			};
			
			// Validate params match input schema
			const result = swarmSynthesizeInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", () => {
			const response = {
				taskId: "t-123",
				integration: {
					status: "integrated",
					integrationSteps: ["Step 1", "Step 2"],
					potentialIssues: [],
					nextActions: []
				}
			};
			
			// Validate response matches output schema
			const result = swarmSynthesizeOutput.safeParse(response);
			expect(result.success).toBe(true);
		});
	});
});