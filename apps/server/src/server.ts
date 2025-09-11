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

// Import transport handlers
import { handleJsonRpcRequest, handleJsonRpcBatch } from "./transports/http";
import { registerHttpRoutes } from "./transports/http-routes";

const app = new Hono();

// Middleware setup
app.use(logger());
app.use(
	"/*",
	cors({
		origin: process.env.CORS_ORIGIN || "http://localhost:3001",
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
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

// JSONRPC endpoint
app.post("/rpc", handleJsonRpcRequest);
app.post("/rpc/batch", handleJsonRpcBatch);

// Initialize system
async function initialize() {
	console.log("🚀 Starting ClaudeBench server...");
	
	try {
		// Connect to Redis
		console.log("📦 Connecting to Redis...");
		await connectRedis();
		
		// Initialize event bus
		console.log("🚌 Initializing event bus...");
		await eventBus.initialize();
		
		// Discover and register handlers
		console.log("🔍 Discovering handlers...");
		await registry.discover();
		const handlers = registry.getAllHandlers();
		console.log(`✅ Registered ${handlers.length} handlers:`);
		handlers.forEach(h => {
			console.log(`   - ${h.event} (${h.className})`);
		});
		
		// Register auto-generated HTTP routes
		console.log("🌐 Registering HTTP routes...");
		registerHttpRoutes(app, registry);
		
		// List available routes
		const routes = registry.getHttpRoutes();
		console.log(`✅ Registered ${routes.length} HTTP routes:`);
		routes.forEach(r => {
			console.log(`   - ${r.method} ${r.path} -> ${r.event}`);
		});
		
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
if (require.main === module) {
	const PORT = parseInt(process.env.PORT || "3000", 10);
	
	initialize().then(() => {
		serve({
			fetch: app.fetch,
			port: PORT,
		});
		
		console.log(`🎯 Server running at http://localhost:${PORT}`);
		console.log(`📡 JSONRPC endpoint: http://localhost:${PORT}/rpc`);
		console.log(`🔧 Health check: http://localhost:${PORT}/`);
	});
}