import { z } from "zod";

// Session state event for persistence
export const sessionStateEventInput = z.object({
	sessionId: z.string().min(1),
	instanceId: z.string().min(1),
	eventType: z.enum([
		"hook.pre_tool",
		"hook.post_tool",
		"hook.user_prompt",
		"hook.todo_write",
		"hook.agent_stop",
		"hook.notification",
		"hook.pre_compact",
		"task.created",
		"task.completed",
		"task.failed",
		"swarm.decomposed",
		"swarm.synthesized"
	]),
	eventData: z.record(z.unknown()),
	timestamp: z.number(),
	labels: z.array(z.string()).optional(),
	metadata: z.record(z.unknown()).optional(),
});

export const sessionStateEventOutput = z.object({
	eventId: z.string(),
	persisted: z.boolean(),
	streamPosition: z.string().optional(),
});

// Session state retrieval
export const sessionStateGetInput = z.object({
	sessionId: z.string().min(1),
	fromTimestamp: z.number().optional(),
	toTimestamp: z.number().optional(),
	eventTypes: z.array(z.string()).optional(),
	limit: z.number().min(1).max(1000).default(100),
	condensed: z.boolean().default(false),
});

export const sessionStateGetOutput = z.object({
	sessionId: z.string(),
	events: z.array(z.object({
		eventId: z.string(),
		eventType: z.string(),
		timestamp: z.number(),
		data: z.record(z.unknown()),
		labels: z.array(z.string()).optional(),
	})),
	summary: z.object({
		totalEvents: z.number(),
		firstEvent: z.number().optional(),
		lastEvent: z.number().optional(),
		eventCounts: z.record(z.number()),
	}).optional(),
	condensed: z.object({
		tasks: z.array(z.object({
			id: z.string(),
			text: z.string(),
			status: z.string(),
			result: z.unknown().optional(),
		})).optional(),
		tools: z.array(z.object({
			name: z.string(),
			count: z.number(),
			lastUsed: z.number(),
		})).optional(),
		prompts: z.array(z.object({
			prompt: z.string(),
			timestamp: z.number(),
		})).optional(),
		todos: z.array(z.object({
			content: z.string(),
			status: z.string(),
		})).optional(),
	}).optional(),
});

// Session snapshot for rehydration
export const sessionSnapshotCreateInput = z.object({
	sessionId: z.string().min(1),
	instanceId: z.string().min(1),
	reason: z.enum(["pre_compact", "manual", "checkpoint", "error_recovery"]),
	includeEvents: z.boolean().default(true),
	metadata: z.record(z.unknown()).optional(),
});

export const sessionSnapshotCreateOutput = z.object({
	snapshotId: z.string(),
	sessionId: z.string(),
	timestamp: z.number(),
	size: z.number(),
	eventCount: z.number(),
});

// Session rehydration
export const sessionRehydrateInput = z.object({
	sessionId: z.string().min(1),
	snapshotId: z.string().optional(),
	fromTimestamp: z.number().optional(),
	instanceId: z.string().min(1),
});

export const sessionRehydrateOutput = z.object({
	sessionId: z.string(),
	rehydrated: z.boolean(),
	snapshot: z.object({
		id: z.string(),
		timestamp: z.number(),
		eventCount: z.number(),
	}).optional(),
	context: z.object({
		lastTasks: z.array(z.object({
			id: z.string(),
			text: z.string(),
			status: z.string(),
		})),
		lastTools: z.array(z.string()),
		lastPrompt: z.string().optional(),
		activeTodos: z.array(z.object({
			content: z.string(),
			status: z.string(),
		})),
	}),
});

// Hook state persist - wrapper for all hook events
export const hookStatePersistInput = z.object({
	hookType: z.enum([
		"pre_tool",
		"post_tool",
		"user_prompt",
		"todo_write",
		"agent_stop",
		"notification",
		"pre_compact"
	]),
	hookData: z.record(z.unknown()),
	sessionId: z.string().min(1),
	instanceId: z.string().min(1),
	timestamp: z.number(),
	labels: z.array(z.string()).optional(),
});

export const hookStatePersistOutput = z.object({
	persisted: z.boolean(),
	eventId: z.string(),
	streamPosition: z.string().optional(),
});

// Type exports
export type SessionStateEventInput = z.infer<typeof sessionStateEventInput>;
export type SessionStateEventOutput = z.infer<typeof sessionStateEventOutput>;
export type SessionStateGetInput = z.infer<typeof sessionStateGetInput>;
export type SessionStateGetOutput = z.infer<typeof sessionStateGetOutput>;
export type SessionSnapshotCreateInput = z.infer<typeof sessionSnapshotCreateInput>;
export type SessionSnapshotCreateOutput = z.infer<typeof sessionSnapshotCreateOutput>;
export type SessionRehydrateInput = z.infer<typeof sessionRehydrateInput>;
export type SessionRehydrateOutput = z.infer<typeof sessionRehydrateOutput>;
export type HookStatePersistInput = z.infer<typeof hookStatePersistInput>;
export type HookStatePersistOutput = z.infer<typeof hookStatePersistOutput>;