import { z } from "zod";

// hook.pre_tool - Contract aligned
export const hookPreToolInput = z.object({
	tool: z.string(), // Changed from toolName to match contract
	params: z.any(), // Changed from toolParams to params, any type per contract
});

export const hookPreToolOutput = z.object({
	allow: z.boolean(), // Changed from allowed to allow per contract
	reason: z.string().optional(),
	modified: z.any().optional(), // Changed from modifiedParams to modified
});

// hook.post_tool - Contract aligned
export const hookPostToolInput = z.object({
	tool: z.string(), // Changed from toolName to match contract
	result: z.any(), // Changed from toolResult to result per contract
});

export const hookPostToolOutput = z.object({
	processed: z.any(), // Contract specifies processed can be any type
});

// hook.user_prompt - Contract aligned
export const hookUserPromptInput = z.object({
	prompt: z.string(),
	context: z.object({}).passthrough(), // Contract requires context as object
});

export const hookUserPromptOutput = z.object({
	modified: z.string().optional(), // Contract says modified is optional string
});

// hook.todo_write - Contract aligned
const todoItem = z.object({
	content: z.string(),
	status: z.enum(["pending", "in_progress", "completed"]),
	activeForm: z.string().optional(), // Contract shows activeForm is optional
});

export const hookTodoWriteInput = z.object({
	todos: z.array(todoItem),
});

export const hookTodoWriteOutput = z.object({
	processed: z.boolean(), // Changed from accepted to processed per contract
});

export type HookPreToolInput = z.infer<typeof hookPreToolInput>;
export type HookPreToolOutput = z.infer<typeof hookPreToolOutput>;
export type HookPostToolInput = z.infer<typeof hookPostToolInput>;
export type HookPostToolOutput = z.infer<typeof hookPostToolOutput>;
export type HookUserPromptInput = z.infer<typeof hookUserPromptInput>;
export type HookUserPromptOutput = z.infer<typeof hookUserPromptOutput>;
export type HookTodoWriteInput = z.infer<typeof hookTodoWriteInput>;
export type HookTodoWriteOutput = z.infer<typeof hookTodoWriteOutput>;