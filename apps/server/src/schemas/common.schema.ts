import { z } from "zod";

// JSONRPC 2.0 schemas
export const jsonRpcRequest = z.object({
	jsonrpc: z.literal("2.0"),
	method: z.string(),
	params: z.any(),
	id: z.union([z.string(), z.number()]).optional(),
});

export const jsonRpcResponse = z.object({
	jsonrpc: z.literal("2.0"),
	result: z.any().optional(),
	error: z.object({
		code: z.number(),
		message: z.string(),
		data: z.any().optional(),
	}).optional(),
	id: z.union([z.string(), z.number(), z.null()]),
});

// Error codes
export enum ErrorCode {
	// JSONRPC standard errors
	PARSE_ERROR = -32700,
	INVALID_REQUEST = -32600,
	METHOD_NOT_FOUND = -32601,
	INVALID_PARAMS = -32602,
	INTERNAL_ERROR = -32603,
	
	// Application errors
	RATE_LIMIT_EXCEEDED = -32001,
	CIRCUIT_BREAKER_OPEN = -32002,
	UNAUTHORIZED = -32003,
	VALIDATION_ERROR = -32004,
	HANDLER_ERROR = -32005,
}

// Common event metadata
export const eventMetadata = z.object({
	eventId: z.string(),
	timestamp: z.number(),
	instanceId: z.string(),
	correlationId: z.string().optional(),
	userId: z.string().optional(),
});

// Pagination
export const paginationInput = z.object({
	offset: z.number().min(0).default(0),
	limit: z.number().min(1).max(100).default(20),
	sortBy: z.string().optional(),
	sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const paginationOutput = z.object({
	items: z.array(z.any()),
	total: z.number(),
	offset: z.number(),
	limit: z.number(),
	hasMore: z.boolean(),
});

export type JsonRpcRequest = z.infer<typeof jsonRpcRequest>;
export type JsonRpcResponse = z.infer<typeof jsonRpcResponse>;
export type EventMetadata = z.infer<typeof eventMetadata>;
export type PaginationInput = z.infer<typeof paginationInput>;
export type PaginationOutput = z.infer<typeof paginationOutput>;