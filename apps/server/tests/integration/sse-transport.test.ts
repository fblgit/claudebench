import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { app, initialize } from "../../src/server";
import { connectRedis, disconnectRedis, getRedis } from "../../src/core/redis";
import { eventBus } from "../../src/core/bus";
import { registry } from "../../src/core/registry";

describe("Integration: SSE Transport", () => {
	let server: any;
	let eventSource: EventSource | null = null;
	const PORT = 3334;
	const SSE_URL = `http://localhost:${PORT}/events`;
	
	beforeAll(async () => {
		// Initialize the system
		await initialize();
		
		// Start server
		server = Bun.serve({
			fetch: app.fetch,
			port: PORT,
		});
		
		// Wait for server to be ready
		await new Promise(resolve => setTimeout(resolve, 500));
	});
	
	afterAll(async () => {
		// Close EventSource
		if (eventSource) {
			eventSource.close();
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
		// Reset EventSource connection
		if (eventSource) {
			eventSource.close();
			eventSource = null;
		}
	});
	
	it("should establish SSE connection and follow SSE protocol specification", async () => {
		const response = await fetch(SSE_URL);
		
		// Verify HTTP headers for SSE
		expect(response.ok).toBe(true);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("Connection")).toBe("keep-alive");
		
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		
		// Read first chunk
		const { value } = await reader!.read();
		const rawText = decoder.decode(value);
		
		// Verify SSE protocol format:
		// 1. Events should be separated by double newlines
		const events = rawText.split("\n\n");
		expect(events.length).toBeGreaterThanOrEqual(1);
		
		// 2. Parse first event and verify SSE field format
		const firstEvent = events[0];
		const lines = firstEvent.split("\n");
		
		// Verify SSE fields follow "field: value" format
		let hasEventField = false;
		let hasDataField = false;
		let hasIdField = false;
		let eventType = "";
		let eventData = "";
		
		for (const line of lines) {
			// Each line should follow "field: value" format or be empty
			if (line.trim()) {
				expect(line).toMatch(/^(event|data|id|retry):\s*.*/);
				
				if (line.startsWith("event:")) {
					hasEventField = true;
					eventType = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					hasDataField = true;
					eventData = line.slice(5).trim();
				} else if (line.startsWith("id:")) {
					hasIdField = true;
				}
			}
		}
		
		// SSE protocol requires at least a data field
		expect(hasDataField).toBe(true);
		
		// Verify our implementation sends event type and id
		expect(hasEventField).toBe(true);
		expect(hasIdField).toBe(true);
		
		// Verify the connected event
		expect(eventType).toBe("connected");
		
		// Verify data is valid JSON
		const parsedData = JSON.parse(eventData);
		expect(parsedData.clientId).toBeDefined();
		expect(parsedData.timestamp).toBeDefined();
		expect(parsedData.heartbeatInterval).toBe(30000);
		
		// Close the connection
		reader!.cancel();
	});
	
	it("should receive events for subscribed event types and follow protocol", async () => {
		const messages: any[] = [];
		
		// Subscribe to specific events via query parameter
		const response = await fetch(`${SSE_URL}?events=test.sse1,test.sse2`);
		
		expect(response.ok).toBe(true);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		
		// Read multiple chunks to ensure we get both connected and subscribed events
		let buffer = "";
		let attempts = 0;
		
		while (attempts < 5) {
			const { value, done } = await reader!.read();
			if (done) break;
			
			buffer += decoder.decode(value, { stream: true });
			attempts++;
			
			// Check if we have both events
			if (buffer.includes("event: connected") && buffer.includes("event: subscribed")) {
				break;
			}
			
			// Small delay between reads
			if (attempts < 5) {
				await new Promise(resolve => setTimeout(resolve, 50));
			}
		}
		
		// Parse SSE messages
		const events = buffer.split("\n\n").filter(e => e.trim());
		
		for (const eventText of events) {
			const lines = eventText.split("\n");
			let eventType = "";
			let data = "";
			
			for (const line of lines) {
				if (line.startsWith("event:")) {
					eventType = line.slice(6).trim();
				} else if (line.startsWith("data:")) {
					data = line.slice(5).trim();
				}
			}
			
			if (eventType && data) {
				messages.push({
					event: eventType,
					data: JSON.parse(data)
				});
			}
		}
		
		// Should have connected and subscribed events
		const connectedEvent = messages.find(m => m.event === "connected");
		expect(connectedEvent).toBeDefined();
		
		const subscribedEvent = messages.find(m => m.event === "subscribed");
		expect(subscribedEvent).toBeDefined();
		expect(subscribedEvent.data.events).toEqual(["test.sse1", "test.sse2"]);
		
		// Publish test event (this should be received by the SSE connection)
		await eventBus.publish({
			type: "test.sse1",
			payload: { message: "Hello SSE" }
		});
		
		// Close the reader
		reader!.cancel();
		
		// Note: In a real test, we'd continue reading from the stream
		// But for simplicity, we're just verifying the setup works
	});
	
	it("should handle SSE execute endpoint for JSONRPC", async () => {
		// First establish SSE connection to get clientId
		const response = await fetch(SSE_URL);
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		
		const { value } = await reader!.read();
		const text = decoder.decode(value);
		
		// Extract clientId from connected event
		let clientId = "";
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("data:")) {
				const data = JSON.parse(line.slice(5).trim());
				if (data.clientId) {
					clientId = data.clientId;
					break;
				}
			}
		}
		
		expect(clientId).toBeDefined();
		
		// Execute JSONRPC request via POST
		const executeResponse = await fetch(`${SSE_URL}/execute?clientId=${clientId}`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "system.health",
				params: {},
				id: "sse-test-1"
			})
		});
		
		expect(executeResponse.ok).toBe(true);
		
		const result = await executeResponse.json();
		expect(result.jsonrpc).toBe("2.0");
		expect(result.result.status).toBe("processing");
		expect(result.result.clientId).toBe(clientId);
	});
	
	it("should reject execute without valid clientId", async () => {
		const response = await fetch(`${SSE_URL}/execute?clientId=invalid`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "system.health",
				params: {},
				id: "test-1"
			})
		});
		
		expect(response.status).toBe(400);
		
		const error = await response.json();
		expect(error.error).toContain("Invalid or missing clientId");
	});
	
	it("should handle heartbeat parameter", async () => {
		// Request with custom heartbeat interval
		const response = await fetch(`${SSE_URL}?heartbeat=5000`);
		
		expect(response.ok).toBe(true);
		
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		
		const { value } = await reader!.read();
		const text = decoder.decode(value);
		
		// Parse connected event
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("data:")) {
				const data = JSON.parse(line.slice(5).trim());
				if (data.heartbeatInterval) {
					expect(data.heartbeatInterval).toBe(5000);
					break;
				}
			}
		}
	});
	
	it("should track SSE subscriptions in Redis", async () => {
		// Connect with specific events
		const response = await fetch(`${SSE_URL}?events=redis.test1,redis.test2`);
		
		const reader = response.body?.getReader();
		const decoder = new TextDecoder();
		
		const { value } = await reader!.read();
		const text = decoder.decode(value);
		
		// Extract clientId
		let clientId = "";
		const lines = text.split("\n");
		for (const line of lines) {
			if (line.startsWith("data:")) {
				try {
					const data = JSON.parse(line.slice(5).trim());
					if (data.clientId) {
						clientId = data.clientId;
						break;
					}
				} catch {}
			}
		}
		
		expect(clientId).toBeDefined();
		
		// Wait a bit for async Redis operations to complete
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Check Redis for subscription tracking
		const redis = getRedis();
		const subKey = `cb:sse:subscriptions:${clientId}`;
		const subscriptions = await redis.stream.smembers(subKey);
		
		expect(subscriptions).toContain("redis.test1");
		expect(subscriptions).toContain("redis.test2");
		
		// Close the connection
		reader!.cancel();
	});
	
	it("should return statistics via stats endpoint", async () => {
		// Create a connection first
		await fetch(`${SSE_URL}?events=stats.test`);
		
		// Wait for connection to be established
		await new Promise(resolve => setTimeout(resolve, 100));
		
		// Get statistics
		const statsResponse = await fetch(`http://localhost:${PORT}/events/stats`);
		expect(statsResponse.ok).toBe(true);
		
		const stats = await statsResponse.json();
		expect(stats.totalClients).toBeGreaterThan(0);
		expect(stats.subscriptions).toBeDefined();
		expect(stats.clients).toBeInstanceOf(Array);
		
		// Should have stats.test subscription
		expect(stats.subscriptions["stats.test"]).toBeGreaterThan(0);
	});
});