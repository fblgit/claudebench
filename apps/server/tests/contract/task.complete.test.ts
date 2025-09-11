import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { getRedis } from "@/core/redis";

// Task complete schemas
const taskCompleteInputSchema = z.object({
	id: z.string(),
	result: z.any().optional(),
	error: z.string().optional(),
	metadata: z.record(z.string(), z.any()).optional(),
});

const taskCompleteOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	status: z.literal("COMPLETED").or(z.literal("FAILED")),
	result: z.any().nullable(),
	error: z.string().nullable(),
	completedAt: z.string().datetime(),
	completedBy: z.string(),
	duration: z.number(), // milliseconds
});

describe("Contract: task.complete", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
	});

	afterAll(async () => {
		await redis.disconnect();
	});

	it("should validate input parameters", () => {
		const validInputs = [
			{ id: "task-123", result: { success: true } },
			{ id: "task-123", error: "Task failed due to timeout" },
			{ id: "task-123", result: "Completed successfully", metadata: { retries: 0 } },
		];

		for (const input of validInputs) {
			const result = taskCompleteInputSchema.safeParse(input);
			expect(result.success).toBe(true);
		}
	});

	it("should reject invalid input parameters", () => {
		const invalidInputs = [
			{}, // Missing id
			{ id: "" }, // Empty id
			{ id: "task-123", result: "success", error: "also failed" }, // Both result and error
		];

		for (const input of invalidInputs) {
			const result = taskCompleteInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		}
	});

	it("should verify task exists and is assigned", async () => {
		const taskKey = "cb:task:task-123";
		const taskData = await redis.stream.hgetall(taskKey);
		
		// Will fail: no handler to create/assign tasks
		expect(taskData.status).toBe("IN_PROGRESS");
		expect(taskData.assignedTo).toBeTruthy();
	});

	it("should update task status to COMPLETED", async () => {
		const taskKey = "cb:task:task-success";
		const status = await redis.stream.hget(taskKey, "status");
		
		// Will fail: no handler to complete tasks
		expect(status).toBe("COMPLETED");
	});

	it("should update task status to FAILED on error", async () => {
		const taskKey = "cb:task:task-failed";
		const taskData = await redis.stream.hgetall(taskKey);
		
		// Will fail: no handler to fail tasks
		expect(taskData.status).toBe("FAILED");
		expect(taskData.error).toBeTruthy();
	});

	it("should set completedAt timestamp", async () => {
		const taskKey = "cb:task:task-completed";
		const completedAt = await redis.stream.hget(taskKey, "completedAt");
		
		// Will fail: no handler to set completion time
		expect(completedAt).toBeTruthy();
		expect(new Date(completedAt as string).getTime()).toBeLessThanOrEqual(Date.now());
	});

	it("should remove task from instance queue", async () => {
		const queueKey = "cb:queue:instance:worker-1";
		const taskInQueue = await redis.stream.lpos(queueKey, "task-123");
		
		// Will fail: no handler to remove from queue
		expect(taskInQueue).toBeNull();
	});

	it("should publish task.complete event", async () => {
		const streamKey = "cb:stream:task.complete";
		const events = await redis.stream.xrange(streamKey, "-", "+", "COUNT", 1);
		
		// Will fail: no handler to publish events
		expect(events.length).toBeGreaterThan(0);
	});

	it("should calculate task duration", async () => {
		const taskKey = "cb:task:task-with-duration";
		const taskData = await redis.stream.hgetall(taskKey);
		
		// Will fail: no handler to track duration
		expect(taskData.duration).toBeTruthy();
		const duration = parseInt(taskData.duration as string);
		expect(duration).toBeGreaterThan(0);
	});

	it("should prevent completing unassigned tasks", async () => {
		const taskKey = "cb:task:unassigned-task";
		const taskData = await redis.stream.hgetall(taskKey);
		
		// Will fail: handler should prevent this
		expect(taskData.status).not.toBe("COMPLETED");
		expect(taskData.assignedTo).toBeFalsy();
	});

	it("should prevent double completion", async () => {
		const taskKey = "cb:task:already-completed";
		const status = await redis.stream.hget(taskKey, "status");
		
		// Task should remain in its first completed state
		// Will fail: no handler to prevent double completion
		expect(status).toBe("COMPLETED");
		
		const historyKey = "cb:history:task:already-completed:completions";
		const completions = await redis.stream.llen(historyKey);
		expect(completions).toBe(1);
	});

	it("should validate output schema", () => {
		const mockOutput = {
			id: "task-123",
			title: "Test Task",
			status: "COMPLETED",
			result: { data: "processed" },
			error: null,
			completedAt: new Date().toISOString(),
			completedBy: "worker-1",
			duration: 1523,
		};

		const result = taskCompleteOutputSchema.safeParse(mockOutput);
		expect(result.success).toBe(true);
	});

	it("should update instance metrics", async () => {
		const metricsKey = "cb:metrics:instance:worker-1";
		const completedCount = await redis.stream.hget(metricsKey, "tasksCompleted");
		
		// Will fail: no handler to track metrics
		expect(completedCount).toBeTruthy();
		expect(parseInt(completedCount as string)).toBeGreaterThan(0);
	});
});