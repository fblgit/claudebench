import { z } from "zod";

// git.context.get - Retrieve task context for git commits
export const gitContextGetInput = z.object({
	instanceId: z.string().min(1),
	sessionId: z.string().min(1),
	limit: z.number().min(1).max(10).optional().default(5), // Max tasks to return
});

export const gitContextGetOutput = z.object({
	tasks: z.array(z.object({
		id: z.string(),
		text: z.string(),
		status: z.enum(["pending", "in_progress", "completed", "failed"]),
		priority: z.number(),
		assignedAt: z.string().optional(),
	})),
	recentTools: z.array(z.string()),
	currentTodos: z.array(z.object({
		content: z.string(),
		status: z.enum(["pending", "in_progress", "completed"]),
		activeForm: z.string().optional(),
	})),
	lastPrompt: z.string().optional(),
	metadata: z.object({
		sessionId: z.string(),
		instanceId: z.string(),
		projectDir: z.string().optional(),
		eventCount: z.number().optional(),
	}),
});

// git.auto_commit.notify - Notify ClaudeBench about auto-commits
export const gitAutoCommitNotifyInput = z.object({
	instanceId: z.string().min(1),
	sessionId: z.string().min(1),
	commitHash: z.string().min(1),
	branch: z.string().min(1),
	files: z.array(z.string()),
	diff: z.string(), // Git diff output
	stats: z.object({
		additions: z.number(),
		deletions: z.number(),
		filesChanged: z.number(),
	}).optional(),
	taskContext: z.object({
		taskIds: z.array(z.string()),
		toolUsed: z.string(),
		timestamp: z.number(),
	}),
	commitMessage: z.string(), // The structured JSON commit message
});

export const gitAutoCommitNotifyOutput = z.object({
	acknowledged: z.boolean(),
	attachmentId: z.string().optional(), // ID of created task attachment
	eventId: z.string().optional(), // ID of published event
});

// Type exports
export type GitContextGetInput = z.infer<typeof gitContextGetInput>;
export type GitContextGetOutput = z.infer<typeof gitContextGetOutput>;
export type GitAutoCommitNotifyInput = z.infer<typeof gitAutoCommitNotifyInput>;
export type GitAutoCommitNotifyOutput = z.infer<typeof gitAutoCommitNotifyOutput>;