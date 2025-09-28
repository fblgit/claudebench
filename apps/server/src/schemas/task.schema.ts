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

// Attachment type enum (moved before task.list to fix ordering)
export const AttachmentType = z.enum([
	"json",
	"markdown",
	"text",
	"url",
	"binary",
]);

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
		resultAttachment: z.object({
			type: AttachmentType,
			value: z.any().optional(),
			content: z.string().optional(),
			createdAt: z.string().datetime()
		}).nullable().optional(),
	})),
	totalCount: z.number(),
	hasMore: z.boolean(),
});

export type TaskListInput = z.infer<typeof taskListInput>;
export type TaskListOutput = z.infer<typeof taskListOutput>;

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

// task.delete_attachment
export const taskDeleteAttachmentInput = z.object({
	taskId: z.string().min(1),
	key: z.string().min(1),
});

export const taskDeleteAttachmentOutput = z.object({
	id: z.string(),
	taskId: z.string(),
	key: z.string(),
	deleted: z.boolean(),
	deletedAt: z.string().datetime(),
});

export type TaskDeleteAttachmentInput = z.infer<typeof taskDeleteAttachmentInput>;
export type TaskDeleteAttachmentOutput = z.infer<typeof taskDeleteAttachmentOutput>;

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

// task.delete
export const taskDeleteInput = z.object({
	id: z.string().min(1),
});

export const taskDeleteOutput = z.object({
	id: z.string(),
	deleted: z.boolean(),
	deletedAt: z.string().datetime(),
});

export type TaskDeleteInput = z.infer<typeof taskDeleteInput>;
export type TaskDeleteOutput = z.infer<typeof taskDeleteOutput>;

// task.unassign
export const taskUnassignInput = z.object({
	taskId: z.string().min(1),
});

export const taskUnassignOutput = z.object({
	taskId: z.string(),
	previousAssignment: z.string().nullable(),
	unassignedAt: z.string().datetime(),
});

export type TaskUnassignInput = z.infer<typeof taskUnassignInput>;
export type TaskUnassignOutput = z.infer<typeof taskUnassignOutput>;

// task.context
export const taskContextInput = z.object({
	taskId: z.string().min(1),
	specialist: z.enum(["frontend", "backend", "testing", "docs", "general"]),
	customDescription: z.string().optional(),
	constraints: z.array(z.string()).optional(),
	requirements: z.array(z.string()).optional(),
	existingFiles: z.array(z.string()).optional(),
	additionalContext: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const taskContextOutput = z.object({
	taskId: z.string(),
	context: z.object({
		taskId: z.string(),
		description: z.string(),
		scope: z.string(),
		mandatoryReadings: z.array(z.object({
			title: z.string(),
			path: z.string(),
			reason: z.string()
		})),
		architectureConstraints: z.array(z.string()),
		relatedWork: z.array(z.object({
			instanceId: z.string(),
			status: z.string(),
			summary: z.string()
		})),
		successCriteria: z.array(z.string()),
		discoveredPatterns: z.array(z.string()).optional(),
		integrationPoints: z.array(z.string()).optional(),
		recommendedApproach: z.string().optional()
	}),
	prompt: z.string()
});

export type TaskContextInput = z.infer<typeof taskContextInput>;
export type TaskContextOutput = z.infer<typeof taskContextOutput>;

// task.decompose
export const taskDecomposeInput = z.object({
	taskId: z.string().min(1),
	task: z.string().min(1).max(1000),
	priority: z.number().int().min(0).max(100).default(50),
	constraints: z.array(z.string()).optional(),
	sessionId: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const taskDecomposeOutput = z.object({
	taskId: z.string(),
	subtaskCount: z.number(),
	decomposition: z.object({
		subtasks: z.array(z.object({
			id: z.string(),
			description: z.string(),
			specialist: z.enum(["frontend", "backend", "testing", "docs", "general"]),
			dependencies: z.array(z.string()),
			complexity: z.number().min(1).max(100),
			context: z.object({
				files: z.array(z.string()),
				patterns: z.array(z.string()),
				constraints: z.array(z.string()),
			}),
			estimatedMinutes: z.number()
		})),
		executionStrategy: z.enum(["parallel", "sequential", "mixed"]),
		totalComplexity: z.number(),
		reasoning: z.string()
	}),
	attachmentKey: z.string(),
});

export type TaskDecomposeInput = z.infer<typeof taskDecomposeInput>;
export type TaskDecomposeOutput = z.infer<typeof taskDecomposeOutput>;

// task.create_project
export const taskCreateProjectInput = z.object({
	project: z.string().min(1).max(2000),
	priority: z.number().int().min(0).max(100).default(75),
	constraints: z.array(z.string()).optional(),
	requirements: z.array(z.string()).optional(),
	sessionId: z.string().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

export const taskCreateProjectOutput = z.object({
	projectId: z.string(),
	taskId: z.string(),
	status: z.enum(["created", "decomposing", "ready", "failed"]),
	estimatedMinutes: z.number().optional(),
	message: z.string(),
	attachmentKey: z.string(),
});

export type TaskCreateProjectInput = z.infer<typeof taskCreateProjectInput>;
export type TaskCreateProjectOutput = z.infer<typeof taskCreateProjectOutput>;

// task.get_project
export const taskGetProjectInput = z.object({
	projectId: z.string().min(1).optional(),
	taskId: z.string().min(1).optional(),
}).refine(data => data.projectId || data.taskId, {
	message: "Either 'projectId' or 'taskId' must be provided",
	path: ["projectId"],
});

export const taskGetProjectOutput = z.object({
	projectId: z.string(),
	parentTask: z.object({
		id: z.string(),
		text: z.string(),
		status: TaskStatus,
		priority: z.number(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
		metadata: z.record(z.string(), z.unknown()).nullable(),
		attachments: z.array(z.object({
			key: z.string(),
			type: AttachmentType,
			value: z.unknown().optional(),
			createdAt: z.string()
		})).optional(),
	}),
	subtasks: z.array(z.object({
		id: z.string(),
		text: z.string(),
		status: TaskStatus,
		priority: z.number(),
		specialist: z.string().optional(),
		complexity: z.number().optional(),
		estimatedMinutes: z.number().optional(),
		dependencies: z.array(z.string()).optional(),
		createdAt: z.string().datetime(),
		updatedAt: z.string().datetime(),
		attachments: z.array(z.object({
			key: z.string(),
			type: AttachmentType,
			value: z.unknown().optional(),
			createdAt: z.string()
		})).optional(),
	})),
	projectMetadata: z.object({
		description: z.string(),
		status: z.string(),
		constraints: z.array(z.string()).optional(),
		requirements: z.array(z.string()).optional(),
		estimatedMinutes: z.number().optional(),
		strategy: z.enum(["parallel", "sequential", "mixed"]).optional(),
		totalComplexity: z.number().optional(),
		createdAt: z.string().datetime(),
		createdBy: z.string().optional(),
	}),
	stats: z.object({
		totalTasks: z.number(),
		pendingTasks: z.number(),
		inProgressTasks: z.number(),
		completedTasks: z.number(),
		failedTasks: z.number(),
	})
});

export type TaskGetProjectInput = z.infer<typeof taskGetProjectInput>;
export type TaskGetProjectOutput = z.infer<typeof taskGetProjectOutput>;