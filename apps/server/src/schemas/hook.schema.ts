import { z } from "zod";

// hook.pre_tool - Contract aligned
export const hookPreToolInput = z.object({
	tool: z.string().min(1), // Changed from toolName to match contract, min(1) to reject empty
	params: z.unknown(), // Changed from toolParams to params, unknown to require field but accept any type
	sessionId: z.string().optional(),
	instanceId: z.string().optional(),
	timestamp: z.number().optional(),
	metadata: z.record(z.unknown()).optional(),
}).refine(data => 'params' in data, {
	message: "params field is required"
});

export const hookPreToolOutput = z.object({
	allow: z.boolean(), // Changed from allowed to allow per contract
	reason: z.string().optional(),
	modified: z.unknown().optional(), // Changed from modifiedParams to modified, unknown for any type
});

// hook.post_tool - Contract aligned
export const hookPostToolInput = z.object({
	tool: z.string().min(1), // Changed from toolName to match contract, min(1) to reject empty
	params: z.unknown().optional(), // Include params from the original tool call
	result: z.unknown(), // Changed from toolResult to result, unknown to require field but accept any type
	sessionId: z.string().optional(),
	instanceId: z.string().optional(),
	timestamp: z.number().optional(),
	executionTime: z.number().optional(),
	success: z.boolean().optional(),
}).refine(data => 'result' in data, {
	message: "result field is required"
});

export const hookPostToolOutput = z.object({
	processed: z.unknown(), // Contract specifies processed can be any type, unknown to require field
}).refine(data => 'processed' in data, {
	message: "processed field is required"
});

// hook.user_prompt - Contract aligned
export const hookUserPromptInput = z.object({
	prompt: z.string().min(1), // min(1) to reject empty strings
	context: z.object({}).passthrough(), // Contract requires context as object
	sessionId: z.string().optional(),
	instanceId: z.string().optional(),
	timestamp: z.number().optional(),
});

export const hookUserPromptOutput = z.object({
	modified: z.string().optional(), // Contract says modified is optional string
});

// hook.todo_write - Contract aligned
const todoItem = z.object({
	content: z.string().min(1), // min(1) to reject empty strings
	status: z.enum(["pending", "in_progress", "completed"]),
	activeForm: z.string().min(1).optional(), // Contract shows activeForm is optional
});

export const hookTodoWriteInput = z.object({
	todos: z.array(todoItem),
	sessionId: z.string().optional(),
	instanceId: z.string().optional(),
	timestamp: z.number().optional(),
	previousTodos: z.array(todoItem).optional(),
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

// hook.agent_stop - Handle agent termination events from Claude Code
export const hookAgentStopInput = z.object({
	instanceId: z.string().min(1),
	sessionId: z.string().min(1),
	agentType: z.enum(["main", "subagent", "unknown"]),
	timestamp: z.number(),
});

export const hookAgentStopOutput = z.object({
	acknowledged: z.boolean(),
	cleanedUp: z.boolean(),
});

// hook.notification - Handle notifications from Claude Code
export const hookNotificationInput = z.object({
	message: z.string(),
	type: z.enum(["info", "warning", "error", "success"]),
	sessionId: z.string().min(1),
	instanceId: z.string().min(1),
	timestamp: z.number(),
});

export const hookNotificationOutput = z.object({
	received: z.boolean(),
	broadcasted: z.boolean(),
});

// hook.pre_compact - Handle pre-compaction events
export const hookPreCompactInput = z.object({
	sessionId: z.string().min(1),
	instanceId: z.string().min(1),
	contextSize: z.number(),
	timestamp: z.number(),
});

export const hookPreCompactOutput = z.object({
	acknowledged: z.boolean(),
	stateSaved: z.boolean(),
});

export type HookAgentStopInput = z.infer<typeof hookAgentStopInput>;
export type HookAgentStopOutput = z.infer<typeof hookAgentStopOutput>;
export type HookNotificationInput = z.infer<typeof hookNotificationInput>;
export type HookNotificationOutput = z.infer<typeof hookNotificationOutput>;
export type HookPreCompactInput = z.infer<typeof hookPreCompactInput>;
export type HookPreCompactOutput = z.infer<typeof hookPreCompactOutput>;