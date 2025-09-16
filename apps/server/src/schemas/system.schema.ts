import { z } from "zod";

export const InstanceStatus = z.enum(["ACTIVE", "IDLE", "BUSY", "OFFLINE"]);

// system.health - Aligned with JSONRPC contract
export const systemHealthInput = z.object({});

export const systemHealthOutput = z.object({
	status: z.enum(["healthy", "degraded", "unhealthy"]),
	services: z.object({
		redis: z.boolean(),
		postgres: z.boolean(),
		mcp: z.boolean(),
	}),
});

// system.register - Aligned with JSONRPC contract
export const systemRegisterInput = z.object({
	id: z.string().min(1),
	roles: z.array(z.string()),
});

export const systemRegisterOutput = z.object({
	registered: z.boolean(),
});

// system.heartbeat - Aligned with JSONRPC contract
export const systemHeartbeatInput = z.object({
	instanceId: z.string().min(1),
});

export const systemHeartbeatOutput = z.object({
	alive: z.boolean(),
});

// system.get_state - Aligned with JSONRPC contract
export const systemGetStateInput = z.object({});

export const systemGetStateOutput = z.object({
	tasks: z.array(z.any()).optional(),
	instances: z.array(z.any()).optional(),
	recentEvents: z.array(z.any()).optional(),
});

// system.metrics - Aligned with JSONRPC contract
export const systemMetricsInput = z.object({
	detailed: z.boolean().optional(), // Request detailed metrics
});

export const systemMetricsOutput = z.object({
	eventsProcessed: z.number().optional(),
	tasksCompleted: z.number().optional(),
	averageLatency: z.number().optional(),
	memoryUsage: z.number().optional(),
	// Extended metrics (when detailed=true)
	circuitBreaker: z.object({
		totalSuccesses: z.number(),
		totalFailures: z.number(),
		totalTrips: z.number(),
		successRate: z.number(),
	}).optional(),
	queue: z.object({
		depth: z.number(),
		pending: z.number(),
		throughput: z.number(),
	}).optional(),
	cache: z.object({
		hits: z.number(),
		misses: z.number(),
		sets: z.number(),
		hitRate: z.number().optional(),
	}).optional(),
	counters: z.object({
		circuit: z.record(z.string(), z.number()).optional(),
		ratelimit: z.record(z.string(), z.number()).optional(),
		timeout: z.record(z.string(), z.number()).optional(),
	}).optional(),
	global: z.object({
		taskSuccess: z.number().optional(),
		taskFailure: z.number().optional(),
		systemSuccess: z.number().optional(),
		totalEvents: z.number().optional(),
		totalTasks: z.number().optional(),
		avgLatency: z.number().optional(),
		throughput: z.number().optional(),
	}).optional(),
	scaling: z.object({
		instanceCount: z.number().optional(),
		loadBalance: z.number().optional(),
		totalLoad: z.number().optional(),
	}).optional(),
	current: z.object({
		eventsTotal: z.number().optional(),
		queueDepth: z.number().optional(),
		instancesActive: z.number().optional(),
		tasksPending: z.number().optional(),
		tasksCompleted: z.number().optional(),
		metricsStartTime: z.number().optional(),
	}).optional(),
	mcpCalls: z.number().optional(),
	systemHealthCheck: z.object({
		lastCheck: z.number().optional(),
	}).optional(),
});

// system.discover - Expose registered handlers and their schemas
export const systemDiscoverInput = z.object({
	domain: z.string().optional(), // Optional filter by domain (e.g., "task", "system", "hook")
});

export const systemDiscoverOutput = z.object({
	methods: z.array(z.object({
		name: z.string(), // Event name (e.g., "task.create")
		description: z.string().optional(),
		inputSchema: z.any().optional(), // The Zod schema as JSON
		outputSchema: z.any().optional(), // The Zod schema as JSON
		metadata: z.object({
			persist: z.boolean().optional(),
			rateLimit: z.number().optional(),
			roles: z.array(z.string()).optional(),
		}).optional(),
	})),
});

export type SystemHealthInput = z.infer<typeof systemHealthInput>;
export type SystemHealthOutput = z.infer<typeof systemHealthOutput>;
export type SystemRegisterInput = z.infer<typeof systemRegisterInput>;
export type SystemRegisterOutput = z.infer<typeof systemRegisterOutput>;
export type SystemHeartbeatInput = z.infer<typeof systemHeartbeatInput>;
export type SystemHeartbeatOutput = z.infer<typeof systemHeartbeatOutput>;
export type SystemGetStateInput = z.infer<typeof systemGetStateInput>;
export type SystemGetStateOutput = z.infer<typeof systemGetStateOutput>;
export type SystemMetricsInput = z.infer<typeof systemMetricsInput>;
export type SystemMetricsOutput = z.infer<typeof systemMetricsOutput>;
export type SystemDiscoverInput = z.infer<typeof systemDiscoverInput>;
export type SystemDiscoverOutput = z.infer<typeof systemDiscoverOutput>;