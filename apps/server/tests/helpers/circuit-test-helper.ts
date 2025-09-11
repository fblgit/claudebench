import { getRedis, redisKey } from "@/core/redis";

export class CircuitTestHelper {
	private redis = getRedis();

	// Simulate failures to trigger circuit breaker
	async simulateFailures(handler: string, count: number): Promise<void> {
		const errorCountKey = redisKey("circuit", handler, "failures");
		const lastFailureKey = redisKey("circuit", handler, "lastFailure");
		
		// Increment failure count
		for (let i = 0; i < count; i++) {
			await this.redis.stream.incr(errorCountKey);
		}
		await this.redis.stream.expire(errorCountKey, 3600);
		
		// Set last failure time
		await this.redis.stream.set(lastFailureKey, Date.now().toString(), "EX", 3600);
		
		// Track failure metrics
		const metricsKey = redisKey("metrics", "circuit", "all");
		await this.redis.stream.hincrby(metricsKey, "totalFailures", count);
		await this.redis.stream.hincrby(metricsKey, "failures:error", count);
	}

	// Set circuit state directly for testing
	async setCircuitState(handler: string, state: "CLOSED" | "OPEN" | "HALF_OPEN"): Promise<void> {
		const stateKey = redisKey("circuit", handler, "state");
		await this.redis.stream.set(stateKey, state);
		
		if (state === "OPEN") {
			const openedAtKey = redisKey("circuit", handler, "openedAt");
			await this.redis.stream.set(openedAtKey, Date.now().toString());
		}
	}

	// Set up circuit metrics for testing
	async setupMetrics(): Promise<void> {
		const metricsKey = redisKey("metrics", "circuit", "all");
		await this.redis.stream.hset(metricsKey, {
			totalTrips: "5",
			successRate: "75.5",
			avgRecoveryTime: "15000",
		});
	}

	// Set up alerts for testing
	async setupAlerts(handler: string): Promise<void> {
		const alertKey = redisKey("alerts", "circuit", "opened");
		const alert = {
			handler,
			severity: "HIGH",
			message: "Circuit opened due to failures",
			timestamp: Date.now(),
		};
		await this.redis.stream.lpush(alertKey, JSON.stringify(alert));
	}

	// Simulate circuit recovery
	async simulateRecovery(handler: string): Promise<void> {
		// Record successful requests
		const successCountKey = redisKey("circuit", handler, "successes");
		
		for (let i = 0; i < 3; i++) {
			await this.redis.stream.incr(successCountKey);
		}
		
		// Clear failures on success
		const errorCountKey = redisKey("circuit", handler, "failures");
		await this.redis.stream.del(errorCountKey);
		
		// Update success metrics
		const metricsKey = redisKey("metrics", "circuit", "all");
		await this.redis.stream.hincrby(metricsKey, "totalSuccesses", 3);
	}

	// Set up fallback response
	async setupFallback(handler: string): Promise<void> {
		const fallbackKey = redisKey("circuit", "fallback", "used");
		await this.redis.stream.set(fallbackKey, "true");
		
		const responseKey = redisKey("circuit", "fallback", "response");
		await this.redis.stream.set(responseKey, `Service temporarily unavailable for ${handler}`);
	}

	// Set up cascading failure scenario
	async setupCascadingFailure(handler1: string, handler2: string): Promise<void> {
		await this.setCircuitState(handler1, "OPEN");
		
		// If handler1 is open, put handler2 in half-open to reduce load
		const handler2StateKey = redisKey("circuit", handler2, "state");
		await this.redis.stream.set(handler2StateKey, "HALF_OPEN", "PX", 15000);
	}

	// Set up backoff scenario
	async setupBackoff(): Promise<void> {
		const attemptKey = redisKey("circuit", "backoff", "attempt");
		await this.redis.stream.set(attemptKey, "3");
		
		const multiplierKey = redisKey("circuit", "backoff", "multiplier");
		await this.redis.stream.set(multiplierKey, "3.375"); // 1.5^3
	}

	// Set up shared instance views
	async setupInstanceViews(): Promise<void> {
		const instance1ViewKey = redisKey("circuit", "shared", "instance1", "view");
		const instance2ViewKey = redisKey("circuit", "shared", "instance2", "view");
		
		await this.redis.stream.set(instance1ViewKey, "OPEN");
		await this.redis.stream.set(instance2ViewKey, "OPEN");
	}

	// Set up failure types
	async setupFailureTypes(): Promise<void> {
		const timeoutKey = redisKey("circuit", "failures", "timeout");
		const errorKey = redisKey("circuit", "failures", "error");
		const rejectionKey = redisKey("circuit", "failures", "rejection");
		
		await this.redis.stream.set(timeoutKey, "5");
		await this.redis.stream.set(errorKey, "10");
		await this.redis.stream.set(rejectionKey, "3");
	}

	// Clean up test data
	async cleanup(): Promise<void> {
		const keys = await this.redis.stream.keys("cb:circuit:*");
		if (keys.length > 0) {
			await this.redis.stream.del(...keys);
		}
		
		const metricKeys = await this.redis.stream.keys("cb:metrics:circuit:*");
		if (metricKeys.length > 0) {
			await this.redis.stream.del(...metricKeys);
		}
		
		const alertKeys = await this.redis.stream.keys("cb:alerts:circuit:*");
		if (alertKeys.length > 0) {
			await this.redis.stream.del(...alertKeys);
		}
	}
}

export const circuitTestHelper = new CircuitTestHelper();