import { registry } from "./src/core/registry";
import { getRedis } from "./src/core/redis";
import "./src/handlers"; // Import handlers to register them

async function testSafeCommand() {
	console.log("Testing safe command validation...\n");
	
	// Initialize registry
	await registry.discover();
	
	// The test "should allow safe commands" doesn't call the handler
	// It just checks if this key exists:
	const redis = getRedis();
	
	console.log("What the test does:");
	console.log("1. It does NOT call registry.executeHandler");
	console.log("2. It just checks if 'cb:validation:bash:ls' exists");
	console.log("3. It expects that key to have value 'true'");
	
	// Check if key exists (this is what the test does)
	const validationKey = "cb:validation:bash:ls";
	const exists = await redis.stream.get(validationKey);
	console.log(`\nKey ${validationKey} = ${exists}`);
	console.log(`Test expects: "true"`);
	console.log(`Test will ${exists === "true" ? "PASS" : "FAIL"}`);
	
	// Now let's see what happens if we actually call the handler
	console.log("\n--- If we actually call the handler ---");
	const result = await registry.executeHandler("hook.pre_tool", {
		tool: "bash",
		params: { command: "ls -la" }
	});
	console.log("Handler result:", result);
	
	// Check key again
	const afterCall = await redis.stream.get(validationKey);
	console.log(`\nAfter handler call, key ${validationKey} = ${afterCall}`);
	
	// But wait, our validator creates a different key pattern
	const ourKey = "cb:validation:bash:ls-la";
	const ourValue = await redis.stream.get(ourKey);
	console.log(`Our implementation creates: ${ourKey} = ${ourValue}`);
	
	process.exit(0);
}

testSafeCommand().catch(console.error);