import "dotenv/config";
import "reflect-metadata";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serve } from "@hono/node-server";

// Import all handlers to register their decorators
import "./handlers";

// Import core modules
import { registry } from "./core/registry";
import { eventBus } from "./core/bus";
import { connectRedis, disconnectRedis } from "./core/redis";
import { metrics } from "./core/metrics";
import { instanceManager } from "./core/instance-manager";
import { jobScheduler } from "./core/jobs";

// Import transport handlers
import { handleJsonRpcRequest, handleJsonRpcBatch } from "./transports/http";
import { registerHttpRoutes } from "./transports/http-routes";
import { createWebSocketHandler, websocket, getWebSocketStats } from "./transports/websocket";

// Import MCP handlers
import { handleMcpPost, handleMcpGet, handleMcpDelete, handleMcpHealth } from "./mcp/handler";

// Import Prometheus middleware
import { prometheusMiddleware, getMetrics } from "./middleware/prometheus";

const app = new Hono();

// Middleware setup
app.use(logger());
app.use(prometheusMiddleware()); // Add Prometheus metrics to all requests
app.use(
	"/*",
	cors({
		origin: process.env.CORS_ORIGIN || "http://localhost:3001",
		allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "mcp-session-id"],
		exposeHeaders: ["Mcp-Session-Id"],
		credentials: true,
	})
);

// Health check endpoint
app.get("/", (c) => {
	return c.json({
		status: "healthy",
		service: "claudebench",
		version: "0.1.0",
		timestamp: new Date().toISOString(),
	});
});

// Prometheus metrics endpoint
app.get("/metrics", async (c) => {
	const metrics = await getMetrics();
	c.header("Content-Type", "text/plain; version=0.0.4");
	return c.text(metrics);
});

// JSONRPC endpoint
app.post("/rpc", handleJsonRpcRequest);
app.post("/rpc/batch", handleJsonRpcBatch);

// MCP routes
app.post("/mcp", handleMcpPost);
app.get("/mcp", handleMcpGet);
app.delete("/mcp", handleMcpDelete);
app.get("/mcp/health", handleMcpHealth);

// WebSocket endpoint with upgradeWebSocket handler
app.get("/ws", createWebSocketHandler());

// Real-time transport statistics endpoint
app.get("/ws/stats", (c) => {
	return c.json(getWebSocketStats());
});

// Initialize system
async function initialize() {
	console.log("🚀 Starting ClaudeBench server...");
	
	try {
		// Connect to Redis
		console.log("📦 Connecting to Redis...");
		await connectRedis();
		
		// Connect to PostgreSQL and set status
		console.log("🐘 Connecting to PostgreSQL...");
		const { initializePostgreSQL } = await import("./db");
		await initializePostgreSQL();
		
		// Initialize event bus
		console.log("🚌 Initializing event bus...");
		await eventBus.initialize();
		
		// Initialize metrics collection
		console.log("📊 Initializing metrics collector...");
		await metrics.initialize();
		metrics.startCollection(5000); // Collect every 5 seconds
		
		// Discover and register handlers
		console.log("🔍 Discovering handlers...");
		await registry.discover();
		const handlers = registry.getAllHandlers();
		console.log(`✅ Registered ${handlers.length} handlers:`);
		handlers.forEach(h => {
			console.log(`   - ${h.event} (${h.className})`);
		});
		
		// Start instance health monitoring
		console.log("🏥 Starting health monitoring...");
		instanceManager.startHealthMonitoring();
		
		// Start job scheduler for multi-instance coordination
		console.log("⏰ Starting job scheduler...");
		await jobScheduler.start();
		
		// Register auto-generated HTTP routes
		console.log("🌐 Registering HTTP routes...");
		registerHttpRoutes(app, registry);
		
		// List available routes
		const routes = registry.getHttpRoutes();
		console.log(`✅ Registered ${routes.length} HTTP routes:`);
		routes.forEach(r => {
			console.log(`   - ${r.method} ${r.path} -> ${r.event}`);
		});
		
		// MCP servers are created per-session, not globally
		console.log("🎯 MCP endpoint ready at /mcp");
		
		console.log("✅ Server initialized successfully");
		
	} catch (error) {
		console.error("❌ Failed to initialize server:", error);
		process.exit(1);
	}
}

// Graceful shutdown
async function shutdown() {
	console.log("\n📴 Shutting down gracefully...");
	
	try {
		// Stop metrics collection
		metrics.stopCollection();
		
		// Stop job scheduler
		await jobScheduler.stop();
		
		// Cleanup instance manager
		await instanceManager.cleanup();
		
		// MCP servers are now managed per-session, no global shutdown needed
		
		// Close event bus subscriptions
		await eventBus.close();
		
		// Disconnect from Redis
		await disconnectRedis();
		
		console.log("✅ Shutdown complete");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error during shutdown:", error);
		process.exit(1);
	}
}

// Handle shutdown signals
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Handle uncaught errors
process.on("uncaughtException", (error) => {
	console.error("❌ Uncaught exception:", error);
	shutdown();
});

process.on("unhandledRejection", (reason, promise) => {
	console.error("❌ Unhandled rejection at:", promise, "reason:", reason);
	shutdown();
});

// Export for testing
export { app, initialize };

// Start server if running directly
if (import.meta.url === `file://${process.argv[1]}` || require.main === module) {
	const PORT = parseInt(process.env.PORT || "3000", 10);
	
	initialize().then(() => {
		// Check if we're running in Bun
		if (typeof Bun !== "undefined") {
			// Bun native server with WebSocket support
			const server = Bun.serve({
				fetch(req, server) {
					return app.fetch(req, server);
				},
				websocket,
				port: PORT,
			});
			
			console.log(`🎯 Server running at http://localhost:${server.port}`);
			console.log(`📡 JSONRPC endpoint: http://localhost:${server.port}/rpc`);
			console.log(`🤖 MCP endpoint: http://localhost:${server.port}/mcp`);
			console.log(`🔄 WebSocket endpoint: ws://localhost:${server.port}/ws`);
			console.log(`📈 Metrics endpoint: http://localhost:${server.port}/metrics`);
			console.log(`🔧 Health check: http://localhost:${server.port}/`);
		} else {
			// Node.js server (no WebSocket support via this method)
			serve({
				fetch: app.fetch,
				port: PORT,
			});
			
			console.log(`🎯 Server running at http://localhost:${PORT}`);
			console.log(`📡 JSONRPC endpoint: http://localhost:${PORT}/rpc`);
			console.log(`🤖 MCP endpoint: http://localhost:${PORT}/mcp`);
			console.log(`⚠️  WebSocket not supported in Node.js mode`);
			console.log(`📈 Metrics endpoint: http://localhost:${PORT}/metrics`);
			console.log(`🔧 Health check: http://localhost:${PORT}/`);
		}
	});
}