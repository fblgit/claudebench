import { z } from "zod";

// Task status enum (lowercase per contract)
export const TaskStatus = z.enum([
	"pending",
	"in_progress",
	"completed",
	"failed",
]);

// task.create
export const taskCreateInput = z.object({
	text: z.string().min(1).max(500), // Changed from title to text, max 500 per contract
	priority: z.number().int().min(0).max(100).default(50), // Changed to 0-100, default 50
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const taskCreateOutput = z.object({
	id: z.string(),
	text: z.string(),
	status: TaskStatus,
	priority: z.number(),
	createdAt: z.string().datetime(),
});

// task.update
export const taskUpdateInput = z.object({
	id: z.string().min(1), // min(1) to reject empty strings
	updates: z.object({
		text: z.string().min(1).max(500).optional(),
		status: TaskStatus.optional(),
		priority: z.number().int().min(0).max(100).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	}),
});

// Contract doesn't specify output, but returning updated task for consistency
export const taskUpdateOutput = z.object({
	id: z.string(),
	text: z.string(),
	status: TaskStatus,
	priority: z.number(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

// task.assign
export const taskAssignInput = z.object({
	taskId: z.string().min(1), // min(1) to reject empty strings
	instanceId: z.string().min(1), // min(1) to reject empty strings
});

// Contract doesn't specify output format
export const taskAssignOutput = z.object({
	taskId: z.string(),
	instanceId: z.string(),
	assignedAt: z.string().datetime(),
});

// task.complete
export const taskCompleteInput = z.object({
	id: z.string().min(1), // min(1) to reject empty strings
	result: z.unknown().optional(),
});

// Contract doesn't specify output format
export const taskCompleteOutput = z.object({
	id: z.string(),
	status: z.literal("completed").or(z.literal("failed")),
	completedAt: z.string().datetime(),
});

export type TaskCreateInput = z.infer<typeof taskCreateInput>;
export type TaskCreateOutput = z.infer<typeof taskCreateOutput>;
export type TaskUpdateInput = z.infer<typeof taskUpdateInput>;
export type TaskUpdateOutput = z.infer<typeof taskUpdateOutput>;
export type TaskAssignInput = z.infer<typeof taskAssignInput>;
export type TaskAssignOutput = z.infer<typeof taskAssignOutput>;
export type TaskCompleteInput = z.infer<typeof taskCompleteInput>;
export type TaskCompleteOutput = z.infer<typeof taskCompleteOutput>;