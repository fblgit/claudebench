import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { getRedis } from "@/core/redis";

// System register schemas
const systemRegisterInputSchema = z.object({
	name: z.string(),
	role: z.string(),
	capabilities: z.array(z.string()), // Handler names this instance supports
	metadata: z.record(z.any()).optional(),
});

const systemRegisterOutputSchema = z.object({
	id: z.string(),
	name: z.string(),
	role: z.string(),
	status: z.literal("ACTIVE"),
	registeredAt: z.string().datetime(),
	heartbeatInterval: z.number(), // milliseconds
	sessionToken: z.string().optional(),
});

describe("Contract: system.register", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
	});

	afterAll(async () => {
		await redis.disconnect();
	});

	it("should validate input parameters", () => {
		const validInputs = [
			{
				name: "worker-node-1",
				role: "worker",
				capabilities: ["task.create", "task.update", "task.complete"],
			},
			{
				name: "supervisor-1",
				role: "supervisor",
				capabilities: ["system.health", "system.metrics", "task.assign"],
				metadata: { region: "us-east", version: "1.0.0" },
			},
		];

		for (const input of validInputs) {
			const result = systemRegisterInputSchema.safeParse(input);
			expect(result.success).toBe(true);
		}
	});

	it("should reject invalid input parameters", () => {
		const invalidInputs = [
			{}, // Missing required fields
			{ name: "worker" }, // Missing role and capabilities
			{ name: "", role: "worker", capabilities: [] }, // Empty name
			{ name: "worker", role: "", capabilities: [] }, // Empty role
			{ name: "worker", role: "worker", capabilities: "invalid" }, // Invalid capabilities type
		];

		for (const input of invalidInputs) {
			const result = systemRegisterInputSchema.safeParse(input);
			expect(result.success).toBe(false);
		}
	});

	it("should create instance record in Redis", async () => {
		const instanceKey = "cb:instance:test-instance";
		const instanceData = await redis.stream.hgetall(instanceKey);
		
		// Will fail: no handler to create instance
		expect(instanceData.name).toBeTruthy();
		expect(instanceData.role).toBeTruthy();
	});

	it("should add instance to active set", async () => {
		const activeKey = "cb:instances:active";
		const activeInstances = await redis.stream.smembers(activeKey);
		
		// Will fail: no handler to track active instances
		expect(activeInstances.length).toBeGreaterThan(0);
	});

	it("should register instance capabilities", async () => {
		const capabilitiesKey = "cb:capabilities:test-instance";
		const capabilities = await redis.stream.smembers(capabilitiesKey);
		
		// Will fail: no handler to store capabilities
		expect(capabilities.length).toBeGreaterThan(0);
		expect(capabilities).toContain("task.create");
	});

	it("should publish system.register event", async () => {
		const streamKey = "cb:stream:system.register";
		const events = await redis.stream.xrange(streamKey, "-", "+", "COUNT", 1);
		
		// Will fail: no handler to publish events
		expect(events.length).toBeGreaterThan(0);
	});

	it("should prevent duplicate registration", async () => {
		const duplicateKey = "cb:instances:names";
		const names = await redis.stream.smembers(duplicateKey);
		
		// Will fail: no handler to track unique names
		const uniqueNames = new Set(names);
		expect(uniqueNames.size).toBe(names.length);
	});

	it("should set initial heartbeat", async () => {
		const instanceKey = "cb:instance:new-instance";
		const lastHeartbeat = await redis.stream.hget(instanceKey, "lastHeartbeat");
		
		// Will fail: no handler to set heartbeat
		expect(lastHeartbeat).toBeTruthy();
		expect(new Date(lastHeartbeat as string).getTime()).toBeLessThanOrEqual(Date.now());
	});

	it("should validate output schema", () => {
		const mockOutput = {
			id: "instance-123",
			name: "worker-node-1",
			role: "worker",
			status: "ACTIVE",
			registeredAt: new Date().toISOString(),
			heartbeatInterval: 30000,
			sessionToken: "token-abc-123",
		};

		const result = systemRegisterOutputSchema.safeParse(mockOutput);
		expect(result.success).toBe(true);
	});

	it("should index instances by role", async () => {
		const roleKey = "cb:instances:role:worker";
		const workers = await redis.stream.smembers(roleKey);
		
		// Will fail: no handler to index by role
		expect(workers.length).toBeGreaterThan(0);
	});

	it("should generate unique instance ID", async () => {
		const idsKey = "cb:instances:ids";
		const ids = await redis.stream.smembers(idsKey);
		
		// Will fail: no handler to track IDs
		const uniqueIds = new Set(ids);
		expect(uniqueIds.size).toBe(ids.length);
	});

	it("should store registration metadata", async () => {
		const metadataKey = "cb:instance:meta-instance:metadata";
		const metadata = await redis.stream.hgetall(metadataKey);
		
		// Will fail: no handler to store metadata
		expect(metadata).toBeTruthy();
		expect(Object.keys(metadata).length).toBeGreaterThan(0);
	});
});