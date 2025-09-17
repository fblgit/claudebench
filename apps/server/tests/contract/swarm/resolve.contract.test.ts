import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { swarmResolveInput, swarmResolveOutput } from "@/schemas/swarm.schema";
import { registry } from "@/core/registry";
import { setupContractTest, cleanupContractTest } from "../../helpers/test-setup";

// Import all handlers to register them
import "@/handlers";

describe("Contract Validation: swarm.resolve", () => {
	let redis: any;

	beforeAll(async () => {
		redis = await setupContractTest();
	});

	afterAll(async () => {
		await cleanupContractTest();
	});

	describe("Schema validation", () => {
		it("should validate input schema", () => {
			// Valid input with minimum solutions (2)
			const validInput = {
				conflictId: "conflict-t-123-1234567890",
				solutions: [
					{
						instanceId: "specialist-1",
						approach: "Use React hooks",
						reasoning: "Modern and efficient"
					},
					{
						instanceId: "specialist-2",
						approach: "Use Redux",
						reasoning: "Better for complex state"
					}
				],
				context: {
					projectType: "React application",
					requirements: ["Dark mode toggle", "Persistent state"]
				}
			};
			const result = swarmResolveInput.safeParse(validInput);
			expect(result.success).toBe(true);

			// With optional code field
			const withCode = {
				...validInput,
				solutions: [
					{
						instanceId: "specialist-1",
						approach: "Use React hooks",
						reasoning: "Modern pattern",
						code: "const [theme, setTheme] = useState('light');"
					},
					{
						instanceId: "specialist-2",
						approach: "Use Redux",
						reasoning: "Scalable",
						code: "dispatch(setTheme('light'));"
					}
				]
			};
			const result2 = swarmResolveInput.safeParse(withCode);
			expect(result2.success).toBe(true);

			// With optional constraints
			const withConstraints = {
				...validInput,
				context: {
					...validInput.context,
					constraints: ["Minimize bundle size", "No external dependencies"]
				}
			};
			const result3 = swarmResolveInput.safeParse(withConstraints);
			expect(result3.success).toBe(true);
		});

		it("should reject invalid inputs", () => {
			const invalidInputs = [
				// Empty conflictId
				{
					conflictId: "",
					solutions: [{instanceId: "s1", approach: "A", reasoning: "R"}],
					context: { projectType: "React", requirements: [] }
				},
				// Only one solution (minimum is 2)
				{
					conflictId: "conflict-123",
					solutions: [{instanceId: "s1", approach: "A", reasoning: "R"}],
					context: { projectType: "React", requirements: [] }
				},
				// Missing required fields in solution
				{
					conflictId: "conflict-123",
					solutions: [
						{instanceId: "s1", approach: "A"}, // Missing reasoning
						{instanceId: "s2", approach: "B", reasoning: "R"}
					],
					context: { projectType: "React", requirements: [] }
				},
				// Missing context
				{
					conflictId: "conflict-123",
					solutions: [
						{instanceId: "s1", approach: "A", reasoning: "R1"},
						{instanceId: "s2", approach: "B", reasoning: "R2"}
					]
				}
			];

			for (const input of invalidInputs) {
				const result = swarmResolveInput.safeParse(input);
				expect(result.success).toBe(false);
			}
		});

		it("should validate output schema", () => {
			const validOutput = {
				conflictId: "conflict-t-123-1234567890",
				resolution: {
					chosenSolution: "React hooks approach",
					instanceId: "specialist-1",
					justification: "Better fits project architecture",
					recommendations: [
						"Use context for theme state",
						"Implement localStorage persistence"
					]
				}
			};
			const result = swarmResolveOutput.safeParse(validOutput);
			expect(result.success).toBe(true);

			// With optional modifications
			const withModifications = {
				...validOutput,
				resolution: {
					...validOutput.resolution,
					modifications: [
						"Add error handling",
						"Include loading state"
					]
				}
			};
			const result2 = swarmResolveOutput.safeParse(withModifications);
			expect(result2.success).toBe(true);
		});
	});

	describe("Handler registration", () => {
		it("should have registered the swarm.resolve handler", () => {
			const handler = registry.getHandler("swarm.resolve");
			expect(handler).toBeDefined();
			expect(handler?.config.event).toBe("swarm.resolve");
		});

		it("should have MCP metadata configured", () => {
			const handler = registry.getHandler("swarm.resolve");
			expect(handler?.config.mcp).toBeDefined();
			expect(handler?.config.mcp?.title).toBe("Resolve Swarm Conflict");
			expect(handler?.config.mcp?.metadata?.tags).toContain("swarm");
			expect(handler?.config.mcp?.metadata?.tags).toContain("conflict");
			expect(handler?.config.mcp?.metadata?.tags).toContain("resolution");
		});

		it("should have persistence enabled", () => {
			const handler = registry.getHandler("swarm.resolve");
			expect(handler?.config.persist).toBe(true);
		});

		it("should have rate limiting configured", () => {
			const handler = registry.getHandler("swarm.resolve");
			expect(handler?.config.rateLimit).toBe(20);
		});
	});

	describe("JSONRPC compliance", () => {
		it("should accept JSONRPC request format", () => {
			const request = {
				jsonrpc: "2.0",
				method: "swarm.resolve",
				params: {
					conflictId: "conflict-123",
					solutions: [
						{
							instanceId: "s1",
							approach: "Approach 1",
							reasoning: "Reason 1"
						},
						{
							instanceId: "s2",
							approach: "Approach 2",
							reasoning: "Reason 2"
						}
					],
					context: {
						projectType: "Web app",
						requirements: ["Requirement 1"]
					}
				},
				id: "req-456"
			};
			
			// Validate params match input schema
			const result = swarmResolveInput.safeParse(request.params);
			expect(result.success).toBe(true);
		});

		it("should produce JSONRPC response format", () => {
			const response = {
				conflictId: "conflict-123",
				resolution: {
					chosenSolution: "Solution 1",
					instanceId: "specialist-1",
					justification: "Best fit",
					recommendations: ["Recommendation 1"]
				}
			};
			
			// Validate response matches output schema
			const result = swarmResolveOutput.safeParse(response);
			expect(result.success).toBe(true);
		});
	});
});