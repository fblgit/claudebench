import { getRedis, redisKey } from "./redis";
import * as crypto from "crypto";

export interface HookConfig {
	id: string;
	type: "pre_tool" | "post_tool" | "user_prompt" | "todo_write";
	priority: number; // Lower number = higher priority
	handler: string; // Handler name
	enabled: boolean;
}

export interface HookResult {
	allow: boolean;
	reason?: string;
	modified?: any;
}

export class HookManager {
	private redis = getRedis();
	private cacheTimeout = 60; // 60 seconds cache

	// Register a hook with priority
	async registerHook(config: HookConfig): Promise<void> {
		const hookKey = redisKey("hooks", config.type, config.id);
		await this.redis.stream.hset(hookKey, {
			id: config.id,
			type: config.type,
			priority: config.priority.toString(),
			handler: config.handler,
			enabled: config.enabled.toString(),
		});
		await this.redis.stream.expire(hookKey, 3600); // 1 hour TTL

		// Add to sorted set for priority ordering
		const setKey = redisKey("hooks", config.type, "sorted");
		await this.redis.stream.zadd(setKey, config.priority, config.id);
	}

	// Execute hooks in priority order with chaining
	async executeHooks(type: string, params: any): Promise<HookResult> {
		// Check cache first
		const cacheKey = redisKey("hook", "cache", type, this.hashParams(params));
		const cached = await this.redis.stream.get(cacheKey);
		if (cached) {
			return JSON.parse(cached);
		}

		// Get hooks sorted by priority
		const setKey = redisKey("hooks", type, "sorted");
		const hookIds = await this.redis.stream.zrange(setKey, 0, -1);

		let result: HookResult = { allow: true };
		let modifiedParams = params;

		// Execute hooks in chain
		for (const hookId of hookIds) {
			const hookKey = redisKey("hooks", type, hookId);
			const hookData = await this.redis.stream.hgetall(hookKey);

			if (!hookData.enabled || hookData.enabled === "false") {
				continue;
			}

			// Execute hook (simplified - in reality would call the handler)
			const hookResult = await this.executeHook(hookData.handler, modifiedParams);

			// If hook blocks, stop chain
			if (!hookResult.allow) {
				result = hookResult;
				break;
			}

			// Apply modifications for next hook in chain
			if (hookResult.modified) {
				modifiedParams = hookResult.modified;
			}

			// Track audit log
			await this.auditHook(type, hookId, hookResult);
		}

		// Update final result with accumulated modifications
		if (result.allow && modifiedParams !== params) {
			result.modified = modifiedParams;
		}

		// Cache result
		await this.redis.stream.setex(cacheKey, this.cacheTimeout, JSON.stringify(result));

		// Track metrics
		await this.trackMetrics(type, result.allow);

		return result;
	}

	// Execute a single hook (simplified)
	private async executeHook(handler: string, params: any): Promise<HookResult> {
		// In a real implementation, this would dynamically call the handler
		// For now, return a simple validation result
		if (handler === "dangerous_command_validator") {
			const dangerous = ["rm -rf", "drop database"];
			const paramStr = JSON.stringify(params).toLowerCase();
			for (const pattern of dangerous) {
				if (paramStr.includes(pattern)) {
					return {
						allow: false,
						reason: `Dangerous pattern detected: ${pattern}`,
					};
				}
			}
		}

		return { allow: true };
	}

	// Audit hook execution
	private async auditHook(type: string, hookId: string, result: HookResult): Promise<void> {
		const auditKey = redisKey("audit", "hooks", type);
		const entry = {
			hookId,
			timestamp: Date.now(),
			allowed: result.allow,
			reason: result.reason,
		};
		await this.redis.stream.lpush(auditKey, JSON.stringify(entry));
		await this.redis.stream.ltrim(auditKey, 0, 999); // Keep last 1000
		await this.redis.stream.expire(auditKey, 86400); // 24 hours
	}

	// Track metrics
	private async trackMetrics(type: string, allowed: boolean): Promise<void> {
		const metricsKey = redisKey("metrics", "hooks", type);
		await this.redis.stream.hincrby(metricsKey, "total", 1);
		await this.redis.stream.hincrby(metricsKey, allowed ? "allowed" : "blocked", 1);
		await this.redis.stream.expire(metricsKey, 3600);
	}

	// Hash params for caching
	private hashParams(params: any): string {
		const str = JSON.stringify(params);
		return crypto.createHash("md5").update(str).digest("hex").substring(0, 8);
	}

	// Get hook chain for a type
	async getHookChain(type: string): Promise<HookConfig[]> {
		const setKey = redisKey("hooks", type, "sorted");
		const hookIds = await this.redis.stream.zrange(setKey, 0, -1);
		
		const hooks: HookConfig[] = [];
		for (const hookId of hookIds) {
			const hookKey = redisKey("hooks", type, hookId);
			const data = await this.redis.stream.hgetall(hookKey);
			if (data.id) {
				hooks.push({
					id: data.id,
					type: data.type as HookConfig["type"],
					priority: parseInt(data.priority || "100"),
					handler: data.handler,
					enabled: data.enabled === "true",
				});
			}
		}
		
		return hooks;
	}

	// Clear hook cache
	async clearCache(type?: string): Promise<void> {
		const pattern = type 
			? redisKey("hook", "cache", type, "*")
			: redisKey("hook", "cache", "*");
		const keys = await this.redis.stream.keys(pattern);
		for (const key of keys) {
			await this.redis.stream.del(key);
		}
	}
}

export const hookManager = new HookManager();