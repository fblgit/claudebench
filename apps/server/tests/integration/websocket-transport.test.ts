import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { app, initialize } from "../../src/server";
import { connectRedis, disconnectRedis, getRedis } from "../../src/core/redis";
import { eventBus } from "../../src/core/bus";
import { registry } from "../../src/core/registry";
import { websocket } from "../../src/transports/websocket";

describe("Integration: WebSocket Transport", () => {
	let server: any;
	let ws: WebSocket;
	const PORT = 3333;
	const WS_URL = `ws://localhost:${PORT}/ws`;
	
	beforeAll(async () => {
		// Initialize the system
		await initialize();
		
		// Start server with WebSocket support
		server = Bun.serve({
			fetch: app.fetch,
			websocket,  // Add WebSocket handler
			port: PORT,
		});
		
		// Wait for server to be ready
		await new Promise(resolve => setTimeout(resolve, 500));
	});
	
	afterAll(async () => {
		// Close WebSocket
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.close();
		}
		
		// Stop server
		if (server) {
			server.stop();
		}
		
		// Clean up
		await eventBus.close();
		await disconnectRedis();
	});
	
	beforeEach(() => {
		// Reset WebSocket connection
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.close();
		}
	});
	
	it("should establish WebSocket connection and receive welcome message", async () => {
		const messages: any[] = [];
		
		ws = new WebSocket(WS_URL);
		
		const connectionPromise = new Promise((resolve, reject) => {
			ws.onopen = () => resolve(true);
			ws.onerror = reject;
			ws.onmessage = (event) => {
				messages.push(JSON.parse(event.data));
			};
		});
		
		await connectionPromise;
		
		// Wait for welcome message
		await new Promise(resolve => setTimeout(resolve, 100));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("connected");
		expect(messages[0].clientId).toBeDefined();
		expect(messages[0].timestamp).toBeDefined();
	});
	
	it("should handle ping/pong", async () => {
		const messages: any[] = [];
		
		ws = new WebSocket(WS_URL);
		
		await new Promise((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onmessage = (event) => {
				messages.push(JSON.parse(event.data));
			};
		});
		
		// Clear welcome message
		messages.length = 0;
		
		// Send ping
		ws.send(JSON.stringify({
			action: "ping"
		}));
		
		// Wait for pong
		await new Promise(resolve => setTimeout(resolve, 100));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("pong");
		expect(messages[0].timestamp).toBeDefined();
	});
	
	it("should subscribe to events and receive notifications", async () => {
		const messages: any[] = [];
		
		ws = new WebSocket(WS_URL);
		
		await new Promise((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onmessage = (event) => {
				messages.push(JSON.parse(event.data));
			};
		});
		
		// Clear welcome message
		messages.length = 0;
		
		// Subscribe to test event
		ws.send(JSON.stringify({
			action: "subscribe",
			events: ["test.event"]
		}));
		
		// Wait for subscription confirmation
		await new Promise(resolve => setTimeout(resolve, 100));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("subscribed");
		expect(messages[0].events).toEqual(["test.event"]);
		
		// Clear messages
		messages.length = 0;
		
		// Publish test event
		await eventBus.publish({
			type: "test.event",
			payload: { message: "Hello WebSocket" }
		});
		
		// Wait for event delivery
		await new Promise(resolve => setTimeout(resolve, 200));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("event");
		expect(messages[0].event).toBe("test.event");
		expect(messages[0].data.payload.message).toBe("Hello WebSocket");
	});
	
	it("should execute JSONRPC requests", async () => {
		const messages: any[] = [];
		
		ws = new WebSocket(WS_URL);
		
		await new Promise((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onmessage = (event) => {
				messages.push(JSON.parse(event.data));
			};
		});
		
		// Clear welcome message
		messages.length = 0;
		
		// Execute system.health request
		ws.send(JSON.stringify({
			action: "execute",
			request: {
				jsonrpc: "2.0",
				method: "system.health",
				params: {},
				id: "test-1"
			}
		}));
		
		// Wait for response
		await new Promise(resolve => setTimeout(resolve, 200));
		
		expect(messages.length).toBe(1);
		expect(messages[0].jsonrpc).toBe("2.0");
		expect(messages[0].id).toBe("test-1");
		expect(messages[0].result).toBeDefined();
		expect(messages[0].result.status).toBeDefined();
		expect(messages[0].result.services).toBeDefined();
	});
	
	it("should handle unsubscribe from events", async () => {
		const messages: any[] = [];
		
		ws = new WebSocket(WS_URL);
		
		await new Promise((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onmessage = (event) => {
				messages.push(JSON.parse(event.data));
			};
		});
		
		// Clear welcome message
		messages.length = 0;
		
		// Subscribe to test event
		ws.send(JSON.stringify({
			action: "subscribe",
			events: ["test.unsub"]
		}));
		
		// Wait for subscription confirmation
		await new Promise(resolve => setTimeout(resolve, 100));
		messages.length = 0;
		
		// Unsubscribe from test event
		ws.send(JSON.stringify({
			action: "unsubscribe",
			events: ["test.unsub"]
		}));
		
		// Wait for unsubscription confirmation
		await new Promise(resolve => setTimeout(resolve, 100));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("unsubscribed");
		expect(messages[0].events).toEqual(["test.unsub"]);
		
		// Clear messages
		messages.length = 0;
		
		// Publish test event (should not be received)
		await eventBus.publish({
			type: "test.unsub",
			payload: { message: "Should not receive" }
		});
		
		// Wait to ensure no event is received
		await new Promise(resolve => setTimeout(resolve, 200));
		
		expect(messages.length).toBe(0);
	});
	
	it("should handle invalid requests gracefully", async () => {
		const messages: any[] = [];
		
		ws = new WebSocket(WS_URL);
		
		await new Promise((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onmessage = (event) => {
				messages.push(JSON.parse(event.data));
			};
		});
		
		// Clear welcome message
		messages.length = 0;
		
		// Send invalid JSON
		ws.send("invalid json");
		
		// Wait for error response
		await new Promise(resolve => setTimeout(resolve, 100));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("error");
		expect(messages[0].error).toBeDefined();
		expect(messages[0].error.message).toContain("Unexpected");
		
		// Clear messages
		messages.length = 0;
		
		// Send invalid action
		ws.send(JSON.stringify({
			action: "invalid_action"
		}));
		
		// Wait for error response
		await new Promise(resolve => setTimeout(resolve, 100));
		
		expect(messages.length).toBe(1);
		expect(messages[0].type).toBe("error");
		expect(messages[0].error).toBeDefined();
	});
	
	it("should track subscriptions in Redis", async () => {
		ws = new WebSocket(WS_URL);
		
		let clientId: string;
		
		await new Promise((resolve) => {
			ws.onopen = () => resolve(true);
			ws.onmessage = (event) => {
				const data = JSON.parse(event.data);
				if (data.type === "connected") {
					clientId = data.clientId;
				}
			};
		});
		
		// Wait for welcome message
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Subscribe to multiple events
		ws.send(JSON.stringify({
			action: "subscribe",
			events: ["event1", "event2", "event3"]
		}));
		
		// Wait for subscription to be tracked
		await new Promise(resolve => setTimeout(resolve, 200));
		
		// Check Redis for subscription tracking
		const redis = getRedis();
		const subKey = `cb:ws:subscriptions:${clientId}`;
		const subscriptions = await redis.stream.smembers(subKey);
		
		expect(subscriptions).toContain("event1");
		expect(subscriptions).toContain("event2");
		expect(subscriptions).toContain("event3");
	});
});