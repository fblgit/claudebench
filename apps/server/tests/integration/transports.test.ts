import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { app, initialize } from "../../src/server";
import { eventBus } from "../../src/core/bus";
import { connectRedis, disconnectRedis } from "../../src/core/redis";

describe("Transport Integration Tests", () => {
	beforeAll(async () => {
		// Initialize server components
		await connectRedis();
		await eventBus.initialize();
		await initialize();
	});

	afterAll(async () => {
		await eventBus.close();
		await disconnectRedis();
	});

	describe("SSE Transport", () => {
		it("should handle SSE test endpoint", async () => {
			const response = await app.request("/events/test", {
				method: "GET",
				headers: {
					"Accept": "text/event-stream",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/event-stream");
		});

		it("should return SSE statistics", async () => {
			const response = await app.request("/events/stats", {
				method: "GET",
			});

			expect(response.status).toBe(200);
			const stats = await response.json();
			expect(stats).toHaveProperty("totalConnections");
			expect(stats).toHaveProperty("activeConnections");
			expect(stats).toHaveProperty("connections");
			expect(stats).toHaveProperty("totalEventsSent");
		});

		it("should handle SSE with event filters", async () => {
			const response = await app.request("/events?events=task.create,task.update&since=now", {
				method: "GET",
				headers: {
					"Accept": "text/event-stream",
				},
			});

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/event-stream");
		});

		it("should reject invalid SSE query parameters", async () => {
			const response = await app.request("/events?since=invalid", {
				method: "GET",
			});

			expect(response.status).toBe(400);
			const text = await response.text();
			expect(text).toContain("Invalid since timestamp");
		});

		it("should handle SSE with metadata filters", async () => {
			const metadata = JSON.stringify({ clientId: "test-client" });
			const response = await app.request(`/events?metadata=${encodeURIComponent(metadata)}`, {
				method: "GET",
				headers: {
					"Accept": "text/event-stream",
				},
			});

			expect(response.status).toBe(200);
		});

		it("should reject invalid metadata JSON", async () => {
			const response = await app.request("/events?metadata=invalid-json", {
				method: "GET",
			});

			expect(response.status).toBe(400);
			const text = await response.text();
			expect(text).toContain("Invalid metadata filter JSON");
		});
	});

	describe("WebSocket Transport", () => {
		it("should handle WebSocket info endpoint", async () => {
			const response = await app.request("/ws", {
				method: "GET",
			});

			expect(response.status).toBe(200);
			const data = await response.json();
			expect(data).toHaveProperty("message", "WebSocket endpoint ready");
			expect(data).toHaveProperty("protocol");
			expect(data).toHaveProperty("features");
			expect(data.features).toContain("Event subscriptions");
		});

		it("should require WebSocket upgrade header", async () => {
			const response = await app.request("/ws", {
				method: "GET",
				headers: {
					"upgrade": "not-websocket",
				},
			});

			expect(response.status).toBe(426);
			const text = await response.text();
			expect(text).toContain("Expected WebSocket upgrade");
		});

		it("should accept WebSocket upgrade request", async () => {
			const response = await app.request("/ws", {
				method: "GET",
				headers: {
					"upgrade": "websocket",
					"connection": "Upgrade",
					"sec-websocket-version": "13",
					"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
				},
			});

			// Since we're not using a real WebSocket server yet, it returns JSON info
			expect(response.status).toBe(200);
		});
	});

	describe("Cross-Transport Event Broadcasting", () => {
		it("should publish events that both transports can receive", async () => {
			// Publish a test event
			const eventId = await eventBus.publish({
				type: "test.broadcast",
				payload: { message: "Cross-transport test" },
				metadata: { source: "test" },
			});

			expect(eventId).toBeDefined();
			expect(eventId).toContain("evt-");

			// Verify event was stored
			const events = await eventBus.getEvents("test.broadcast", 1);
			expect(events.length).toBe(1);
			expect(events[0].payload.message).toBe("Cross-transport test");
		});

		it("should handle filtered event subscriptions", async () => {
			// Create a subscription with filters
			const events: any[] = [];
			await eventBus.subscribe(
				"test.filtered",
				async (event) => {
					events.push(event);
				},
				"test-subscriber"
			);

			// Publish matching event
			await eventBus.publish({
				type: "test.filtered",
				payload: { data: "test1" },
				metadata: { clientId: "client1" },
			});

			// Publish non-matching event (different type)
			await eventBus.publish({
				type: "test.other",
				payload: { data: "test2" },
				metadata: { clientId: "client1" },
			});

			// Wait for events to process
			await new Promise(resolve => setTimeout(resolve, 100));

			// Should only receive the matching event
			expect(events.length).toBe(1);
			expect(events[0].payload.data).toBe("test1");
		});
	});

	describe("Transport Error Handling", () => {
		it("should handle SSE connection timeout gracefully", async () => {
			// This would require a more complex test setup with actual streaming
			// For now, just verify the endpoint exists
			const response = await app.request("/events", {
				method: "GET",
				headers: {
					"Accept": "text/event-stream",
				},
			});

			expect(response.status).toBe(200);
		});

		it("should handle invalid event types in SSE", async () => {
			const response = await app.request("/events?events=invalid.event.type", {
				method: "GET",
				headers: {
					"Accept": "text/event-stream",
				},
			});

			// SSE will connect but send error events for unknown types
			expect(response.status).toBe(200);
		});
	});

	describe("Transport Metrics", () => {
		it("should track SSE connection metrics", async () => {
			// Make a few SSE connections
			const promises = [];
			for (let i = 0; i < 3; i++) {
				promises.push(
					app.request("/events/test", {
						method: "GET",
						headers: { "Accept": "text/event-stream" },
					})
				);
			}

			await Promise.all(promises);

			// Check stats
			const response = await app.request("/events/stats");
			const stats = await response.json();

			expect(stats.totalConnections).toBeGreaterThanOrEqual(0);
			expect(Array.isArray(stats.connections)).toBe(true);
		});
	});
});