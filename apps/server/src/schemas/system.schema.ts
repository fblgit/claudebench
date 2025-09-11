import { z } from "zod";

export const InstanceStatus = z.enum(["ACTIVE", "IDLE", "BUSY", "OFFLINE"]);

// system.health
export const systemHealthInput = z.object({
	instanceId: z.string().optional(),
	verbose: z.boolean().optional().default(false),
});

export const systemHealthOutput = z.object({
	status: z.enum(["healthy", "degraded", "unhealthy"]),
	redis: z.object({
		connected: z.boolean(),
		latency: z.number(),
	}),
	postgres: z.object({
		connected: z.boolean(),
		latency: z.number(),
	}),
	instances: z.array(z.object({
		id: z.string(),
		status: InstanceStatus,
		lastHeartbeat: z.string().datetime(),
		uptime: z.number(),
	})),
	handlers: z.object({
		registered: z.number(),
		active: z.number(),
	}),
	metrics: z.object({
		eventsProcessed: z.number(),
		tasksInQueue: z.number(),
		errorRate: z.number(),
	}).optional(),
});

// system.register
export const systemRegisterInput = z.object({
	name: z.string(),
	role: z.string(),
	capabilities: z.array(z.string()),
	metadata: z.record(z.string(), z.any()).optional(),
});

export const systemRegisterOutput = z.object({
	id: z.string(),
	name: z.string(),
	role: z.string(),
	status: z.literal("ACTIVE"),
	registeredAt: z.string().datetime(),
	heartbeatInterval: z.number(),
	sessionToken: z.string().optional(),
});

// system.heartbeat
export const systemHeartbeatInput = z.object({
	instanceId: z.string(),
	status: InstanceStatus.optional(),
	metrics: z.object({
		cpuUsage: z.number().min(0).max(100).optional(),
		memoryUsage: z.number().min(0).max(100).optional(),
		tasksProcessed: z.number().optional(),
		errors: z.number().optional(),
	}).optional(),
});

export const systemHeartbeatOutput = z.object({
	acknowledged: z.boolean(),
	nextHeartbeat: z.number(),
	warnings: z.array(z.string()).optional(),
	commands: z.array(z.object({
		type: z.enum(["shutdown", "restart", "update_config", "assign_task"]),
		payload: z.any().optional(),
	})).optional(),
});

// system.get_state
export const systemGetStateInput = z.object({
	scope: z.enum(["all", "tasks", "instances", "events", "metrics"]).optional().default("all"),
	instanceId: z.string().optional(),
	since: z.string().datetime().optional(),
	limit: z.number().min(1).max(1000).optional().default(100),
});

export const systemGetStateOutput = z.object({
	timestamp: z.string().datetime(),
	scope: z.string(),
	tasks: z.object({
		total: z.number(),
		byStatus: z.record(z.string(), z.number()),
		queue: z.array(z.any()),
	}).optional(),
	instances: z.object({
		total: z.number(),
		byStatus: z.record(z.string(), z.number()),
		list: z.array(z.any()),
	}).optional(),
	events: z.object({
		total: z.number(),
		recent: z.array(z.any()),
		byType: z.record(z.string(), z.number()),
	}).optional(),
	metrics: z.object({
		eventsPerSecond: z.number(),
		averageLatency: z.number(),
		errorRate: z.number(),
		throughput: z.number(),
	}).optional(),
});

// system.metrics
export const systemMetricsInput = z.object({
	period: z.enum(["1m", "5m", "15m", "1h", "24h"]).optional().default("5m"),
	instanceId: z.string().optional(),
});

export const systemMetricsOutput = z.object({
	period: z.string(),
	events: z.object({
		total: z.number(),
		byType: z.record(z.string(), z.number()),
		rate: z.number(),
	}),
	tasks: z.object({
		created: z.number(),
		completed: z.number(),
		failed: z.number(),
		avgDuration: z.number(),
	}),
	instances: z.object({
		active: z.number(),
		total: z.number(),
		avgUptime: z.number(),
	}),
	errors: z.object({
		total: z.number(),
		byType: z.record(z.string(), z.number()),
		rate: z.number(),
	}),
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