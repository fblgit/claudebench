/**
 * MCP Request Handler - Using fetch-to-node approach from mcp-hono-stateless
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toFetchResponse, toReqRes } from "fetch-to-node";
import { registry } from "../core/registry";
import * as crypto from "crypto";
import { z } from "zod";
import { getRedis } from "../core/redis";

// Store servers and transports by session ID to maintain state
const servers = new Map<string, McpServer>();
const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Get or create MCP server for a session
 */
async function getOrCreateServer(sessionId: string): Promise<McpServer> {
	if (servers.has(sessionId)) {
		return servers.get(sessionId)!;
	}
	
	// Create new server
	const server = new McpServer({
		name: "claudebench-mcp",
		version: "0.1.0",
	}, {
		capabilities: {
			logging: {},
			tools: {}
		}
	});
	
	// Ensure handlers are discovered
	if (registry.getAllHandlers().length === 0) {
		await registry.discover();
	}
	
	// Register tools from handlers
	const handlers = registry.getAllHandlers();
	console.log(`[MCP] Registering ${handlers.length} tools for session ${sessionId}`);
	
	for (const handler of handlers) {
		const toolName = handler.event.replace(/\./g, "__");
		
		try {
			// Convert Zod schema to a raw shape for the tool() method
			// The tool() method expects ZodRawShape, not a ZodObject
			// Handle both ZodObject and ZodEffects (from .refine())
			let inputSchemaShape;
			const schema = handler.inputSchema as any;
			
			// Check if it's a ZodEffects (has refinement)
			if (schema._def?.typeName === "ZodEffects" && schema._def?.schema) {
				// Get shape from the underlying schema
				inputSchemaShape = schema._def.schema.shape;
			} else {
				// Regular ZodObject - shape is directly accessible
				inputSchemaShape = schema.shape;
			}
			
			// Use the high-level tool() method which properly handles Zod schemas
			(server as any).tool(
				toolName,
				handler.description || `Execute ${handler.event} event handler`,
				inputSchemaShape,
				async (params: any, metadata: any): Promise<any> => {
					console.log(`[MCP Tool] Executing ${toolName}`);
					console.log(`[MCP Tool] Params:`, params);
					console.log(`[MCP Tool] Metadata keys:`, metadata ? Object.keys(metadata) : 'none');
					
					// Update MCP service status when tool is executed
					const redis = getRedis();
					await redis.pub.setex("cb:service:mcp:status", 300, "ok"); // 5 minute TTL
					await redis.pub.incr("cb:metrics:mcp:calls");
					
					// The tool() method already validates params with the schema
					// So params here are already validated
					const result = await registry.executeHandler(handler.event, params);
					
					// Return in MCP format
					return {
						content: [
							{
								type: "text" as const,
								text: JSON.stringify(result, null, 2)
							}
						]
					};
				}
			);
			
			console.log(`   ✅ Registered MCP tool: ${toolName}`);
		} catch (error) {
			console.error(`   ❌ Failed to register tool ${toolName}:`, error);
		}
	}
	
	servers.set(sessionId, server);
	return server;
}

/**
 * POST /mcp - Handle JSON-RPC requests maintaining session state
 */
export async function handleMcpPost(c: Context) {
	try {
		const body = await c.req.json();
		let sessionId = c.req.header("mcp-session-id");
		let transport: StreamableHTTPServerTransport | undefined;
		
		// Check if this is an initialization request
		const isInit = body.method === "initialize";
		
		if (isInit) {
			// Generate new session ID for initialization
			sessionId = crypto.randomUUID();
			console.log(`[MCP] New session initialization: ${sessionId}`);
			
			// Set MCP service status as ok in Redis
			const redis = getRedis();
			await redis.pub.setex("cb:service:mcp:status", 300, "ok"); // 5 minute TTL
			await redis.pub.incr("cb:metrics:mcp:calls");
			
			// Create new transport for this session
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => sessionId!
			});
			
			// Create and connect server
			const server = await getOrCreateServer(sessionId);
			await server.connect(transport);
			
			// Store transport for future requests
			transports.set(sessionId, transport);
			
		} else if (sessionId && transports.has(sessionId)) {
			// Reuse existing transport for this session
			transport = transports.get(sessionId);
			console.log(`[MCP] Reusing session ${sessionId} for method: ${body.method}`);
		} else {
			// No valid session
			console.log(`[MCP] Invalid session: ${sessionId}`);
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message: "Bad Request: Invalid or missing session ID. Initialize first."
				},
				id: body.id || null
			}, 400);
		}
		
		// Convert Hono request to Node.js format
		const { req, res } = toReqRes(c.req.raw);
		
		// Handle the request through the transport
		await transport!.handleRequest(req, res, body);
		
		// Set session ID header for client
		c.header("Mcp-Session-Id", sessionId);
		
		// Convert Node.js response back to Fetch Response
		return toFetchResponse(res);
		
	} catch (error) {
		console.error("[MCP] Request handling error:", error);
		return c.json({
			jsonrpc: "2.0",
			error: {
				code: -32603,
				message: error instanceof Error ? error.message : "Internal server error",
			},
			id: null,
		}, 500);
	}
}

/**
 * GET /mcp - Server-sent events for notifications
 */
export async function handleMcpGet(c: Context) {
	const sessionId = c.req.header("mcp-session-id");
	
	if (!sessionId || !servers.has(sessionId)) {
		return c.text("Invalid or missing session ID", 400);
	}
	
	// Set up SSE stream
	return streamSSE(c, async (stream) => {
		console.log(`[MCP] SSE connection established for session: ${sessionId}`);
		
		// Keep connection alive with periodic pings
		const pingInterval = setInterval(() => {
			stream.writeSSE({
				event: "ping",
				data: JSON.stringify({ timestamp: Date.now() })
			});
		}, 30000);
		
		// Clean up on connection close
		stream.onAbort(() => {
			console.log(`[MCP] SSE connection closed for session: ${sessionId}`);
			clearInterval(pingInterval);
		});
	});
}

/**
 * DELETE /mcp - Terminate session
 */
export async function handleMcpDelete(c: Context) {
	const sessionId = c.req.header("mcp-session-id");
	
	if (!sessionId) {
		return c.text("Missing session ID", 400);
	}
	
	try {
		// Remove transport
		if (transports.has(sessionId)) {
			const transport = transports.get(sessionId);
			// Close the transport if it has a close method
			if (transport && typeof (transport as any).close === 'function') {
				(transport as any).close();
			}
			transports.delete(sessionId);
		}
		
		// Remove server
		if (servers.has(sessionId)) {
			servers.delete(sessionId);
		}
		
		console.log(`[MCP] Session terminated: ${sessionId}`);
		
		return c.json({
			jsonrpc: "2.0",
			result: {
				message: "Session terminated successfully",
				sessionId
			},
			id: null
		});
		
	} catch (error) {
		console.error(`[MCP] Error terminating session ${sessionId}:`, error);
		return c.json({
			jsonrpc: "2.0",
			error: {
				code: -32603,
				message: error instanceof Error ? error.message : "Failed to terminate session",
			},
			id: null,
		}, 500);
	}
}

/**
 * GET /mcp/health - Health check
 */
export function handleMcpHealth(c: Context) {
	const activeSessions = Array.from(servers.keys());
	
	return c.json({
		status: "healthy",
		activeSessions: activeSessions.length,
		sessions: activeSessions,
		transports: transports.size
	});
}
