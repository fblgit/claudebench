import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

// Import all handlers to register their decorators
import "./handlers";

// Import registry to discover handlers
import { registry } from "./core/registry";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: process.env.CORS_ORIGIN || "",
    allowMethods: ["GET", "POST", "OPTIONS"],
  })
);

// Initialize handlers on startup
async function initializeHandlers() {
  await registry.discover();
  console.log(`Discovered ${registry.getAllHandlers().length} handlers`);
}

initializeHandlers().catch(console.error);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;