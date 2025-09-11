# ClaudeBench Technical Research

## Table of Contents
1. [Redis Pub/Sub Patterns](#1-redis-pubsub-patterns-for-event-driven-typescriptbun-applications)
2. [MCP SDK Streamable HTTP Transport](#2-mcp-sdk-streamable-http-transport-implementation)
3. [Multi-Instance Worker Coordination](#3-multi-instance-worker-coordination-with-redis)
4. [Circuit Breaker Implementation](#4-circuit-breaker-pattern-for-event-handlers)
5. [Rate Limiting Strategy](#5-rate-limiting-strategy-for-event-processing)
6. [Hook Chain Execution](#6-hook-chain-execution-and-validation-patterns)
7. [Cross-Cutting Concerns via Decorators](#7-cross-cutting-concerns-via-decorators-new)

## 1. Redis Pub/Sub Patterns for Event-Driven TypeScript/Bun Applications

**Decision**: Use Redis Streams over traditional pub/sub for ClaudeBench event bus

**Rationale**: While Redis pub/sub offers sub-millisecond latency, Redis Streams provides crucial benefits for an event-driven architecture:
- Message persistence and replay capability
- Consumer groups for load balancing
- At-least-once delivery guarantees
- Built-in backpressure handling
- Only 1-2ms latency overhead vs pub/sub

**Alternatives Considered**:
- Traditional Redis pub/sub (fire-and-forget, no persistence)
- Kafka (too heavy for localhost-first approach)
- In-memory EventEmitter (no persistence, single process)

**Implementation Notes**:
```typescript
// Redis Streams for ClaudeBench event bus
import Redis from 'ioredis';

class EventBus {
  constructor(private redis: Redis) {}
  
  async publish(stream: string, event: Record<string, any>) {
    return this.redis.xadd(stream, '*', 'data', JSON.stringify(event));
  }
  
  async subscribe(stream: string, consumerGroup: string, consumer: string) {
    // Create consumer group if doesn't exist
    try {
      await this.redis.xgroup('CREATE', stream, consumerGroup, '0', 'MKSTREAM');
    } catch (e) {
      // Group already exists
    }
    
    while (true) {
      const messages = await this.redis.xreadgroup(
        'GROUP', consumerGroup, consumer,
        'COUNT', 10,
        'BLOCK', 1000,
        'STREAMS', stream, '>'
      );
      
      for (const [streamName, entries] of messages) {
        for (const [id, fields] of entries) {
          const data = JSON.parse(fields[1]);
          await this.handleEvent(data);
          await this.redis.xack(stream, consumerGroup, id);
        }
      }
    }
  }
}
```

## 2. MCP SDK Streamable HTTP Transport Implementation

**Decision**: Implement Streamable HTTP transport with both batch and streaming modes

**Rationale**: The new Streamable HTTP transport (2025-03-26 spec) replaces HTTP+SSE with a more robust single-endpoint architecture:
- Single HTTP endpoint for all communication
- Built-in session management
- Support for both batch responses and SSE streaming
- Better error handling and recovery

**Alternatives Considered**:
- Legacy HTTP+SSE transport (deprecated in 2025)
- stdio transport (not suitable for web deployment)
- WebSocket transport (not part of MCP spec)

**Implementation Notes**:
```typescript
// MCP Streamable HTTP Transport for ClaudeBench
import { Server } from '@modelcontextprotocol/sdk/server/index.js';

const server = new Server({
  name: 'claudebench-mcp',
  version: '1.0.0',
}, {
  capabilities: {
    tools: {},
    resources: {},
    prompts: {}
  }
});

// Configure HTTP Stream transport
const transport = new HttpStreamTransport({
  port: 3002,
  endpoint: '/mcp',
  responseMode: 'batch', // or 'stream' for SSE
  cors: {
    allowOrigin: 'http://localhost:3001'
  },
  sessionTimeout: 300000 // 5 minutes
});

await server.connect(transport);
```

## 3. TypeScript Decorator Metadata Reflection for Auto-Generation

**Decision**: Use legacy experimental decorators with reflect-metadata for ClaudeBench decorator pattern

**Rationale**: While TC39 decorators are Stage 3, they don't support automatic metadata emission. The ClaudeBench architecture needs runtime type information for auto-generating HTTP, MCP, and event interfaces:
- reflect-metadata still actively maintained for legacy decorators
- Auto-generated type metadata (design:type, design:paramtypes, design:returntype)
- Required for the decorator pattern that generates multiple transport interfaces

**Alternatives Considered**:
- TC39 decorators (no metadata support yet)
- Manual type annotations (defeats auto-generation purpose)
- Code generation tools (adds build complexity)

**Implementation Notes**:
```typescript
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}

// ClaudeBench handler decorator
import 'reflect-metadata';

export function Handler(config: HandlerConfig) {
  return function <T extends { new(...args: any[]): {} }>(constructor: T) {
    const paramTypes = Reflect.getMetadata('design:paramtypes', constructor);
    const returnType = Reflect.getMetadata('design:returntype', constructor);
    
    // Auto-generate HTTP route
    generateHttpRoute(constructor, config, paramTypes, returnType);
    
    // Auto-generate MCP tool
    generateMcpTool(constructor, config, paramTypes, returnType);
    
    // Auto-generate event listener
    generateEventListener(constructor, config, paramTypes, returnType);
    
    return constructor;
  };
}

// Usage
@Handler({ 
  route: '/tasks',
  event: 'task.create',
  tool: 'create_task'
})
class CreateTaskHandler {
  async execute(data: CreateTaskInput): Promise<CreateTaskOutput> {
    // Implementation
  }
}
```

## 4. Zod Schema to OpenAPI Generation

**Decision**: Use @asteasolutions/zod-to-openapi with .openapi() extension method

**Rationale**: This library provides the most mature and feature-complete solution for ClaudeBench's needs:
- Native .openapi() method integration
- Full TypeScript support
- Override capabilities for custom schemas
- Active maintenance and 2025 updates

**Alternatives Considered**:
- zod-openapi by samchungy (uses .meta() but less features)
- @anatine/zod-openapi (basic conversion only)
- Manual OpenAPI definitions (defeats single source of truth)

**Implementation Notes**:
```typescript
import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';

// Extend Zod with OpenAPI functionality
extendZodWithOpenApi(z);

// ClaudeBench event schemas
const TaskCreateEventSchema = z.object({
  title: z.string().openapi({ description: 'Task title' }),
  description: z.string().optional().openapi({ description: 'Task description' }),
  priority: z.enum(['low', 'medium', 'high']).openapi({ description: 'Task priority' })
}).openapi('TaskCreateEvent');

// Generate OpenAPI spec
const generator = new OpenApiGeneratorV3([TaskCreateEventSchema]);
const openApiSpec = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'ClaudeBench API',
    version: '1.0.0'
  }
});
```

## 5. Redis Streams vs Pub/Sub for Localhost Event Bus

**Decision**: Use Redis Streams for ClaudeBench event bus

**Rationale**: For ClaudeBench's localhost-first architecture, Redis Streams provides significant advantages:
- **Message Persistence**: Events survive service restarts
- **Replay Capability**: Critical for debugging and development
- **Consumer Groups**: Enables load balancing when scaling
- **At-least-once Delivery**: Prevents message loss
- **Minimal Latency Cost**: 1-2ms vs sub-millisecond (negligible for localhost)

**Alternatives Considered**:
- Redis pub/sub: Fire-and-forget, no persistence, ultra-low latency
- In-memory events: No persistence, single process limitation
- File-based events: Too slow, no real-time capability

**Implementation Notes**:
```typescript
// ClaudeBench event patterns
const EVENT_STREAMS = {
  TASKS: 'cb:events:tasks',
  HOOKS: 'cb:events:hooks',
  SYSTEM: 'cb:events:system'
} as const;

class ClaudeBenchEventBus {
  async publishEvent(domain: string, action: string, payload: any) {
    const stream = `cb:events:${domain}`;
    const event = {
      type: `${domain}.${action}`,
      payload: JSON.stringify(payload),
      timestamp: Date.now()
    };
    
    return this.redis.xadd(stream, '*', ...Object.entries(event).flat());
  }
  
  async subscribeToEvents(domain: string, handler: EventHandler) {
    const stream = `cb:events:${domain}`;
    const consumerGroup = `cb:consumers:${domain}`;
    const consumer = `consumer-${process.pid}`;
    
    // Consumer group ensures no message duplication
    await this.createConsumerGroup(stream, consumerGroup);
    
    while (true) {
      const messages = await this.redis.xreadgroup(
        'GROUP', consumerGroup, consumer,
        'COUNT', 10, 'BLOCK', 1000,
        'STREAMS', stream, '>'
      );
      
      for (const message of messages) {
        await handler(message);
        await this.redis.xack(stream, consumerGroup, message.id);
      }
    }
  }
}
```

## 6. Simple Circuit Breaker Implementation with Redis INCR

**Decision**: Implement distributed circuit breaker using Redis INCR with time-based windows

**Rationale**: Redis INCR provides atomic operations essential for circuit breaker state management:
- Atomic increment prevents race conditions
- TTL-based failure windows
- Distributed state sharing across processes
- Simple implementation suitable for localhost-first approach

**Alternatives Considered**:
- In-memory circuit breakers (not distributed)
- Complex Redis scripts (overkill for localhost)
- External circuit breaker services (too heavy)

**Implementation Notes**:
```typescript
// ClaudeBench Redis Circuit Breaker
class RedisCircuitBreaker {
  constructor(
    private redis: Redis,
    private options: {
      failureThreshold: number;
      recoveryTimeout: number;
      windowSize: number;
    }
  ) {}
  
  async execute<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const state = await this.getState(key);
    
    if (state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN');
    }
    
    try {
      const result = await fn();
      await this.recordSuccess(key);
      return result;
    } catch (error) {
      await this.recordFailure(key);
      throw error;
    }
  }
  
  private async recordFailure(key: string): Promise<void> {
    const failureKey = `cb:circuit:${key}:failures`;
    const failures = await this.redis.incr(failureKey);
    
    if (failures === 1) {
      await this.redis.expire(failureKey, this.options.windowSize);
    }
    
    if (failures >= this.options.failureThreshold) {
      await this.openCircuit(key);
    }
  }
  
  private async openCircuit(key: string): Promise<void> {
    const stateKey = `cb:circuit:${key}:state`;
    await this.redis.setex(stateKey, this.options.recoveryTimeout, 'OPEN');
  }
  
  private async getState(key: string): Promise<'OPEN' | 'CLOSED'> {
    const stateKey = `cb:circuit:${key}:state`;
    const state = await this.redis.get(stateKey);
    return state === 'OPEN' ? 'OPEN' : 'CLOSED';
  }
}

// Usage in ClaudeBench handlers
const circuitBreaker = new RedisCircuitBreaker(redis, {
  failureThreshold: 5,
  recoveryTimeout: 30,
  windowSize: 60
});

@Handler({ route: '/external-api' })
class ExternalApiHandler {
  async execute() {
    return circuitBreaker.execute('external-api', async () => {
      return fetch('https://external-api.com/data');
    });
  }
}
```

## 7. Redis Rate Limiting Patterns for Single-User Localhost

**Decision**: Use sliding window rate limiter with Redis sorted sets

**Rationale**: For ClaudeBench's single-user localhost environment, sliding window provides:
- Smooth traffic distribution vs fixed windows
- Precise rate limiting without burst allowances
- Atomic operations via Redis
- Suitable for development/testing scenarios

**Alternatives Considered**:
- Fixed window rate limiting (allows burst traffic)
- Token bucket algorithm (requires multiple Redis keys)
- In-memory rate limiting (not persistent across restarts)

**Implementation Notes**:
```typescript
// ClaudeBench Redis Rate Limiter
class RedisSlidingWindowLimiter {
  constructor(
    private redis: Redis,
    private options: {
      windowSizeMs: number;
      maxRequests: number;
    }
  ) {}
  
  async checkRateLimit(key: string): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const windowStart = now - this.options.windowSizeMs;
    const rateLimitKey = `cb:ratelimit:${key}`;
    
    // Use Redis transaction for atomicity
    const multi = this.redis.multi();
    
    // Remove old entries outside the window
    multi.zremrangebyscore(rateLimitKey, 0, windowStart);
    
    // Count current requests in window
    multi.zcard(rateLimitKey);
    
    // Add current request
    multi.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
    
    // Set expiration
    multi.expire(rateLimitKey, Math.ceil(this.options.windowSizeMs / 1000));
    
    const results = await multi.exec();
    const currentCount = results[1][1] as number;
    
    const allowed = currentCount < this.options.maxRequests;
    const remaining = Math.max(0, this.options.maxRequests - currentCount - 1);
    
    if (!allowed) {
      // Remove the request we just added since it's not allowed
      await this.redis.zrem(rateLimitKey, `${now}-${Math.random()}`);
    }
    
    return { allowed, remaining };
  }
}

// Usage in ClaudeBench middleware
const rateLimiter = new RedisSlidingWindowLimiter(redis, {
  windowSizeMs: 60 * 1000, // 1 minute
  maxRequests: 100 // 100 requests per minute
});

// Hono middleware for rate limiting
app.use('*', async (c, next) => {
  const clientId = 'localhost'; // Single user for localhost
  const { allowed, remaining } = await rateLimiter.checkRateLimit(clientId);
  
  if (!allowed) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }
  
  c.header('X-RateLimit-Remaining', remaining.toString());
  await next();
});
```

## 7. Cross-Cutting Concerns via Decorators

**Decision**: Implement custom method decorators for caching, metrics, and audit logging using Redis-backed utilities

**Rationale**: ClaudeBench needs cross-cutting concerns applied to all handler methods without violating DRY principles or exceeding the 500 LOC target. Method decorators provide:
- Zero boilerplate in handler methods
- Automatic application of caching, metrics, and audit logging
- Leverage existing Redis-based utilities (cache.ts, audit.ts, metrics.ts)
- Maintain the existing @EventHandler pattern for class-level decoration
- Minimal code footprint (~50 LOC for all decorators)

**Alternatives Considered**:
- External libraries like `type-cacheable` (adds dependencies, 15KB+ bundle size)
- NestJS-style decorators (requires complex DI system, too heavy for 500 LOC target)
- Manual instrumentation (violates DRY, 100+ LOC per handler)
- Aspect-Oriented Programming libraries (overkill, adds complexity)

**Implementation Notes**:
```typescript
// Method decorators for cross-cutting concerns (decorators.ts - ~50 LOC)
import 'reflect-metadata';
import { cache } from './cache';
import { audit } from './audit';
import { metrics } from './metrics';

// Cache decorator using existing CacheManager
export function Cached(namespace?: string, ttl?: number) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const cacheKey = `${propertyKey}-${JSON.stringify(args)}`;
      const ns = namespace || target.constructor.name.toLowerCase();
      
      // Try cache first
      const cached = await cache.get(ns, cacheKey);
      if (cached !== null) return cached;
      
      // Execute original method
      const result = await originalMethod.apply(this, args);
      
      // Cache result
      await cache.set(ns, cacheKey, result, { ttl });
      
      return result;
    };
  };
}

// Metrics decorator using existing MetricsCollector
export function Measured(eventType?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const startTime = Date.now();
      const event = eventType || `${target.constructor.name}.${propertyKey}`;
      
      try {
        const result = await originalMethod.apply(this, args);
        const duration = Date.now() - startTime;
        
        // Record successful execution
        await metrics.recordEvent(event, duration);
        
        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        
        // Record failed execution
        await metrics.recordEvent(`${event}.error`, duration);
        
        throw error;
      }
    };
  };
}

// Audit decorator using existing AuditLogger
export function Audited(action?: string, resource?: string) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const auditAction = action || `${target.constructor.name}.${propertyKey}`;
      const startTime = Date.now();
      
      try {
        const result = await originalMethod.apply(this, args);
        
        // Log successful execution
        await audit.log({
          action: auditAction,
          resource: resource || 'handler',
          result: 'success',
          metadata: { args, duration: Date.now() - startTime },
          timestamp: new Date().toISOString()
        });
        
        return result;
      } catch (error) {
        // Log failed execution
        await audit.log({
          action: auditAction,
          resource: resource || 'handler',
          result: 'failure',
          reason: error.message,
          metadata: { args, duration: Date.now() - startTime },
          timestamp: new Date().toISOString()
        });
        
        throw error;
      }
    };
  };
}

// Composite decorator combining all concerns
export function Instrumented(options?: {
  cache?: { namespace?: string; ttl?: number };
  metrics?: { eventType?: string };
  audit?: { action?: string; resource?: string };
}) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    // Apply decorators in order: cache -> metrics -> audit
    if (options?.cache) {
      Cached(options.cache.namespace, options.cache.ttl)(target, propertyKey, descriptor);
    }
    if (options?.metrics) {
      Measured(options.metrics.eventType)(target, propertyKey, descriptor);
    }
    if (options?.audit) {
      Audited(options.audit.action, options.audit.resource)(target, propertyKey, descriptor);
    }
  };
}
```

**Usage in ClaudeBench handlers**:
```typescript
// Individual decorators for fine-grained control
@EventHandler({
  event: "task.create",
  inputSchema: taskCreateInput,
  outputSchema: taskCreateOutput,
  persist: true
})
export class TaskCreateHandler {
  @Cached("tasks", 300) // Cache for 5 minutes
  @Measured("task.create")
  @Audited("task.create", "task")
  async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
    // Original handler logic - no instrumentation code needed
    const taskId = `t-${Date.now()}`;
    // ... rest of implementation
    return result;
  }
}

// Or use composite decorator for common patterns
export class HookPreToolHandler {
  @Instrumented({
    cache: { namespace: "hooks", ttl: 60 },
    metrics: { eventType: "hook.pre_tool" },
    audit: { action: "hook.pre_tool", resource: "validation" }
  })
  async handle(input: HookPreToolInput, ctx: EventContext): Promise<HookPreToolOutput> {
    // Clean handler logic with zero instrumentation boilerplate
    // ... validation logic
    return { allow: true };
  }
}
```

**Benefits and Trade-offs**:

*Benefits*:
- **Zero boilerplate**: Handlers focus purely on business logic
- **Consistent instrumentation**: All handlers get same cross-cutting concerns automatically
- **Redis-native**: Leverages existing utilities without external dependencies
- **Minimal footprint**: ~50 LOC total for all decorators
- **Composable**: Mix and match concerns as needed per handler
- **Type-safe**: Full TypeScript support with proper method signatures
- **Performance optimized**: Direct Redis operations, no abstraction overhead

*Trade-offs*:
- **Decorator order dependency**: Cache must be applied before metrics/audit
- **Method-level only**: Cannot instrument individual code blocks within methods
- **Reflection overhead**: Minimal but present decorator invocation cost
- **Debug complexity**: Stack traces show decorator wrappers
- **Legacy decorators required**: Must use experimental decorators for metadata

**Integration with existing architecture**:
- Works seamlessly with existing @EventHandler class decorator
- Uses established Redis patterns from cache.ts, audit.ts, metrics.ts
- Maintains 500 LOC target by reusing existing infrastructure
- No new dependencies or external packages required
- Compatible with ClaudeBench's Redis-first design philosophy

## Summary

These research findings support ClaudeBench's Redis-first, localhost-focused architecture:

1. **Redis Streams** for reliable event-driven communication
2. **Streamable HTTP** for modern MCP transport
3. **Legacy decorators** for runtime metadata and auto-generation
4. **zod-to-openapi** for single source of truth schemas
5. **Circuit breakers** and **rate limiting** using Redis primitives
6. **Method decorators** for zero-boilerplate cross-cutting concerns

All patterns prioritize simplicity, localhost optimization, and the 500 LOC target while maintaining enterprise-grade reliability patterns.