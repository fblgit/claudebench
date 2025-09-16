import { app, initialize } from "./server";
import { websocket } from "./transports/websocket";

// Export for Bun with WebSocket support
export default {
	fetch: app.fetch,
	websocket,
};

// Re-export for testing
export { app, initialize };