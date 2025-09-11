import { getRedis, redisKey } from "./redis";
import { circuitBreaker as circuitBreakerConfig } from "../config";

export enum CircuitState {
	CLOSED = "CLOSED",
	OPEN = "OPEN",
	HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerMetrics {
	totalTrips: number;
	successRate: number;
	avgRecoveryTime: number;
	failuresByType: {
		timeout: number;
		error: number;
		rejection: number;
	};
}

export interface CircuitAlert {
	handler: string;
	severity: "LOW" | "MEDIUM" | "HIGH";
	message: string;
	timestamp: number;
}

export class CircuitBreaker {
	private redis = getRedis();
	private threshold = circuitBreakerConfig.threshold;
	private timeout = circuitBreakerConfig.timeout;
	private resetTimeout = circuitBreakerConfig.resetTimeout;
	private halfOpenLimit = 3; // Max requests in half-open state
	private backoffMultiplier = 1.5;

	async getState(handler: string): Promise<CircuitState> {
		const stateKey = redisKey("circuit", handler, "state");
		const state = await this.redis.stream.get(stateKey);
		
		// Default to CLOSED if no state exists
		if (!state) {
			return CircuitState.CLOSED;
		}
		
		return state as CircuitState;
	}

	async recordSuccess(handler: string): Promise<void> {
		const state = await this.getState(handler);
		
		// Track successes for recovery
		const successKey = redisKey("circuit", handler, "successes");
		await this.redis.stream.incr(successKey);
		
		if (state === CircuitState.HALF_OPEN) {
			const successes = await this.redis.stream.get(successKey);
			if (parseInt(successes || "0") >= 3) {
				// Close circuit after successful requests
				await this.closeCircuit(handler);
			}
		}
		
		// Clear failures on success
		const failureKey = redisKey("circuit", handler, "failures");
		await this.redis.stream.del(failureKey);
		
		// Update metrics
		await this.updateMetrics(handler, "success");
	}

	async recordFailure(handler: string, failureType: "timeout" | "error" | "rejection" = "error"): Promise<CircuitState> {
		// Track failure types separately
		const failureTypeKey = redisKey("circuit", "failures", failureType);
		await this.redis.stream.incr(failureTypeKey);
		await this.redis.stream.expire(failureTypeKey, 3600); // 1 hour TTL
		
		// Track overall failures
		const failureKey = redisKey("circuit", handler, "failures");
		const failures = await this.redis.stream.incr(failureKey);
		await this.redis.stream.expire(failureKey, this.resetTimeout / 1000);

		// Track per-handler failure types
		const handlerFailureKey = redisKey("circuit", handler, "failures", failureType);
		await this.redis.stream.incr(handlerFailureKey);
		await this.redis.stream.expire(handlerFailureKey, 3600);

		if (failures >= this.threshold) {
			// Open circuit
			await this.openCircuit(handler);
			return CircuitState.OPEN;
		}

		// Update metrics
		await this.updateMetrics(handler, "failure", failureType);

		return CircuitState.CLOSED;
	}

	private async openCircuit(handler: string): Promise<void> {
		const stateKey = redisKey("circuit", handler, "state");
		await this.redis.stream.set(stateKey, CircuitState.OPEN, "PX", this.timeout);
		
		// Track when opened
		const openedAtKey = redisKey("circuit", handler, "openedAt");
		await this.redis.stream.set(openedAtKey, Date.now().toString(), "PX", this.timeout);
		
		// Track total trips
		const metricsKey = redisKey("metrics", "circuit", "all");
		await this.redis.stream.hincrby(metricsKey, "totalTrips", 1);
		
		// Create alert
		await this.createAlert(handler, "Circuit opened due to failures");
		
		// Track backoff
		const attemptKey = redisKey("circuit", "backoff", "attempt");
		const attempt = await this.redis.stream.incr(attemptKey);
		const backoffKey = redisKey("circuit", "backoff", "multiplier");
		await this.redis.stream.set(backoffKey, (Math.pow(this.backoffMultiplier, attempt)).toString());
		
		// Schedule half-open transition
		setTimeout(() => this.transitionToHalfOpen(handler), this.timeout);
		
		// Mark fallback as active
		const fallbackKey = redisKey("circuit", "fallback", "used");
		await this.redis.stream.set(fallbackKey, "true", "PX", this.timeout);
		
		// Set fallback response
		const responseKey = redisKey("circuit", "fallback", "response");
		await this.redis.stream.set(responseKey, `Service temporarily unavailable for ${handler}`, "PX", this.timeout);
	}

	private async closeCircuit(handler: string): Promise<void> {
		const stateKey = redisKey("circuit", handler, "state");
		await this.redis.stream.set(stateKey, CircuitState.CLOSED);
		
		// Reset failures
		const failureKey = redisKey("circuit", handler, "failures");
		await this.redis.stream.del(failureKey);
		
		// Clear successes counter
		const successKey = redisKey("circuit", handler, "successes");
		await this.redis.stream.del(successKey);
		
		// Reset backoff
		const attemptKey = redisKey("circuit", "backoff", "attempt");
		await this.redis.stream.del(attemptKey);
		const backoffKey = redisKey("circuit", "backoff", "multiplier");
		await this.redis.stream.del(backoffKey);
		
		// Clear fallback
		const fallbackKey = redisKey("circuit", "fallback", "used");
		await this.redis.stream.del(fallbackKey);
		
		// Update metrics for recovery
		const metricsKey = redisKey("metrics", "circuit", "all");
		const openedAtKey = redisKey("circuit", handler, "openedAt");
		const openedAt = await this.redis.stream.get(openedAtKey);
		if (openedAt) {
			const recoveryTime = Date.now() - parseInt(openedAt);
			await this.redis.stream.hset(metricsKey, "lastRecoveryTime", recoveryTime.toString());
			
			// Update average recovery time
			const avgKey = await this.redis.stream.hget(metricsKey, "avgRecoveryTime");
			const currentAvg = parseFloat(avgKey || "0");
			const newAvg = currentAvg ? (currentAvg + recoveryTime) / 2 : recoveryTime;
			await this.redis.stream.hset(metricsKey, "avgRecoveryTime", newAvg.toString());
		}
		
		await this.redis.stream.del(openedAtKey);
	}

