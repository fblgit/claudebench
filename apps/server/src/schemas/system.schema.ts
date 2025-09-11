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
export const systemMetricsInput = z.object({});

export const systemMetricsOutput = z.object({
	eventsProcessed: z.number().optional(),
	tasksCompleted: z.number().optional(),
	averageLatency: z.number().optional(),
	memoryUsage: z.number().optional(),
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