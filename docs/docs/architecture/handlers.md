---
sidebar_position: 3
---

# Handler Pattern and Decorator System

ClaudeBench's handler architecture is built around a powerful decorator pattern that automatically generates HTTP, MCP, and event interfaces from a single handler definition. This approach eliminates code duplication and ensures consistency across all transport mechanisms.

## Core Philosophy

### Single Source of Truth

One handler definition automatically provides:
- **HTTP endpoint**: `POST /domain/action`
- **MCP tool**: `domain__action` 
- **Event subscription**: `domain.action`
- **Input/output validation**: Zod schema enforcement
- **Cross-cutting concerns**: Caching, rate limiting, circuit breaking

### Decorator-Driven Architecture

```typescript
@EventHandler({
  event: 'task.create',
  inputSchema: TaskCreateInput,
  outputSchema: TaskCreateOutput,
  persist: true,
  roles: ['worker']
})
@Resilient({
  rateLimit: { limit: 100, windowMs: 60000 },
  timeout: 5000,
  circuitBreaker: { threshold: 10, timeout: 30000 }
})
export class TaskCreateHandler {
  async handle(input: TaskCreateInput, context: EventContext): Promise<TaskCreateOutput> {
    // Single implementation serves all transports
    const task = { id: `t-${Date.now()}`, ...input };
    await context.redis.hset(`cb:task:${task.id}`, task);
    
    if (this.persist) {
      await context.prisma.task.create({ data: task });
    }
    
    return task;
  }
}
```

## Handler Classification by Pattern

### Pattern A: Centralized Handlers (59% of system)

**Characteristics:**
- Single component manages domain state
- Synchronous processing with strong consistency
- Direct Redis operations and optional PostgreSQL persistence

**Examples:**

#### Task Handlers (100% Pattern A)
```typescript
// Task lifecycle operations require strong consistency
@EventHandler({ event: 'task.create', persist: true })
export class TaskCreateHandler {
  async handle(input: TaskCreateInput, ctx: EventContext) {
    // Centralized task creation with atomic operations
    const task = await this.createTask(input);
    await this.enqueueTask(task);
    return task;
  }
}

@EventHandler({ event: 'task.assign', persist: true })  
export class TaskAssignHandler {
  async handle(input: TaskAssignInput, ctx: EventContext) {
    // Centralized assignment with load balancing
    const assignment = await this.redis.evalsha(
      'ASSIGN_TASK_WITH_LOAD_BALANCING',
      keys, args
    );
    return assignment;
  }
}
```

#### System Management Handlers (71% Pattern A)
```typescript
@EventHandler({ event: 'system.health' })
export class SystemHealthHandler {
  async handle(input: {}, ctx: EventContext) {
    // Centralized health aggregation
    return {
      status: 'healthy',
      services: await this.checkAllServices(),
      instances: await this.getActiveInstances()
    };
  }
}
```

### Pattern B: Distributed Handlers (15% of system)

**Characteristics:**
- Multiple autonomous instances
- Coordination through Redis state
- Eventual consistency model

**Examples:**

#### Decorator System (Distributed Cross-Cutting Concerns)
```typescript
@RateLimited({
  limit: 100,
  windowMs: 60000,
  keyGenerator: (ctx) => `${ctx.event}:${ctx.instanceId}`
})
@CircuitBreaker({
  threshold: 10,
  timeout: 30000,
  stateKey: (event) => `cb:circuit:${event}:state`
})
export class DistributedResilienceDecorator {
  // State coordinated across instances via Redis
  // Autonomous operation with shared coordination
}
```

### Pattern C: Hybrid Handlers (26% of system)

**Characteristics:**
- Central coordination with distributed execution
- Mixed sync/async operations
- Orchestrated workflow management

**Examples:**

#### TodoWrite Handler (Complex Orchestration)
```typescript
@EventHandler({ event: 'hook.todo_write' })
export class TodoWriteHookHandler {
  async handle(input: TodoWriteInput, ctx: EventContext) {
    // Central coordination
    const changes = this.todoManager.detectChanges(input.todos);
    
    // Distributed task creation
    for (const todo of changes.added) {
      await this.registry.executeHandler("task.create", {
        title: todo.content,
        metadata: { todoId: todo.id }
      });
    }
    
    // Hybrid state management
    await this.todoManager.setState(input.todos, ctx.instanceId);
    return { processed: changes };
  }
}
```

#### Batch Processing (Distributed Coordination)
```typescript
@EventHandler({ event: 'system.batch.process' })
export class SystemBatchProcessHandler {
  async handle(input: BatchInput, ctx: EventContext) {
    // Acquire distributed lock
    const [acquired, processor] = await ctx.redis.evalsha(
      'COORDINATE_BATCH',
      3,
      'cb:batch:lock',
      'cb:batch:progress', 
      'cb:batch:current',
      input.batchId, ctx.instanceId
    );
    
    if (!acquired) {
      return { processing: false, currentProcessor: processor };
    }
    
    // Process batch with progress updates
    return await this.processBatch(input, ctx);
  }
}
```

## Decorator System Architecture

### Core Decorators

