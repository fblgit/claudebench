/**
 * MCP Request Handler - Based on working implementation
 */

import { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registry } from "../core/registry";
import { registerTools } from "./tools";
import { SessionManager } from "./session";
import { processMcpRequest } from "./transport-adapter";

// Store transports and servers by session ID
const transports = new Map<string, StreamableHTTPServerTransport>();
const servers = new Map<string, McpServer>();

/**
 * POST /mcp - Handle JSON-RPC requests
 */
export async function handleMcpPost(c: Context) {
	try {
		const body = await c.req.json();
		
		// Check for existing session ID in header
		const sessionId = c.req.header("mcp-session-id");
		let transport: StreamableHTTPServerTransport | undefined;
		let activeSessionId: string | undefined = sessionId;
		
		if (sessionId && transports.has(sessionId)) {
			// Reuse existing transport for this session
			transport = transports.get(sessionId);
		} else if (!sessionId && isInitializeRequest(body)) {
			// New initialization request - create new session
			const newSessionId = crypto.randomUUID();
			activeSessionId = newSessionId;
			
			// Create transport with session management
			transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => newSessionId,
				onsessioninitialized: (sid) => {
					console.log(`[MCP] Session initialized: ${sid}`);
					SessionManager.getInstance().createSession(sid);
				},
				enableDnsRebindingProtection: true,
				allowedHosts: ["127.0.0.1", "localhost", "localhost:3000", "127.0.0.1:3000"],
			});
			
			// Set up cleanup handler
			transport.onclose = () => {
				console.log(`[MCP] Transport closed for session: ${newSessionId}`);
				transports.delete(newSessionId);
				servers.delete(newSessionId);
				SessionManager.getInstance().removeSession(newSessionId);
			};
			
			// Create MCP server for this session
			const server = new McpServer({
				name: "claudebench-mcp",
				version: "0.1.0",
			});
			
			// Register tools from handlers
			// Make sure registry has discovered handlers first
			if (registry.getAllHandlers().length === 0) {
				await registry.discover();
			}
			const handlers = registry.getAllHandlers();
			console.log(`[MCP] Registering ${handlers.length} tools for session ${newSessionId}`);
			await registerTools(server, registry);
			
			// Connect transport to server
			await server.connect(transport);
			
			// Store transport and server
			transports.set(newSessionId, transport);
			servers.set(newSessionId, server);
			
			// Set session ID header in response
			c.header("Mcp-Session-Id", newSessionId);
		} else {
			// Invalid request
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32000,
					message: "Bad Request: No valid session ID provided",
				},
				id: null,
			}, 400);
		}
		
		if (!transport) {
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32603,
					message: "Internal error: Transport not available",
				},
				id: null,
			}, 500);
		}
		
		// Process request through transport adapter
		const headers = Object.fromEntries(c.req.raw.headers.entries());
		console.log(`[MCP] Processing request for session ${activeSessionId}:`, body.method);
		const response = await processMcpRequest(transport, headers, body);
		
		console.log(`[MCP] Response status: ${response.status}, has data: ${!!response.data}`);
		if (response.data) {
			console.log(`[MCP] Response data:`, JSON.stringify(response.data).substring(0, 200));
		}
		
		// Apply response headers
		for (const [key, value] of Object.entries(response.headers)) {
			c.header(key, value);
		}
		
		// Return response
		if (response.data) {
			return c.json(response.data, response.status as any);
		} else {
			return c.text("", response.status as any);
		}
		
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
	
	if (!sessionId || !transports.has(sessionId)) {
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
			transport?.close();
			transports.delete(sessionId);
		}
		
		// Remove server
		if (servers.has(sessionId)) {
			servers.delete(sessionId);
		}
		
		// Remove from session manager
		await SessionManager.getInstance().removeSession(sessionId);
		
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
		sessions: activeSessions
	});
}