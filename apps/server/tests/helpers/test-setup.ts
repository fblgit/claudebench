import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";

/**
 * Standard test setup for contract tests
 * Ensures clean Redis state and initialized registry
 */
export async function setupContractTest() {
	const redis = getRedis();
	
	// Flush Redis to ensure clean state for tests
	try {
		await redis.stream.flushdb();
	} catch (error) {
		console.warn("Could not flush Redis:", error);
	}
	
	// Initialize registry after flush
	await registry.discover();
	
	return redis;
}

/**
 * Standard test cleanup
 */
export async function cleanupContractTest() {
	// Don't quit Redis - let the process handle cleanup on exit
	// This prevents interference between parallel test files
}