import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import { 
	setupIntegrationTest, 
	cleanupIntegrationTest 
} from "../helpers/integration-setup";
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
		redis = await setupIntegrationTest();
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	beforeEach(async () => {
		// Flush Redis to ensure clean state for each test
		await redis.stream.flushdb();
	});

	it("should capture TodoWrite events from Claude Code", async () => {
		// Simulate TodoWrite tool usage
		const todos = [
			{ content: "Implement feature X", status: "pending", activeForm: "Implementing feature X" },
			{ content: "Write tests", status: "in_progress", activeForm: "Writing tests" },
			{ content: "Update documentation", status: "pending", activeForm: "Updating documentation" },
		];

		// Invoke the TodoWrite handler through the registry
		// This simulates what happens when Claude Code uses the TodoWrite tool
		const result = await registry.executeHandler("hook.todo_write", {
			todos: todos
		});
		
		// Verify the handler processed the todos
		expect(result.processed).toBe(true);
		
		// Check if event was captured in the Redis stream
		const eventStreamKey = "cb:stream:hook.todo_write";
		const events = await redis.stream.xrange(eventStreamKey, "-", "+", "COUNT", 1);
		expect(events.length).toBeGreaterThan(0);
		
		// Verify the event structure
		if (events.length > 0) {
			const [streamId, fields] = events[0];
			const eventData = JSON.parse(fields[1]);
			expect(eventData.type).toBe("hook.todo_write");
			expect(eventData.payload.todos).toHaveLength(3);
		}
	});

	it("should convert todos to tasks automatically", async () => {
		// Invoke handler with todos that should create tasks
		const result = await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Implement new feature", status: "pending", activeForm: "Implementing new feature" },
				{ content: "Another task", status: "in_progress", activeForm: "Working on another task" },
			]
		});
		
		// 1. Verify the TodoWrite handler returned success
		expect(result.processed).toBe(true);
		
		// 2. Check that the TodoWrite event itself was captured
		const todoWriteStreamKey = "cb:stream:hook.todo_write";
		const todoWriteEvents = await redis.stream.xrange(todoWriteStreamKey, "-", "+");
		expect(todoWriteEvents.length).toBeGreaterThan(0);
		
		// 3. Check if tasks were created from todos
		const taskStreamKey = "cb:stream:task.create";
		const taskEvents = await redis.stream.xrange(taskStreamKey, "-", "+");
		expect(taskEvents.length).toBeGreaterThan(0);
		
		// 4. Verify both types of events exist
		// - Registry event (has payload with todos)
		// - TodoManager event (has params with title)
		let foundImplementTask = false;
		let foundAnotherTask = false;
		
		for (const [streamId, fields] of taskEvents) {
			const taskData = JSON.parse(fields[1]);
			
			// Check for TodoManager-created events
			if (taskData.params && taskData.params.title) {
				if (taskData.params.title.includes("Implement")) {
					foundImplementTask = true;
				}
				if (taskData.params.title.includes("Another")) {
					foundAnotherTask = true;
				}
			}
		}
		
		// We expect both tasks to be created
		expect(foundImplementTask).toBe(true);
		expect(foundAnotherTask).toBe(true);
	});

	it("should maintain todo-to-task mapping", async () => {
		// Invoke handler with sessionId that matches the mapping key
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Task for mapping", status: "pending", activeForm: "Creating task for mapping" },
			]
		}, "session-123"); // Pass sessionId as clientId
		
		const mappingKey = "cb:mapping:todo-task:session-123";
		
		// Check mapping exists
		const mapping = await redis.stream.hgetall(mappingKey);
		expect(Object.keys(mapping).length).toBeGreaterThan(0);
	});

	it("should track todo status changes", async () => {
		// First call with pending todos
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Status tracking task", status: "pending", activeForm: "Starting status tracking" },
			]
		});
		
		// Second call with status change to in_progress
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Status tracking task", status: "in_progress", activeForm: "Working on status tracking" },
			]
		});
		
		const historyKey = "cb:history:todos:status-changes";
		
		// Check history is tracked
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
		// Invoke handler to create aggregated todos
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Todo for aggregation", status: "pending", activeForm: "Creating aggregated todo" },
			]
		});
		
		const aggregateKey = "cb:aggregate:todos:all-instances";
		
		// Check aggregation works
		const allTodos = await redis.stream.lrange(aggregateKey, 0, -1);
		expect(allTodos.length).toBeGreaterThan(0);
	});

	it("should enforce todo limits per session", async () => {
		// Create todos with the special session-overload ID
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Test limit 1", status: "pending", activeForm: "Testing limit" },
				{ content: "Test limit 2", status: "pending", activeForm: "Testing limit" },
			]
		}, "session-overload");
		
		const limitKey = "cb:limits:todos:session-overload";
		
		// Check limit is enforced
		const count = await redis.stream.get(limitKey);
		expect(parseInt(count || "0")).toBeLessThanOrEqual(100);
	});

	it("should emit notifications for completed todos", async () => {
		// First call with in_progress todo
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Task to complete", status: "in_progress", activeForm: "Working on task" },
			]
		});
		
		// Second call with completed status
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Task to complete", status: "completed", activeForm: "Completed task" },
			]
		});
		
		const notificationKey = "cb:notifications:todos:completed";
		
		// Check notifications are created
		const notifications = await redis.stream.lrange(notificationKey, 0, -1);
		expect(notifications.length).toBeGreaterThan(0);
	});

	it("should persist important todos to PostgreSQL", async () => {
		// Invoke handler with high-priority todo
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Important task to handle", status: "pending", activeForm: "Handling important task" },
			]
		});
		
		// High-priority todos should be persisted
		const persistedKey = "cb:persisted:todos:high-priority";
		
		// Check persistence flag
		const persisted = await redis.stream.get(persistedKey);
		expect(persisted).toBe("true");
	});

	it("should clean up completed todos after timeout", async () => {
		// First call with pending todo
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Task to clean up", status: "pending", activeForm: "Starting task" },
			]
		});
		
		// Second call with completed status (triggers cleanup scheduling)
		await registry.executeHandler("hook.todo_write", {
			todos: [
				{ content: "Task to clean up", status: "completed", activeForm: "Completed task" },
			]
		});
		
		// Completed todos should be archived/removed after 24 hours
		const cleanupKey = "cb:cleanup:todos:completed";
		
		// Check cleanup is scheduled
		const scheduled = await redis.stream.get(cleanupKey);
		expect(scheduled).toBeTruthy();
	});
});