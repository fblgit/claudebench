import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import { 
	setupIntegrationTest, 
	setupHookValidation,
	cleanupIntegrationTest 
} from "../helpers/integration-setup";

// Pre-tool Hook Validation Integration Test
// Tests the complete flow of tool validation and blocking via hooks

describe("Integration: Pre-tool Hook Validation", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = await setupIntegrationTest();
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	beforeEach(async () => {
		// Flush Redis to ensure clean state for each test
		await redis.stream.flushdb();
		
		// Setup hook validation data after flush
		await setupHookValidation();
	});

	it("should intercept dangerous bash commands", async () => {
		// Call hook.pre_tool handler to validate dangerous command
		const result = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "rm -rf /" }
		}, "session-danger"); // Pass sessionId as clientId
		
		// Should block dangerous command
		expect(result.allow).toBe(false);
		expect(result.reason).toContain("dangerous");
		
		// Check validation was recorded
		const validationKey = "cb:validation:bash:rm-rf";
		const hookEvent = {
			toolName: "Bash",
			toolParams: { command: "rm -rf /" },
			instanceId: "worker-1",
			sessionId: "session-danger",
		};
		
		// Hook should block this (will fail without handler)
		const blocked = await redis.stream.get(validationKey);
		expect(blocked).toBe("true");
		
		// Check rejection reason
		const reasonKey = "cb:rejection:bash:rm-rf:reason";
		const reason = await redis.stream.get(reasonKey);
		expect(reason).toContain("dangerous");
	});

	it("should allow safe commands", async () => {
		// Call hook.pre_tool handler to validate safe command
		const result = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "ls -la" }
		}, "session-safe"); // Pass sessionId as clientId
		
		// Should allow safe command
		expect(result.allow).toBe(true);
		
		// Check validation was recorded
		const validationKey = "cb:validation:bash:ls";
		const allowed = await redis.stream.get(validationKey);
		expect(allowed).toBe("true");
	});

	it("should modify parameters for safety", async () => {
		// Call hook.pre_tool handler with sudo command
		const result = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "sudo apt-get install package" }
		}, "session-modify"); // Pass sessionId
		
		// Should allow but modify the command
		expect(result.allow).toBe(true);
		expect(result.modified).toBeDefined();
		
		// Check modification was recorded
		const modificationKey = "cb:modifications:bash:sudo";
		const modified = await redis.stream.hget(modificationKey, "modified");
		expect(modified).toBeTruthy();
		const modifiedCmd = JSON.parse(modified || "{}");
		expect(modifiedCmd.command || "").not.toContain("sudo");
	});

	it("should validate file write permissions", async () => {
		// Call hook.pre_tool handler to validate system write
		const result = await registry.executeHandler("hook.pre_tool", {
			tool: "write",
			params: { 
				file_path: "/etc/passwd",
				content: "malicious content"
			}
		}, "session-write"); // Pass sessionId
		
		// Should block system directory write
		expect(result.allow).toBe(false);
		expect(result.reason).toContain("system directory");
		
		// Check validation was recorded
		const validationKey = "cb:validation:write:system";
		const blocked = await redis.stream.get(validationKey);
		expect(blocked).toBe("true");
	});

	it("should track hook execution time", async () => {
		// Hooks should execute quickly
		const performanceKey = "cb:performance:hooks:pre_tool";
		
		// Check execution time (will fail without handler)
		const avgTime = await redis.stream.hget(performanceKey, "avgExecutionTime");
		expect(parseFloat(avgTime || "0")).toBeLessThan(100); // Less than 100ms
	});

	it.skip("should chain multiple validation hooks", async () => {
		// This test requires multiple hook handlers to be implemented
		// Currently we only have one hook.pre_tool handler
		// Skipping until multiple hooks feature is implemented
	});

	it.skip("should respect hook priorities", async () => {
		// This test requires multiple hook handlers with different priorities
		// Currently we only have one hook.pre_tool handler
		// Skipping until hook priority feature is implemented
	});

	it("should emit warnings without blocking", async () => {
		// Call hook.pre_tool handler with large file operation
		const result = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "cat very-large-file.txt" }
		}, "session-warn"); // Pass sessionId
		
		// Should allow with warning (performance_warnings rule in config)
		expect(result.allow).toBe(true);
		
		// Check warnings were recorded
		const warningsKey = "cb:warnings:bash:large-file";
		const warnings = await redis.stream.lrange(warningsKey, 0, -1);
		expect(warnings.length).toBeGreaterThan(0);
		
		// Check not blocked
		const blockedKey = "cb:validation:bash:large-file:blocked";
		const blocked = await redis.stream.get(blockedKey);
		expect(blocked).toBe("false");
	});

	it("should cache validation results", async () => {
		// First call - cache miss
		const result1 = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "ls -la" }
		}, "session-cache-test");
		
		// Second call with same params - should hit cache
		const result2 = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "ls -la" }
		}, "session-cache-test");
		
		// Both results should be the same (cached)
		expect(result1).toEqual(result2);
		expect(result1.allow).toBe(true);
		
		// The validation should have been recorded
		const validationKey = "cb:validation:bash:ls";
		const cached = await redis.stream.get(validationKey);
		expect(cached).toBe("true");
		
		// The @Instrumented decorator provides caching at the method level
		// So the second call returns immediately without executing validateInternal
		// This is correct behavior - the caching is working via the decorator
		
		// Check that the HookValidator tracked cache hits in metrics
		const metricsKey = "cb:metrics:counters";
		const cacheHits = await redis.stream.hget(metricsKey, "hook.validation.cache.hits");
		expect(parseInt(cacheHits || "0")).toBeGreaterThanOrEqual(1);
	});

	it.skip("should handle hook timeouts gracefully", async () => {
		// The timeout test requires simulating a slow validation
		// The @Resilient decorator on HookValidator.validateInternal has a 3s timeout
		// To properly test this, we'd need to inject a delay into the validation logic
		// Skipping for now as it requires modifying production code for testing
	});

	it("should log all hook decisions", async () => {
		// Audit trail of all hook decisions
		const auditKey = "cb:audit:hooks:decisions";
		
		// Check audit log exists (will fail without handler)
		const auditLog = await redis.stream.xrange(auditKey, "-", "+", "COUNT", 10);
		expect(auditLog.length).toBeGreaterThan(0);
		
		// Each entry should have decision details
		if (auditLog.length > 0) {
			// Redis stream returns [id, [field1, value1, field2, value2, ...]]
			const fields = auditLog[0][1];
			expect(fields).toContain("tool");
			expect(fields).toContain("decision");
			expect(fields).toContain("timestamp");
		}
	});

	it("should integrate with rate limiting", async () => {
		// Hooks should respect rate limits
		const rateLimitKey = "cb:ratelimit:hooks:pre_tool";
		
		// Check rate limit is applied (will fail without handler)
		const limited = await redis.stream.get(rateLimitKey);
		expect(limited).toBeTruthy();
	});
});