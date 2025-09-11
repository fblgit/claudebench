import { z } from "zod";

// Task status enum
export const TaskStatus = z.enum([
	"PENDING",
	"ASSIGNED",
	"IN_PROGRESS",
	"COMPLETED",
	"FAILED",
	"CANCELLED",
]);

// task.create
export const taskCreateInput = z.object({
	title: z.string().min(1).max(255),
	description: z.string().optional(),
	priority: z.number().int().min(0).max(10).default(0),
	metadata: z.record(z.string(), z.any()).optional(),
});

export const taskCreateOutput = z.object({
	id: z.string(),
	title: z.string(),
	description: z.string().nullable(),
	status: TaskStatus,
	priority: z.number(),
	assignedTo: z.string().nullable(),
	metadata: z.record(z.string(), z.any()).nullable(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

// task.update
export const taskUpdateInput = z.object({
	id: z.string(),
	title: z.string().min(1).max(255).optional(),
	description: z.string().optional(),
	status: TaskStatus.optional(),
	priority: z.number().int().min(0).max(10).optional(),
	metadata: z.record(z.string(), z.any()).optional(),
});

export const taskUpdateOutput = taskCreateOutput.extend({
	completedAt: z.string().datetime().nullable(),
});

// task.assign
export const taskAssignInput = z.object({
	taskId: z.string(),
	instanceId: z.string(),
	force: z.boolean().optional().default(false),
});

export const taskAssignOutput = z.object({
	taskId: z.string(),
	instanceId: z.string(),
	assignedAt: z.string().datetime(),
	previousAssignment: z.string().nullable(),
});

// task.complete
export const taskCompleteInput = z.object({
	id: z.string(),
	result: z.any().optional(),
	error: z.string().optional(),
	metadata: z.record(z.string(), z.any()).optional(),
});

export const taskCompleteOutput = z.object({
	id: z.string(),
	title: z.string(),
	status: z.literal("COMPLETED").or(z.literal("FAILED")),
	result: z.any().nullable(),
	error: z.string().nullable(),
	completedAt: z.string().datetime(),
	completedBy: z.string(),
	duration: z.number(),
});

export type TaskCreateInput = z.infer<typeof taskCreateInput>;
export type TaskCreateOutput = z.infer<typeof taskCreateOutput>;
export type TaskUpdateInput = z.infer<typeof taskUpdateInput>;
export type TaskUpdateOutput = z.infer<typeof taskUpdateOutput>;
export type TaskAssignInput = z.infer<typeof taskAssignInput>;
export type TaskAssignOutput = z.infer<typeof taskAssignOutput>;
export type TaskCompleteInput = z.infer<typeof taskCompleteInput>;
export type TaskCompleteOutput = z.infer<typeof taskCompleteOutput>;