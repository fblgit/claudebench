import { z } from "zod";

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

// task.update_attachment
export const taskUpdateAttachmentInput = z.object({
	taskId: z.string().min(1),
	key: z.string().min(1),
	value: z.any().optional(),
	content: z.string().optional(),
	url: z.string().url().optional(),
});

export const taskUpdateAttachmentOutput = z.object({
	id: z.string(),
	taskId: z.string(),
	key: z.string(),
	type: AttachmentType,
	updatedAt: z.string().datetime(),
});

// task.delete_attachment
export const taskDeleteAttachmentInput = z.object({
	taskId: z.string().min(1),
	key: z.string().min(1),
});

export const taskDeleteAttachmentOutput = z.object({
	deleted: z.boolean(),
	taskId: z.string(),
	key: z.string(),
});

// Type exports
export type TaskCreateAttachmentInput = z.infer<typeof taskCreateAttachmentInput>;
export type TaskCreateAttachmentOutput = z.infer<typeof taskCreateAttachmentOutput>;
export type TaskListAttachmentsInput = z.infer<typeof taskListAttachmentsInput>;
export type TaskListAttachmentsOutput = z.infer<typeof taskListAttachmentsOutput>;
export type TaskGetAttachmentInput = z.infer<typeof taskGetAttachmentInput>;
export type TaskGetAttachmentOutput = z.infer<typeof taskGetAttachmentOutput>;
export type TaskUpdateAttachmentInput = z.infer<typeof taskUpdateAttachmentInput>;
export type TaskUpdateAttachmentOutput = z.infer<typeof taskUpdateAttachmentOutput>;
export type TaskDeleteAttachmentInput = z.infer<typeof taskDeleteAttachmentInput>;
export type TaskDeleteAttachmentOutput = z.infer<typeof taskDeleteAttachmentOutput>;