# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClaudeBench is a Redis-first event-driven system where every handler auto-generates HTTP, MCP, and event interfaces through a single decorator. The architecture enforces localhost-reality: no distributed complexity for single-user tools.

## Critical Commands

```bash
bun relay               # MUST run in background - monitors all system events
bun dev                 # Start server (:3000) and web (:3001)
bun test:contract       # Test external API contracts (specs/001-claudebench/contracts/)
bun test:integration    # Test internal Redis/Prisma side effects
```

## Codebase Architecture

### Handler-Centric Design

Every feature is a handler in `apps/server/src/handlers/{domain}/`. The handler IS the feature:

```typescript
// apps/server/src/handlers/task/task.create.handler.ts
@EventHandler({
  event: 'task.create',              // Becomes HTTP POST /task/create
  inputSchema: taskCreateInput,      // Shared schema from schemas/
  outputSchema: taskCreateOutput,    // Type-safe everywhere
  persist: true,                     // Handler decides PostgreSQL persistence
  rateLimit: 10
})
export class TaskCreateHandler {
  @Instrumented(0)                   // Caching TTL (0 = no cache)
  @Resilient({                       // Per-handler resilience config
    rateLimit: { limit: 100, windowMs: 60000 },
    timeout: 5000,
    circuitBreaker: { threshold: 5, timeout: 30000 }
  })
  async handle(input: TaskCreateInput, ctx: EventContext) {
    // 1. Atomic Redis operations via Lua scripts
    const result = await redisScripts.createTask(...);
    
    // 2. Conditional PostgreSQL persistence
    if (ctx.persist) {
      await ctx.prisma.task.create({ data });
    }
    
    // 3. Publish events for observers
    await ctx.publish({ type: 'task.created', payload });
    
    return output; // Validated by outputSchema
  }
}
```

### Directory Structure Patterns

```
apps/server/src/
├── core/
│   ├── decorator.ts       # @EventHandler, @Instrumented, @Resilient
│   ├── context.ts         # EventContext with Redis, Prisma, publish
│   ├── redis-scripts.ts   # Lua scripts for atomic operations
│   └── bus.ts             # Event bus initialization
├── handlers/
│   ├── task/              # Task domain
│   │   ├── task.create.handler.ts
│   │   ├── task.complete.handler.ts
│   │   └── index.ts       # Exports all handlers
│   ├── swarm/             # Swarm intelligence
│   └── system/            # System operations
├── schemas/               # Shared Zod schemas
│   ├── task.schema.ts     # Input/Output types for task domain
│   └── common.schema.ts   # Shared types
└── transports/
    ├── http.ts            # Auto-generated from decorators
    └── mcp.ts             # Auto-generated MCP tools
```

## Key Architectural Patterns

### 1. Redis Lua Scripts (Atomic Operations)

All Redis operations use Lua scripts for atomicity (`core/redis-scripts.ts`):

```typescript
// Instead of multiple Redis calls:
// ❌ await redis.hset(); await redis.zadd(); await redis.incr();

// Use atomic Lua script:
// ✅ await redisScripts.createTask(taskId, text, priority, status, now, metadata);
```

Lua scripts handle:
- Task creation with queue addition
- Atomic metrics updates
- Conflict detection
- State transitions

### 2. EventContext Pattern

Every handler receives `EventContext` with unified access:

```typescript
interface EventContext {
  instanceId: string;        // Worker identity
  requestId: string;         // Trace requests
  redis: RedisConnection;    // Direct Redis access
  prisma: PrismaClient;      // Direct DB access
  persist: boolean;          // From decorator config
  publish: (event) => void;  // Emit events
  metrics: MetricsClient;    // Prometheus metrics
}
```

### 3. Schema-First Development

Schemas define the contract (`schemas/*.schema.ts`):

```typescript
// schemas/task.schema.ts
export const taskCreateInput = z.object({
  text: z.string().min(1).max(500),
  priority: z.number().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional()
});

export type TaskCreateInput = z.infer<typeof taskCreateInput>;
```

Schemas are:
- Shared between handlers and tests
- Used for validation at all boundaries
- The source of TypeScript types
- Never duplicated between transports

## Testing Philosophy

### Contract Tests (External Behavior)

Location: `apps/server/tests/contract/`
Purpose: Verify API contracts match specifications

```typescript
// Tests against specs/001-claudebench/contracts/jsonrpc-contract.json
it('should create task with correct shape', async () => {
  const response = await callRPC('task.create', { text: 'Test' });
  expect(response).toMatchContract('task.create.output');
});
```

### Integration Tests (Internal Behavior)

Location: `apps/server/tests/integration/`
Purpose: Verify Redis keys, queues, and side effects

```typescript
it('should add task to Redis queue', async () => {
  await handler.handle(input, ctx);
  
  // Verify internal state changes
  const queueLength = await redis.zcard('cb:queue:tasks');
  expect(queueLength).toBe(1);
  
  const taskData = await redis.hgetall(`cb:task:${taskId}`);
  expect(taskData.status).toBe('pending');
});
```

