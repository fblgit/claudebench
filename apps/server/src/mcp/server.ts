/**
 * MCP Server Setup - Following ClaudeBench patterns
 * 
 * This module handles McpServer instantiation and configuration.
 * Each MCP session gets its own McpServer instance for isolation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { registry } from "../core/registry";
import { registerTools } from "./tools";
import { SessionManager } from "./session";

// Store server instances by session ID
const servers: Map<string, McpServer> = new Map();

// Store transports by session ID for session management
const transports: Map<string, StreamableHTTPServerTransport> = new Map();

/**
 * Create a new McpServer instance for a session
 */
export async function createMcpServer(sessionId: string): Promise<McpServer> {
	// Check if server already exists for this session
	if (servers.has(sessionId)) {
		throw new Error(`Server already exists for session: ${sessionId}`);
	}

	// Create new McpServer instance
	const server = new McpServer({
		name: "claudebench-mcp",
		version: "0.1.0",
	});

	// Wait a moment for registry to be ready if needed
	// The registry should already be initialized during server startup
	const handlers = registry.getAllHandlers();
	console.log(`📦 Found ${handlers.length} handlers for MCP tools`);

	// Register tools from handlers
	await registerTools(server, registry);

	// Store server instance
	servers.set(sessionId, server);

	console.log(`🎯 MCP server created for session: ${sessionId}`);
	return server;
}

/**
 * Handle MCP HTTP requests with session management
 */
export async function handleMcpRequest(
	req: any,
	res: any,
	body?: any
): Promise<void> {
	// Get or validate session ID
	const sessionId = req.headers["mcp-session-id"] as string | undefined;
	let transport: StreamableHTTPServerTransport;

	// Handle different request scenarios
	if (sessionId && transports.has(sessionId)) {
		// Reuse existing transport for established session
		transport = transports.get(sessionId)!;
	} else if (!sessionId && isInitializeRequest(body)) {
		// New initialization request - create new transport and session
		const newSessionId = randomUUID();
		
		transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: () => newSessionId,
			onsessioninitialized: (sid) => {
				// Store the transport by session ID
				transports.set(sid, transport);
				SessionManager.getInstance().createSession(sid);
				console.log(`🔑 MCP session initialized: ${sid}`);
			},
			// Enable DNS rebinding protection for localhost
			enableDnsRebindingProtection: true,
			allowedHosts: ["127.0.0.1", "localhost"],
		});

		// Clean up transport when closed
		transport.onclose = () => {
			if (transport.sessionId) {
				transports.delete(transport.sessionId);
				SessionManager.getInstance().removeSession(transport.sessionId);
				servers.delete(transport.sessionId);
				console.log(`🔒 MCP session closed: ${transport.sessionId}`);
			}
		};

		// Create and connect MCP server for this session
		const server = await createMcpServer(newSessionId);
		await server.connect(transport);
		
	} else {
		// Invalid request - no session ID for non-initialization request
		res.status(400);
		res.json({
			jsonrpc: "2.0",
			error: {
				code: -32000,
				message: "Bad Request: No valid session ID provided",
			},
			id: null,
		});
		return;
	}

	// Handle the request through the transport
	await transport.handleRequest(req, res, body);
}

/**
 * Get active MCP sessions
 */
export function getActiveSessions(): string[] {
	return Array.from(servers.keys());
}

/**
 * Terminate a specific session
 */
export async function terminateSession(sessionId: string): Promise<void> {
	// Close transport if exists
	const transport = transports.get(sessionId);
	if (transport) {
		transport.close();
		transports.delete(sessionId);
	}

	// Remove server instance
	if (servers.has(sessionId)) {
		servers.delete(sessionId);
	}

	// Remove from session manager
	await SessionManager.getInstance().removeSession(sessionId);
	
	console.log(`🔒 MCP session terminated: ${sessionId}`);
}

/**
 * Shutdown all MCP servers and cleanup
 */
export async function shutdownMcpServers(): Promise<void> {
	// Close all transports
	for (const [sessionId, transport] of transports.entries()) {
		console.log(`🔒 Closing MCP transport: ${sessionId}`);
		transport.close();
	}
	transports.clear();

	// Clear server instances
	servers.clear();

	// Clear session manager
	await SessionManager.getInstance().clearAllSessions();

	console.log("✅ MCP servers shutdown complete");
}