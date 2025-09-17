import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import nunjucks from "nunjucks";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Swarm Templates Integration Test
// Tests Nunjucks template rendering with various edge cases and data scenarios

describe("Integration: Swarm Templates", () => {
	let templates: nunjucks.Environment;

	beforeAll(async () => {
		await setupIntegrationTest();
		
		// Flush all ClaudeBench data to ensure clean state
		const { registry } = await import("@/core/registry");
		await registry.executeHandler("system.flush", {
			confirm: "FLUSH_ALL_DATA",
			includePostgres: true
		});
		
		// Configure nunjucks with path relative to this test file
		const __filename = fileURLToPath(import.meta.url);
		const __dirname = dirname(__filename);
		const templatePath = join(__dirname, "..", "..", "src", "templates", "swarm");
		
		templates = nunjucks.configure(templatePath, {
			autoescape: true,
			noCache: true
		});
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	describe("Decomposition Template", () => {
		it("should render decomposition template with basic data", () => {
			const data = {
				task: "Implement dark mode toggle",
				specialists: [
					{ id: "s1", type: "frontend", currentLoad: 2, maxCapacity: 5, capabilities: ["react"] }
				],
				priority: 75,
				constraints: ["Use existing theme"]
			};

			const result = templates.render("decomposition.njk", data);
			
			expect(result).toContain("Implement dark mode toggle");
			expect(result).toContain("Priority: 75");
			expect(result).toContain("Use existing theme");
		});

		it("should handle empty specialists array", () => {
			const data = {
				task: "Test task",
				specialists: [],
				priority: 50
			};

			const result = templates.render("decomposition.njk", data);
			expect(result).toContain("Test task");
			expect(result).not.toContain("undefined");
		});

		it("should escape HTML in task descriptions", () => {
			const data = {
				task: "Implement <script>alert('XSS')</script> feature",
				specialists: [],
				priority: 50
			};

			const result = templates.render("decomposition.njk", data);
			expect(result).not.toContain("<script>");
			expect(result).toContain("&lt;script&gt;");
		});

		it("should handle complex nested data", () => {
			const data = {
				task: "Complex feature",
				specialists: [
					{
						id: "s1",
						type: "frontend",
						currentLoad: 2,
						maxCapacity: 5,
						capabilities: ["react", "typescript", "css"]
					},
					{
						id: "s2",
						type: "backend",
						currentLoad: 1,
						maxCapacity: 5,
						capabilities: ["node", "express", "postgresql"]
					}
				],
				priority: 90,
				constraints: [
					"Performance critical",
					"Must support IE11",
					"Accessibility compliant"
				]
			};

			const result = templates.render("decomposition.njk", data);
			
			// Should include all specialists
			expect(result).toContain("frontend");
			expect(result).toContain("backend");
			
			// Should include all constraints
			expect(result).toContain("Performance critical");
			expect(result).toContain("Must support IE11");
			expect(result).toContain("Accessibility compliant");
		});
	});

	describe("Specialist Context Template", () => {
		it("should render specialist context with all sections", () => {
			const data = {
				subtaskId: "st-123",
				specialist: "frontend",
				description: "Create toggle component",
				dependencies: [],
				constraints: ["Use React hooks", "Follow atomic design"]
			};

			const result = templates.render("specialist-context.njk", data);
			
			expect(result).toContain("Create toggle component");
			expect(result).toContain("st-123");
			expect(result).toContain("frontend");
			expect(result).toContain("Use React hooks");
			expect(result).toContain("Follow atomic design");
		});

		it("should handle empty arrays gracefully", () => {
			const data = {
				subtaskId: "st-456",
				specialist: "backend",
				description: "Create API",
				dependencies: [],
				constraints: []
			};

			const result = templates.render("specialist-context.njk", data);
			
			expect(result).toContain("Create API");
			expect(result).not.toContain("undefined");
			expect(result).not.toContain("null");
		});
	});

	describe("Conflict Resolution Template", () => {
		it("should render conflict resolution with multiple solutions", () => {
			const data = {
				conflictId: "conflict-t-123-456789",
				solutions: [
					{
						instanceId: "specialist-1",
						approach: "Use React hooks",
						reasoning: "Modern and efficient",
						code: "const [theme, setTheme] = useState('light');"
					},
					{
						instanceId: "specialist-2",
						approach: "Use Redux",
						reasoning: "Better for complex state",
						code: "dispatch(setTheme('light'));"
					},
					{
						instanceId: "specialist-3",
						approach: "Use Context API",
						reasoning: "Built-in React solution",
						code: "<ThemeContext.Provider value={theme}>"
					}
				],
				projectType: "React SPA",
				requirements: [
					"Theme persistence",
					"Fast switching",
					"TypeScript support"
				],
				constraints: [
					"Bundle size < 200KB",
					"No external dependencies preferred"
				]
			};

			const result = templates.render("conflict-resolution.njk", data);
			
			// Should include all solutions
			expect(result).toContain("Use React hooks");
			expect(result).toContain("Use Redux");
			expect(result).toContain("Use Context API");
			
			// Should include reasoning
			expect(result).toContain("Modern and efficient");
			expect(result).toContain("Better for complex state");
			
			// Should include context
			expect(result).toContain("React SPA");
			expect(result).toContain("Theme persistence");
			expect(result).toContain("Bundle size");
		});

		it("should handle solutions without code", () => {
			const data = {
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
				projectType: "Web app",
				requirements: ["Requirement 1"],
				constraints: []
			};

			const result = templates.render("conflict-resolution.njk", data);
			
			expect(result).toContain("Approach 1");
			expect(result).toContain("Approach 2");
			expect(result).not.toContain("undefined");
		});
	});

	describe("Progress Synthesis Template", () => {
		it("should render synthesis with completed subtasks", () => {
			const data = {
				taskId: "t-123",
				parentTask: "Implement feature X",
				completedSubtasks: [
					{
						id: "st-1",
						specialist: "frontend",
						output: "Created React component with hooks",
						artifacts: [
							"components/Feature.tsx",
							"components/Feature.test.tsx"
						]
					},
					{
						id: "st-2",
						specialist: "backend",
						output: "Implemented REST API endpoints",
						artifacts: [
							"api/feature.ts",
							"api/feature.spec.ts"
						]
					},
					{
						id: "st-3",
						specialist: "testing",
						output: "Added E2E tests",
						artifacts: [
							"e2e/feature.test.ts"
						]
					}
				],
				timestamp: "2024-01-15T10:30:00.000Z"
			};

			const result = templates.render("progress-synthesis.njk", data);
			
			// Should include parent task
			expect(result).toContain("Implement feature X");
			
			// Should include all subtasks
			expect(result).toContain("Created React component");
			expect(result).toContain("Implemented REST API");
			expect(result).toContain("Added E2E tests");
			
			// Should include artifacts
			expect(result).toContain("components/Feature.tsx");
			expect(result).toContain("api/feature.ts");
			expect(result).toContain("e2e/feature.test.ts");
			
			// Should include specialist types
			expect(result).toContain("frontend");
			expect(result).toContain("backend");
			expect(result).toContain("testing");
		});

		it("should handle subtasks without artifacts", () => {
			const data = {
				taskId: "t-456",
				parentTask: "Simple task",
				completedSubtasks: [
					{
						id: "st-4",
						specialist: "docs",
						output: "Documentation updated"
					}
				],
				timestamp: new Date().toISOString()
			};

			const result = templates.render("progress-synthesis.njk", data);
			
			expect(result).toContain("Documentation updated");
			expect(result).not.toContain("undefined");
		});
	});

	describe("Specialist Prompt Template", () => {
		it("should render specialist prompt with full context", () => {
			const data = {
				taskId: "t-789",
				description: "Build authentication system",
				scope: "User login and registration",
				mandatoryReadings: [
					{ title: "Security Guide", path: "docs/security.md" }
				],
				architectureConstraints: [
					"Use JWT tokens",
					"Implement rate limiting"
				],
				relatedWork: [
					{
						instanceId: "specialist-db",
						status: "completed",
						summary: "Database schema ready"
					}
				],
				successCriteria: [
					"Secure password storage",
					"Session management",
					"OAuth integration"
				]
			};

			const result = templates.render("specialist-prompt.njk", data);
			
			expect(result).toContain("specialist working on");
			expect(result).toContain("Build authentication system");
			expect(result).toContain("User login and registration");
			expect(result).toContain("Security Guide");
			expect(result).toContain("Use JWT tokens");
			expect(result).toContain("Database schema ready");
			expect(result).toContain("Secure password storage");
		});
	});

	describe("Template Error Handling", () => {
		it("should handle missing template gracefully", () => {
			expect(() => {
				templates.render("non-existent.njk", {});
			}).toThrow();
		});

		it("should handle circular references in data", () => {
			const data: any = {
				task: "Test task",
				priority: 50,
				specialists: [],
				constraints: []
			};
			// Create circular reference
			data.self = data;

			// Nunjucks handles circular references gracefully - it should not throw
			const result = templates.render("decomposition.njk", data);
			expect(result).toContain("Test task");
			expect(result).toBeDefined();
		});

		it("should handle very large data sets", () => {
			const largeData = {
				task: "Large task",
				specialists: Array(1000).fill({
					id: "specialist",
					type: "general",
					currentLoad: 0,
					maxCapacity: 5,
					capabilities: ["test"]
				}),
				priority: 50,
				constraints: Array(100).fill("Constraint")
			};

			// Should not crash or timeout
			const result = templates.render("decomposition.njk", largeData);
			expect(result).toBeDefined();
			expect(result.length).toBeGreaterThan(0);
		});
	});
});