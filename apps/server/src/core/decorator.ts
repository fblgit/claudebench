import "reflect-metadata";
import type { z } from "zod";

export interface EventHandlerConfig {
	event: string;
	inputSchema: z.ZodSchema<any>;
	outputSchema: z.ZodSchema<any>;
	persist?: boolean;
	roles?: string[];
	rateLimit?: number;
	description?: string;
}

export interface HandlerMetadata extends EventHandlerConfig {
	className: string;
	handler: Function;
}

const HANDLER_METADATA_KEY = Symbol("eventHandler");
const HANDLER_METADATA_KEY_STRING = "eventHandler"; // Also store with string key for method decorators

export function EventHandler(config: EventHandlerConfig) {
	return function <T extends { new(...args: any[]): {} }>(constructor: T) {
		const metadata: HandlerMetadata = {
			...config,
			className: constructor.name,
			handler: constructor,
		};

		// Store metadata on the class with both Symbol and string keys
		Reflect.defineMetadata(HANDLER_METADATA_KEY, metadata, constructor);
		Reflect.defineMetadata(HANDLER_METADATA_KEY_STRING, metadata, constructor); // For method decorators

		// Store in global registry for discovery
		const handlers = global.__handlers || [];
		handlers.push(metadata);
		global.__handlers = handlers;

		return constructor;
	};
}

export function getHandlerMetadata(target: any): HandlerMetadata | undefined {
	return Reflect.getMetadata(HANDLER_METADATA_KEY, target);
}

export function getAllHandlers(): HandlerMetadata[] {
	return global.__handlers || [];
}

// Helper to generate MCP tool definition from handler
export function toMcpTool(metadata: HandlerMetadata) {
	return {
		name: metadata.event.replace(".", "__"),
		description: metadata.description || `Handle ${metadata.event} event`,
		inputSchema: metadata.inputSchema,
	};
}

// Helper to generate HTTP route from handler
export function toHttpRoute(metadata: HandlerMetadata) {
	const [domain, action] = metadata.event.split(".");
	return {
		method: "POST" as const,
		path: `/${domain}/${action}`,
		event: metadata.event,
	};
}

// Declare global type
declare global {
	var __handlers: HandlerMetadata[] | undefined;
}

// ============================================================================
// METHOD DECORATORS FOR CROSS-CUTTING CONCERNS
// ============================================================================

import { cache } from "./cache";
import { audit } from "./audit";
import { metrics } from "./metrics";
import type { EventContext } from "./context";
import * as crypto from "crypto";

/**
 * Method decorator for caching handler results
 * Automatically detects event name from @EventHandler metadata
 */
export function Cached(ttl: number = 60) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		
		descriptor.value = async function (input: any, ctx: EventContext, ...rest: any[]) {
			// Get event name from class metadata
			const eventMetadata = Reflect.getMetadata("eventHandler", target.constructor);
			const eventName = eventMetadata?.event || ctx?.eventType || `${target.constructor.name}.${propertyKey}`;
			
			// Generate cache key
			const inputHash = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex").substring(0, 16);
			const cacheKey = `${eventName}:${inputHash}`;
			
			// Check cache
			const cached = await cache.get("handler", cacheKey);
			if (cached !== null) {
				return cached;
			}
			
			// Execute and cache
			const result = await originalMethod.call(this, input, ctx, ...rest);
			await cache.set("handler", cacheKey, result, { ttl });
			
			return result;
		};
		
		return descriptor;
	};
}

/**
 * Method decorator for measuring execution time
 */
export function Measured() {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		
		descriptor.value = async function (input: any, ctx: EventContext, ...rest: any[]) {
			const eventMetadata = Reflect.getMetadata("eventHandler", target.constructor);
			const eventName = eventMetadata?.event || ctx?.eventType || `${target.constructor.name}.${propertyKey}`;
			
			const startTime = Date.now();
			
			try {
				const result = await originalMethod.call(this, input, ctx, ...rest);
				await metrics.recordEvent(eventName, Date.now() - startTime);
				return result;
			} catch (error) {
				await metrics.recordEvent(eventName, Date.now() - startTime);
				throw error;
			}
		};
		
		return descriptor;
	};
}

/**
 * Method decorator for audit logging
 */
