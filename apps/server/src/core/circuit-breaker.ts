import { getRedis, redisKey } from "./redis";
import { circuitBreaker as circuitBreakerConfig } from "../config";

export enum CircuitState {
	CLOSED = "CLOSED",
	OPEN = "OPEN",
	HALF_OPEN = "HALF_OPEN",
}

export class CircuitBreaker {
	private redis = getRedis();
	private threshold = circuitBreakerConfig.threshold;
	private timeout = circuitBreakerConfig.timeout;
	private resetTimeout = circuitBreakerConfig.resetTimeout;

	async getState(handler: string): Promise<CircuitState> {
		const stateKey = redisKey("circuit", handler, "state");
		const state = await this.redis.stream.get(stateKey);
		return (state as CircuitState) || CircuitState.CLOSED;
	}

	async recordSuccess(handler: string): Promise<void> {
		const failureKey = redisKey("circuit", handler, "failures");
		await this.redis.stream.del(failureKey);
		
		const stateKey = redisKey("circuit", handler, "state");
		await this.redis.stream.set(stateKey, CircuitState.CLOSED);
	}

	async recordFailure(handler: string): Promise<CircuitState> {
		const failureKey = redisKey("circuit", handler, "failures");
		const failures = await this.redis.stream.incr(failureKey);
		await this.redis.stream.expire(failureKey, this.resetTimeout / 1000);

		if (failures >= this.threshold) {
			// Open circuit
			const stateKey = redisKey("circuit", handler, "state");
			await this.redis.stream.set(stateKey, CircuitState.OPEN, "PX", this.timeout);
			
			// Schedule half-open transition
			setTimeout(() => this.transitionToHalfOpen(handler), this.timeout);
			
			return CircuitState.OPEN;
		}

		return CircuitState.CLOSED;
	}

	private async transitionToHalfOpen(handler: string): Promise<void> {
		const stateKey = redisKey("circuit", handler, "state");
		const currentState = await this.redis.stream.get(stateKey);
		
		if (currentState === CircuitState.OPEN) {
			await this.redis.stream.set(stateKey, CircuitState.HALF_OPEN);
		}
	}

	async canExecute(handler: string): Promise<boolean> {
		const state = await this.getState(handler);
		return state !== CircuitState.OPEN;
	}
}

export const circuitBreaker = new CircuitBreaker();