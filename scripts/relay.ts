#!/usr/bin/env bun
import { spawn } from "child_process";
import { resolve } from "path";

// Get instance ID from args or environment
const instanceId = process.argv[2] || process.env.CLAUDE_INSTANCE_ID || "worker-1";

console.log(`🚀 Starting Claude Event Relay with instance ID: ${instanceId}`);
console.log(`   Press Ctrl+C to stop\n`);

// Resolve the Python script path
const scriptPath = resolve(import.meta.dir, "claude_event_relay.py");

// Spawn the Python process with the instance ID
const relay = spawn("python3", [scriptPath], {
	env: {
		...process.env,
		CLAUDE_INSTANCE_ID: instanceId,
		PYTHONUNBUFFERED: "1", // Ensure real-time output
	},
	stdio: "inherit", // Pass through all output
});

// Handle process termination
process.on("SIGINT", () => {
	console.log("\n\n⏹️  Stopping event relay...");
	relay.kill("SIGINT");
	process.exit(0);
});

process.on("SIGTERM", () => {
	relay.kill("SIGTERM");
	process.exit(0);
});

relay.on("error", (error) => {
	console.error("❌ Failed to start event relay:", error);
	process.exit(1);
});

relay.on("exit", (code) => {
	if (code !== 0 && code !== null) {
		console.error(`❌ Event relay exited with code ${code}`);
		process.exit(code);
	}
});