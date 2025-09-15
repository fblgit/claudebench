import type { ServerWebSocket } from "bun";
import { upgradeWebSocket } from "hono/bun";
import type { Context } from "hono";
import { z } from "zod";
import { eventBus } from "../core/bus";
import { registry } from "../core/registry";
import { getRedis, redisKey } from "../core/redis";

// WebSocket connection state
interface WSClient {
	id: string;
	subscriptions: Set<string>;
	roles?: string[];
	metadata?: Record<string, any>;
}

// Map of WebSocket connections
const clients = new Map<ServerWebSocket<WSClient>, WSClient>();

// JSONRPC 2.0 Request schema (same as HTTP)
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

// WebSocket-specific request types
const WSActionSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("subscribe"),
		events: z.array(z.string()),
	}),
	z.object({
		action: z.literal("unsubscribe"),
		events: z.array(z.string()),
	}),
	z.object({
		action: z.literal("execute"),
		request: JsonRpcRequestSchema,
	}),
	z.object({
		action: z.literal("ping"),
	}),
]);

/**
 * Create WebSocket upgrade handler
 */
export const createWebSocketHandler = () => {
	return upgradeWebSocket((c: Context) => {
		const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		
		return {
			onOpen(event, ws) {
				const client: WSClient = {
					id: clientId,
					subscriptions: new Set(),
					metadata: {
						connectedAt: Date.now(),
						userAgent: c.req.header("User-Agent"),
					},
				};
				
				clients.set(ws as any, client);
				
				// Send welcome message
				ws.send(JSON.stringify({
					type: "connected",
					clientId,
					timestamp: Date.now(),
				}));
				
				console.log(`WebSocket client connected: ${clientId}`);
			},
			
			async onMessage(event, ws) {
				const client = clients.get(ws as any);
				if (!client) return;
				
				try {
					const data = typeof event.data === "string" 
						? JSON.parse(event.data)
						: event.data;
					
					// Validate WebSocket action
					const action = WSActionSchema.parse(data);
					
					switch (action.action) {
						case "subscribe":
							await handleSubscribe(client, action.events, ws);
							break;
							
						case "unsubscribe":
							await handleUnsubscribe(client, action.events, ws);
							break;
							
						case "execute":
							await handleExecute(client, action.request, ws);
							break;
							
						case "ping":
							ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
							break;
					}
				} catch (error: any) {
					// Send error response
					ws.send(JSON.stringify({
						type: "error",
						error: {
							message: error.message || "Invalid request",
							code: error.name === "ZodError" ? -32602 : -32603,
						},
						timestamp: Date.now(),
					}));
				}
			},
			
			onClose(event, ws) {
				const client = clients.get(ws as any);
				if (!client) return;
				
				// Clean up subscriptions
				for (const eventType of client.subscriptions) {
					eventBus.subscribe(eventType, async () => {}, client.id).catch(() => {});
				}
				
				clients.delete(ws as any);
				console.log(`WebSocket client disconnected: ${client.id}`);
			},
			
			onError(event, ws) {
				const client = clients.get(ws as any);
				console.error(`WebSocket error for client ${client?.id}:`, event);
			},
		};
	});
};

/**
 * Handle event subscription
 */
async function handleSubscribe(
	client: WSClient,
	events: string[],
	ws: any
): Promise<void> {
	const redis = getRedis();
	
	for (const eventType of events) {
		if (client.subscriptions.has(eventType)) continue;
		
		// Subscribe to event bus
		await eventBus.subscribe(
			eventType,
			async (event) => {
				// Send event to WebSocket client
				ws.send(JSON.stringify({
					type: "event",
					event: eventType,
					data: event,
					timestamp: Date.now(),
				}));
			},
			client.id
		);
		
		client.subscriptions.add(eventType);
		
		// Track subscription in Redis
		const subKey = redisKey("ws:subscriptions", client.id);
		await redis.stream.sadd(subKey, eventType);
		await redis.stream.expire(subKey, 3600); // 1 hour TTL
	}
	
	// Send confirmation
	ws.send(JSON.stringify({
		type: "subscribed",
		events: events.filter(e => client.subscriptions.has(e)),
		timestamp: Date.now(),
	}));
}

/**
 * Handle event unsubscription
 */
