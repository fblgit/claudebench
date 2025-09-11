import { z } from "zod";

// hook.pre_tool
export const hookPreToolInput = z.object({
	toolName: z.string(),
	toolParams: z.record(z.string(), z.any()),
	instanceId: z.string(),
	sessionId: z.string(),
	context: z.object({
		user: z.string().optional(),
		project: z.string().optional(),
		metadata: z.record(z.string(), z.any()).optional(),
	}).optional(),
});

export const hookPreToolOutput = z.object({
	allowed: z.boolean(),
	reason: z.string().optional(),
	modifiedParams: z.record(z.string(), z.any()).optional(),
	warnings: z.array(z.string()).optional(),
});

// hook.post_tool
export const hookPostToolInput = z.object({
	toolName: z.string(),
	toolParams: z.record(z.string(), z.any()),
	toolResult: z.any(),
	instanceId: z.string(),
	sessionId: z.string(),
	executionTime: z.number(),
	success: z.boolean(),
	error: z.string().optional(),
});

export const hookPostToolOutput = z.object({
	processed: z.boolean(),
	sideEffects: z.array(z.string()).optional(),
	notifications: z.array(z.object({
		type: z.enum(["info", "warning", "error"]),
		message: z.string(),
	})).optional(),
	metadata: z.record(z.string(), z.any()).optional(),
});

// hook.user_prompt
export const hookUserPromptInput = z.object({
	prompt: z.string(),
	instanceId: z.string(),
	sessionId: z.string(),
	context: z.record(z.string(), z.any()).optional(),
});

export const hookUserPromptOutput = z.object({
	modified: z.boolean(),
	prompt: z.string(),
	additions: z.array(z.string()).optional(),
});

// hook.todo_write
const todoItem = z.object({
	content: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]),
	activeForm: z.string(),
});

export const hookTodoWriteInput = z.object({
	todos: z.array(todoItem),
	instanceId: z.string(),
	sessionId: z.string(),
	operation: z.enum(["create", "update", "delete"]).optional(),
	previousTodos: z.array(todoItem).optional(),
});

export const hookTodoWriteOutput = z.object({
	accepted: z.boolean(),
	modifiedTodos: z.array(todoItem).optional(),
	tasksCreated: z.array(z.string()).optional(),
	notifications: z.array(z.string()).optional(),
});

export type HookPreToolInput = z.infer<typeof hookPreToolInput>;
export type HookPreToolOutput = z.infer<typeof hookPreToolOutput>;
export type HookPostToolInput = z.infer<typeof hookPostToolInput>;
export type HookPostToolOutput = z.infer<typeof hookPostToolOutput>;
export type HookUserPromptInput = z.infer<typeof hookUserPromptInput>;
export type HookUserPromptOutput = z.infer<typeof hookUserPromptOutput>;
export type HookTodoWriteInput = z.infer<typeof hookTodoWriteInput>;
export type HookTodoWriteOutput = z.infer<typeof hookTodoWriteOutput>;