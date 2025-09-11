import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";

// Multi-Instance Event Distribution Integration Test
// Tests the complete flow of events distributed across multiple Claude Code instances

describe("Integration: Multi-Instance Event Distribution", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		// Clear test data
		try {
			const keys = await redis.stream.keys("cb:test:multi:*");
			if (keys.length > 0) {
				await redis.stream.del(...keys);
			}
		} catch {
			// Ignore cleanup errors
		}
	});

	afterAll(async () => {
		// Don't quit Redis - let the process handle cleanup on exit
		// This prevents interference between parallel test files
	});

	it("should register multiple instances", async () => {
		const instanceKeys = [
			"cb:instance:worker-1",
			"cb:instance:worker-2",
			"cb:instance:supervisor-1",
		];
		
		// Check all instances are registered (will fail without handler)
		for (const key of instanceKeys) {
			const exists = await redis.stream.exists(key);
			expect(exists).toBe(1);
		}
		
		// Check active instances set
		const activeKey = "cb:instances:active";
		const activeInstances = await redis.stream.smembers(activeKey);
		expect(activeInstances.length).toBeGreaterThanOrEqual(3);
	});

	it("should distribute events via pub/sub", async () => {
		// Publish an event
		const eventChannel = "cb:events:task.create";
		
		// Check subscribers exist (will fail without handler)
		const subscribersKey = "cb:subscribers:task.create";
		const subscribers = await redis.stream.smembers(subscribersKey);
		expect(subscribers.length).toBeGreaterThan(0);
	});

	it("should ensure exactly-once delivery", async () => {
		const eventId = "evt-unique-123";
		const processedKey = "cb:processed:events";
		
		// Event should be processed exactly once (will fail without handler)
		const processed = await redis.stream.sismember(processedKey, eventId);
		expect(processed).toBe(1);
		
		// Check duplicate prevention
		const duplicateKey = "cb:duplicates:prevented";
		const duplicateCount = await redis.stream.get(duplicateKey);
		expect(parseInt(duplicateCount || "0")).toBeGreaterThanOrEqual(0);
	});

	it("should partition events by instance capabilities", async () => {
		// Worker instances handle different event types
		const worker1Caps = "cb:capabilities:worker-1";
		const worker2Caps = "cb:capabilities:worker-2";
		
		// Check capabilities are different (will fail without handler)
		const caps1 = await redis.stream.smembers(worker1Caps);
		const caps2 = await redis.stream.smembers(worker2Caps);
		
		expect(caps1.length).toBeGreaterThan(0);
		expect(caps2.length).toBeGreaterThan(0);
		
		// Some capabilities should be unique to each instance
		const unique1 = caps1.filter(c => !caps2.includes(c));
		expect(unique1.length).toBeGreaterThan(0);
	});

	it("should handle instance failures gracefully", async () => {
		// When instance fails, events should be redistributed
		const failedInstance = "worker-failed";
		const redistributedKey = "cb:redistributed:from:" + failedInstance;
		
		// Check events were redistributed (will fail without handler)
		const redistributed = await redis.stream.lrange(redistributedKey, 0, -1);
		expect(redistributed.length).toBeGreaterThan(0);
	});

	it("should maintain event ordering per partition", async () => {
		// Events in same partition should maintain order
		const partitionKey = "cb:partition:user-123";
		const events = await redis.stream.lrange(partitionKey, 0, -1);
		
		// Check ordering (will fail without handler)
		expect(events.length).toBeGreaterThan(1);
		
		if (events.length > 1) {
			const timestamps = events.map(e => JSON.parse(e).timestamp);
			for (let i = 1; i < timestamps.length; i++) {
				expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
			}
		}
	});

	it("should implement leader election", async () => {
		// One instance should be elected as leader
		const leaderKey = "cb:leader:current";
		const leader = await redis.stream.get(leaderKey);
		
		// Leader should exist (will fail without handler)
		expect(leader).toBeTruthy();
		
		// Leader should be from active instances
		const activeKey = "cb:instances:active";
		const activeInstances = await redis.stream.smembers(activeKey);
		expect(activeInstances).toContain(leader);
	});

	it("should handle split-brain scenarios", async () => {
		// Prevent multiple leaders
		const leaderLockKey = "cb:leader:lock";
		const lockHolder = await redis.stream.get(leaderLockKey);
		
		// Only one lock holder (will fail without handler)
		expect(lockHolder).toBeTruthy();
		
		// Check lock has TTL
		const ttl = await redis.stream.ttl(leaderLockKey);
		expect(ttl).toBeGreaterThan(0);
	});

	it("should synchronize state across instances", async () => {
		// All instances should have consistent view
		const stateKey = "cb:state:global";
		const state = await redis.stream.hgetall(stateKey);
		
		// State should exist (will fail without handler)
		expect(Object.keys(state).length).toBeGreaterThan(0);
		
		// Check state version for consistency
		expect(state.version).toBeTruthy();
		expect(parseInt(state.version as string)).toBeGreaterThan(0);
	});

	it("should implement gossip protocol for health", async () => {
		// Instances should share health information
		const gossipKey = "cb:gossip:health";
		const gossipData = await redis.stream.hgetall(gossipKey);
		
		// Should have health from multiple instances (will fail without handler)
		expect(Object.keys(gossipData).length).toBeGreaterThan(1);
		
		for (const instance in gossipData) {
			const health = JSON.parse(gossipData[instance]);
			expect(health.status).toBeTruthy();
			expect(health.lastSeen).toBeTruthy();
		}
	});

	it("should handle network partitions", async () => {
		// Detect and handle network splits
		const partitionKey = "cb:partition:detected";
		const partitioned = await redis.stream.get(partitionKey);
		
		// Should detect partitions (will fail without handler)
		expect(partitioned).toBeTruthy();
		
		// Check recovery mechanism
		const recoveryKey = "cb:partition:recovery";
		const recovery = await redis.stream.get(recoveryKey);
		expect(recovery).toBeTruthy();
	});

	it("should scale horizontally", async () => {
		// Track scaling metrics
		const scalingKey = "cb:metrics:scaling";
		const metrics = await redis.stream.hgetall(scalingKey);
		
		// Should track instance count (will fail without handler)
		expect(metrics.instanceCount).toBeTruthy();
		expect(parseInt(metrics.instanceCount as string)).toBeGreaterThan(0);
		
		// Check load distribution
		expect(metrics.loadBalance).toBeTruthy();
		expect(parseFloat(metrics.loadBalance as string)).toBeLessThan(2); // Good balance
	});

	it("should coordinate batch processing", async () => {
		// Multiple instances should coordinate on batches
		const batchKey = "cb:batch:current";
		const batchLockKey = "cb:batch:lock";
		
		// Only one instance processes a batch (will fail without handler)
		const processor = await redis.stream.get(batchLockKey);
		expect(processor).toBeTruthy();
		
		// Check batch progress
		const progressKey = "cb:batch:progress";
		const progress = await redis.stream.hgetall(progressKey);
		expect(progress.processed).toBeTruthy();
		expect(progress.total).toBeTruthy();
	});

	it("should implement quorum-based decisions", async () => {
		// Critical decisions require quorum
		const quorumKey = "cb:quorum:decision:latest";
		const decision = await redis.stream.hgetall(quorumKey);
		
		// Should have votes from multiple instances (will fail without handler)
		expect(decision.votes).toBeTruthy();
		const votes = JSON.parse(decision.votes as string);
		expect(votes.length).toBeGreaterThan(Math.floor(3 / 2)); // Majority
	});

	it("should track global metrics", async () => {
		// Aggregate metrics across all instances
		const globalMetricsKey = "cb:metrics:global";
		const metrics = await redis.stream.hgetall(globalMetricsKey);
		
		// Should have aggregated metrics (will fail without handler)
		expect(metrics.totalEvents).toBeTruthy();
		expect(metrics.totalTasks).toBeTruthy();
		expect(metrics.avgLatency).toBeTruthy();
		expect(metrics.throughput).toBeTruthy();
		
		// Metrics should be reasonable
		expect(parseFloat(metrics.avgLatency as string)).toBeLessThan(1000);
		expect(parseFloat(metrics.throughput as string)).toBeGreaterThan(0);
	});
});