	private async transitionToHalfOpen(handler: string): Promise<void> {
		const stateKey = redisKey("circuit", handler, "state");
		const currentState = await this.redis.stream.get(stateKey);
		
		if (currentState === CircuitState.OPEN) {
			await this.redis.stream.set(stateKey, CircuitState.HALF_OPEN);
			
			// Reset allowed counter for half-open state
			const allowedKey = redisKey("circuit", handler, "allowed");
			await this.redis.stream.set(allowedKey, "0");
		}
	}

	async canExecute(handler: string): Promise<boolean> {
		const state = await this.getState(handler);
		
		// CLOSED state means circuit is functioning normally
		if (state === CircuitState.CLOSED || !state) {
			return true;
		}
		
		if (state === CircuitState.OPEN) {
			// Track rejected requests
			const rejectedKey = redisKey("circuit", handler, "rejected");
			await this.redis.stream.incr(rejectedKey);
			await this.redis.stream.expire(rejectedKey, 3600);
			return false;
		}
		
		if (state === CircuitState.HALF_OPEN) {
			// Allow limited requests
			const allowedKey = redisKey("circuit", handler, "allowed");
			const allowed = await this.redis.stream.incr(allowedKey);
			
			if (allowed <= this.halfOpenLimit) {
				await this.redis.stream.expire(allowedKey, 60); // Reset after 1 minute
				return true;
			}
			
			// Too many requests, reject
			const rejectedKey = redisKey("circuit", handler, "rejected");
			await this.redis.stream.incr(rejectedKey);
			return false;
		}
		
		return false;
	}

	async getFallbackResponse(handler: string): Promise<any> {
		const responseKey = redisKey("circuit", "fallback", "response");
		const response = await this.redis.stream.get(responseKey);
		return {
			error: response || `Service temporarily unavailable for ${handler}`,
			fallback: true,
		};
	}

	private async updateMetrics(handler: string, type: "success" | "failure", failureType?: string): Promise<void> {
		const metricsKey = redisKey("metrics", "circuit", "all");
		
		// Update counters
		if (type === "success") {
			await this.redis.stream.hincrby(metricsKey, "totalSuccesses", 1);
		} else {
			await this.redis.stream.hincrby(metricsKey, "totalFailures", 1);
			if (failureType) {
				await this.redis.stream.hincrby(metricsKey, `failures:${failureType}`, 1);
			}
		}
		
		// Calculate success rate
		const successes = await this.redis.stream.hget(metricsKey, "totalSuccesses");
		const failures = await this.redis.stream.hget(metricsKey, "totalFailures");
		const total = parseInt(successes || "0") + parseInt(failures || "0");
		if (total > 0) {
			const successRate = (parseInt(successes || "0") / total) * 100;
			await this.redis.stream.hset(metricsKey, "successRate", successRate.toFixed(2));
		}
		
		// Set TTL on metrics
		await this.redis.stream.expire(metricsKey, 3600); // 1 hour
	}

	private async createAlert(handler: string, message: string): Promise<void> {
		const alertKey = redisKey("alerts", "circuit", "opened");
		const alert: CircuitAlert = {
			handler,
			severity: "HIGH",
			message,
			timestamp: Date.now(),
		};
		
		await this.redis.stream.lpush(alertKey, JSON.stringify(alert));
		await this.redis.stream.ltrim(alertKey, 0, 99); // Keep last 100 alerts
		await this.redis.stream.expire(alertKey, 86400); // 24 hours
	}

	async getMetrics(): Promise<CircuitBreakerMetrics> {
		const metricsKey = redisKey("metrics", "circuit", "all");
		const metrics = await this.redis.stream.hgetall(metricsKey);
		
		return {
			totalTrips: parseInt(metrics.totalTrips || "0"),
			successRate: parseFloat(metrics.successRate || "0"),
			avgRecoveryTime: parseFloat(metrics.avgRecoveryTime || "0"),
			failuresByType: {
				timeout: parseInt(metrics["failures:timeout"] || "0"),
				error: parseInt(metrics["failures:error"] || "0"),
				rejection: parseInt(metrics["failures:rejection"] || "0"),
			},
		};
	}

	async handleCascadingFailure(handler1: string, handler2: string): Promise<void> {
		// If handler1 is open, mark handler2 as affected
		const state1 = await this.getState(handler1);
		if (state1 === CircuitState.OPEN) {
			const handler2StateKey = redisKey("circuit", handler2, "state");
			const handler2State = await this.redis.stream.get(handler2StateKey);
			
			if (handler2State !== CircuitState.OPEN) {
				// Put handler2 in half-open to reduce load
				await this.redis.stream.set(handler2StateKey, CircuitState.HALF_OPEN, "PX", this.timeout / 2);
			}
		}
	}

	async syncAcrossInstances(handler: string, instanceId: string): Promise<void> {
		// Share circuit state across instances
		const sharedStateKey = redisKey("circuit", "shared", instanceId, "view");
		const state = await this.getState(handler);
		await this.redis.stream.set(sharedStateKey, state, "PX", 5000); // 5 second TTL
	}
}

export const circuitBreaker = new CircuitBreaker();