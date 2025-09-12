import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import { instanceManager } from "@/core/instance-manager";
import { taskQueue } from "@/core/task-queue";
import { eventBus } from "@/core/bus";

// Import all handlers to register them
import "@/handlers";

/**
 * Setup integration test data by invoking handlers to create proper Redis state
 */
export async function setupIntegrationTest() {
	const redis = getRedis();
	
	// Initialize core systems
	await registry.discover();
	await eventBus.initialize();
	
	// Start health monitoring loop for failure detection
	// For tests, we need to set a faster check interval
	process.env.HEALTH_CHECK_INTERVAL = "500"; // 500ms for tests
	instanceManager.startHealthMonitoring();
	
	return redis;
}

/**
 * Register test instances through the system.register handler
 */
export async function registerTestInstances() {
	const instances = [
		{ id: "worker-1", roles: ["worker", "task-processor"] },
		{ id: "worker-2", roles: ["worker", "task-processor"] },
		{ id: "supervisor-1", roles: ["supervisor", "monitor"] },
	];
	
	for (const instance of instances) {
		// Use the system.register handler via registry
		await registry.executeHandler("system.register", instance);
	}
	
	// Also register instances that tests expect for specific scenarios
	await registry.executeHandler("system.register", { 
		id: "worker-balance-1", 
		roles: ["worker"] 
	});
	await registry.executeHandler("system.register", { 
		id: "worker-balance-2", 
		roles: ["worker"] 
	});
	await registry.executeHandler("system.register", { 
		id: "worker-balance-3", 
		roles: ["worker"] 
	});
}

/**
 * Create test tasks through the task.create handler
 */
export async function createTestTasks() {
	const tasks = [
		{ text: "Test task 1", priority: 50 },
		{ text: "High priority task", priority: 90 },
		{ text: "Low priority task", priority: 10 },
		{ text: "Task for balance test 1", priority: 50 },
		{ text: "Task for balance test 2", priority: 50 },
		{ text: "Task for balance test 3", priority: 50 },
	];
	
	const taskIds = [];
	for (const task of tasks) {
		const result = await registry.executeHandler("task.create", task);
		taskIds.push(result.id);
	}
	
	return taskIds;
}

/**
 * Setup event subscriptions for testing
 */
export async function setupEventSubscriptions() {
	// Subscribe to task.create events for testing
	await eventBus.subscribe("task.create", async (event) => {
		// Track in subscribers key
	}, "test-subscriber-1");
	
	// Mark a test event as processed
	await eventBus.markProcessed("evt-unique-123");
	
	// Add test data to partition
	await eventBus.addToPartition("user-123", { event: "test1", timestamp: 1 });
	await eventBus.addToPartition("user-123", { event: "test2", timestamp: 2 });
}

/**
 * Setup hook validation data
 */
export async function setupHookValidation() {
	const redis = getRedis();
	
	// Create hook chain for testing
	await redis.stream.sadd("cb:hooks:chain:bash", "security-hook", "audit-hook");
	
	// Create validation cache
	await redis.stream.set("cb:cache:validation:bash:ls", "allowed");
	
	// Create audit log
	await redis.stream.xadd(
		"cb:audit:hooks:decisions",
		"*",
		"tool", "bash",
		"decision", "allowed",
		"timestamp", Date.now().toString()
	);
	
	// Set rate limit flag
	await redis.stream.set("cb:ratelimit:hooks:pre_tool", "active");
}

/**
 * Setup circuit breaker test data
 */
export async function setupCircuitBreaker() {
	const redis = getRedis();
	
	// Set up circuit breaker state
	await redis.stream.hset("cb:circuit:test-handler", {
		state: "open",
		failures: "5",
		lastFailure: Date.now().toString(),
	});
	
	// Set trip timestamp
	await redis.stream.set("cb:circuit:trip:test-handler", Date.now().toString());
}

/**
 * Clean up integration test data
 */
export async function cleanupIntegrationTest() {
	// Close the event bus to clean up all listeners and subscriptions
	await eventBus.close();
	
	// Don't quit Redis - let the process handle cleanup on exit
	// This prevents interference between parallel test files
}