import { describe, it, expect, beforeAll, afterAll } from "bun:test";
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
		
		// Setup hook validation data
		await setupHookValidation();
	});

	afterAll(async () => {
		await cleanupIntegrationTest();
	});

	it("should intercept dangerous bash commands", async () => {
		// Call hook.pre_tool handler to validate dangerous command
		const result = await registry.executeHandler("hook.pre_tool", {
			tool: "bash",
			params: { command: "rm -rf /" }
		});
		
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
		// Simulate safe command
		const validationKey = "cb:validation:bash:ls";
		const hookEvent = {
			toolName: "Bash",
			toolParams: { command: "ls -la" },
			instanceId: "worker-1",
			sessionId: "session-safe",
		};
		
		// Hook should allow this (will fail without handler)
		const allowed = await redis.stream.get(validationKey);
		expect(allowed).toBe("true");
	});

	it("should modify parameters for safety", async () => {
		// Some commands should be modified
		const modificationKey = "cb:modifications:bash:sudo";
		const originalCommand = "sudo apt-get install package";
		
		// Check if command was modified (will fail without handler)
		const modified = await redis.stream.hget(modificationKey, "modified");
		expect(modified).toBeTruthy();
		expect(modified).not.toContain("sudo");
	});

	it("should validate file write permissions", async () => {
		// Check write to system directories
		const validationKey = "cb:validation:write:system";
		const hookEvent = {
			toolName: "Write",
			toolParams: { 
				file_path: "/etc/passwd",
				content: "malicious content"
			},
			instanceId: "worker-1",
			sessionId: "session-write",
		};
		
		// Should be blocked (will fail without handler)
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

	it("should chain multiple validation hooks", async () => {
		// Multiple hooks can validate the same tool
		const chainKey = "cb:hooks:chain:bash";
		
		// Check multiple hooks are registered (will fail without handler)
		const hooks = await redis.stream.smembers(chainKey);
		expect(hooks.length).toBeGreaterThan(1);
		
		// All hooks must pass for tool to execute
		const allPassedKey = "cb:validation:chain:result";
		const allPassed = await redis.stream.get(allPassedKey);
		expect(allPassed).toBeTruthy();
	});

	it("should respect hook priorities", async () => {
		// High priority hooks execute first
		const executionOrderKey = "cb:hooks:execution:order";
		
		// Check execution order (will fail without handler)
		const order = await redis.stream.lrange(executionOrderKey, 0, -1);
		expect(order.length).toBeGreaterThan(0);
		
		// First hook should be highest priority
		if (order.length > 0) {
			const firstHook = JSON.parse(order[0]);
			expect(firstHook.priority).toBeGreaterThanOrEqual(10);
		}
	});

	it("should emit warnings without blocking", async () => {
		// Some operations should warn but not block
		const warningsKey = "cb:warnings:bash:large-file";
		const hookEvent = {
			toolName: "Bash",
			toolParams: { command: "cat very-large-file.txt" },
			instanceId: "worker-1",
			sessionId: "session-warn",
		};
		
		// Should have warnings (will fail without handler)
		const warnings = await redis.stream.lrange(warningsKey, 0, -1);
		expect(warnings.length).toBeGreaterThan(0);
		
		// But not blocked
		const blockedKey = "cb:validation:bash:large-file:blocked";
		const blocked = await redis.stream.get(blockedKey);
		expect(blocked).toBe("false");
	});

	it("should cache validation results", async () => {
		// Repeated validations should use cache
		const cacheKey = "cb:cache:validation:bash:ls";
		
		// Check cache exists (will fail without handler)
		const cached = await redis.stream.get(cacheKey);
		expect(cached).toBeTruthy();
		
		// Check cache hit rate
		const metricsKey = "cb:metrics:validation:cache";
		const hitRate = await redis.stream.hget(metricsKey, "hitRate");
		expect(parseFloat(hitRate || "0")).toBeGreaterThan(0);
	});

	it("should handle hook timeouts gracefully", async () => {
		// Slow hooks should timeout and allow tool execution
		const timeoutKey = "cb:hooks:timeout:slow-hook";
		
		// Check timeout occurred (will fail without handler)
		const timedOut = await redis.stream.get(timeoutKey);
		expect(timedOut).toBe("true");
		
		// Tool should still execute (with warning)
		const executedKey = "cb:tool:executed:after-timeout";
		const executed = await redis.stream.get(executedKey);
		expect(executed).toBe("true");
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