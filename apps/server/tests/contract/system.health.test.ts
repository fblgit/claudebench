import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { getRedis } from "@/core/redis";

// System health schemas
const systemHealthInputSchema = z.object({
	instanceId: z.string().optional(),
	verbose: z.boolean().optional().default(false),
});

const systemHealthOutputSchema = z.object({
	status: z.enum(["healthy", "degraded", "unhealthy"]),
	redis: z.object({
		connected: z.boolean(),
		latency: z.number(), // milliseconds
	}),
	postgres: z.object({
		connected: z.boolean(),
		latency: z.number(),
	}),
	instances: z.array(z.object({
		id: z.string(),
		status: z.enum(["ACTIVE", "IDLE", "BUSY", "OFFLINE"]),
		lastHeartbeat: z.string().datetime(),
		uptime: z.number(), // seconds
	})),
	handlers: z.object({
		registered: z.number(),
		active: z.number(),
	}),
	metrics: z.object({
		eventsProcessed: z.number(),
		tasksInQueue: z.number(),
		errorRate: z.number(), // percentage
	}).optional(),
});

describe("Contract: system.health", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
	});

	afterAll(async () => {
		await redis.disconnect();
	});

	it("should validate input parameters", () => {
		const validInputs = [
			{},
			{ instanceId: "worker-1" },
			{ verbose: true },
			{ instanceId: "supervisor-1", verbose: true },
		];

		for (const input of validInputs) {
			const result = systemHealthInputSchema.safeParse(input);
			expect(result.success).toBe(true);
		}
	});

	it("should check Redis connectivity", async () => {
		const healthKey = "cb:health:redis";
		const isConnected = await redis.stream.get(healthKey);
		
		// Will fail: no handler to check health
		expect(isConnected).toBe("true");
	});

	it("should check PostgreSQL connectivity", async () => {
		const healthKey = "cb:health:postgres";
		const isConnected = await redis.stream.get(healthKey);
		
		// Will fail: no handler to check database
		expect(isConnected).toBe("true");
	});

	it("should list active instances", async () => {
		const instancesKey = "cb:instances:active";
		const instances = await redis.stream.smembers(instancesKey);
		
		// Will fail: no handler to track instances
		expect(instances.length).toBeGreaterThan(0);
	});

	it("should calculate system status", async () => {
		const statusKey = "cb:system:status";
		const status = await redis.stream.get(statusKey);
		
		// Will fail: no handler to calculate status
		expect(["healthy", "degraded", "unhealthy"]).toContain(status);
	});

	it("should measure Redis latency", async () => {
		const latencyKey = "cb:metrics:redis:latency";
		const latency = await redis.stream.get(latencyKey);
		
		// Will fail: no handler to measure latency
		expect(parseInt(latency as string)).toBeLessThan(100);
	});

	it("should count registered handlers", async () => {
		const handlersKey = "cb:handlers:registry";
		const handlers = await redis.stream.hkeys(handlersKey);
		
		// Will fail: no handler registry exists
		expect(handlers.length).toBeGreaterThan(0);
	});

	it("should validate output schema", () => {
		const mockOutput = {
			status: "healthy",
			redis: { connected: true, latency: 2 },
			postgres: { connected: true, latency: 5 },
			instances: [
				{
					id: "worker-1",
					status: "ACTIVE",
					lastHeartbeat: new Date().toISOString(),
					uptime: 3600,
				},
			],
			handlers: { registered: 15, active: 12 },
			metrics: {
				eventsProcessed: 1000,
				tasksInQueue: 5,
				errorRate: 0.5,
			},
		};

		const result = systemHealthOutputSchema.safeParse(mockOutput);
		expect(result.success).toBe(true);
	});

	it("should detect degraded state", async () => {
		// When some services are down
		const degradedKey = "cb:health:degraded:reason";
		const reason = await redis.stream.get(degradedKey);
		
		// Will fail: no handler to detect degradation
		expect(reason).toBeFalsy(); // Should be healthy
	});

	it("should cache health check results", async () => {
		const cacheKey = "cb:cache:health:latest";
		const cached = await redis.stream.get(cacheKey);
		
		// Will fail: no handler to cache results
		expect(cached).toBeTruthy();
	});

	it("should include verbose metrics when requested", async () => {
		const verboseKey = "cb:health:verbose:metrics";
		const metrics = await redis.stream.hgetall(verboseKey);
		
		// Will fail: no handler to provide verbose output
		expect(Object.keys(metrics).length).toBeGreaterThan(5);
	});
});