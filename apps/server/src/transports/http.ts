import type { Context } from "hono";
import { z } from "zod";
import { registry } from "../core/registry";

// JSONRPC 2.0 Request schema
const JsonRpcRequestSchema = z.object({
	jsonrpc: z.literal("2.0"),
	method: z.string(),
	params: z.any().optional(),
	id: z.union([z.string(), z.number(), z.null()]).optional(),
	metadata: z.object({
		sessionId: z.string().optional(),
		correlationId: z.string().optional(),
		timestamp: z.number().optional(),
	}).optional(),
});

// JSONRPC 2.0 Response types
interface JsonRpcSuccessResponse {
	jsonrpc: "2.0";
	result: any;
	id: string | number | null;
}

interface JsonRpcErrorResponse {
	jsonrpc: "2.0";
	error: {
		code: number;
		message: string;
		data?: any;
	};
	id: string | number | null;
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// JSONRPC Error codes
export const JsonRpcErrorCodes = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	// Custom errors
	RATE_LIMIT_EXCEEDED: -32000,
	CIRCUIT_BREAKER_OPEN: -32001,
	UNAUTHORIZED: -32002,
	HOOK_BLOCKED: -32003,
} as const;

/**
 * Handle JSONRPC 2.0 request over HTTP
 */
export async function handleJsonRpcRequest(c: Context): Promise<Response> {
	let request: z.infer<typeof JsonRpcRequestSchema>;
	let requestId: string | number | null | undefined;

	try {
		// Parse JSON body
		const body = await c.req.json();
		
		// Validate JSONRPC structure
		request = JsonRpcRequestSchema.parse(body);
		requestId = request.id;
		
		// Method not found check
		const handler = registry.getHandler(request.method);
		if (!handler) {
			return c.json(createErrorResponse(
				requestId ?? null,
				JsonRpcErrorCodes.METHOD_NOT_FOUND,
				`Method not found: ${request.method}`
			));
		}

		// Execute handler
		try {
			const result = await registry.executeHandler(
				request.method,
				request.params || {}
			);

			// Return success response (only if ID is present)
			if (requestId !== undefined) {
				return c.json(createSuccessResponse(requestId, result));
			}
			
			// Notification (no ID) - return 204 No Content
			return c.body(null, 204);
			
		} catch (error: any) {
			// Handle Zod validation errors
			if (error.name === "ZodError") {
				return c.json(createErrorResponse(
					requestId ?? null,
					JsonRpcErrorCodes.INVALID_PARAMS,
					"Invalid parameters",
					error.errors
				));
			}

			// Handle rate limit errors
			if (error.message?.includes("rate limit")) {
				return c.json(createErrorResponse(
					requestId ?? null,
					JsonRpcErrorCodes.RATE_LIMIT_EXCEEDED,
					"Rate limit exceeded"
				));
			}

			// Handle circuit breaker errors
			if (error.message?.includes("circuit breaker")) {
				return c.json(createErrorResponse(
					requestId ?? null,
					JsonRpcErrorCodes.CIRCUIT_BREAKER_OPEN,
					"Circuit breaker is open"
				));
			}

			// Handle hook blocked errors
			if (error.message?.includes("hook blocked")) {
				return c.json(createErrorResponse(
					requestId ?? null,
					JsonRpcErrorCodes.HOOK_BLOCKED,
					"Hook blocked execution",
					error.reason
				));
			}

			// Generic internal error
			console.error(`Error handling ${request.method}:`, error);
			return c.json(createErrorResponse(
				requestId ?? null,
				JsonRpcErrorCodes.INTERNAL_ERROR,
				"Internal error",
				process.env.NODE_ENV === "development" ? error.message : undefined
			));
		}
		
	} catch (error: any) {
		// Parse or validation error
		if (error.name === "ZodError") {
			return c.json(createErrorResponse(
				null,
				JsonRpcErrorCodes.INVALID_REQUEST,
				"Invalid request",
				error.errors
			));
		}

		// JSON parse error
		return c.json(createErrorResponse(
			null,
			JsonRpcErrorCodes.PARSE_ERROR,
			"Parse error"
		));
	}
}

/**
 * Create JSONRPC success response
 */
function createSuccessResponse(
	id: string | number | null,
	result: any
): JsonRpcSuccessResponse {
	return {
		jsonrpc: "2.0",
		result,
		id,
	};
}

/**
 * Create JSONRPC error response
 */
function createErrorResponse(
	id: string | number | null,
	code: number,
	message: string,
	data?: any
): JsonRpcErrorResponse {
	return {
		jsonrpc: "2.0",
		error: {
			code,
			message,
			...(data !== undefined && { data }),
		},
		id,
	};
}

/**
 * Handle batch JSONRPC requests
 */
export async function handleJsonRpcBatch(c: Context): Promise<Response> {
	try {
		const batch = await c.req.json();
		
		if (!Array.isArray(batch)) {
			return c.json(createErrorResponse(
				null,
				JsonRpcErrorCodes.INVALID_REQUEST,
				"Batch must be an array"
			));
		}

		if (batch.length === 0) {
			return c.json(createErrorResponse(
				null,
				JsonRpcErrorCodes.INVALID_REQUEST,
				"Batch cannot be empty"
			));
		}

		// Process each request in parallel
		const responses = await Promise.all(
			batch.map(async (req) => {
				// Create a mock context for each request
				const mockContext = {
					...c,
					req: {
						...c.req,
						json: async () => req,
					},
				} as Context;
				
				const response = await handleJsonRpcRequest(mockContext);
				
				// Only include responses for requests with IDs
				if (response.status === 204) {
					return null; // Notification, no response
				}
				
				return response.json();
			})
		);

		// Filter out null responses (notifications)
		const filteredResponses = responses.filter(r => r !== null);

		// Return batch response
		return c.json(filteredResponses);
		
	} catch (error) {
		return c.json(createErrorResponse(
			null,
			JsonRpcErrorCodes.PARSE_ERROR,
			"Invalid batch request"
		));
	}
}