import { describe, it, expect, beforeAll, afterAll, mock } from "bun:test";
import { SamplingService, getSamplingService } from "@/core/sampling";
import { registry } from "@/core/registry";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Swarm Sampling Integration Test
// Tests the integration between SamplingService and MCP for LLM-based decisions

describe("Integration: Swarm Sampling Service", () => {
	let samplingService: SamplingService;
	let mockMcpServer: any;

	beforeAll(async () => {
		await setupIntegrationTest();
		
		// Get sampling service instance
		samplingService = getSamplingService();
		
		// Create a mock MCP server for testing
		mockMcpServer = {
			server: {
				createMessage: mock(async (params: any) => {
					// Simulate LLM responses based on the prompt content
					const prompt = params.messages[0].content.text;
					
					if (prompt.includes("decompose")) {
						return {
							content: {
								type: "text",
								text: JSON.stringify({
									subtasks: [
										{
											id: "st-test-1",
											description: "Frontend implementation",
											specialist: "frontend",
											complexity: 6,
											estimatedMinutes: 120,
											dependencies: [],
											context: {
												files: ["src/components/Test.tsx"],
												patterns: ["React"],
												constraints: []
											}
										},
										{
											id: "st-test-2",
											description: "Backend API",
											specialist: "backend",
											complexity: 4,
											estimatedMinutes: 90,
											dependencies: [],
											context: {
												files: ["api/test.ts"],
												patterns: ["REST"],
												constraints: []
											}
										}
									],
									executionStrategy: "parallel",
									totalComplexity: 10,
									reasoning: "Frontend and backend can be developed in parallel"
								})
							}
						};
					} else if (prompt.includes("specialist context")) {
						return {
							content: {
								type: "text",
								text: JSON.stringify({
									taskId: "t-test",
									description: "Implement test feature",
									scope: "Create a test component",
									mandatoryReadings: [
										{ title: "Component Guide", path: "docs/components.md" }
									],
									architectureConstraints: ["Use existing patterns"],
									successCriteria: ["Component renders correctly"]
								})
							}
						};
					} else if (prompt.includes("conflict")) {
						return {
							content: {
								type: "text",
								text: JSON.stringify({
									chosenSolution: "Solution 1",
									instanceId: "specialist-1",
									justification: "Better fits the architecture",
									recommendations: ["Consider performance"],
									modifications: []
								})
							}
						};
					} else if (prompt.includes("synthesis")) {
						return {
							content: {
								type: "text",
								text: JSON.stringify({
									status: "integrated",
									integrationSteps: ["Merge components", "Connect APIs"],
									potentialIssues: [],
									nextActions: [],
									mergedCode: "// Integrated solution"
								})
							}
						};
					}
					
					// Default response
					return {
						content: {
							type: "text",
							text: JSON.stringify({ status: "success" })
						}
					};
				})
			}
		};
		
		// Register the mock server
		(samplingService as any).mcpServers.set("test-session", mockMcpServer);
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
		(samplingService as any).mcpServers.clear();
	});

	describe("Task Decomposition", () => {
		it("should request decomposition via MCP sampling", async () => {
			const result = await samplingService.requestDecomposition(
				"test-session",
				"Implement dark mode toggle",
				{
					specialists: [
						{ id: "specialist-1", type: "frontend", currentLoad: 2, maxCapacity: 5, capabilities: ["react"] },
						{ id: "specialist-2", type: "backend", currentLoad: 1, maxCapacity: 5, capabilities: ["node"] }
					],
					priority: 75,
					constraints: ["Use existing theme system"]
				}
			);

			expect(result).toBeDefined();
			expect(result.subtasks).toHaveLength(2);
			expect(result.subtasks[0].specialist).toBe("frontend");
			expect(result.subtasks[1].specialist).toBe("backend");
			expect(result.executionStrategy).toBe("parallel");
			
			// Verify MCP server was called
			expect(mockMcpServer.server.createMessage).toHaveBeenCalled();
		});

		it("should handle decomposition with dependencies", async () => {
			// Override mock for this test
			mockMcpServer.server.createMessage.mockImplementationOnce(async () => ({
				content: {
					type: "text",
					text: JSON.stringify({
						subtasks: [
							{
								id: "st-1",
								description: "Setup infrastructure",
								specialist: "backend",
								complexity: 5,
								estimatedMinutes: 60,
								dependencies: [],
								context: { files: [], patterns: [], constraints: [] }
							},
							{
								id: "st-2",
								description: "Build UI",
								specialist: "frontend",
								complexity: 6,
								estimatedMinutes: 120,
								dependencies: ["st-1"],
								context: { files: [], patterns: [], constraints: [] }
							},
							{
								id: "st-3",
								description: "Write tests",
								specialist: "testing",
								complexity: 4,
								estimatedMinutes: 90,
								dependencies: ["st-1", "st-2"],
								context: { files: [], patterns: [], constraints: [] }
							}
						],
						executionStrategy: "sequential",
						totalComplexity: 15,
						reasoning: "Infrastructure must be ready before UI and tests"
					})
				}
			}));

			const result = await samplingService.requestDecomposition(
				"test-session",
				"Build complete feature",
				{
					specialists: [],
					priority: 80
				}
			);

			expect(result.subtasks).toHaveLength(3);
			expect(result.subtasks[2].dependencies).toContain("st-1");
			expect(result.subtasks[2].dependencies).toContain("st-2");
			expect(result.executionStrategy).toBe("sequential");
		});
	});

	describe("Context Generation", () => {
		it("should generate specialist context via MCP", async () => {
			const result = await samplingService.generateContext(
				"test-session",
				"st-123",
				"frontend",
				{
					id: "st-123",
					description: "Create UI component",
					specialist: "frontend",
					dependencies: []
				}
			);

			expect(result).toBeDefined();
			expect(result.taskId).toBe("t-test");
			expect(result.description).toContain("test feature");
			expect(result.mandatoryReadings).toHaveLength(1);
			expect(result.architectureConstraints).toHaveLength(1);
			expect(result.successCriteria).toHaveLength(1);
		});

		it("should include related work in context", async () => {
			const result = await samplingService.generateContext(
				"test-session",
				"st-456",
				"backend",
				{
					id: "st-456",
					description: "Create API endpoint",
					specialist: "backend",
					dependencies: [],
					relatedWork: [
						{
							instanceId: "specialist-1",
							status: "completed",
							output: "Database schema created"
						}
					]
				}
			);

			expect(result).toBeDefined();
			expect(result.scope).toContain("test component");
		});
	});

	describe("Conflict Resolution", () => {
		it("should resolve conflicts via MCP sampling", async () => {
			const result = await samplingService.resolveConflict(
				"test-session",
				{
					solutions: [
						{
							instanceId: "specialist-1",
							approach: "Use hooks",
							reasoning: "Modern React pattern",
							code: "useState()"
						},
						{
							instanceId: "specialist-2",
							approach: "Use Redux",
							reasoning: "Better state management",
							code: "dispatch()"
						}
					],
					context: {
						projectType: "React application",
						requirements: ["State persistence", "Performance"],
						constraints: ["Bundle size limit"]
					}
				}
			);

			expect(result).toBeDefined();
			expect(result.chosenSolution).toBe("Solution 1");
			expect(result.instanceId).toBe("specialist-1");
			expect(result.justification).toContain("architecture");
			expect(result.recommendations).toHaveLength(1);
		});
	});

	describe("Progress Synthesis", () => {
		it("should synthesize completed work via MCP", async () => {
			const result = await samplingService.synthesizeProgress(
				"test-session",
				{
					completedSubtasks: [
						{
							id: "st-1",
							specialist: "frontend",
							output: "UI component completed",
							artifacts: ["Component.tsx"]
						},
						{
							id: "st-2",
							specialist: "backend",
							output: "API endpoint ready",
							artifacts: ["api/endpoint.ts"]
						}
					],
					parentTask: "Implement feature X"
				}
			);

			expect(result).toBeDefined();
			expect(result.status).toBe("integrated");
			expect(result.integrationSteps).toContain("Merge components");
			expect(result.integrationSteps).toContain("Connect APIs");
			expect(result.potentialIssues).toHaveLength(0);
			expect(result.mergedCode).toContain("Integrated solution");
		});

		it("should identify integration issues", async () => {
			// Override mock for this test
			mockMcpServer.server.createMessage.mockImplementationOnce(async () => ({
				content: {
					type: "text",
					text: JSON.stringify({
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
					})
				}
			}));

			const result = await samplingService.synthesizeProgress(
				"test-session",
				{
					completedSubtasks: [
						{
							id: "st-3",
							specialist: "frontend",
							output: "Component with wrong types"
						}
					],
					parentTask: "Feature with issues"
				}
			);

			expect(result.status).toBe("requires_fixes");
			expect(result.potentialIssues).toHaveLength(2);
			expect(result.nextActions).toHaveLength(2);
		});
	});

	describe("Error Handling", () => {
		it("should handle MCP server errors gracefully", async () => {
			// Create a failing mock
			const failingMock = {
				server: {
					createMessage: mock(async () => {
						throw new Error("MCP server error");
					})
				}
			};
			
			(samplingService as any).mcpServers.set("failing-session", failingMock);

			await expect(
				samplingService.requestDecomposition(
					"failing-session",
					"Test task",
					{ specialists: [], priority: 50 }
				)
			).rejects.toThrow("MCP server error");
		});

		it("should handle invalid JSON responses", async () => {
			// Create a mock that returns invalid JSON
			const invalidMock = {
				server: {
					createMessage: mock(async () => ({
						content: {
							type: "text",
							text: "Not valid JSON {]}"
						}
					}))
				}
			};
			
			(samplingService as any).mcpServers.set("invalid-session", invalidMock);

			await expect(
				samplingService.requestDecomposition(
					"invalid-session",
					"Test task",
					{ specialists: [], priority: 50 }
				)
			).rejects.toThrow();
		});

		it("should handle missing session gracefully", async () => {
			await expect(
				samplingService.requestDecomposition(
					"non-existent-session",
					"Test task",
					{ specialists: [], priority: 50 }
				)
			).rejects.toThrow("No MCP server found for session");
		});
	});

	describe("Metrics Tracking", () => {
		it("should track sampling metrics", async () => {
			const redis = (samplingService as any).redis;
			
			// Get initial count
			const initialCount = await redis.pub.get("cb:metrics:sampling:requests") || "0";
			
			// Make a request
			await samplingService.requestDecomposition(
				"test-session",
				"Test task",
				{ specialists: [], priority: 50 }
			);
			
			// Check metrics were incremented
			const newCount = await redis.pub.get("cb:metrics:sampling:requests");
			expect(Number(newCount)).toBe(Number(initialCount) + 1);
			
			// Check latency was recorded
			const latency = await redis.pub.lrange("cb:metrics:sampling:latency", 0, 0);
			expect(latency).toHaveLength(1);
			expect(Number(latency[0])).toBeGreaterThan(0);
		});
	});
});