#### 1. @EventHandler - Primary Decorator

```typescript
interface EventHandlerConfig {
  event: string;           // domain.action format
  inputSchema: ZodSchema;  // Input validation
  outputSchema: ZodSchema; // Output validation  
  persist?: boolean;       // PostgreSQL persistence
  roles?: string[];        // Required roles
  rateLimit?: number;      // Events per second
}
```

**Auto-Generated Interfaces:**
- HTTP route registration
- MCP tool definition
- Event subscription setup
- Schema validation middleware

#### 2. @Resilient - Cross-Cutting Concerns

```typescript
interface ResilientConfig {
  rateLimit?: {
    limit: number;
    windowMs: number;
    keyGenerator?: (ctx) => string;
  };
  timeout?: number;
  circuitBreaker?: {
    threshold: number;
    timeout: number;
    fallback?: () => any;
  };
}
```

**Provides:**
- Distributed rate limiting via Redis
- Circuit breaker with shared state
- Request timeout handling
- Automatic fallback responses

#### 3. @Instrumented - Caching and Metrics

```typescript
@Instrumented(ttlSeconds)
async handle(input, context) {
  // Automatic caching with Redis
  // Metrics collection
  // Performance monitoring
}
```

### Decorator Execution Chain

```mermaid
graph LR
    A[Request] --> B["@EventHandler"]
    B --> C[Schema Validation]
    C --> D["@Resilient"] 
    D --> E[Rate Limit Check]
    E --> F[Circuit Breaker Check]
    F --> G["@Instrumented"]
    G --> H[Cache Lookup]
    H --> I[Handler Execution]
    I --> J[Cache Update]
    J --> K[Metrics Collection]
    K --> L[Response]
```

## Event Context and Dependency Injection

### EventContext Interface

```typescript
interface EventContext {
  // Event metadata
  eventType: string;
  eventId: string;
  instanceId: string;
  
  // Resource access
  redis: RedisClients;
  prisma: PrismaClient;
  
  // Capabilities  
  persist: boolean;
  publish: (event: Event) => Promise<void>;
  
  // Request context
  metadata: Record<string, any>;
  requestId?: string;
  userId?: string;
}
```

### Resource Management

**Redis Clients**
```typescript
interface RedisClients {
  main: Redis;      // Primary operations
  pub: Redis;       // Event publishing
  sub: Redis;       // Event subscription  
  scripts: Redis;   // Lua script execution
}
```

**Prisma Integration**
```typescript
// Explicit persistence control
if (this.persist) {
  await ctx.prisma.task.create({
    data: transformToDbSchema(result)
  });
}
```

## Handler Registry and Discovery

### Automatic Registration

```typescript
export class HandlerRegistry {
  async registerHandler(handlerClass: any) {
    const config = getEventHandlerConfig(handlerClass);
    
    // Register HTTP route
    this.app.post(`/${config.event.replace('.', '/')}`, 
      validateInput(config.inputSchema),
      createHttpHandler(handlerClass)
    );
    
    // Register MCP tool
    this.mcpServer.addTool({
      name: config.event.replace('.', '__'),
      description: `Execute ${config.event}`,
      inputSchema: config.inputSchema
    });
    
    // Register event subscription
    this.eventBus.subscribe(config.event, 
      createEventHandler(handlerClass)
    );
  }
}
```

### Dynamic Handler Execution

```typescript
async executeHandler(eventType: string, input: any, context: EventContext) {
  const handler = this.handlers.get(eventType);
  if (!handler) {
    throw new Error(`Handler not found: ${eventType}`);
  }
  
  // Apply decorator chain
  const decoratedHandler = this.applyDecorators(handler);
  
  // Execute with full context
  return await decoratedHandler.handle(input, context);
}
```

## Handler Domain Organization

### Task Domain (4 handlers - 100% Pattern A)

| Handler | Event | Purpose | Persistence |
|---------|-------|---------|-------------|
| TaskCreateHandler | task.create | Create new tasks | ✅ |
| TaskUpdateHandler | task.update | Update task state | ✅ |
| TaskAssignHandler | task.assign | Assign to instances | ✅ |
| TaskCompleteHandler | task.complete | Mark completion | ✅ |

**Rationale**: Task operations require strong consistency, audit trails, and transactional guarantees.

### System Domain (7 handlers - Mixed patterns)

| Handler | Event | Pattern | Purpose |
|---------|-------|---------|---------|
| SystemRegisterHandler | system.register | A | Instance registration |
| SystemHealthHandler | system.health | A | Health monitoring |
| SystemHeartbeatHandler | system.heartbeat | A | Keep-alive signals |
| SystemGetStateHandler | system.get_state | A | State queries |
| SystemMetricsHandler | system.metrics | A | Metrics aggregation |
| SystemBatchProcessHandler | system.batch.process | C | Batch coordination |
| SystemQuorumVoteHandler | system.quorum.vote | C | Consensus decisions |

### Hook Domain (4 handlers - Mixed patterns)

