import { getRedis, redisKey } from "./redis";
import { rateLimit } from "../config";

export interface RateLimitResult {
	allowed: boolean;
	remaining: number;
	resetAt: number;
}

export class RateLimiter {
	private redis = getRedis();

	async checkLimit(
		event: string,
		clientId: string,
		maxRequests = rateLimit.maxRequests,
		windowMs = rateLimit.windowMs
	): Promise<RateLimitResult> {
		const key = redisKey("ratelimit", event, clientId);
		const now = Date.now();
		const windowStart = now - windowMs;

		// Remove old entries outside window
		await this.redis.stream.zremrangebyscore(key, "-inf", windowStart);

		// Count requests in current window
		const count = await this.redis.stream.zcard(key);

		if (count < maxRequests) {
			// Add current request
			await this.redis.stream.zadd(key, now, `${now}-${Math.random()}`);
			await this.redis.stream.expire(key, Math.ceil(windowMs / 1000));

			return {
				allowed: true,
				remaining: maxRequests - count - 1,
				resetAt: now + windowMs,
			};
		}

		// Get oldest entry to determine reset time
		const oldest = await this.redis.stream.zrange(key, 0, 0, "WITHSCORES");
		const resetAt = oldest.length > 1 ? parseInt(oldest[1]) + windowMs : now + windowMs;

		return {
			allowed: false,
			remaining: 0,
			resetAt,
		};
	}
}

export const rateLimiter = new RateLimiter();