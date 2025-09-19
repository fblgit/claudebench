import { describe, it, expect, beforeAll, afterAll, mock, beforeEach } from "bun:test";
import { ClaudeSamplingService, getSamplingService } from "@/core/sampling";
import { registry } from "@/core/registry";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Swarm Sampling Integration Test
// Tests the ClaudeSamplingService with mocked HTTP responses

describe("Integration: Swarm Sampling Service", () => {
	let samplingService: ClaudeSamplingService;
	let originalFetch: typeof global.fetch;
	let fetchMock: any;

	// Pre-recorded responses from the inference server
	// These would be captured from a real run and stored here
	const MOCK_RESPONSES = {
		decomposition: {
			subtasks: [
				{
					id: "st-1",
					description: "Design and implement user authentication system with JWT tokens",
					specialist: "backend",
					dependencies: [],
					complexity: 7,
					context: {
						files: ["src/auth/auth.controller.ts", "src/auth/auth.service.ts"],
						patterns: ["JWT authentication", "middleware pattern"],
						constraints: ["Secure token storage"]
					},
					estimatedMinutes: 180
				},
				{
					id: "st-2",
					description: "Create login and registration UI components",
					specialist: "frontend",
					dependencies: ["st-1"],
					complexity: 5,
					context: {
						files: ["src/components/Login.tsx", "src/components/Register.tsx"],
						patterns: ["React hooks", "form validation"],
						constraints: ["Mobile responsive"]
					},
					estimatedMinutes: 120
				},
				{
					id: "st-3",
					description: "Write comprehensive tests for authentication flow",
					specialist: "testing",
					dependencies: ["st-1", "st-2"],
					complexity: 4,
					context: {
						files: ["tests/auth.test.ts", "tests/e2e/login.spec.ts"],
						patterns: ["unit testing", "E2E testing"],
						constraints: ["90% coverage minimum"]
					},
					estimatedMinutes: 90
				}
			],
			executionStrategy: "sequential",
			totalComplexity: 16,
			reasoning: "Authentication backend must be ready before frontend can integrate, and tests require both to be complete"
		},
		
		context: {
			taskId: "st-1",
			description: "Design and implement a secure JWT-based authentication system with proper token management and refresh mechanisms",
			scope: "In scope: JWT generation, validation, refresh tokens, password hashing. Out of scope: OAuth providers, 2FA",
			mandatoryReadings: [
				{ title: "JWT Best Practices", path: "/docs/security/jwt.md" },
				{ title: "Authentication Architecture", path: "/docs/architecture/auth.md" }
			],
			architectureConstraints: [
				"Use existing database schema",
				"Follow REST API conventions",
				"Implement rate limiting"
			],
			relatedWork: [
				{
					instanceId: "worker-db",
					status: "completed",
					summary: "Database schema for users table created"
				}
			],
			successCriteria: [
				"Secure token generation and validation",
				"Proper password hashing with bcrypt",
				"Token refresh mechanism working",
				"Rate limiting on auth endpoints"
			]
		},
		
		resolution: {
			chosenSolution: "Use React Context with useReducer for state management",
			instanceId: "spec-frontend-1",
			justification: "React Context with useReducer provides sufficient state management for our scale while keeping bundle size small. It's built into React, requires no additional dependencies, and the team is already familiar with it.",
			recommendations: [
				"Implement proper TypeScript types for all actions",
				"Add middleware pattern for logging",
				"Consider adding Redux DevTools connector for debugging"
			],
			modifications: [
				"Add error boundary around context provider",
				"Implement persistence layer for offline support"
			]
		},
		
		integration: {
			status: "ready_for_integration",
			integrationSteps: [
				"1. Merge backend authentication API into main branch",
				"2. Update frontend components to use auth endpoints",
				"3. Configure environment variables for JWT secrets",
				"4. Run database migrations for user tables",
				"5. Deploy backend services first, then frontend"
			],
			potentialIssues: [
				"CORS configuration needs updating for auth headers",
				"Frontend token refresh logic needs testing with slow networks"
			],
			nextActions: [
				"Performance test auth endpoints under load",
				"Security audit of JWT implementation",
				"Add monitoring for failed login attempts"
			],
			mergedCode: undefined
		}
	};

	beforeAll(async () => {
		await setupIntegrationTest();
		
		// Get sampling service instance
		samplingService = getSamplingService();
		
		// Save original fetch
		originalFetch = global.fetch;
	});

	beforeEach(() => {
		// Create fetch mock for each test
		fetchMock = mock((url: string, options?: any) => {
			const urlStr = url.toString();
			
			// Mock health check
			if (urlStr.includes('/health')) {
				return Promise.resolve({
					ok: true,
					json: async () => ({
						status: "healthy",
						service: "claudebench-inference",
						version: "0.1.0"
					})
				});
			}
			
			// Mock decomposition endpoint
			if (urlStr.includes('/api/v1/decompose')) {
				return Promise.resolve({
					ok: true,
					json: async () => MOCK_RESPONSES.decomposition,
					text: async () => JSON.stringify(MOCK_RESPONSES.decomposition)
				});
			}
			
			// Mock context endpoint
			if (urlStr.includes('/api/v1/context')) {
				return Promise.resolve({
					ok: true,
					json: async () => MOCK_RESPONSES.context,
					text: async () => JSON.stringify(MOCK_RESPONSES.context)
				});
			}
			
			// Mock resolve endpoint
			if (urlStr.includes('/api/v1/resolve')) {
				return Promise.resolve({
					ok: true,
					json: async () => MOCK_RESPONSES.resolution,
					text: async () => JSON.stringify(MOCK_RESPONSES.resolution)
				});
			}
			
			// Mock synthesize endpoint
			if (urlStr.includes('/api/v1/synthesize')) {
				return Promise.resolve({
					ok: true,
					json: async () => MOCK_RESPONSES.integration,
					text: async () => JSON.stringify(MOCK_RESPONSES.integration)
				});
			}
			
			// Default 404 for unknown endpoints
			return Promise.resolve({
				ok: false,
				status: 404,
				text: async () => "Not found"
			});
		});
		
		// Replace global fetch with mock
		global.fetch = fetchMock as any;
	});

	afterAll(async () => {
		// Restore original fetch
		global.fetch = originalFetch;
		await cleanupIntegrationTest();
	});

	describe("Health Check", () => {
		it("should check inference server health", async () => {
			const isHealthy = await samplingService.checkHealth();
			
			expect(isHealthy).toBe(true);
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/health"),
				expect.any(Object)
			);
		});
		
		it("should handle health check failures gracefully", async () => {
			// Override mock for this test
			global.fetch = mock(() => Promise.reject(new Error("Connection refused"))) as any;
			
			const isHealthy = await samplingService.checkHealth();
			expect(isHealthy).toBe(false);
		});
	});

	describe("Task Decomposition", () => {
		it("should request decomposition via HTTP", async () => {
			const result = await samplingService.requestDecomposition(
				"test-session",
				"Implement user authentication with JWT",
				{
					specialists: [
						{ id: "spec-1", type: "backend", currentLoad: 2, maxCapacity: 5, capabilities: ["node", "jwt"] },
						{ id: "spec-2", type: "frontend", currentLoad: 1, maxCapacity: 5, capabilities: ["react"] }
					],
					priority: 75,
					constraints: ["Use existing database", "Mobile responsive"]
				}
			);

			expect(result).toBeDefined();
			expect(result.subtasks).toHaveLength(3);
			expect(result.subtasks[0].specialist).toBe("backend");
			expect(result.subtasks[1].specialist).toBe("frontend");
			expect(result.subtasks[2].specialist).toBe("testing");
			expect(result.executionStrategy).toBe("sequential");
			expect(result.totalComplexity).toBe(16);
			
			// Verify HTTP call was made correctly
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/api/v1/decompose"),
				expect.objectContaining({
					method: "POST",
					headers: expect.objectContaining({
						"Content-Type": "application/json"
					})
				})
			);
		});

		it("should validate decomposition response structure", async () => {
			// Test with invalid response
			global.fetch = mock(() => Promise.resolve({
				ok: true,
				json: async () => ({ invalid: "structure" })
			})) as any;
			
			await expect(
				samplingService.requestDecomposition("test", "task", { specialists: [], priority: 50 })
			).rejects.toThrow();
		});

		it("should handle network errors with retry", async () => {
			let attemptCount = 0;
			global.fetch = mock(() => {
				attemptCount++;
				if (attemptCount < 3) {
					return Promise.reject(new Error("Network error"));
				}
				return Promise.resolve({
					ok: true,
					json: async () => MOCK_RESPONSES.decomposition
				});
			}) as any;
			
			const result = await samplingService.requestDecomposition(
				"test-session",
				"Test task",
				{ specialists: [], priority: 50 }
			);
			
			expect(result).toBeDefined();
			expect(attemptCount).toBe(3); // Should retry twice before succeeding
		});
	});

	describe("Context Generation", () => {
		it("should generate specialist context via HTTP", async () => {
			const result = await samplingService.generateContext(
				"test-session",
				"st-1",
				"backend",
				{
					description: "Create authentication API",
					dependencies: [],
					context: { files: [], patterns: [], constraints: [] }
				}
			);

			expect(result).toBeDefined();
			expect(result.taskId).toBe("st-1");
			expect(result.mandatoryReadings).toHaveLength(2);
			expect(result.architectureConstraints).toHaveLength(3);
			expect(result.successCriteria).toHaveLength(4);
			expect(result.relatedWork).toHaveLength(1);
			
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/api/v1/context"),
				expect.any(Object)
			);
		});
	});

	describe("Conflict Resolution", () => {
		it("should resolve conflicts via HTTP", async () => {
			const result = await samplingService.resolveConflict(
				"test-session",
				{
					solutions: [
						{
							instanceId: "spec-frontend-1",
							approach: "Use React Context",
							reasoning: "Simpler, built-in solution",
							code: "const Context = React.createContext();"
						},
						{
							instanceId: "spec-frontend-2",
							approach: "Use Redux",
							reasoning: "More scalable",
							code: "const store = createStore();"
						}
					],
					context: {
						projectType: "React SPA",
						requirements: ["State management", "Type safety"],
						constraints: ["Small bundle size"]
					}
				}
			);

			expect(result).toBeDefined();
			expect(result.instanceId).toBe("spec-frontend-1");
			expect(result.chosenSolution).toContain("React Context");
			expect(result.justification).toContain("bundle size");
			expect(result.recommendations).toHaveLength(3);
			expect(result.modifications).toHaveLength(2);
		});
	});

	describe("Progress Synthesis", () => {
		it("should synthesize completed work via HTTP", async () => {
			const result = await samplingService.synthesizeProgress(
				"test-session",
				{
					completedSubtasks: [
						{
							id: "st-1",
							specialist: "backend",
							output: "Authentication API implemented",
							artifacts: ["src/auth/"]
						},
						{
							id: "st-2",
							specialist: "frontend",
							output: "Login UI completed",
							artifacts: ["src/components/Login.tsx"]
						}
					],
					parentTask: "Implement authentication system"
				}
			);

			expect(result).toBeDefined();
			expect(result.status).toBe("ready_for_integration");
			expect(result.integrationSteps).toHaveLength(5);
			expect(result.potentialIssues).toHaveLength(2);
			expect(result.nextActions).toHaveLength(3);
			
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining("/api/v1/synthesize"),
				expect.any(Object)
			);
		});
	});

	describe("Error Handling", () => {
		it("should handle 500 errors from inference server", async () => {
			global.fetch = mock(() => Promise.resolve({
				ok: false,
				status: 500,
				text: async () => "Internal server error"
			})) as any;
			
			await expect(
				samplingService.requestDecomposition("test", "task", { specialists: [], priority: 50 })
			).rejects.toThrow("Inference server error (500)");
		});

		it("should handle timeout errors", async () => {
			// This will timeout immediately
			global.fetch = mock(() => new Promise((_, reject) => {
				setTimeout(() => reject(new Error("AbortError")), 10);
			})) as any;
			
			await expect(
				samplingService.requestDecomposition("test", "task", { specialists: [], priority: 50 })
			).rejects.toThrow();
		});
	});

	describe("Statistics", () => {
		it("should fetch inference server statistics", async () => {
			global.fetch = mock((url: string) => {
				if (url.includes('/api/v1/stats')) {
					return Promise.resolve({
						ok: true,
						json: async () => ({
							uptime: 1000,
							sampling_stats: {
								total_requests: 100,
								successful_requests: 95,
								failed_requests: 5
							}
						})
					});
				}
				return Promise.resolve({ ok: false });
			}) as any;
			
			const stats = await samplingService.getStats();
			
			expect(stats).toBeDefined();
			expect(stats.uptime).toBe(1000);
			expect(stats.sampling_stats.total_requests).toBe(100);
		});
	});
});