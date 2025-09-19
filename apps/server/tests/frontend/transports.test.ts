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


	describe("WebSocket Transport", () => {
		it("should return WebSocket statistics", async () => {
			const response = await app.request("/ws/stats", {
				method: "GET",
			});

			expect(response.status).toBe(200);
			const stats = await response.json();
			expect(stats).toHaveProperty("totalClients");
			expect(stats).toHaveProperty("subscriptions");
			expect(stats).toHaveProperty("clients");
			expect(Array.isArray(stats.clients)).toBe(true);
		});

		it("should handle WebSocket endpoint with upgrade", async () => {
			// The WebSocket endpoint requires a proper WebSocket client
			// Testing with regular HTTP request should fail
			const response = await app.request("/ws", {
				method: "GET",
			});

			// Without upgrade headers, Hono's upgradeWebSocket returns a normal response
			expect(response.status).toBe(426);
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
		it("should handle WebSocket connection errors gracefully", async () => {
			// WebSocket endpoint without proper upgrade headers
			const response = await app.request("/ws", {
				method: "GET",
				headers: {
					"Connection": "keep-alive",
				},
			});

			expect(response.status).toBe(426); // Upgrade Required
		});

		it("should handle invalid WebSocket messages", async () => {
			// This would require a real WebSocket client to test properly
			// For now, just verify the stats endpoint works
			const response = await app.request("/ws/stats");
			expect(response.status).toBe(200);
		});
	});

	describe("Transport Metrics", () => {
		it("should track WebSocket connection metrics", async () => {
			// Check WebSocket stats
			const response = await app.request("/ws/stats");
			const stats = await response.json();

			expect(stats.totalClients).toBeGreaterThanOrEqual(0);
			expect(typeof stats.subscriptions).toBe("object");
			expect(Array.isArray(stats.clients)).toBe(true);
		});
	});
});