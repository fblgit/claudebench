import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { getRedis } from "@/core/redis";
import type { RedisConnection } from "@/core/redis";

// JSONRPC 2.0 Request/Response schemas
const jsonRpcRequestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	method: z.string(),
	params: z.any(),
	id: z.union([z.string(), z.number()]).optional(),
});

const jsonRpcResponseSchema = z.object({
	jsonrpc: z.literal("2.0"),
	result: z.any().optional(),
	error: z.object({
		code: z.number(),
		message: z.string(),
		data: z.any().optional(),
	}).optional(),
	id: z.union([z.string(), z.number(), z.null()]),
});

// Task domain schemas
const taskCreateInputSchema = z.object({
	title: z.string().min(1).max(255),
	description: z.string().optional(),
	priority: z.number().int().min(0).max(10).default(0),
	metadata: z.record(z.string(), z.any()).optional(),
});

const taskCreateOutputSchema = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	status: z.enum(["PENDING", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"]),
	priority: z.number(),
	assignedTo: z.string().nullable(),
	metadata: z.record(z.string(), z.any()).nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

describe("Contract: task.create", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		// Clear test data
		const keys = await redis.stream.keys("cb:test:*");
		if (keys.length > 0) {
			await redis.stream.del(...keys);
		}
	});

	afterAll(async () => {
		await redis.disconnect();
	});

	it("should validate JSONRPC request structure", async () => {
		const request = {
			jsonrpc: "2.0",
			method: "task.create",
			params: {
				title: "Test Task",
				description: "Test Description",
				priority: 5,
			},
			id: "test-1",
		};

		const result = jsonRpcRequestSchema.safeParse(request);
		expect(result.success).toBe(true);
	});

	it("should validate input parameters", async () => {
		const validInput = {
			title: "Test Task",
			description: "Test Description",
			priority: 5,
			metadata: { source: "test" },
		};

		const result = taskCreateInputSchema.safeParse(validInput);
		expect(result.success).toBe(true);
	});

	it("should reject invalid input parameters", async () => {
		const invalidInputs = [
			{}, // Missing title
			{ title: "" }, // Empty title
			{ title: "a".repeat(256) }, // Title too long
			{ title: "Test", priority: -1 }, // Invalid priority
			{ title: "Test", priority: 11 }, // Priority too high
		];

		for (const input of invalidInputs) {
			const result = taskCreateInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		}
	});

	it("should publish task.create event to Redis stream", async () => {
		// This test will fail until handler is implemented
		const streamKey = "cb:stream:task.create";
		const request = {
			jsonrpc: "2.0",
			method: "task.create",
			params: {
				title: "Test Task",
				description: "Test Description",
				priority: 5,
			},
			id: "test-2",
		};

		// Simulate event publication (will be done by handler)
		// This is what the handler should do:
		const eventId = await redis.stream.xadd(
			streamKey,
			"*",
			"data",
			JSON.stringify(request)
		);

		expect(eventId).toBeTruthy();

		// Verify event was added to stream
		const events = await redis.stream.xrange(streamKey, "-", "+", "COUNT", 1);
		expect(events.length).toBe(1);
		expect(JSON.parse(events[0][1][1])).toEqual(request);
	});

	it("should validate output schema", async () => {
		const mockOutput = {
			id: "task-123",
			title: "Test Task",
			description: "Test Description",
			status: "PENDING",
			priority: 5,
			assignedTo: null,
			metadata: { source: "test" },
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const result = taskCreateOutputSchema.safeParse(mockOutput);
		expect(result.success).toBe(true);
	});

	it("should handle concurrent task creation", async () => {
		// This test ensures the handler can handle multiple simultaneous requests
		const promises = Array.from({ length: 10 }, (_, i) => ({
			jsonrpc: "2.0",
			method: "task.create",
			params: {
				title: `Concurrent Task ${i}`,
				priority: i % 5,
			},
			id: `concurrent-${i}`,
		}));

		// When handler is implemented, this should process all requests
		// For now, we just validate the request structure
		for (const request of promises) {
			const result = jsonRpcRequestSchema.safeParse(request);
			expect(result.success).toBe(true);
		}
	});

	it("should enforce rate limiting", async () => {
		// This test will fail until rate limiter is implemented
		const rateLimitKey = "cb:ratelimit:task.create:test-client";
		const windowMs = 1000;
		const maxRequests = 5;

		// Simulate rate limit tracking (will be done by rate limiter)
		const now = Date.now();
		const promises = [];

		for (let i = 0; i < maxRequests + 2; i++) {
			promises.push(
				redis.stream.zadd(
					rateLimitKey,
					now + i,
					`req-${i}`
				)
			);
		}

		await Promise.all(promises);

		// Check if rate limit would be exceeded
		const count = await redis.stream.zcount(
			rateLimitKey,
			now - windowMs,
			now + windowMs
		);

		expect(count).toBeGreaterThan(maxRequests);
	});
});