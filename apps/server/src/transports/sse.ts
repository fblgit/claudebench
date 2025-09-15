import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { eventBus } from "../core/bus";
import { registry } from "../core/registry";
import { getRedis, redisKey } from "../core/redis";

// SSE client state
interface SSEClient {
	id: string;
	subscriptions: Set<string>;
	metadata?: Record<string, any>;
}

// Track active SSE connections
const sseClients = new Map<string, SSEClient>();

// Query parameter schema for SSE connections
const SSEQuerySchema = z.object({
	events: z.string().optional(), // Comma-separated list of events
	clientId: z.string().optional(),
	heartbeat: z.coerce.number().optional().default(30000), // Heartbeat interval in ms
});

/**
 * Create SSE endpoint handler
 */
export async function handleSSEConnection(c: Context) {
	// Parse query parameters
	const queryResult = SSEQuerySchema.safeParse({
		events: c.req.query("events"),
		clientId: c.req.query("clientId"),
		heartbeat: c.req.query("heartbeat"),
	});
	
	if (!queryResult.success) {
		return c.json({ error: "Invalid query parameters" }, 400);
	}
	
	const { events: eventList, clientId: providedId, heartbeat } = queryResult.data;
	const clientId = providedId || `sse-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	
	// Parse event subscriptions
	const requestedEvents = eventList ? eventList.split(",").map(e => e.trim()) : [];
	
	// Set appropriate headers for SSE
	c.header("Content-Type", "text/event-stream");
	c.header("Cache-Control", "no-cache");
	c.header("Connection", "keep-alive");
	c.header("X-Accel-Buffering", "no"); // Disable nginx buffering
	
	return streamSSE(c, async (stream) => {
		const client: SSEClient = {
			id: clientId,
			subscriptions: new Set(),
			metadata: {
				connectedAt: Date.now(),
				userAgent: c.req.header("User-Agent"),
			},
		};
		
		sseClients.set(clientId, client);
		
		// Send initial connection event
		await stream.writeSSE({
			event: "connected",
			data: JSON.stringify({
				clientId,
				timestamp: Date.now(),
				heartbeatInterval: heartbeat,
			}),
			id: `${Date.now()}`,
		});
		
		// Set up heartbeat
		let heartbeatInterval: NodeJS.Timeout | undefined;
		if (heartbeat > 0) {
			heartbeatInterval = setInterval(async () => {
				try {
					await stream.writeSSE({
						event: "heartbeat",
						data: JSON.stringify({ timestamp: Date.now() }),
						id: `hb-${Date.now()}`,
					});
				} catch (error) {
					// Connection likely closed
					if (heartbeatInterval) clearInterval(heartbeatInterval);
				}
			}, heartbeat);
		}
		
		// Subscribe to requested events
		const eventHandlers = new Map<string, (event: any) => Promise<void>>();
		
		for (const eventType of requestedEvents) {
			const handler = async (event: any) => {
				try {
					await stream.writeSSE({
						event: eventType,
						data: JSON.stringify(event),
						id: event.id || `${Date.now()}`,
					});
				} catch (error) {
					console.error(`Failed to send SSE event ${eventType} to ${clientId}:`, error);
				}
			};
			
			eventHandlers.set(eventType, handler);
			client.subscriptions.add(eventType);
			
			// Subscribe to event bus
			await eventBus.subscribe(eventType, handler, clientId);
			
			// Track in Redis
			const redis = getRedis();
			const subKey = redisKey("sse:subscriptions", clientId);
			await redis.stream.sadd(subKey, eventType);
			await redis.stream.expire(subKey, 3600); // 1 hour TTL
		}
		
		// Send subscription confirmation
		if (requestedEvents.length > 0) {
			await stream.writeSSE({
				event: "subscribed",
				data: JSON.stringify({
					events: requestedEvents,
					timestamp: Date.now(),
				}),
				id: `sub-${Date.now()}`,
			});
		}
		
		// Handle abort/disconnect
		stream.onAbort(async () => {
			console.log(`SSE client disconnected: ${clientId}`);
			
			// Clean up heartbeat
			if (heartbeatInterval) {
				clearInterval(heartbeatInterval);
			}
			
			// Clean up subscriptions
			for (const [eventType, handler] of eventHandlers.entries()) {
				// Note: We can't actually unsubscribe from the event bus here
				// as it doesn't support removing specific handlers
				// This is a limitation that should be addressed in the event bus
			}
			
			// Remove from active clients
			sseClients.delete(clientId);
			
			// Clean up Redis tracking
			const redis = getRedis();
			const subKey = redisKey("sse:subscriptions", clientId);
			await redis.stream.del(subKey);
		});
		
		// Keep connection alive
		while (true) {
			await stream.sleep(1000);
		}
	});
}

/**
 * Handle SSE command execution endpoint
 * This allows executing JSONRPC commands via POST that return results via SSE
 */
export async function handleSSEExecute(c: Context) {
	const clientId = c.req.query("clientId");
	
	if (!clientId || !sseClients.has(clientId)) {
		return c.json({ error: "Invalid or missing clientId" }, 400);
	}
	
	try {
		const request = await c.req.json();
		
		// Validate JSONRPC structure
		const JsonRpcRequestSchema = z.object({
			jsonrpc: z.literal("2.0"),
			method: z.string(),
			params: z.any().optional(),
			id: z.union([z.string(), z.number(), z.null()]).optional(),
		});
		
		const validatedRequest = JsonRpcRequestSchema.parse(request);
		
		// Check if handler exists
		const handler = registry.getHandler(validatedRequest.method);
		if (!handler) {
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32601,
					message: `Method not found: ${validatedRequest.method}`,
				},
				id: validatedRequest.id ?? null,
			});
		}
		
		// Execute handler
		const result = await registry.executeHandler(
			validatedRequest.method,
			validatedRequest.params || {}
		);
		
		// Publish result as event (will be sent via SSE)
		await eventBus.publish({
			type: `rpc.response.${clientId}`,
			payload: {
				jsonrpc: "2.0",
				result,
				id: validatedRequest.id,
			},
			metadata: {
				clientId,
				method: validatedRequest.method,
			},
		});
		
		// Return acknowledgment
		return c.json({
			jsonrpc: "2.0",
			result: { status: "processing", clientId },
			id: validatedRequest.id,
		});
		
	} catch (error: any) {
		if (error.name === "ZodError") {
			return c.json({
				jsonrpc: "2.0",
				error: {
					code: -32602,
					message: "Invalid parameters",
					data: error.errors,
				},
				id: null,
			});
		}
		
		return c.json({
			jsonrpc: "2.0",
			error: {
				code: -32603,
				message: "Internal error",
				data: process.env.NODE_ENV === "development" ? error.message : undefined,
			},
			id: null,
		});
	}
}

/**
 * Broadcast event to all SSE clients subscribed to a specific event type
 */
export async function broadcastToSSE(
	eventType: string,
	data: any
): Promise<void> {
	// This function is mainly for direct broadcasting outside of the event bus
	// The event bus subscription handlers already send to SSE clients
	
	const redis = getRedis();
	const eventData = {
		type: eventType,
		payload: data,
		timestamp: Date.now(),
		id: `broadcast-${Date.now()}`,
	};
	
	// Publish to event bus (will reach all SSE subscribers)
	await eventBus.publish(eventData);
}

/**
 * Get SSE connection statistics
 */
export function getSSEStats() {
	const stats = {
		totalClients: sseClients.size,
		subscriptions: {} as Record<string, number>,
		clients: [] as any[],
	};
	
	for (const [clientId, client] of sseClients.entries()) {
		stats.clients.push({
			id: clientId,
			subscriptions: Array.from(client.subscriptions),
			metadata: client.metadata,
		});
		
		for (const sub of client.subscriptions) {
			stats.subscriptions[sub] = (stats.subscriptions[sub] || 0) + 1;
		}
	}
	
	return stats;
}

/**
 * Send a direct message to a specific SSE client
 * Note: This requires storing the stream reference, which is not implemented
 * in this basic version. For production, you'd want to maintain stream references.
 */
export async function sendToSSEClient(
	clientId: string,
	eventType: string,
	data: any
): Promise<boolean> {
	const client = sseClients.get(clientId);
	if (!client) return false;
	
	// Publish an event specifically for this client
	await eventBus.publish({
		type: `direct.${clientId}`,
		payload: data,
		metadata: {
			eventType,
			targetClient: clientId,
		},
	});
	
	return true;
}