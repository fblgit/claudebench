import { app, initialize } from "./server";
import { websocket } from "./transports/websocket";

// Initialize the server when this module loads
let initialized = false;
const initPromise = initialize().then(() => {
	initialized = true;
	console.log("✅ ClaudeBench server initialized");
}).catch((error) => {
	console.error("❌ Failed to initialize ClaudeBench server:", error);
	process.exit(1);
});

// Export for Bun with WebSocket support
export default {
	async fetch(request: Request, server: any) {
		// Wait for initialization to complete on first request
		if (!initialized) {
			await initPromise;
		}
		return app.fetch(request, server);
	},
	websocket,
};

// Re-export for testing
export { app, initialize };