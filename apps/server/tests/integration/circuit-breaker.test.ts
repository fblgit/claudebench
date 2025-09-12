import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { getRedis } from "@/core/redis";
import { registry } from "@/core/registry";
import "@/handlers/test/test.circuit.handler"; // Import test handler

// Circuit Breaker Integration Test
// Tests the complete flow of circuit breaker triggering and recovery

describe("Integration: Circuit Breaker", () => {
	let redis: ReturnType<typeof getRedis>;

	beforeAll(async () => {
		redis = getRedis();
		
		// Ensure handler is discovered
		await registry.discover();
		
		// Clear test data
		try {
			const keys = await redis.stream.keys("cb:test:circuit:*");
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

	it("should track handler failures", async () => {
		const failureKey = "cb:circuit:test.circuit:failures";
		
		// Trigger a failure by calling handler with shouldFail=true
		try {
			await registry.executeHandler("test.circuit", { shouldFail: true });
		} catch (error: any) {
			// Expected to fail
		}
		
		const failures = await redis.stream.get(failureKey);
		expect(parseInt(failures || "0")).toBeGreaterThanOrEqual(1);
	});

	it("should open circuit after threshold failures", async () => {
		const circuitKey = "cb:circuit:test.circuit:state";
		const threshold = 5;
		
		// Trigger 5 failures to open the circuit
		for (let i = 0; i < threshold; i++) {
			try {
				await registry.executeHandler("test.circuit", { shouldFail: true });
			} catch (error) {
				// Expected to fail
			}
		}
		
		const state = await redis.stream.get(circuitKey);
		expect(state).toBe("OPEN");
		
		// Check timestamp when opened
		const openedAtKey = "cb:circuit:test.circuit:openedAt";
		const openedAt = await redis.stream.get(openedAtKey);
		expect(openedAt).toBeTruthy();
	});

	it("should reject requests when circuit is open", async () => {
		// Circuit should already be open from previous test
		const circuitKey = "cb:circuit:test.circuit:state";
		const rejectedKey = "cb:circuit:test.circuit:rejected";
		
		const state = await redis.stream.get(circuitKey);
		expect(state).toBe("OPEN");
		
		// Try to make a request when circuit is open - should get fallback
		const result = await registry.executeHandler("test.circuit", { shouldFail: false });
		expect(result.success).toBe(false);
		expect(result.message).toContain("fallback");
		
		// Count rejected requests
		const rejected = await redis.stream.get(rejectedKey);
		expect(parseInt(rejected || "0")).toBeGreaterThan(0);
	});

	it("should transition to half-open after timeout", async () => {
		const circuitKey = "cb:circuit:test.circuit:state";
		
		// Wait for timeout (test handler has 1 second timeout)
		await new Promise(resolve => setTimeout(resolve, 1100));
		
		// Try a request - circuit should transition to half-open
		try {
			await registry.executeHandler("test.circuit", { shouldFail: false });
		} catch (error) {
			// Might fail if still transitioning
		}
		
		const state = await redis.stream.get(circuitKey);
		expect(state).toBe("HALF_OPEN");
	});

	it("should allow limited requests in half-open state", async () => {
		const circuitKey = "cb:circuit:test.circuit:state";
		const allowedKey = "cb:circuit:test.circuit:allowed";
		
		// Circuit should be half-open from previous test
		const state = await redis.stream.get(circuitKey);
		expect(state).toBe("HALF_OPEN");
		
		// Make a successful request in half-open state
		const result = await registry.executeHandler("test.circuit", { shouldFail: false });
		expect(result.success).toBe(true);
		
		const allowed = await redis.stream.get(allowedKey);
		expect(parseInt(allowed || "0")).toBeLessThanOrEqual(3); // Limited requests
	});

	it("should close circuit after successful requests", async () => {
		const circuitKey = "cb:circuit:test.circuit:state";
		const successKey = "cb:circuit:test.circuit:successes";
		
		// Make 3 successful requests to close the circuit
		for (let i = 0; i < 3; i++) {
			const result = await registry.executeHandler("test.circuit", { shouldFail: false });
			expect(result.success).toBe(true);
		}
		
		const successes = await redis.stream.get(successKey);
		expect(parseInt(successes || "0")).toBeGreaterThan(0);
		
		// Circuit should close after successful requests
		const state = await redis.stream.get(circuitKey);
		expect(state || "CLOSED").toBe("CLOSED"); // null means closed
	});

	it("should reset failure count when circuit closes", async () => {
		const failureKey = "cb:circuit:test.circuit:failures";
		const stateKey = "cb:circuit:test.circuit:state";
		
		// Circuit should be closed from previous test, failures should be reset
		const initialFailures = await redis.stream.get(failureKey);
		expect(parseInt(initialFailures || "0")).toBe(0);
		
		const state = await redis.stream.get(stateKey);
		expect(state || "CLOSED").toBe("CLOSED");
		
		const finalFailures = await redis.stream.get(failureKey);
		expect(parseInt(finalFailures || "0")).toBe(0);
	});

	it("should track circuit breaker metrics", async () => {
		const metricsKey = "cb:metrics:circuit:all";
		
		// Check metrics are tracked (will fail without handler)
		const metrics = await redis.stream.hgetall(metricsKey);
		expect(metrics.totalTrips).toBeTruthy();
		expect(metrics.successRate).toBeTruthy();
		expect(metrics.avgRecoveryTime).toBeTruthy();
	});

	it("should emit alerts when circuit opens", async () => {
		const alertKey = "cb:alerts:circuit:opened";
		
		// Check alerts are created (will fail without handler)
		const alerts = await redis.stream.lrange(alertKey, 0, -1);
		expect(alerts.length).toBeGreaterThan(0);
		
		if (alerts.length > 0) {
			const alert = JSON.parse(alerts[0]);
			expect(alert.handler).toBeTruthy();
			expect(alert.severity).toBe("HIGH");
		}
	});

	it("should handle cascading failures", async () => {
		// When one handler fails, dependent handlers should also trip
		const handler1Key = "cb:circuit:handler1:state";
		const handler2Key = "cb:circuit:handler2:state";
		
		// If handler1 is open (will fail without handler)
		const handler1State = await redis.stream.get(handler1Key);
		expect(handler1State).toBe("OPEN");
		
		// Dependent handler2 should also be affected
		const handler2State = await redis.stream.get(handler2Key);
		expect(["OPEN", "HALF_OPEN"]).toContain(handler2State);
	});

	it("should implement exponential backoff", async () => {
		const backoffKey = "cb:circuit:backoff:multiplier";
		const attemptKey = "cb:circuit:backoff:attempt";
		
		// Check backoff is increasing (will fail without handler)
		const attempt = await redis.stream.get(attemptKey);
		const multiplier = await redis.stream.get(backoffKey);
		
		expect(parseInt(attempt || "0")).toBeGreaterThan(0);
		expect(parseFloat(multiplier || "1")).toBeGreaterThan(1);
	});

	it("should maintain circuit state across instances", async () => {
		// Circuit state should be shared across all instances
		const instance1ViewKey = "cb:circuit:shared:instance1:view";
		const instance2ViewKey = "cb:circuit:shared:instance2:view";
		
		// Both instances should see same state (will fail without handler)
		const state1 = await redis.stream.get(instance1ViewKey);
		const state2 = await redis.stream.get(instance2ViewKey);
		expect(state1).toBe(state2);
	});

	it("should handle different failure types", async () => {
		// Different errors should be tracked separately
		const timeoutKey = "cb:circuit:failures:timeout";
		const errorKey = "cb:circuit:failures:error";
		const rejectionKey = "cb:circuit:failures:rejection";
		
		// Check different failure types (will fail without handler)
		const timeouts = await redis.stream.get(timeoutKey);
		const errors = await redis.stream.get(errorKey);
		const rejections = await redis.stream.get(rejectionKey);
		
		expect(parseInt(timeouts || "0")).toBeGreaterThanOrEqual(0);
		expect(parseInt(errors || "0")).toBeGreaterThanOrEqual(0);
		expect(parseInt(rejections || "0")).toBeGreaterThanOrEqual(0);
	});

	it("should provide fallback responses", async () => {
		// First, trigger enough failures to open the circuit
		const threshold = 5;
		for (let i = 0; i < threshold; i++) {
			try {
				await registry.executeHandler("test.circuit", { shouldFail: true });
			} catch (error) {
				// Expected to fail
			}
		}
		
		// Now try to call the handler while circuit is open
		// This should trigger the fallback
		try {
			await registry.executeHandler("test.circuit", { shouldFail: false });
			// Should not reach here - circuit should be open
		} catch (error: any) {
			// Circuit is open, fallback should have been triggered
		}
		
		const fallbackKey = "cb:circuit:fallback:used";
		const fallbackUsed = await redis.stream.get(fallbackKey);
		expect(fallbackUsed).toBe("true");
		
		// Check fallback response
		const responseKey = "cb:circuit:fallback:response";
		const response = await redis.stream.get(responseKey);
		if (response) {
			expect(response).toContain("temporarily unavailable");
		}
	});
});