### Redis Test Pattern

**CRITICAL**: Never call `redis.quit()` in tests - causes parallel test interference:

```typescript
afterAll(async () => {
  try {
    // Clean test data but DON'T quit Redis
    const keys = await redis.keys('cb:test:*');
    if (keys.length > 0) await redis.del(...keys);
  } catch { /* ignore */ }
  // ❌ NEVER: await redis.quit();
});
```

## Handler Implementation Checklist

When implementing a new handler:

1. **Define Schema** (`schemas/{domain}.schema.ts`)
   - Input/output Zod schemas
   - TypeScript type exports

2. **Create Handler** (`handlers/{domain}/{domain}.{action}.handler.ts`)
   - @EventHandler decorator with event name
   - @Instrumented for caching (usually 0 for mutations)
   - @Resilient for rate limiting and circuit breaking
   - Handle method with EventContext parameter

3. **Implement Logic**
   - Use redisScripts for atomic operations
   - Check ctx.persist for PostgreSQL writes
   - Publish events via ctx.publish
   - Return validated output

4. **Write Tests**
   - Contract test in `tests/contract/`
   - Integration test in `tests/integration/`
   - Both must pass before merge

5. **Export Handler** (`handlers/{domain}/index.ts`)
   - Add to domain's barrel export

## Critical Implementation Details

### Zod v3 Lock (NEVER UPGRADE)

The project requires **Zod v3.25.76**. MCP SDK expects `.shape` property which changed in v4:

```typescript
// MCP tool registration needs this to work:
const tool = sdk.tool({
  name: 'task__create',
  inputSchema: taskCreateInput.shape  // ← Only works in Zod v3
});
```

### Prisma Custom Output

Prisma generates to `apps/server/generated/` not `node_modules`:

```typescript
// apps/server/src/db/index.ts
import { PrismaClient } from '../../generated';
```

### Event Publishing Pattern

Events use past tense for completed actions:

```typescript
// Handler emits 'task.created' AFTER creation
await ctx.publish({
  type: 'task.created',  // Past tense
  payload: { id, text, status },
  metadata: { createdBy: ctx.instanceId }
});
```

## Code Style & Constraints

### Formatting (Biome)
- Tabs for indentation (not spaces)
- Double quotes for strings
- Imports auto-organized on save

### Handler Rules
- <50 lines (one screen readable)
- No abstraction wrappers over Redis/Prisma
- Explicit persistence via ctx.persist check
- All operations emit observable events
- Comments only for non-obvious logic

## Event Naming & Redis Keys

### Event Format: `domain.action`

```typescript
'task.create'      // Creates task
'task.created'     // Emitted after creation
'task.complete'    // Completes task  
'task.completed'   // Emitted after completion
'swarm.decompose'  // Decomposes complex task
'system.health'    // Health check
```

### Redis Key Format: `cb:{type}:{id}`

```typescript
'cb:task:t-123'           // Task data (hash)
'cb:queue:tasks'          // Task queue (sorted set)
'cb:metrics:task.create'  // Handler metrics (hash)
'cb:instance:worker-1'    // Worker registration (hash)
'cb:stream:events'        // Event stream (stream)
'cb:conflict:c-456'       // Conflict data (hash)
```

## Swarm Intelligence Pattern

Complex tasks decompose into specialist subtasks:

```typescript
// handlers/swarm/swarm.decompose.handler.ts
// Breaks down "Build dashboard" into:
// - frontend: Create React components
// - backend: Set up API endpoints  
// - testing: Write E2E tests
// - docs: Generate documentation

// handlers/swarm/swarm.assign.handler.ts  
// Uses ASSIGN_SUBTASK_TO_BEST_SPECIALIST Lua script
// Atomic assignment based on load and capabilities

// handlers/swarm/swarm.synthesize.handler.ts
// Combines completed subtasks into final solution
```

## MCP Tool Generation

Handlers auto-generate MCP tools via decorator metadata:

```typescript
@EventHandler({
  event: 'task.create',
  mcp: {
    title: 'Create Task',
    metadata: {
      examples: [{...}],      // Usage examples
      prerequisites: [...],   // Required conditions
      warnings: [...],        // Important caveats
      useCases: [...]        // When to use
    }
  }
})
```

This generates:
- Tool name: `task__create` (double underscore)
- Auto-registered in MCP server
- Available to AI agents

## Constitution Principles

**Event Democracy**: All actors (system/user/tools) equal. No privileged APIs.
**Localhost Reality**: Single-user, max 3 events/sec. No distributed complexity.
**Type Uniformity**: One schema per event, validated everywhere.
**Pragmatic Testing**: Test what matters, not imaginary edge cases.
**No Enterprise Theater**: No sagas, no microservices patterns for single keyboard.
