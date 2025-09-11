import { hookValidator } from "./src/core/hook-validator";
import { getRedis } from "./src/core/redis";

async function testValidator() {
	console.log("Testing HookValidator...");
	
	// Test 1: Dangerous command
	const result1 = await hookValidator.validate({
		tool: "bash",
		params: { command: "rm -rf /" },
	});
	console.log("Test 1 - Dangerous command:");
	console.log("  Result:", result1);
	
	// Check what keys were created
	const redis = getRedis();
	const keys = await redis.stream.keys("cb:validation:*");
	console.log("  Created keys:", keys);
	
	// Check specific key
	const validationKey = await redis.stream.get("cb:validation:bash:rm-rf");
	console.log("  cb:validation:bash:rm-rf =", validationKey);
	
	// Test 2: Safe command
	const result2 = await hookValidator.validate({
		tool: "bash",
		params: { command: "ls -la" },
	});
	console.log("\nTest 2 - Safe command:");
	console.log("  Result:", result2);
	
	// Test 3: System path write
	const result3 = await hookValidator.validate({
		tool: "Write",
		params: { file_path: "/etc/passwd", content: "test" },
	});
	console.log("\nTest 3 - System write:");
	console.log("  Result:", result3);
	
	// List all validation keys
	const allKeys = await redis.stream.keys("cb:*");
	console.log("\nAll CB keys created:");
	allKeys.forEach(key => console.log("  -", key));
	
	process.exit(0);
}

testValidator().catch(console.error);