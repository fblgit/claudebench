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
	id: z.string().min(1).optional(), // min(1) to reject empty strings
	taskId: z.string().min(1).optional(), // Support both id and taskId
	workerId: z.string().min(1).optional(), // Optional worker ID for tracking
	result: z.unknown().optional(),
}).refine(data => data.id || data.taskId, {
	message: "Either 'id' or 'taskId' must be provided",
	path: ["id"],
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

// task.claim - NEW for pull model (distributed pattern)
export const taskClaimInput = z.object({
	workerId: z.string().min(1),
	maxTasks: z.number().int().min(1).max(10).default(1),
});

export const taskClaimOutput = z.object({
	claimed: z.boolean(),
	taskId: z.string().optional(),
	task: z.object({
		id: z.string(),
		text: z.string(),
		priority: z.number(),
		status: TaskStatus,
		assignedTo: z.string().nullable(),
		metadata: z.record(z.string(), z.unknown()).nullable(),
		result: z.unknown().nullable(),
		error: z.string().nullable(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
		completedAt: z.string().datetime().nullable(),
		attachments: z.record(z.string(), z.object({
			type: z.string(),
			value: z.unknown(),
			createdAt: z.string()
		})).optional(),
		attachmentCount: z.number().optional(),
	}).optional(),
});

export type TaskClaimInput = z.infer<typeof taskClaimInput>;
export type TaskClaimOutput = z.infer<typeof taskClaimOutput>;

// task.list - NEW for listing/filtering tasks
export const taskListInput = z.object({
	status: TaskStatus.optional(),
	assignedTo: z.string().optional(),
	priority: z.number().int().min(0).max(100).optional(),
	limit: z.number().int().min(1).max(1000).default(100),
	offset: z.number().int().min(0).default(0),
	orderBy: z.enum(["createdAt", "updatedAt", "priority", "status", "assignedTo"]).default("createdAt"),
	order: z.enum(["asc", "desc"]).default("desc"),
});

export const taskListOutput = z.object({
	tasks: z.array(z.object({
		id: z.string(),
		text: z.string(),
		status: TaskStatus,
		priority: z.number(),
		assignedTo: z.string().nullable(),
		metadata: z.record(z.string(), z.unknown()).nullable(),
		result: z.unknown().nullable(),
		error: z.string().nullable(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
		completedAt: z.string().datetime().nullable(),
		attachmentCount: z.number().int().min(0).default(0),
		attachmentKeys: z.array(z.string()).optional(),
	})),
	totalCount: z.number(),
	hasMore: z.boolean(),
});

export type TaskListInput = z.infer<typeof taskListInput>;
export type TaskListOutput = z.infer<typeof taskListOutput>;

// Attachment type enum
export const AttachmentType = z.enum([
	"json",
	"markdown",
	"text",
	"url",
	"binary",
]);

// task.create_attachment
export const taskCreateAttachmentInput = z.object({
	taskId: z.string().min(1),
	key: z.string().min(1).max(100), // Unique key for this attachment
	type: AttachmentType,
	value: z.any().optional(), // For JSON data
	content: z.string().optional(), // For text/markdown
	url: z.string().url().optional(), // For URL references
	mimeType: z.string().optional(), // For binary data
	size: z.number().int().positive().optional(), // Size in bytes
});

export const taskCreateAttachmentOutput = z.object({
	id: z.string(),
	taskId: z.string(),
	key: z.string(),
	type: AttachmentType,
	createdAt: z.string().datetime(),
});

// task.list_attachments
export const taskListAttachmentsInput = z.object({
	taskId: z.string().min(1),
	type: AttachmentType.optional(), // Optional filter by type
	limit: z.number().int().min(1).max(100).default(50),
	offset: z.number().int().min(0).default(0),
});

export const taskListAttachmentsOutput = z.object({
	attachments: z.array(z.object({
		id: z.string(),
		taskId: z.string(),
		key: z.string(),
		type: AttachmentType,
		value: z.any().optional(),
		content: z.string().optional(),
		url: z.string().optional(),
		size: z.number().optional(),
		mimeType: z.string().optional(),
		createdBy: z.string().optional(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
	})),
	totalCount: z.number(),
	hasMore: z.boolean(),
});

// task.get_attachment
export const taskGetAttachmentInput = z.object({
	taskId: z.string().min(1),
	key: z.string().min(1),
});

export const taskGetAttachmentOutput = z.object({
	id: z.string(),
	taskId: z.string(),
	key: z.string(),
	type: AttachmentType,
	value: z.any().optional(),
	content: z.string().optional(),
	url: z.string().optional(),
	size: z.number().optional(),
	mimeType: z.string().optional(),
	createdBy: z.string().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
});

// Type exports for attachments
export type TaskCreateAttachmentInput = z.infer<typeof taskCreateAttachmentInput>;
export type TaskCreateAttachmentOutput = z.infer<typeof taskCreateAttachmentOutput>;
export type TaskListAttachmentsInput = z.infer<typeof taskListAttachmentsInput>;
export type TaskListAttachmentsOutput = z.infer<typeof taskListAttachmentsOutput>;
export type TaskGetAttachmentInput = z.infer<typeof taskGetAttachmentInput>;
export type TaskGetAttachmentOutput = z.infer<typeof taskGetAttachmentOutput>;

// Batch attachment operations
export const taskGetAttachmentsBatchInput = z.object({
	requests: z.array(z.object({
		taskId: z.string().min(1),
		key: z.string().min(1),
	})).min(1).max(100),
});

export const taskGetAttachmentsBatchOutput = z.object({
	attachments: z.array(taskGetAttachmentOutput),
});

export type TaskGetAttachmentsBatchInput = z.infer<typeof taskGetAttachmentsBatchInput>;
export type TaskGetAttachmentsBatchOutput = z.infer<typeof taskGetAttachmentsBatchOutput>;