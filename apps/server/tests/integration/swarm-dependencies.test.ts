import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";
import { redisScripts } from "@/core/redis-scripts";
import { registry } from "@/core/registry";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Import handlers to register them
import "@/handlers";

// Swarm Dependencies Integration Test
// Tests dependency graph resolution and task unblocking mechanisms

describe("Integration: Swarm Dependency Resolution", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = await setupIntegrationTest();
		
		// Flush all ClaudeBench data to ensure clean state
		await registry.executeHandler("system.flush", {
			confirm: "FLUSH_ALL_DATA",
			includePostgres: true
		});
		
		// Register active specialists using the registry API
		await registry.executeHandler("system.register", {
			id: "specialist-frontend-1",
			roles: ["worker", "frontend"]
		});
		
		await registry.executeHandler("system.register", {
			id: "specialist-backend-1", 
			roles: ["worker", "backend"]
		});
		
		await registry.executeHandler("system.register", {
			id: "specialist-testing-1",
			roles: ["worker", "testing"]
		});
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	describe("Dependency Graph Creation", () => {
		it("should create proper dependency graph during decomposition", async () => {
			// Clear the queue before test to avoid interference
			await redis.pub.del(`cb:queue:subtasks`);
			
			const taskId = `t-deps-${Date.now()}`;
			
			const decomposition = {
				subtasks: [
					{
						id: "st-a",
						description: "Task A - Independent",
						specialist: "backend",
						complexity: 30,
						estimatedMinutes: 45,
						dependencies: [],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-b",
						description: "Task B - Independent",
						specialist: "frontend",
						complexity: 40,
						estimatedMinutes: 60,
						dependencies: [],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-c",
						description: "Task C - Depends on A",
						specialist: "backend",
						complexity: 35,
						estimatedMinutes: 50,
						dependencies: ["st-a"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-d",
						description: "Task D - Depends on A and B",
						specialist: "testing",
						complexity: 45,
						estimatedMinutes: 70,
						dependencies: ["st-a", "st-b"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-e",
						description: "Task E - Depends on C and D",
						specialist: "docs",
						complexity: 20,
						estimatedMinutes: 30,
						dependencies: ["st-c", "st-d"],
						context: { files: [], patterns: [], constraints: [] }
					}
				],
				executionStrategy: "mixed",
				totalComplexity: 170,
				reasoning: "Complex dependency chain for testing"
			};

			const result = await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				decomposition,
				Date.now()
			);

			expect(result.success).toBe(true);
			expect(result.subtaskCount).toBe(5);
			expect(result.queuedCount).toBe(2); // Only st-a and st-b are ready initially

			// Verify dependency graph structure (actual key pattern from Lua script)
			
			// st-c depends on st-a
			const stcDeps = await redis.pub.smembers(`cb:dependencies:${taskId}:st-c`);
			expect(stcDeps).toContain("st-a");
			expect(stcDeps).toHaveLength(1);
			
			// st-d depends on st-a and st-b
			const stdDeps = await redis.pub.smembers(`cb:dependencies:${taskId}:st-d`);
			expect(stdDeps).toContain("st-a");
			expect(stdDeps).toContain("st-b");
			expect(stdDeps).toHaveLength(2);
			
			// st-e depends on st-c and st-d
			const steDeps = await redis.pub.smembers(`cb:dependencies:${taskId}:st-e`);
			expect(steDeps).toContain("st-c");
			expect(steDeps).toContain("st-d");
			expect(steDeps).toHaveLength(2);
			
			// Verify ready queue only has independent tasks (actual key from Lua script)
			const readyQueue = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyQueue).toContain("st-a");
			expect(readyQueue).toContain("st-b");
			expect(readyQueue).not.toContain("st-c");
			expect(readyQueue).not.toContain("st-d");
			expect(readyQueue).not.toContain("st-e");
		});

		it("should detect circular dependencies", async () => {
			const taskId = `t-circular-${Date.now()}`;
			
			const circularDecomposition = {
				subtasks: [
					{
						id: "st-1",
						description: "Task 1",
						specialist: "general",
						complexity: 30,
						estimatedMinutes: 45,
						dependencies: ["st-3"], // Creates cycle: 1 -> 3 -> 2 -> 1
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-2",
						description: "Task 2",
						specialist: "general",
						complexity: 30,
						estimatedMinutes: 45,
						dependencies: ["st-1"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-3",
						description: "Task 3",
						specialist: "general",
						complexity: 30,
						estimatedMinutes: 45,
						dependencies: ["st-2"],
						context: { files: [], patterns: [], constraints: [] }
					}
				],
				executionStrategy: "sequential",
				totalComplexity: 90,
				reasoning: "Circular dependency test"
			};

			const result = await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				circularDecomposition,
				Date.now()
			);

			// Should handle circular dependencies gracefully
			// (In practice, this should be caught during decomposition validation)
			expect(result.success).toBe(true);
			expect(result.queuedCount).toBe(0); // No tasks can be queued due to circular deps
		});
	});

	describe("Progressive Unblocking", () => {
		it("should unblock tasks as dependencies complete", async () => {
			// Clear the queue before test to avoid interference
			await redis.pub.del(`cb:queue:subtasks`);
			const taskId = `t-unblock-${Date.now()}`;
			
			// Create a simple dependency chain: A -> B -> C
			const decomposition = {
				subtasks: [
					{
						id: "st-first",
						description: "First task",
						specialist: "backend",
						complexity: 30,
						estimatedMinutes: 30,
						dependencies: [],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-second",
						description: "Second task",
						specialist: "backend",
						complexity: 40,
						estimatedMinutes: 40,
						dependencies: ["st-first"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-third",
						description: "Third task",
						specialist: "backend",
						complexity: 50,
						estimatedMinutes: 50,
						dependencies: ["st-second"],
						context: { files: [], patterns: [], constraints: [] }
					}
				],
				executionStrategy: "sequential",
				totalComplexity: 120,
				reasoning: "Sequential dependency chain"
			};

			await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				decomposition,
				Date.now()
			);

			// Initially only st-first should be ready
			let readyQueue = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyQueue).toContain("st-first");
			expect(readyQueue).toHaveLength(1);

			// Complete st-first
			const result1 = await redisScripts.synthesizeProgress(
				taskId,
				"st-first",
				{ status: "completed", output: "First done" }
			);
			
			expect(result1.success).toBe(true);
			expect(result1.unblockedCount).toBe(1); // st-second unblocked
			
			// st-second should now be ready
			readyQueue = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyQueue).toContain("st-second");
			expect(readyQueue).not.toContain("st-first"); // Completed tasks removed
			
			// Complete st-second
			const result2 = await redisScripts.synthesizeProgress(
				taskId,
				"st-second",
				{ status: "completed", output: "Second done" }
			);
			
			expect(result2.success).toBe(true);
			expect(result2.unblockedCount).toBe(1); // st-third unblocked
			
			// st-third should now be ready
			readyQueue = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyQueue).toContain("st-third");
			
			// Complete st-third
			const result3 = await redisScripts.synthesizeProgress(
				taskId,
				"st-third",
				{ status: "completed", output: "Third done" }
			);
			
			expect(result3.success).toBe(true);
			expect(result3.readyForSynthesis).toBe(true); // All tasks complete
		});

		it("should handle complex multi-dependency unblocking", async () => {
			// Clear the queue before test to avoid interference
			await redis.pub.del(`cb:queue:subtasks`);
			const taskId = `t-complex-${Date.now()}`;
			
			// Diamond dependency pattern:
			//     A
			//    / \
			//   B   C
			//    \ /
			//     D
			const decomposition = {
				subtasks: [
					{
						id: "st-top",
						description: "Top",
						specialist: "general",
						complexity: 25,
						estimatedMinutes: 30,
						dependencies: [],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-left",
						description: "Left branch",
						specialist: "general",
						complexity: 30,
						estimatedMinutes: 35,
						dependencies: ["st-top"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-right",
						description: "Right branch",
						specialist: "general",
						complexity: 35,
						estimatedMinutes: 40,
						dependencies: ["st-top"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-bottom",
						description: "Bottom merge",
						specialist: "general",
						complexity: 40,
						estimatedMinutes: 45,
						dependencies: ["st-left", "st-right"],
						context: { files: [], patterns: [], constraints: [] }
					}
				],
				executionStrategy: "mixed",
				totalComplexity: 130,
				reasoning: "Diamond dependency pattern"
			};

			await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				decomposition,
				Date.now()
			);

			// Complete top
			await redisScripts.synthesizeProgress(
				taskId,
				"st-top",
				{ status: "completed", output: "Top done" }
			);
			
			// Both left and right should be ready
			const readyAfterTop = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyAfterTop).toContain("st-left");
			expect(readyAfterTop).toContain("st-right");
			expect(readyAfterTop).toHaveLength(2);
			
			// Complete left only
			await redisScripts.synthesizeProgress(
				taskId,
				"st-left",
				{ status: "completed", output: "Left done" }
			);
			
			// Bottom should NOT be ready yet (still waiting for right)
			const readyAfterLeft = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyAfterLeft).toContain("st-right");
			expect(readyAfterLeft).not.toContain("st-bottom");
			
			// Complete right
			const rightResult = await redisScripts.synthesizeProgress(
				taskId,
				"st-right",
				{ status: "completed", output: "Right done" }
			);
			
			expect(rightResult.unblockedCount).toBe(1); // Bottom unblocked
			
			// Bottom should now be ready
			const readyAfterRight = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyAfterRight).toContain("st-bottom");
			expect(readyAfterRight).toHaveLength(1);
		});
	});

	describe("Integration with Handlers", () => {
		it("should handle dependencies through full handler flow", async () => {
			// Mock MCP server for sampling
			const samplingService = (await import("@/core/sampling")).getSamplingService();
			const mockServer = {
				server: {
					createMessage: async () => ({
						content: {
							type: "text",
							text: JSON.stringify({
								subtasks: [
									{
										id: "st-handler-1",
										description: "Setup",
										specialist: "backend",
										complexity: 4,
										estimatedMinutes: 60,
										dependencies: [],
										context: { files: [], patterns: [], constraints: [] }
									},
									{
										id: "st-handler-2",
										description: "Implementation",
										specialist: "frontend",
										complexity: 6,
										estimatedMinutes: 90,
										dependencies: ["st-handler-1"],
										context: { files: [], patterns: [], constraints: [] }
									}
								],
								executionStrategy: "sequential",
								totalComplexity: 10,
								reasoning: "Setup must complete before implementation"
							})
						}
					})
				}
			};
			
			// The handler will use the current instance ID as session ID (worker-1)
			(samplingService as any).mcpServers.set("worker-1", mockServer);
			
			// Execute decomposition handler
			const decomposeResult = await registry.executeHandler(
				"swarm.decompose",
				{
					taskId: `t-handler-${Date.now()}`,
					task: "Test task with dependencies",
					priority: 60
				},
				"worker-1" // Pass session ID
			);
			
			expect(decomposeResult.subtaskCount).toBe(2);
			
			// Clean up
			(samplingService as any).mcpServers.delete("worker-1");
		});
	});

	describe("Edge Cases", () => {
		it("should handle task with no dependencies", async () => {
			const taskId = `t-nodeps-${Date.now()}`;
			
			const decomposition = {
				subtasks: [
					{
						id: "st-independent",
						description: "Standalone task",
						specialist: "general",
						complexity: 50,
						estimatedMinutes: 60,
						dependencies: [],
						context: { files: [], patterns: [], constraints: [] }
					}
				],
				executionStrategy: "sequential",
				totalComplexity: 50,
				reasoning: "Single independent task"
			};

			const result = await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				decomposition,
				Date.now()
			);

			expect(result.success).toBe(true);
			expect(result.queuedCount).toBe(1);
			
			// Complete the task
			const synthResult = await redisScripts.synthesizeProgress(
				taskId,
				"st-independent",
				{ status: "completed", output: "Done" }
			);
			
			expect(synthResult.readyForSynthesis).toBe(true);
		});

		it("should handle task with all dependencies on single task", async () => {
			// Clear the queue before test to avoid interference
			await redis.pub.del(`cb:queue:subtasks`);
			const taskId = `t-stardeps-${Date.now()}`;
			
			const decomposition = {
				subtasks: [
					{
						id: "st-center",
						description: "Central task",
						specialist: "general",
						complexity: 30,
						estimatedMinutes: 30,
						dependencies: [],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-ray1",
						description: "Dependent 1",
						specialist: "general",
						complexity: 20,
						estimatedMinutes: 20,
						dependencies: ["st-center"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-ray2",
						description: "Dependent 2",
						specialist: "general",
						complexity: 20,
						estimatedMinutes: 20,
						dependencies: ["st-center"],
						context: { files: [], patterns: [], constraints: [] }
					},
					{
						id: "st-ray3",
						description: "Dependent 3",
						specialist: "general",
						complexity: 20,
						estimatedMinutes: 20,
						dependencies: ["st-center"],
						context: { files: [], patterns: [], constraints: [] }
					}
				],
				executionStrategy: "mixed",
				totalComplexity: 90,
				reasoning: "Star dependency pattern"
			};

			await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				decomposition,
				Date.now()
			);

			// Complete center task
			const centerResult = await redisScripts.synthesizeProgress(
				taskId,
				"st-center",
				{ status: "completed", output: "Center done" }
			);
			
			// Should unblock all three dependent tasks
			expect(centerResult.unblockedCount).toBe(3);
			
			// All dependent tasks should be ready
			const readyQueue = await redis.pub.zrange(`cb:queue:subtasks`, 0, -1);
			expect(readyQueue).toContain("st-ray1");
			expect(readyQueue).toContain("st-ray2");
			expect(readyQueue).toContain("st-ray3");
			expect(readyQueue).toHaveLength(3);
		});
	});
});