export function Audited(action?: string) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		
		descriptor.value = async function (input: any, ctx: EventContext, ...rest: any[]) {
			const eventMetadata = Reflect.getMetadata("eventHandler", target.constructor);
			const eventName = eventMetadata?.event || ctx?.eventType || `${target.constructor.name}.${propertyKey}`;
			const auditAction = action || eventName;
			
			try {
				const result = await originalMethod.call(this, input, ctx, ...rest);
				
				await audit.log({
					action: auditAction,
					actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
					resource: eventName,
					result: "success",
					timestamp: new Date().toISOString(),
				});
				
				// Special handling for hooks
				if (eventName.startsWith("hook.")) {
					await audit.logHookDecision({
						tool: eventName.replace("hook.", ""),
						decision: result.allow ? "allowed" : "blocked",
						reason: result.reason,
						params: input,
					});
				}
				
				return result;
			} catch (error: any) {
				await audit.log({
					action: auditAction,
					actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
					resource: eventName,
					result: "failure",
					reason: error.message,
					timestamp: new Date().toISOString(),
				});
				throw error;
			}
		};
		
		return descriptor;
	};
}

/**
 * Composite decorator that applies all instrumentation
 * Order: Audited -> Measured -> Cached (bottom to top)
 */
export function Instrumented(ttl: number = 60) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		// Apply in reverse order (decorators compose bottom-up)
		Audited()(target, propertyKey, descriptor);
		Measured()(target, propertyKey, descriptor);
		Cached(ttl)(target, propertyKey, descriptor);
		
		return descriptor;
	};
}

// ============================================================================
// RESILIENCE DECORATORS
// ============================================================================

import { getRedis } from "./redis";

export interface RateLimitOptions {
	limit: number;           // Max requests per window
	windowMs?: number;       // Time window in ms (default: 60000 = 1 minute)
	keyPrefix?: string;      // Custom key prefix
	skipSuccessfulRequests?: boolean; // Only count failed requests
	skipFailedRequests?: boolean;     // Only count successful requests
}

/**
 * Rate limiting decorator using Redis sliding window
 * Prevents handler overload by limiting requests per time window
 */
export function RateLimited(options: RateLimitOptions) {
	const { limit, windowMs = 60000, keyPrefix, skipSuccessfulRequests = false, skipFailedRequests = false } = options;
	
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		
		descriptor.value = async function (input: any, ctx: EventContext, ...rest: any[]) {
			const redis = getRedis();
			const eventMetadata = Reflect.getMetadata("eventHandler", target.constructor);
			const eventName = eventMetadata?.event || ctx?.eventType || `${target.constructor.name}.${propertyKey}`;
			
			// Generate rate limit key
			const actor = ctx?.metadata?.clientId || ctx?.instanceId || "global";
			const rateLimitKey = keyPrefix 
				? `cb:ratelimit:${keyPrefix}:${actor}`
				: `cb:ratelimit:${eventName}:${actor}`;
			
			// Check current window count
			const now = Date.now();
			const windowStart = now - windowMs;
			
			// Remove old entries and count current window
			await redis.zremrangebyscore(rateLimitKey, "-inf", windowStart.toString());
			const currentCount = await redis.zcard(rateLimitKey);
			
			if (currentCount >= limit) {
				// Log rate limit hit
				await audit.log({
					action: `ratelimit.exceeded`,
					actor,
					resource: eventName,
					result: "blocked",
					reason: `Rate limit exceeded: ${currentCount}/${limit} in ${windowMs}ms`,
					timestamp: new Date().toISOString(),
				});
				
				// Track metrics
				await metrics.increment(`ratelimit:${eventName}:blocked`);
				
				const error = new Error(`Rate limit exceeded: ${limit} requests per ${windowMs}ms`);
				(error as any).code = "RATE_LIMIT_EXCEEDED";
				throw error;
			}
			
			try {
				const result = await originalMethod.call(this, input, ctx, ...rest);
				
				// Add to sliding window if not skipping successful
				if (!skipSuccessfulRequests) {
					await redis.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
					await redis.expire(rateLimitKey, Math.ceil(windowMs / 1000));
				}
				
				// Track metrics
				await metrics.increment(`ratelimit:${eventName}:allowed`);
				
				return result;
			} catch (error) {
				// Add to sliding window if not skipping failed
				if (!skipFailedRequests) {
					await redis.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
					await redis.expire(rateLimitKey, Math.ceil(windowMs / 1000));
				}
				throw error;
			}
		};
		
		return descriptor;
	};
}

