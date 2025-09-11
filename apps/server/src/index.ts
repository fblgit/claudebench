import { app, initialize } from "./server";

// Export the app for production deployment
export default app;

// Re-export initialize for testing
export { initialize };