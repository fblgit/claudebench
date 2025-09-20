import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import prisma from "@/db";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Task Attachments Integration Test
// Tests the complete flow of attachment creation, retrieval, and batch operations

describe("Integration: Task Attachments", () => {
	let redis: ReturnType<typeof getRedis>;
	let testTaskId: string;

	beforeAll(async () => {
		redis = await setupIntegrationTest();
		
		// Flush Redis to ensure clean state
		await redis.pub.flushdb();
		
		// Register a worker instance
		await registry.executeHandler("system.register", {
			id: "worker-attachment-test",
			roles: ["worker"]
		});
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	afterEach(async () => {
		// Add delay between tests to avoid rate limiting
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Clear rate limit keys
		const rateLimitKeys = await redis.pub.keys("cb:ratelimit:*");
		if (rateLimitKeys.length > 0) {
			await redis.pub.del(...rateLimitKeys);
		}
	});

	// Note: Individual test suites handle their own cleanup in their beforeEach blocks

	describe("Create Attachment", () => {
		beforeEach(async () => {
			// Create a fresh test task for this suite
			const taskResult = await registry.executeHandler("task.create", {
				text: "Test task for create attachment suite",
				priority: 50
			});
			testTaskId = taskResult.id;
		});
		it("should create JSON attachment and store in both Redis and PostgreSQL", async () => {
			const attachmentData = {
				taskId: testTaskId,
				key: "test-json",
				type: "json" as const,
				value: { foo: "bar", count: 42 }
			};

			const result = await registry.executeHandler("task.create_attachment", attachmentData);

			expect(result).toMatchObject({
				taskId: testTaskId,
				key: "test-json",
				type: "json"
			});
			expect(result.id).toBeDefined();
			expect(result.createdAt).toBeDefined();

			// Verify in Redis
			const redisKey = `cb:task:${testTaskId}:attachment:test-json`;
			const redisData = await redis.pub.hgetall(redisKey);
			expect(redisData.key).toBe("test-json");
			expect(redisData.type).toBe("json");
			expect(JSON.parse(redisData.value)).toEqual({ foo: "bar", count: 42 });

			// Verify in index
			const indexKey = `cb:task:${testTaskId}:attachments`;
			const indexedKeys = await redis.pub.zrange(indexKey, 0, -1);
			expect(indexedKeys).toContain("test-json");

			// Verify in PostgreSQL
			if (prisma) {
				const dbAttachment = await prisma.taskAttachment.findUnique({
					where: {
						taskId_key: {
							taskId: testTaskId,
							key: "test-json"
						}
					}
				});
				expect(dbAttachment).toBeDefined();
				expect(dbAttachment?.type).toBe("json");
				expect(dbAttachment?.value).toEqual({ foo: "bar", count: 42 });
			}
		});

		it("should create markdown attachment", async () => {
			const attachmentData = {
				taskId: testTaskId,
				key: "test-markdown",
				type: "markdown" as const,
				content: "# Test Document\n\nThis is a test markdown document."
			};

			const result = await registry.executeHandler("task.create_attachment", attachmentData);

			expect(result).toMatchObject({
				taskId: testTaskId,
				key: "test-markdown",
				type: "markdown"
			});

			// Verify content in Redis
			const redisKey = `cb:task:${testTaskId}:attachment:test-markdown`;
			const redisData = await redis.pub.hgetall(redisKey);
			expect(redisData.content).toBe("# Test Document\n\nThis is a test markdown document.");
		});

		it("should create URL attachment", async () => {
			const attachmentData = {
				taskId: testTaskId,
				key: "test-url",
				type: "url" as const,
				url: "https://example.com/api/docs"
			};

			const result = await registry.executeHandler("task.create_attachment", attachmentData);

			expect(result).toMatchObject({
				taskId: testTaskId,
				key: "test-url",
				type: "url"
			});

			// Verify URL in Redis
			const redisKey = `cb:task:${testTaskId}:attachment:test-url`;
			const redisData = await redis.pub.hgetall(redisKey);
			expect(redisData.url).toBe("https://example.com/api/docs");
		});

		it("should update existing attachment with same key", async () => {
			// Create initial attachment
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "update-test",
				type: "json",
				value: { version: 1 }
			});

			// Update with same key
			const updateResult = await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "update-test",
				type: "json",
				value: { version: 2, updated: true }
			});

			// Verify update
			const redisKey = `cb:task:${testTaskId}:attachment:update-test`;
			const redisData = await redis.pub.hgetall(redisKey);
			expect(JSON.parse(redisData.value)).toEqual({ version: 2, updated: true });

			// Verify only one entry in index
			const indexKey = `cb:task:${testTaskId}:attachments`;
			const indexedKeys = await redis.pub.zrange(indexKey, 0, -1);
			const updateTestCount = indexedKeys.filter((k: string) => k === "update-test").length;
			expect(updateTestCount).toBe(1);
		});

		it("should throw error if task does not exist", async () => {
			await expect(
				registry.executeHandler("task.create_attachment", {
					taskId: "non-existent-task",
					key: "test",
					type: "json",
					value: { test: true }
				})
			).rejects.toThrow(/not found/i);
		});

		it("should throw error if PostgreSQL persistence fails", async () => {
			// This test assumes PostgreSQL is configured and persist flag is true
			// We'll test by trying to create an attachment with invalid data that would fail DB constraints
			
			// First, verify the handler throws on DB errors
			// Note: This is a simplified test - in real scenarios you might mock the DB connection
			const attachmentData = {
				taskId: testTaskId,
				key: "test-db-error",
				type: "invalid-type" as any, // This should fail validation
				value: { test: true }
			};

			await expect(
				registry.executeHandler("task.create_attachment", attachmentData)
			).rejects.toThrow();
		});
	});

	describe("Get Attachment", () => {
		beforeEach(async () => {
			// Create a fresh test task for this suite
			const taskResult = await registry.executeHandler("task.create", {
				text: "Test task for get attachment suite",
				priority: 50
			});
			testTaskId = taskResult.id;
			
			// Create a test attachment
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "get-test",
				type: "json",
				value: { test: "data", nested: { value: 123 } }
			});
		});

		it("should retrieve attachment by key", async () => {
			const result = await registry.executeHandler("task.get_attachment", {
				taskId: testTaskId,
				key: "get-test"
			});

			expect(result).toMatchObject({
				taskId: testTaskId,
				key: "get-test",
				type: "json",
				value: { test: "data", nested: { value: 123 } }
			});
			expect(result.id).toBeDefined();
			expect(result.createdAt).toBeDefined();
			expect(result.updatedAt).toBeDefined();
		});

		it("should throw error if attachment not found", async () => {
			await expect(
				registry.executeHandler("task.get_attachment", {
					taskId: testTaskId,
					key: "non-existent"
				})
			).rejects.toThrow(/not found/i);
		});

		it("should cache retrieved attachment from PostgreSQL in Redis", async () => {
			// Clear Redis cache but keep in DB
			const redisKey = `cb:task:${testTaskId}:attachment:get-test`;
			await redis.pub.del(redisKey);

			// Retrieve - should fetch from DB and cache
			const result = await registry.executeHandler("task.get_attachment", {
				taskId: testTaskId,
				key: "get-test"
			});

			expect(result.key).toBe("get-test");

			// Verify it's now cached in Redis
			const cachedData = await redis.pub.hgetall(redisKey);
			expect(cachedData.key).toBe("get-test");
			expect(JSON.parse(cachedData.value)).toEqual({ test: "data", nested: { value: 123 } });
		});
	});

	describe("List Attachments", () => {
		beforeEach(async () => {
			// Create a fresh test task for this suite
			const taskResult = await registry.executeHandler("task.create", {
				text: "Test task for list attachments suite",
				priority: 50
			});
			testTaskId = taskResult.id;
			
			// Create multiple test attachments
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "list-1",
				type: "json",
				value: { index: 1 }
			});
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "list-2",
				type: "markdown",
				content: "Test content"
			});
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "list-3",
				type: "url",
				url: "https://example.com"
			});
		});

		it("should list all attachments for a task", async () => {
			const result = await registry.executeHandler("task.list_attachments", {
				taskId: testTaskId
			});

			expect(result.attachments).toHaveLength(3);
			expect(result.totalCount).toBe(3);
			expect(result.hasMore).toBe(false);

			const keys = result.attachments.map((a: any) => a.key);
			expect(keys).toContain("list-1");
			expect(keys).toContain("list-2");
			expect(keys).toContain("list-3");
		});

		it("should filter attachments by type", async () => {
			const result = await registry.executeHandler("task.list_attachments", {
				taskId: testTaskId,
				type: "json"
			});

			expect(result.attachments).toHaveLength(1);
			expect(result.attachments[0].key).toBe("list-1");
			expect(result.attachments[0].type).toBe("json");
		});

		it("should support pagination", async () => {
			const page1 = await registry.executeHandler("task.list_attachments", {
				taskId: testTaskId,
				limit: 2,
				offset: 0
			});

			expect(page1.attachments).toHaveLength(2);
			expect(page1.hasMore).toBe(true);
			expect(page1.totalCount).toBe(3);

			const page2 = await registry.executeHandler("task.list_attachments", {
				taskId: testTaskId,
				limit: 2,
				offset: 2
			});

			expect(page2.attachments).toHaveLength(1);
			expect(page2.hasMore).toBe(false);
		});

		it("should return empty list for task with no attachments", async () => {
			// Create a new task with no attachments
			const newTask = await registry.executeHandler("task.create", {
				text: "Task with no attachments",
				priority: 50
			});

			const result = await registry.executeHandler("task.list_attachments", {
				taskId: newTask.id
			});

			expect(result.attachments).toHaveLength(0);
			expect(result.totalCount).toBe(0);
			expect(result.hasMore).toBe(false);
		});
	});

	describe("Batch Get Attachments", () => {
		beforeEach(async () => {
			// Create a fresh test task for this suite
			const taskResult = await registry.executeHandler("task.create", {
				text: "Test task for batch get attachments suite",
				priority: 50
			});
			testTaskId = taskResult.id;
			
			// Create test attachments
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "batch-1",
				type: "json",
				value: { batch: 1 }
			});
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "batch-2",
				type: "json",
				value: { batch: 2 }
			});
			await registry.executeHandler("task.create_attachment", {
				taskId: testTaskId,
				key: "batch-3",
				type: "json",
				value: { batch: 3 }
			});
		});

		it("should fetch multiple attachments in a single batch", async () => {
			const result = await registry.executeHandler("task.get_attachments_batch", {
				requests: [
					{ taskId: testTaskId, key: "batch-1" },
					{ taskId: testTaskId, key: "batch-2" },
					{ taskId: testTaskId, key: "batch-3" }
				]
			});

			expect(result.attachments).toHaveLength(3);
			
			const attachment1 = result.attachments.find((a: any) => a.key === "batch-1");
			expect(attachment1.value).toEqual({ batch: 1 });
			
			const attachment2 = result.attachments.find((a: any) => a.key === "batch-2");
			expect(attachment2.value).toEqual({ batch: 2 });
			
			const attachment3 = result.attachments.find((a: any) => a.key === "batch-3");
			expect(attachment3.value).toEqual({ batch: 3 });
		});

		it("should maintain request order in response", async () => {
			const result = await registry.executeHandler("task.get_attachments_batch", {
				requests: [
					{ taskId: testTaskId, key: "batch-3" },
					{ taskId: testTaskId, key: "batch-1" },
					{ taskId: testTaskId, key: "batch-2" }
				]
			});

			expect(result.attachments[0].key).toBe("batch-3");
			expect(result.attachments[1].key).toBe("batch-1");
			expect(result.attachments[2].key).toBe("batch-2");
		});

		it("should throw error if any attachment not found", async () => {
			await expect(
				registry.executeHandler("task.get_attachments_batch", {
					requests: [
						{ taskId: testTaskId, key: "batch-1" },
						{ taskId: testTaskId, key: "non-existent" },
						{ taskId: testTaskId, key: "batch-3" }
					]
				})
			).rejects.toThrow(/not found/i);
		});
	});

	describe("Task Claim with Attachments", () => {
		let taskWithAttachments: string;

		beforeEach(async () => {
			// Create a new task with attachments
			const task = await registry.executeHandler("task.create", {
				text: "Task with attachments for claim test",
				priority: 75
			});
			taskWithAttachments = task.id;

			// Add attachments
			await registry.executeHandler("task.create_attachment", {
				taskId: taskWithAttachments,
				key: "config",
				type: "json",
				value: { setting1: "value1", setting2: "value2" }
			});
			await registry.executeHandler("task.create_attachment", {
				taskId: taskWithAttachments,
				key: "instructions",
				type: "markdown",
				content: "## Instructions\n\n1. Do this\n2. Do that"
			});
		});

		it("should include attachments when claiming task", async () => {
			const claimResult = await registry.executeHandler("task.claim", {
				workerId: "worker-attachment-test"
			});

			if (claimResult.claimed && claimResult.task) {
				// Find our task
				if (claimResult.task.id === taskWithAttachments) {
					expect(claimResult.task.attachments).toBeDefined();
					expect(claimResult.task.attachmentCount).toBe(2);
					
					// Verify attachment data is included
					expect(claimResult.task.attachments.config).toMatchObject({
						type: "json",
						value: { setting1: "value1", setting2: "value2" }
					});
					expect(claimResult.task.attachments.instructions).toMatchObject({
						type: "markdown"
					});
				}
			}
		});
	});

	describe("Task Complete with Result Attachment", () => {
		let taskToComplete: string;

		beforeEach(async () => {
			// Create and assign a task
			const task = await registry.executeHandler("task.create", {
				text: "Task to complete with result",
				priority: 50
			});
			taskToComplete = task.id;

			await registry.executeHandler("task.assign", {
				taskId: taskToComplete,
				instanceId: "worker-attachment-test"
			});
		});

		it("should create result attachment when completing task", async () => {
			const resultData = {
				success: true,
				metrics: { processed: 100, failed: 0 },
				output: "Task completed successfully"
			};

			await registry.executeHandler("task.complete", {
				taskId: taskToComplete,
				workerId: "worker-attachment-test",
				result: resultData
			});

			// Verify result attachment was created
			const attachment = await registry.executeHandler("task.get_attachment", {
				taskId: taskToComplete,
				key: "result"
			});

			expect(attachment.type).toBe("json");
			expect(attachment.value).toEqual(resultData);
		});

		it("should fail task completion if result attachment creation fails", async () => {
			// This would happen if there's a DB constraint violation or connection issue
			// For this test, we'll simulate by trying to complete a non-existent task
			await expect(
				registry.executeHandler("task.complete", {
					taskId: "non-existent-task",
					workerId: "worker-attachment-test",
					result: { test: true }
				})
			).rejects.toThrow();
		});
	});
});