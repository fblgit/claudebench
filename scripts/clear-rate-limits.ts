import { getRedis } from "./src/core/redis";

async function clearRateLimits() {
	const redis = getRedis();
	
	// Find all rate limit keys
	const keys = await redis.stream.keys("cb:ratelimit:*");
	console.log(`Found ${keys.length} rate limit keys`);
	
	// Delete them all
	if (keys.length > 0) {
		await redis.stream.del(...keys);
		console.log("Cleared all rate limit keys");
	}
	
	// Also check what's creating the 10 request limit
	// Let's see if there are any decorators being applied
	console.log("\nChecking for rate limit decorators...");
	
	process.exit(0);
}

clearRateLimits().catch(console.error);