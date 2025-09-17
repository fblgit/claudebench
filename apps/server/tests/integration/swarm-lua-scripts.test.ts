import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";
import { redisScripts } from "@/core/redis-scripts";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Swarm Lua Scripts Integration Test
// Tests atomicity and correctness of Redis Lua scripts under concurrent access

describe("Integration: Swarm Lua Scripts", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = await setupIntegrationTest();
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	describe("DECOMPOSE_AND_STORE_SUBTASKS", () => {
		it("should atomically store decomposition with subtasks", async () => {
			const taskId = `t-${Date.now()}`;
			const decomposition = {
				subtasks: [
					{
						id: "st-1",
						description: "Frontend implementation",
						specialist: "frontend",
						complexity: 60,
						estimatedMinutes: 120,
						dependencies: [],
						context: {
							files: ["src/components/Toggle.tsx"],
							patterns: ["React hooks"],
							constraints: []
						}
					},
					{
						id: "st-2",
						description: "Backend API",
						specialist: "backend",
						complexity: 40,
						estimatedMinutes: 90,
						dependencies: [],
						context: {
							files: ["api/preferences.ts"],
							patterns: ["REST API"],
							constraints: []
						}
					},
					{
						id: "st-3",
						description: "Integration tests",
						specialist: "testing",
						complexity: 30,
						estimatedMinutes: 60,
						dependencies: ["st-1", "st-2"],
						context: {
							files: ["tests/integration.test.ts"],
							patterns: ["Jest", "Playwright"],
							constraints: []
						}
					}
				],
				executionStrategy: "mixed",
				totalComplexity: 130,
				reasoning: "Frontend and backend can run in parallel, tests depend on both"
			};

			const result = await redisScripts.decomposeAndStoreSubtasks(
				taskId,
				decomposition,
				Date.now()
			);

			expect(result.success).toBe(true);
			expect(result.subtaskCount).toBe(3);
			expect(result.queuedCount).toBe(2); // Only st-1 and st-2 are queued initially

			// Verify data was stored
			const decompositionKey = `cb:decomposition:${taskId}`;
			const storedData = await redis.pub.hget(decompositionKey, "data");
			expect(storedData).toBeDefined();

			// Verify dependency graph
			const depGraphKey = `cb:dependencies:${taskId}`;
			const st3Deps = await redis.pub.smembers(`${depGraphKey}:st-3`);
			expect(st3Deps).toContain("st-1");
			expect(st3Deps).toContain("st-2");
		});

		it("should handle concurrent decompositions without race conditions", async () => {
			const promises = [];
			const taskIds = [];

			// Create 10 concurrent decompositions
			for (let i = 0; i < 10; i++) {
				const taskId = `t-concurrent-${Date.now()}-${i}`;
				taskIds.push(taskId);
				
				const decomposition = {
					subtasks: [
						{
							id: `st-${i}-1`,
							description: `Task ${i} subtask 1`,
							specialist: "frontend",
							complexity: 50,
							estimatedMinutes: 60,
							dependencies: [],
							context: { files: [], patterns: [], constraints: [] }
						}
					],
					executionStrategy: "sequential",
					totalComplexity: 50,
					reasoning: "Simple task"
				};

				promises.push(
					redisScripts.decomposeAndStoreSubtasks(taskId, decomposition, Date.now())
				);
			}

			const results = await Promise.all(promises);
			
			// All should succeed
			for (const result of results) {
				expect(result.success).toBe(true);
			}

			// Verify metrics were incremented correctly
			const decompositionCount = await redis.pub.get("cb:metrics:swarm:decompositions");
			expect(Number(decompositionCount)).toBeGreaterThanOrEqual(10);
		});
	});

	describe("ASSIGN_TO_SPECIALIST", () => {
		it("should assign subtask to best available specialist", async () => {
			const subtaskId = `st-${Date.now()}`;
			
			// Register test specialists
			await redis.pub.hset("cb:specialists:frontend", {
				"specialist-fe-1": JSON.stringify({
					id: "specialist-fe-1",
					capabilities: ["react", "typescript"],
					currentLoad: 2,
					maxLoad: 5,
					lastHeartbeat: Date.now()
				}),
				"specialist-fe-2": JSON.stringify({
					id: "specialist-fe-2",
					capabilities: ["react"],
					currentLoad: 4,
					maxLoad: 5,
					lastHeartbeat: Date.now()
				})
			});

			const result = await redisScripts.assignToSpecialist(
				subtaskId,
				"frontend",
				["react", "typescript"]
			);

			expect(result.success).toBe(true);
			expect(result.specialistId).toBe("specialist-fe-1"); // Better match and lower load
			expect(result.score).toBeGreaterThan(0);

			// Verify assignment was stored
			const assignmentKey = `cb:assignment:${subtaskId}`;
			const assignment = await redis.pub.hget(assignmentKey, "specialistId");
			expect(assignment).toBe("specialist-fe-1");
		});

		it("should handle concurrent assignments without double-booking", async () => {
			// Register a specialist with limited capacity
			await redis.pub.hset("cb:specialists:backend", {
				"specialist-be-limited": JSON.stringify({
					id: "specialist-be-limited",
					capabilities: ["node", "express"],
					currentLoad: 0,
					maxLoad: 3,
					lastHeartbeat: Date.now()
				})
			});

			const promises = [];
			const subtaskIds = [];

			// Try to assign 5 tasks to a specialist with max capacity of 3
			for (let i = 0; i < 5; i++) {
				const subtaskId = `st-concurrent-assign-${Date.now()}-${i}`;
				subtaskIds.push(subtaskId);
				
				promises.push(
					redisScripts.assignToSpecialist(
						subtaskId,
						"backend",
						["node"]
					)
				);
			}

			const results = await Promise.all(promises);
			
			// Count successful assignments
			const successfulAssignments = results.filter(r => r.success).length;
			
			// Should not exceed max capacity
			expect(successfulAssignments).toBeLessThanOrEqual(3);
			
			// Verify specialist load
			const specialistData = await redis.pub.hget(
				"cb:specialists:backend",
				"specialist-be-limited"
			);
			if (specialistData) {
				const specialist = JSON.parse(specialistData);
				expect(specialist.currentLoad).toBeLessThanOrEqual(3);
			}
		});
	});

	describe("DETECT_AND_QUEUE_CONFLICT", () => {
		it("should detect conflicts when multiple solutions proposed", async () => {
			const taskId = `t-conflict-${Date.now()}`;
			
			// First solution
			const result1 = await redisScripts.detectAndQueueConflict(
				taskId,
				"specialist-1",
				{
					approach: "Use React hooks",
					reasoning: "Modern pattern",
					code: "useState()"
				}
			);
			
			expect(result1.conflictDetected).toBe(false);
			expect(result1.solutionCount).toBe(1);

			// Second solution (triggers conflict)
			const result2 = await redisScripts.detectAndQueueConflict(
				taskId,
				"specialist-2",
				{
					approach: "Use Redux",
					reasoning: "Scalable",
					code: "dispatch()"
				}
			);
			
			expect(result2.conflictDetected).toBe(true);
			expect(result2.solutionCount).toBe(2);

			// Verify conflict was queued
			const queueSize = await redis.pub.zcard("cb:queue:conflicts");
			expect(queueSize).toBeGreaterThan(0);
		});
	});

	describe("SYNTHESIZE_PROGRESS", () => {
		it("should track synthesis progress and unblock dependencies", async () => {
			const parentId = `t-synthesis-${Date.now()}`;
			
			// Setup decomposition with dependencies
			await redis.pub.hset(`cb:decomposition:${parentId}`, {
				data: JSON.stringify({
					subtaskCount: 3,
					subtasks: ["st-a", "st-b", "st-c"]
				})
			});
			
			// Set up dependency graph
			await redis.pub.sadd(`cb:dependencies:${parentId}:st-c`, "st-a", "st-b");
			
			// Mark st-a as complete
			const result1 = await redisScripts.synthesizeProgress(
				parentId,
				"st-a",
				{ status: "completed", output: "Component done" }
			);
			
			expect(result1.success).toBe(true);
			expect(result1.readyForSynthesis).toBe(false); // Not all complete
			
			// Mark st-b as complete
			const result2 = await redisScripts.synthesizeProgress(
				parentId,
				"st-b",
				{ status: "completed", output: "API done" }
			);
			
			expect(result2.success).toBe(true);
			expect(result2.unblockedCount).toBe(1); // st-c is now unblocked
			
			// Mark st-c as complete
			const result3 = await redisScripts.synthesizeProgress(
				parentId,
				"st-c",
				{ status: "completed", output: "Tests done" }
			);
			
			expect(result3.success).toBe(true);
			expect(result3.readyForSynthesis).toBe(true); // All complete!
		});
	});

	describe("Concurrent operations stress test", () => {
		it("should handle mixed concurrent operations without deadlocks", async () => {
			const operations = [];
			
			// Mix different types of operations
			for (let i = 0; i < 20; i++) {
				if (i % 4 === 0) {
					// Decomposition
					operations.push(
						redisScripts.decomposeAndStoreSubtasks(
							`t-stress-${i}`,
							{
								subtasks: [{
									id: `st-stress-${i}`,
									description: "Stress test",
									specialist: "general",
									complexity: 50,
									estimatedMinutes: 60,
									dependencies: [],
									context: { files: [], patterns: [], constraints: [] }
								}],
								executionStrategy: "sequential",
								totalComplexity: 50,
								reasoning: "Stress test"
							},
							Date.now()
						)
					);
				} else if (i % 4 === 1) {
					// Assignment
					operations.push(
						redisScripts.assignToSpecialist(
							`st-stress-${i}`,
							"general",
							[]
						)
					);
				} else if (i % 4 === 2) {
					// Conflict detection
					operations.push(
						redisScripts.detectAndQueueConflict(
							`t-stress-${i}`,
							`specialist-stress-${i}`,
							{ approach: "Test", reasoning: "Test", code: "test()" }
						)
					);
				} else {
					// Progress synthesis
					operations.push(
						redisScripts.synthesizeProgress(
							`t-stress-${i}`,
							`st-stress-${i}`,
							{ status: "completed", output: "Done" }
						)
					);
				}
			}
			
			// Execute all operations concurrently
			const results = await Promise.allSettled(operations);
			
			// Check that all operations completed (either fulfilled or rejected)
			const completed = results.filter(r => r.status === "fulfilled").length;
			expect(completed).toBeGreaterThan(0);
			
			// No operation should hang (test timeout would fail if deadlocked)
			expect(results.length).toBe(20);
		});
	});
});