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
import { connectRedis, disconnectRedis, getRedis } from "./core/redis";
import { metrics } from "./core/metrics";
import { instanceManager } from "./core/instance-manager";
import { jobScheduler } from "./core/jobs";
import { stateProcessor } from "./core/state-processor";

// Import transport handlers
import { handleJsonRpcRequest, handleJsonRpcBatch } from "./transports/http";
import { registerHttpRoutes } from "./transports/http-routes";
import { createWebSocketHandler, websocket, getWebSocketStats } from "./transports/websocket";

// Import MCP handlers
import { handleMcpPost, handleMcpGet, handleMcpDelete, handleMcpHealth } from "./mcp/handler";

// Import Prometheus middleware
import { prometheusMiddleware, getMetrics } from "./middleware/prometheus";

const app = new Hono();

// Hydrate Redis attachment indices by using task.list then task.list_attachments
async function hydrateAttachmentIndices() {
	try {
		console.log("💧 Getting all tasks...");
		
		// First get all tasks using task.list handler
		const taskList = await registry.executeHandler("task.list", {
			limit: 1000, // Get a large batch
			offset: 0,
			orderBy: "createdAt",
			order: "desc"
		});

		let totalTasks = taskList.totalCount;
		let processed = 0;
		let errors = 0;
		let offset = 0;
		const batchSize = 1000;

		console.log(`💧 Found ${totalTasks} total tasks to process`);

		// Process all tasks in batches
		while (offset < totalTasks) {
			const batch = await registry.executeHandler("task.list", {
				limit: batchSize,
				offset: offset,
				orderBy: "createdAt", 
				order: "desc"
			});

			// For each task, clear Redis cache and call list_attachments to populate from PostgreSQL
			for (const task of batch.tasks) {
				try {
					// Get Redis instance
					const redis = getRedis();
					
					// Clear Redis attachment index to force PostgreSQL fallback
					const attachmentsIndexKey = `cb:task:${task.id}:attachments`;
					await redis.pub.del(attachmentsIndexKey);
					
					// Also clear any individual attachment keys that might exist
					const existingKeys = await redis.pub.keys(`cb:task:${task.id}:attachment:*`);
					if (existingKeys.length > 0) {
						await redis.pub.del(...existingKeys);
					}
					
					// Now call list_attachments which will fallback to PostgreSQL and populate Redis
					await registry.executeHandler("task.list_attachments", {
						taskId: task.id,
						limit: 100  // Get all attachments to populate Redis properly
					});
					processed++;
				} catch (error) {
					errors++;
					// Silently continue
				}
			}

			offset += batchSize;
			
			if (processed % 500 === 0) {
				console.log(`💧 Hydrated ${processed}/${totalTasks} tasks`);
			}
		}

		console.log(`💧 Attachment hydration complete: ${processed} tasks processed, ${errors} errors`);
		
	} catch (error) {
		console.error("❌ Failed to hydrate attachments:", error);
		// Don't fail startup for this
	}
}

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
		
		// Initialize state processor for session tracking
		console.log("🔄 Initializing state processor...");
		await stateProcessor.initialize();
		
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
		
		// Health monitoring is now handled by MonitoringWorker in jobs.ts
		console.log("🏥 Health monitoring handled by job scheduler...");
		
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
		
		// Hydrate Redis attachment indices from PostgreSQL
		console.log("💧 Hydrating Redis attachment indices...");
		await hydrateAttachmentIndices();
		
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