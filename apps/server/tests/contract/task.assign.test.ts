import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { getRedis } from "@/core/redis";

// Task assign schemas
const taskAssignInputSchema = z.object({
	taskId: z.string(),
	instanceId: z.string(),
	force: z.boolean().optional().default(false),
});

const taskAssignOutputSchema = z.object({
	taskId: z.string(),
	instanceId: z.string(),
	assignedAt: z.string().datetime(),
	previousAssignment: z.string().nullable(),
});

describe("Contract: task.assign", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
	});

	afterAll(async () => {
		await redis.disconnect();
	});

	it("should validate input parameters", () => {
		const validInputs = [
			{ taskId: "task-123", instanceId: "worker-1" },
			{ taskId: "task-123", instanceId: "worker-2", force: true },
			{ taskId: "task-456", instanceId: "supervisor-1", force: false },
		];

		for (const input of validInputs) {
			const result = taskAssignInputSchema.safeParse(input);
			expect(result.success).toBe(true);
		}
	});

	it("should reject invalid input parameters", () => {
		const invalidInputs = [
			{}, // Missing required fields
			{ taskId: "task-123" }, // Missing instanceId
			{ instanceId: "worker-1" }, // Missing taskId
			{ taskId: "", instanceId: "worker-1" }, // Empty taskId
			{ taskId: "task-123", instanceId: "" }, // Empty instanceId
		];

		for (const input of invalidInputs) {
			const result = taskAssignInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		}
	});

	it("should verify task exists before assignment", async () => {
		const taskKey = "cb:task:task-123";
		const exists = await redis.stream.exists(taskKey);
		
		// Will fail: no handler to create tasks
		expect(exists).toBe(1);
	});

	it("should verify instance exists and is active", async () => {
		const instanceKey = "cb:instance:worker-1";
		const status = await redis.stream.hget(instanceKey, "status");
		
		// Will fail: no handler to register instances
		expect(status).toBe("ACTIVE");
	});

	it("should add task to instance queue", async () => {
		const queueKey = "cb:queue:instance:worker-1";
		const queueSize = await redis.stream.llen(queueKey);
		
		// Will fail: no handler to manage queues
		expect(queueSize).toBeGreaterThan(0);
	});

	it("should update task assignment in Redis", async () => {
		const taskKey = "cb:task:task-123";
		const assignedTo = await redis.stream.hget(taskKey, "assignedTo");
		
		// Will fail: no handler to update assignments
		expect(assignedTo).toBe("worker-1");
	});

	it("should publish task.assign event", async () => {
		const streamKey = "cb:stream:task.assign";
		const events = await redis.stream.xrange(streamKey, "-", "+", "COUNT", 1);
		
		// Will fail: no handler to publish events
		expect(events.length).toBeGreaterThan(0);
	});

	it("should prevent double assignment without force flag", async () => {
		const taskKey = "cb:task:already-assigned";
		const currentAssignment = await redis.stream.hget(taskKey, "assignedTo");
		
		// Will fail: no handler to check assignments
		expect(currentAssignment).toBeTruthy();
		
		// Attempting to assign to different instance should fail
		// This validates the force flag behavior
		const queueKey = "cb:queue:instance:worker-2";
		const inQueue = await redis.stream.lpos(queueKey, "already-assigned");
		
		// Will fail: task shouldn't be in new queue without force
		expect(inQueue).toBeNull();
	});

	it("should handle force reassignment", async () => {
		const taskKey = "cb:task:force-reassign";
		
		// Check if task was reassigned (will fail without handler)
		const assignedTo = await redis.stream.hget(taskKey, "assignedTo");
		expect(assignedTo).toBe("worker-3");
		
		// Old queue should not contain the task
		const oldQueue = "cb:queue:instance:worker-1";
		const inOldQueue = await redis.stream.lpos(oldQueue, "force-reassign");
		expect(inOldQueue).toBeNull();
	});

	it("should validate output schema", () => {
		const mockOutput = {
			taskId: "task-123",
			instanceId: "worker-1",
			assignedAt: new Date().toISOString(),
			previousAssignment: null,
		};

		const result = taskAssignOutputSchema.safeParse(mockOutput);
		expect(result.success).toBe(true);
	});

	it("should track assignment history", async () => {
		const historyKey = "cb:history:task:task-123:assignments";
		const history = await redis.stream.lrange(historyKey, 0, -1);
		
		// Will fail: no handler to track history
		expect(history.length).toBeGreaterThan(0);
		expect(history[0]).toContain("worker-1");
	});
});