export interface TimeoutOptions {
	ms: number;              // Timeout in milliseconds
	errorMessage?: string;   // Custom error message
	fallback?: () => any;   // Fallback function on timeout
}

/**
 * Timeout decorator that enforces execution time limits
 * Prevents handlers from running indefinitely
 */
export function Timeout(options: TimeoutOptions | number) {
	const config = typeof options === "number" ? { ms: options } : options;
	
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		
		descriptor.value = async function (input: any, ctx: EventContext, ...rest: any[]) {
			const redis = getRedis();
			const eventMetadata = Reflect.getMetadata("eventHandler", target.constructor);
			const eventName = eventMetadata?.event || ctx?.eventType || `${target.constructor.name}.${propertyKey}`;
			
			// Create timeout promise
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => {
					const error = new Error(config.errorMessage || `Operation timed out after ${config.ms}ms`);
					(error as any).code = "TIMEOUT";
					reject(error);
				}, config.ms);
			});
			
			try {
				// Race between operation and timeout
				const result = await Promise.race([
					originalMethod.call(this, input, ctx, ...rest),
					timeoutPromise
				]);
				
				// Track successful completion
				await metrics.increment(`timeout:${eventName}:completed`);
				
				return result;
			} catch (error: any) {
				if (error.code === "TIMEOUT") {
					// Log timeout
					await audit.log({
						action: `timeout.exceeded`,
						actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
						resource: eventName,
						result: "timeout",
						reason: `Execution exceeded ${config.ms}ms`,
						timestamp: new Date().toISOString(),
					});
					
					// Track timeout metrics
					await metrics.increment(`timeout:${eventName}:exceeded`);
					await redis.set(`cb:hooks:timeout:${eventName}`, "true", "EX", 300);
					
					// Use fallback if provided
					if (config.fallback) {
						const fallbackResult = await config.fallback();
						// Still mark tool as executed (with warning)
						await redis.set(`cb:tool:executed:after-timeout`, "true", "EX", 300);
						return fallbackResult;
					}
				}
				throw error;
			}
		};
		
		return descriptor;
	};
}

export interface CircuitBreakerOptions {
	threshold: number;       // Error threshold to open circuit
	timeout: number;         // Time in ms before trying half-open
	resetTimeout?: number;   // Time to fully reset after success
	errorFilter?: (error: any) => boolean; // Which errors to count
	fallback?: () => any;   // Fallback when circuit is open
	halfOpenLimit?: number;  // Max requests in half-open state (default: 3)
	backoffMultiplier?: number; // Exponential backoff multiplier (default: 1.5)
}

type CircuitState = "closed" | "open" | "half-open";

/**
 * Circuit breaker decorator with advanced features from the class implementation
 * Includes backoff multiplier, half-open limits, alerts, and recovery tracking
 */
