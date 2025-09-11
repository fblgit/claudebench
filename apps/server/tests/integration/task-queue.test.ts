import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";

// Task Queue Assignment Integration Test
// Tests the complete flow of task creation, queuing, and assignment to instances

describe("Integration: Task Queue Assignment", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		// Clear test data
		try {
			const keys = await redis.stream.keys("cb:test:queue:*");
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

	it("should create task and add to global queue", async () => {
		const globalQueueKey = "cb:queue:tasks:pending";
		
		// Create a task (will fail without handler)
		const taskId = "task-test-1";
		const queueLength = await redis.stream.llen(globalQueueKey);
		expect(queueLength).toBeGreaterThan(0);
	});

	it("should assign tasks to available workers", async () => {
		// Register worker instances
		const worker1Key = "cb:instance:worker-1";
		const worker2Key = "cb:instance:worker-2";
		
		// Check workers are registered (will fail without handler)
		const worker1Exists = await redis.stream.exists(worker1Key);
		const worker2Exists = await redis.stream.exists(worker2Key);
		expect(worker1Exists).toBe(1);
		expect(worker2Exists).toBe(1);
		
		// Check tasks are distributed
		const queue1Key = "cb:queue:instance:worker-1";
		const queue2Key = "cb:queue:instance:worker-2";
		
		const queue1Length = await redis.stream.llen(queue1Key);
		const queue2Length = await redis.stream.llen(queue2Key);
		
		// At least one worker should have tasks (will fail without handler)
		expect(queue1Length + queue2Length).toBeGreaterThan(0);
	});

	it("should respect task priority in assignment", async () => {
		// High priority tasks should be assigned first
		const queueKey = "cb:queue:instance:worker-priority";
		
		// Get first task in queue (will fail without handler)
		const firstTask = await redis.stream.lindex(queueKey, 0);
		expect(firstTask).toBeTruthy();
		
		// Check if it's high priority
		const taskKey = `cb:task:${firstTask}`;
		const priority = await redis.stream.hget(taskKey, "priority");
		expect(parseInt(priority || "0")).toBeGreaterThanOrEqual(5);
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
		// When instance goes offline, tasks should be reassigned
		const failedInstanceKey = "cb:instance:worker-failed";
		const failedQueueKey = "cb:queue:instance:worker-failed";
		
		// Mark instance as offline (will fail without handler)
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
		const completedTaskId = "task-completed";
		const queueKey = "cb:queue:instance:worker-complete";
		
		// Task should not be in queue after completion (will fail without handler)
		const position = await redis.stream.lpos(queueKey, completedTaskId);
		expect(position).toBeNull();
		
		// Task should be marked as completed
		const taskKey = `cb:task:${completedTaskId}`;
		const status = await redis.stream.hget(taskKey, "status");
		expect(status).toBe("COMPLETED");
	});

	it("should emit queue metrics", async () => {
		const metricsKey = "cb:metrics:queues";
		
		// Check metrics are tracked (will fail without handler)
		const metrics = await redis.stream.hgetall(metricsKey);
		expect(metrics.totalTasks).toBeTruthy();
		expect(metrics.avgWaitTime).toBeTruthy();
		expect(metrics.throughput).toBeTruthy();
	});
});