async function handleUnsubscribe(
	client: WSClient,
	events: string[],
	ws: any
): Promise<void> {
	const redis = getRedis();
	
	for (const eventType of events) {
		if (!client.subscriptions.has(eventType)) continue;
		
		client.subscriptions.delete(eventType);
		
		// Remove from Redis tracking
		const subKey = redisKey("ws:subscriptions", client.id);
		await redis.stream.srem(subKey, eventType);
	}
	
	// Send confirmation
	ws.send(JSON.stringify({
		type: "unsubscribed",
		events: events.filter(e => !client.subscriptions.has(e)),
		timestamp: Date.now(),
	}));
}

/**
 * Handle JSONRPC request execution
 */
async function handleExecute(
	client: WSClient,
	request: z.infer<typeof JsonRpcRequestSchema>,
	ws: any
): Promise<void> {
	try {
		// Check if handler exists
		const handler = registry.getHandler(request.method);
		if (!handler) {
			ws.send(JSON.stringify({
				jsonrpc: "2.0",
				error: {
					code: -32601,
					message: `Method not found: ${request.method}`,
				},
				id: request.id ?? null,
			}));
			return;
		}
		
		// Execute handler
		const result = await registry.executeHandler(
			request.method,
			request.params || {}
		);
		
		// Send response (only if request has ID)
		if (request.id !== undefined) {
			ws.send(JSON.stringify({
				jsonrpc: "2.0",
				result,
				id: request.id,
			}));
		}
	} catch (error: any) {
		// Send error response
		if (request.id !== undefined) {
			ws.send(JSON.stringify({
				jsonrpc: "2.0",
				error: {
					code: error.name === "ZodError" ? -32602 : -32603,
					message: error.message || "Internal error",
					data: process.env.NODE_ENV === "development" ? error.stack : undefined,
				},
				id: request.id,
			}));
		}
	}
}

/**
 * Broadcast event to all subscribed WebSocket clients
 */
export async function broadcastToWebSockets(
	eventType: string,
	data: any
): Promise<void> {
	for (const [ws, client] of clients.entries()) {
		if (client.subscriptions.has(eventType)) {
			try {
				(ws as any).send(JSON.stringify({
					type: "event",
					event: eventType,
					data,
					timestamp: Date.now(),
				}));
			} catch (error) {
				console.error(`Failed to send to WebSocket client ${client.id}:`, error);
			}
		}
	}
}

/**
 * Get WebSocket stats
 */
export function getWebSocketStats() {
	const stats = {
		totalClients: clients.size,
		subscriptions: {} as Record<string, number>,
		clients: [] as any[],
	};
	
	for (const [ws, client] of clients.entries()) {
		stats.clients.push({
			id: client.id,
			subscriptions: Array.from(client.subscriptions),
			metadata: client.metadata,
		});
		
		for (const sub of client.subscriptions) {
			stats.subscriptions[sub] = (stats.subscriptions[sub] || 0) + 1;
		}
	}
	
	return stats;
}

// Export the websocket handler for Bun
// This needs to be an object with message, open, close handlers
export const websocket = {
	message(ws: any, message: string | Buffer) {
		const client = clients.get(ws);
		if (!client) return;
		
		// Handle the message using the same logic from onMessage
		try {
			const data = typeof message === "string" 
				? JSON.parse(message)
				: JSON.parse(message.toString());
			
			// Validate WebSocket action
			const action = WSActionSchema.parse(data);
			
			switch (action.action) {
				case "subscribe":
					handleSubscribe(client, action.events, ws);
					break;
					
				case "unsubscribe":
					handleUnsubscribe(client, action.events, ws);
					break;
					
				case "execute":
					handleExecute(client, action.request, ws);
					break;
					
				case "ping":
					ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
					break;
			}
		} catch (error: any) {
			// Send error response
			ws.send(JSON.stringify({
				type: "error",
				error: {
					message: error.message || "Invalid request",
					code: error.name === "ZodError" ? -32602 : -32603,
				},
				timestamp: Date.now(),
			}));
		}
	},
	
	open(ws: any) {
		const clientId = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		const client: WSClient = {
			id: clientId,
			subscriptions: new Set(),
			metadata: {
				connectedAt: Date.now(),
			},
		};
		
		clients.set(ws, client);
		
		// Send welcome message
		ws.send(JSON.stringify({
			type: "connected",
			clientId,
			timestamp: Date.now(),
		}));
		
		console.log(`WebSocket client connected: ${clientId}`);
	},
	
	close(ws: any) {
		const client = clients.get(ws);
		if (!client) return;
		
		// Clean up subscriptions
		for (const eventType of client.subscriptions) {
			eventBus.subscribe(eventType, async () => {}, client.id).catch(() => {});
		}
		
		clients.delete(ws);
		console.log(`WebSocket client disconnected: ${client.id}`);
	},
};