export function CircuitBreaker(options: CircuitBreakerOptions) {
	const halfOpenLimit = options.halfOpenLimit || 3;
	const backoffMultiplier = options.backoffMultiplier || 1.5;
	
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value;
		
		descriptor.value = async function (input: any, ctx: EventContext, ...rest: any[]) {
			const redis = getRedis();
			const eventMetadata = Reflect.getMetadata("eventHandler", target.constructor);
			const eventName = eventMetadata?.event || ctx?.eventType || `${target.constructor.name}.${propertyKey}`;
			
			// Redis keys
			const stateKey = `cb:circuit:${eventName}:state`;
			const errorCountKey = `cb:circuit:${eventName}:failures`;
			const successCountKey = `cb:circuit:${eventName}:successes`;
			const lastFailureKey = `cb:circuit:${eventName}:lastFailure`;
			const openedAtKey = `cb:circuit:${eventName}:openedAt`;
			const allowedKey = `cb:circuit:${eventName}:allowed`;
			const backoffAttemptKey = `cb:circuit:backoff:attempt`;
			const rejectedKey = `cb:circuit:${eventName}:rejected`;
			
			// Get current state
			const state = (await redis.get(stateKey) || "closed") as CircuitState;
			const errorCount = parseInt(await redis.get(errorCountKey) || "0");
			const lastFailure = parseInt(await redis.get(lastFailureKey) || "0");
			
			// Check if circuit is open
			if (state === "open") {
				const timeSinceFailure = Date.now() - lastFailure;
				
				if (timeSinceFailure < options.timeout) {
					// Still in timeout period - track rejection
					await redis.incr(rejectedKey);
					await redis.expire(rejectedKey, 3600);
					
					await audit.log({
						action: `circuit.open`,
						actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
						resource: eventName,
						result: "blocked",
						reason: `Circuit open: ${errorCount} errors exceeded threshold ${options.threshold}`,
						timestamp: new Date().toISOString(),
					});
					
					await metrics.increment(`circuit:${eventName}:rejected`);
					
					// Store fallback response in Redis
					const fallbackResponseKey = `cb:circuit:fallback:response`;
					await redis.set(
						fallbackResponseKey, 
						`Service temporarily unavailable for ${eventName}`,
						"PX", 
						options.timeout
					);
					
					if (options.fallback) {
						return await options.fallback();
					}
					
					const error = new Error(`Circuit breaker open for ${eventName}`);
					(error as any).code = "CIRCUIT_OPEN";
					(error as any).data = { fallback: true };
					throw error;
				} else {
					// Transition to half-open
					await redis.set(stateKey, "half-open", "EX", 3600);
					await redis.set(allowedKey, "0"); // Reset allowed counter
					await audit.log({
						action: `circuit.half-open`,
						actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
						resource: eventName,
						result: "attempting",
						timestamp: new Date().toISOString(),
					});
				}
			}
			
			// Check half-open state limits
			if (state === "half-open") {
				const allowed = await redis.incr(allowedKey);
				
				if (allowed > halfOpenLimit) {
					// Too many requests in half-open state
					await redis.incr(rejectedKey);
					await redis.expire(rejectedKey, 3600);
					
					const error = new Error(`Circuit breaker half-open limit exceeded for ${eventName}`);
					(error as any).code = "CIRCUIT_HALF_OPEN_LIMIT";
					throw error;
				}
				
				await redis.expire(allowedKey, 60); // Reset after 1 minute
			}
			
			try {
				const result = await originalMethod.call(this, input, ctx, ...rest);
				
				// Track success
				await redis.incr(successCountKey);
				
				// Success - check state transitions
				if (state === "half-open") {
					const successes = parseInt(await redis.get(successCountKey) || "0");
					if (successes >= 3) {
						// Close circuit after successful requests
						await redis.del(stateKey, errorCountKey, lastFailureKey, successCountKey, allowedKey);
						
						// Calculate recovery time if we have openedAt
						const openedAt = await redis.get(openedAtKey);
						if (openedAt) {
							const recoveryTime = Date.now() - parseInt(openedAt);
							const metricsKey = `cb:metrics:circuit:all`;
							await redis.hset(metricsKey, "lastRecoveryTime", recoveryTime.toString());
							
							// Update average recovery time
							const avgKey = await redis.hget(metricsKey, "avgRecoveryTime");
							const currentAvg = parseFloat(avgKey || "0");
							const newAvg = currentAvg ? (currentAvg + recoveryTime) / 2 : recoveryTime;
							await redis.hset(metricsKey, "avgRecoveryTime", newAvg.toString());
							await redis.expire(metricsKey, 3600);
						}
						await redis.del(openedAtKey);
						
						// Reset backoff
						await redis.del(backoffAttemptKey);
						
						await audit.log({
							action: `circuit.closed`,
							actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
							resource: eventName,
							result: "recovered",
							timestamp: new Date().toISOString(),
						});
						await metrics.increment(`circuit:${eventName}:closed`);
					}
				} else if (state === "closed" && errorCount > 0) {
					// Reset error count on success in closed state
					await redis.del(errorCountKey);
				}
				
				// Clear failures on success
				await redis.del(errorCountKey);
				
				// Update success metrics
				await metrics.increment(`circuit:${eventName}:success`);
				const metricsKey = `cb:metrics:circuit:all`;
				await redis.hincrby(metricsKey, "totalSuccesses", 1);
				
				// Calculate success rate
				const successes = await redis.hget(metricsKey, "totalSuccesses");
				const failures = await redis.hget(metricsKey, "totalFailures");
				const total = parseInt(successes || "0") + parseInt(failures || "0");
				if (total > 0) {
					const successRate = (parseInt(successes || "0") / total) * 100;
					await redis.hset(metricsKey, "successRate", successRate.toFixed(2));
				}
				
				return result;
				
			} catch (error: any) {
				// Check if we should count this error
				if (options.errorFilter && !options.errorFilter(error)) {
					throw error;
				}
				
				// Determine failure type
				const failureType = error.code === "TIMEOUT" ? "timeout" 
					: error.code === "RATE_LIMIT_EXCEEDED" ? "rejection"
					: "error";
				
				// Track failure type
				const failureTypeKey = `cb:circuit:failures:${failureType}`;
				await redis.incr(failureTypeKey);
				await redis.expire(failureTypeKey, 3600);
				
				// Track per-handler failure type
				const handlerFailureKey = `cb:circuit:${eventName}:failures:${failureType}`;
				await redis.incr(handlerFailureKey);
				await redis.expire(handlerFailureKey, 3600);
				
				// Increment error count
				const newErrorCount = await redis.incr(errorCountKey);
				await redis.expire(errorCountKey, options.resetTimeout ? options.resetTimeout / 1000 : 3600);
				await redis.set(lastFailureKey, Date.now().toString(), "EX", options.resetTimeout ? options.resetTimeout / 1000 : 3600);
				
				// Check if we should open the circuit
				if (newErrorCount >= options.threshold && state !== "open") {
					// Open circuit with backoff
					const attempt = await redis.incr(backoffAttemptKey);
					const backoffTimeout = options.timeout * Math.pow(backoffMultiplier, attempt - 1);
					
					await redis.set(stateKey, "open", "PX", backoffTimeout);
					await redis.set(openedAtKey, Date.now().toString(), "PX", backoffTimeout);
					
					// Create alert
					const alertKey = `cb:alerts:circuit:opened`;
					const alert = {
						handler: eventName,
						severity: "HIGH",
						message: `Circuit opened due to ${newErrorCount} failures`,
						timestamp: Date.now(),
					};
					await redis.lpush(alertKey, JSON.stringify(alert));
					await redis.ltrim(alertKey, 0, 99); // Keep last 100 alerts
					await redis.expire(alertKey, 86400); // 24 hours
					
					// Track total trips
					const metricsKey = `cb:metrics:circuit:all`;
					await redis.hincrby(metricsKey, "totalTrips", 1);
					
					await audit.log({
						action: `circuit.opened`,
						actor: ctx?.metadata?.clientId || ctx?.instanceId || "system",
						resource: eventName,
						result: "opened",
						reason: `Error threshold reached: ${newErrorCount}/${options.threshold}`,
						timestamp: new Date().toISOString(),
					});
					await metrics.increment(`circuit:${eventName}:opened`);
				}
				
				// Update failure metrics
				await metrics.increment(`circuit:${eventName}:failure`);
				const metricsKey = `cb:metrics:circuit:all`;
				await redis.hincrby(metricsKey, "totalFailures", 1);
				await redis.hincrby(metricsKey, `failures:${failureType}`, 1);
				
				throw error;
			}
		};
		
		return descriptor;
	};
}

/**
 * Composite resilience decorator that applies rate limiting, timeout, and circuit breaker
 * Order: CircuitBreaker -> RateLimit -> Timeout (bottom to top)
 */
export function Resilient(options: {
	rateLimit?: RateLimitOptions;
	timeout?: TimeoutOptions | number;
	circuitBreaker?: CircuitBreakerOptions;
}) {
	return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
		// Apply in reverse order (decorators compose bottom-up)
		if (options.circuitBreaker) {
			CircuitBreaker(options.circuitBreaker)(target, propertyKey, descriptor);
		}
		if (options.rateLimit) {
			RateLimited(options.rateLimit)(target, propertyKey, descriptor);
		}
		if (options.timeout) {
			Timeout(options.timeout)(target, propertyKey, descriptor);
		}
		
		return descriptor;
	};
}