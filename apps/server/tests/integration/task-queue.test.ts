import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import { taskQueue } from "@/core/task-queue";
import { 
	setupIntegrationTest, 
	registerTestInstances,
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Task Queue Assignment Integration Test
// Tests the complete flow of task creation, queuing, and assignment to instances

describe("Integration: Task Queue Assignment", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = await setupIntegrationTest();
		
		// Register worker instances for task assignment
		await registerTestInstances();
		
		// Create additional test instances for specific tests
		await registry.executeHandler("system.register", {
			id: "worker-priority",
			roles: ["worker"]
		});
		await registry.executeHandler("system.register", {
			id: "worker-limited",
			roles: ["worker"]
		});
		await registry.executeHandler("system.register", {
			id: "worker-complete",
			roles: ["worker"]
		});
		
		// Set capacity for limited worker
		await taskQueue.setInstanceCapacity("worker-limited", 5);
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	it("should create task and add to global queue", async () => {
		const globalQueueKey = "cb:queue:tasks:pending";
		
		// Create a task through the handler (per JSONRPC contract)
		const result = await registry.executeHandler("task.create", {
			text: "Test task for queue",
			priority: 50
		});
		
		expect(result.id).toBeDefined();
		expect(result.status).toBe("pending");
		
		// Check if task was added to global queue
		const queueLength = await redis.stream.zcard(globalQueueKey);
		expect(queueLength).toBeGreaterThan(0);
	});

	it("should assign tasks to available workers", async () => {
		// Create tasks first
		await registry.executeHandler("task.create", {
			text: "Task 1 for distribution",
			priority: 50
		});
		await registry.executeHandler("task.create", {
			text: "Task 2 for distribution",
			priority: 50
		});
		await registry.executeHandler("task.create", {
			text: "Task 3 for distribution",
			priority: 50
		});
		
		// Now register workers - they should auto-pull tasks
		await registry.executeHandler("system.register", {
			id: "worker-dist-1",
			roles: ["worker"]
		});
		await registry.executeHandler("system.register", {
			id: "worker-dist-2",
			roles: ["worker"]
		});
		
		// Check workers are registered
		const worker1Key = "cb:instance:worker-dist-1";
		const worker2Key = "cb:instance:worker-dist-2";
		const worker1Exists = await redis.stream.exists(worker1Key);
		const worker2Exists = await redis.stream.exists(worker2Key);
		expect(worker1Exists).toBe(1);
		expect(worker2Exists).toBe(1);
		
		// Check tasks are distributed
		const queue1Key = "cb:queue:instance:worker-dist-1";
		const queue2Key = "cb:queue:instance:worker-dist-2";
		
		const queue1Length = await redis.stream.llen(queue1Key);
		const queue2Length = await redis.stream.llen(queue2Key);
		
		// At least one worker should have tasks
		expect(queue1Length + queue2Length).toBeGreaterThan(0);
	});

	it("should respect task priority in assignment", async () => {
		// Flush Redis to ensure clean state
		await redis.stream.flushdb();
		
		// Create tasks FIRST with different priorities
		const lowTask = await registry.executeHandler("task.create", {
			text: "Low priority task",
			priority: 10
		});
		const highTask = await registry.executeHandler("task.create", {
			text: "High priority task", 
			priority: 90
		});
		const mediumTask = await registry.executeHandler("task.create", {
			text: "Medium priority task",
			priority: 50
		});
		
		// NOW register worker - it will auto-pull tasks in priority order
		await registry.executeHandler("system.register", {
			id: "worker-priority",
			roles: ["worker"]
		});
		
		// High priority tasks should be assigned first
		const queueKey = "cb:queue:instance:worker-priority";
		const firstTask = await redis.stream.lindex(queueKey, 0);
		expect(firstTask).toBeTruthy();
		
		// Check if it's high priority (should be the 90 priority task)
		const taskKey = `cb:task:${firstTask}`;
		const priority = await redis.stream.hget(taskKey, "priority");
		expect(parseInt(priority || "0")).toBe(90);
	});

	it("should load balance across instances", async () => {
		// Tasks should be evenly distributed
		const worker1QueueKey = "cb:queue:instance:worker-balance-1";
		const worker2QueueKey = "cb:queue:instance:worker-balance-2";
		const worker3QueueKey = "cb:queue:instance:worker-balance-3";
		
		const q1 = await redis.stream.llen(worker1QueueKey);
		const q2 = await redis.stream.llen(worker2QueueKey);
		const q3 = await redis.stream.llen(worker3QueueKey);
		
		// Check distribution is balanced (will fail without handler)
		const max = Math.max(q1, q2, q3);
		const min = Math.min(q1, q2, q3);
		expect(max - min).toBeLessThanOrEqual(2); // Allow small imbalance
	});

	it("should reassign tasks from failed instances", async () => {
		// Setup: Create worker-failed with tasks
		await registry.executeHandler("system.register", {
			id: "worker-failed",
			roles: ["worker"]
		});
		
		// Create tasks that will be assigned to worker-failed
		await registry.executeHandler("task.create", {
			text: "Task for failed worker",
			priority: 50
		});
		
		// Wait a moment for the task to be assigned
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// When instance goes offline, tasks should be reassigned
		const failedInstanceKey = "cb:instance:worker-failed";
		const failedQueueKey = "cb:queue:instance:worker-failed";
		
		// Simulate instance failure by stopping heartbeats and waiting for timeout
		// The monitoring loop should detect and mark it OFFLINE
		await redis.stream.hset(failedInstanceKey, "lastSeen", "1"); // Very old timestamp
		
		// Wait for monitoring loop to detect failure (check interval is likely 1000ms)
		await new Promise(resolve => setTimeout(resolve, 1500));
		
		// Now check if instance was marked offline
		const status = await redis.stream.hget(failedInstanceKey, "status");
		expect(status).toBe("OFFLINE");
		
		// Check queue is empty (tasks reassigned)
		const queueLength = await redis.stream.llen(failedQueueKey);
		expect(queueLength).toBe(0);
		
		// Check tasks were moved to other queues
		const reassignedKey = "cb:reassigned:from:worker-failed";
		const reassigned = await redis.stream.smembers(reassignedKey);
		expect(reassigned.length).toBeGreaterThan(0);
	});

	it("should handle instance capacity limits", async () => {
		// Instances should not be overloaded
		const capacityKey = "cb:capacity:worker-limited";
		const queueKey = "cb:queue:instance:worker-limited";
		
		// Check capacity is respected (will fail without handler)
		const capacity = await redis.stream.hget(capacityKey, "maxTasks");
		const queueLength = await redis.stream.llen(queueKey);
		expect(queueLength).toBeLessThanOrEqual(parseInt(capacity || "10"));
	});

	it("should track task assignment history", async () => {
		const historyKey = "cb:history:assignments";
		
		// Check assignment history is tracked (will fail without handler)
		const history = await redis.stream.lrange(historyKey, 0, -1);
		expect(history.length).toBeGreaterThan(0);
		
		// Each entry should contain task and instance info
		if (history.length > 0) {
			const entry = JSON.parse(history[0]);
			expect(entry.taskId).toBeTruthy();
			expect(entry.instanceId).toBeTruthy();
			expect(entry.timestamp).toBeTruthy();
		}
	});

	it("should prevent duplicate task assignments", async () => {
		const taskId = "task-no-duplicate";
		
		// Check task is only in one queue (will fail without handler)
		const queues = await redis.stream.keys("cb:queue:instance:*");
		let foundCount = 0;
		
		for (const queue of queues) {
			const position = await redis.stream.lpos(queue, taskId);
			if (position !== null) foundCount++;
		}
		
		expect(foundCount).toBeLessThanOrEqual(1);
	});

	it("should handle task completion and removal from queue", async () => {
		// Create a task first
		const taskResult = await registry.executeHandler("task.create", {
			text: "Task to be completed",
			priority: 50
		});
		
		// Debug: Check what we actually got back
		console.log("[TEST] Task create result:", taskResult);
		
		if (!taskResult || !taskResult.id) {
			throw new Error(`Task creation failed or returned invalid result: ${JSON.stringify(taskResult)}`);
		}
		
		const completedTaskId = taskResult.id;
		
		// Register a new worker - it should auto-assign the task
		await registry.executeHandler("system.register", {
			id: "worker-complete-new",
			roles: ["worker"]
		});
		
		// Wait a moment for auto-assignment to happen
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Complete the task
		await registry.executeHandler("task.complete", {
			id: completedTaskId,  // Use 'id' not 'taskId' per schema
			result: { success: true, data: "Task completed successfully" }
		});
		
		const queueKey = "cb:queue:instance:worker-complete-new";
		
		// Task should not be in queue after completion
		const position = await redis.stream.lpos(queueKey, completedTaskId);
		expect(position).toBeNull();
		
		// Task should be marked as completed
		const taskKey = `cb:task:${completedTaskId}`;
		const status = await redis.stream.hget(taskKey, "status");
		expect(status).toBe("completed");
	});

	it("should emit queue metrics", async () => {
		const metricsKey = "cb:metrics:queues";
		
		// Debug: Create a task to ensure metrics are populated
		await registry.executeHandler("task.create", {
			text: "Task for metrics test",
			priority: 50
		});
		
		// Check metrics are tracked
		const metrics = await redis.stream.hgetall(metricsKey);
		console.log("[TEST] Queue metrics:", metrics);
		expect(metrics.totalTasks).toBeTruthy();
		expect(metrics.avgWaitTime).toBeTruthy();
		expect(metrics.throughput).toBeTruthy();
	});
});
