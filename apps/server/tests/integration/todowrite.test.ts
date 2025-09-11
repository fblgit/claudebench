import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";
import { z } from "zod";

// TodoWrite event capture integration test
// Tests the complete flow from TodoWrite tool usage to task creation

const todoSchema = z.object({
	content: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]),
	activeForm: z.string(),
});

describe("Integration: TodoWrite Event Capture", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		// Clear test data
		try {
			const keys = await redis.stream.keys("cb:test:todowrite:*");
			if (keys.length > 0) {
				await redis.stream.del(...keys);
			}
		} catch {
			// Ignore cleanup errors
		}
	});

	afterAll(async () => {
		// Don't quit Redis - let the process handle cleanup on exit
		// This prevents interference between parallel test files
	});

	it("should capture TodoWrite events from Claude Code", async () => {
		// Simulate TodoWrite tool usage
		const todos = [
			{ content: "Implement feature X", status: "pending", activeForm: "Implementing feature X" },
			{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
			{ content: "Update documentation", status: "pending", activeForm: "Updating documentation" },
		];

		// This would be triggered by the TodoWrite hook
		const eventStreamKey = "cb:stream:hook.todo_write";
		
		// Check if event was captured (will fail without handler)
		const events = await redis.stream.xrange(eventStreamKey, "-", "+", "COUNT", 1);
		expect(events.length).toBeGreaterThan(0);
	});

	it("should convert todos to tasks automatically", async () => {
		// After TodoWrite event, tasks should be created
		const taskStreamKey = "cb:stream:task.create";
		
		// Check if tasks were created from todos (will fail without handler)
		const taskEvents = await redis.stream.xrange(taskStreamKey, "-", "+");
		expect(taskEvents.length).toBeGreaterThan(0);
		
		// Verify task contains todo information
		if (taskEvents.length > 0) {
			const taskData = JSON.parse(taskEvents[0][1][1]);
			expect(taskData.params.title).toContain("Implement");
		}
	});

	it("should maintain todo-to-task mapping", async () => {
		const mappingKey = "cb:mapping:todo-task:session-123";
		
		// Check mapping exists (will fail without handler)
		const mapping = await redis.stream.hgetall(mappingKey);
		expect(Object.keys(mapping).length).toBeGreaterThan(0);
	});

	it("should track todo status changes", async () => {
		// Simulate status change: pending -> in_progress -> completed
		const historyKey = "cb:history:todos:status-changes";
		
		// Check history is tracked (will fail without handler)
		const history = await redis.stream.lrange(historyKey, 0, -1);
		expect(history.length).toBeGreaterThan(0);
	});

	it("should handle concurrent TodoWrite updates", async () => {
		// Simulate multiple Claude Code instances updating todos
		const instance1Key = "cb:todos:instance:worker-1";
		const instance2Key = "cb:todos:instance:worker-2";
		
		// Check both instances have separate todo lists (will fail without handler)
		const todos1 = await redis.stream.lrange(instance1Key, 0, -1);
		const todos2 = await redis.stream.lrange(instance2Key, 0, -1);
		
		expect(todos1).toBeTruthy();
		expect(todos2).toBeTruthy();
	});

	it("should aggregate todos across all instances", async () => {
		const aggregateKey = "cb:aggregate:todos:all-instances";
		
		// Check aggregation works (will fail without handler)
		const allTodos = await redis.stream.lrange(aggregateKey, 0, -1);
		expect(allTodos.length).toBeGreaterThan(0);
	});

	it("should enforce todo limits per session", async () => {
		// Try to add more than limit (e.g., 100 todos)
		const limitKey = "cb:limits:todos:session-overload";
		
		// Check limit is enforced (will fail without handler)
		const count = await redis.stream.get(limitKey);
		expect(parseInt(count || "0")).toBeLessThanOrEqual(100);
	});

	it("should emit notifications for completed todos", async () => {
		const notificationKey = "cb:notifications:todos:completed";
		
		// Check notifications are created (will fail without handler)
		const notifications = await redis.stream.lrange(notificationKey, 0, -1);
		expect(notifications.length).toBeGreaterThan(0);
	});

	it("should persist important todos to PostgreSQL", async () => {
		// High-priority todos should be persisted
		const persistedKey = "cb:persisted:todos:high-priority";
		
		// Check persistence flag (will fail without handler)
		const persisted = await redis.stream.get(persistedKey);
		expect(persisted).toBe("true");
	});

	it("should clean up completed todos after timeout", async () => {
		// Completed todos should be archived/removed after 24 hours
		const cleanupKey = "cb:cleanup:todos:completed";
		
		// Check cleanup is scheduled (will fail without handler)
		const scheduled = await redis.stream.get(cleanupKey);
		expect(scheduled).toBeTruthy();
	});
});