| Handler | Event | Pattern | Purpose |
|---------|-------|---------|---------|
| PreToolHookHandler | hook.pre_tool | A | Tool validation |
| PostToolHookHandler | hook.post_tool | A | Result processing |
| UserPromptHookHandler | hook.user_prompt | A | Prompt modification |
| TodoWriteHookHandler | hook.todo_write | C | Todo orchestration |

### Test Domain (1 handler - Pattern A)

| Handler | Event | Pattern | Purpose |
|---------|-------|---------|---------|
| TestCircuitHandler | test.circuit | A | Circuit breaker testing |

## Testing Strategy for Handlers

### ContractTest Driven Development

**1. Contract Tests (100% passing)**
```typescript
describe('TaskCreateHandler Contract', () => {
  it('validates input schema', async () => {
    const input = { text: 'Test task', priority: 75 };
    const result = await TaskCreateInput.parse(input);
    expect(result).toEqual(input);
  });
  
  it('validates output schema', async () => {
    const output = { id: 't-123', status: 'pending', text: 'Test' };
    const result = await TaskCreateOutput.parse(output);
    expect(result).toEqual(output);
  });
});
```

**2. Integration Tests (85%+ passing)**
```typescript
describe('TaskCreateHandler Integration', () => {
  it('creates task and updates Redis', async () => {
    const handler = new TaskCreateHandler();
    const result = await handler.handle(input, mockContext);
    
    // Verify Redis state
    const task = await redis.hgetall(`cb:task:${result.id}`);
    expect(task.status).toBe('pending');
    
    // Verify queue entry
    const queueEntry = await redis.zscore('cb:queue:tasks:pending', result.id);
    expect(queueEntry).toBe(input.priority);
  });
});
```

### Handler Test Patterns

**Mocking Context**
```typescript
const mockContext: EventContext = {
  eventType: 'task.create',
  eventId: 'evt-123',
  instanceId: 'test-instance',
  redis: mockRedis,
  prisma: mockPrisma,
  persist: true,
  publish: jest.fn(),
  metadata: {}
};
```

**Testing Decorators**
```typescript
describe('@Resilient Decorator', () => {
  it('applies rate limiting', async () => {
    // Test rate limit enforcement
    // Verify circuit breaker behavior
    // Check fallback responses
  });
});
```

## Performance Characteristics by Pattern

### Pattern A (Centralized) Performance

| Metric | Value | Characteristic |
|--------|-------|----------------|
| Latency | 5-15ms | Single-hop operations |
| Throughput | 1,000-2,000 ops/sec | CPU bound |
| Memory | Predictable growth | Bounded by Redis |
| Scaling | Vertical | Instance upgrades |

### Pattern B (Distributed) Performance

| Metric | Value | Characteristic |
|--------|-------|----------------|
| Latency | 15-50ms | Multi-hop coordination |
| Throughput | 5,000-10,000 ops/sec | Distributed load |
| Memory | Elastic | Scales with instances |
| Scaling | Horizontal | Linear scaling |

### Pattern C (Hybrid) Performance

| Metric | Value | Characteristic |
|--------|-------|----------------|
| Latency | 10-30ms | Mixed operations |
| Throughput | 2,000-5,000 ops/sec | Variable based on mode |
| Memory | Mixed distribution | Coordinator + workers |
| Scaling | Adaptive | Based on workload |

## Evolution and Transformation

### Pattern Transformation Scenarios

#### A → B: TaskQueueManager Evolution
**Current State**: Centralized queue management
**Target State**: Distributed worker actors
**Benefits**: Better fault isolation, higher throughput
**Challenges**: Complex coordination, consistency guarantees

#### B → A: Decorator System Simplification  
**Current State**: Distributed resilience coordination
**Target State**: Centralized resilience manager
**Benefits**: Simpler state management, easier debugging
**Challenges**: Single point of failure, scalability limits

#### C → A: EventBus Simplification
**Current State**: Hybrid pub/sub + streams
**Target State**: Pure stream-based with polling
**Benefits**: Simplified consistency model
**Challenges**: Higher latency, reduced real-time capability

## Best Practices

### Handler Design

1. **Single Responsibility**: One event type per handler
2. **Idempotent Operations**: Handle duplicate events gracefully
3. **Fast Execution**: Keep handlers under 100ms
4. **Error Isolation**: Don't let failures cascade
5. **Resource Cleanup**: Use TTL for temporary state

### Decorator Usage

1. **Appropriate Patterns**: Match decorator to handler pattern
2. **Performance Monitoring**: Track decorator overhead
3. **Fallback Design**: Always provide meaningful fallbacks
4. **Configuration**: Make thresholds configurable

### Testing Strategy

1. **Contract First**: Define schemas before implementation
2. **Integration Testing**: Verify Redis key patterns
3. **Pattern Testing**: Test pattern-specific behaviors
4. **Performance Testing**: Validate latency requirements

### Operational Excellence

1. **Monitoring**: Track handler-specific metrics
2. **Alerting**: Set appropriate thresholds per pattern
3. **Debugging**: Use distributed tracing for complex flows
4. **Capacity Planning**: Monitor resource usage by pattern

This handler architecture provides a solid foundation for ClaudeBench's event-driven system, offering clear patterns for different requirements while maintaining consistency and performance across all transport mechanisms.