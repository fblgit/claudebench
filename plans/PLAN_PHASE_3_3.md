⏺ User approved Claude's plan:
  ⎿ Phase 3.3 Implementation Plan: Core Infrastructure

    Overview

    Implement the core event-driven infrastructure that powers ClaudeBench, including the event bus, decorator pattern, handler registry,
    and protective mechanisms (rate limiting, circuit breaker). Target: ~150 LOC for core, ~50 LOC for schemas, ~300 LOC for handlers.

    Implementation Order

    1. Core Infrastructure (T024-T029)

    Sequential - Must be done in order:

    T024: Event Bus with Redis Streams

    - Create apps/server/src/core/bus.ts
    - Implement event publishing to Redis Streams
    - Add event subscription with consumer groups
    - Support both fire-and-forget and request-response patterns
    - ~30 LOC

    T025: EventHandler Decorator

    - Create apps/server/src/core/decorator.ts
    - Use reflect-metadata to store handler metadata
    - Define decorator interface with Zod schemas
    - Auto-generate transport interfaces from metadata
    - ~40 LOC

    T026: Handler Registry

    - Create apps/server/src/core/registry.ts
    - Implement automatic handler discovery
    - Support handler lookup by event type
    - Generate route maps for HTTP/MCP
    - ~25 LOC

    T027: Event Context

    - Create apps/server/src/core/context.ts
    - Provide Redis and Prisma access to handlers
    - Include request metadata and instance info
    - Support transaction-like operations
    - ~20 LOC

    T028: Rate Limiter

    - Create apps/server/src/core/rate-limiter.ts
    - Use Redis sorted sets for sliding window
    - Support per-event and per-client limits
    - Return remaining quota in responses
    - ~20 LOC

    T029: Circuit Breaker

    - Create apps/server/src/core/circuit-breaker.ts
    - Use Redis INCR with TTL for failure counting
    - Implement CLOSED → OPEN → HALF_OPEN states
    - Support fallback responses
    - ~15 LOC

    2. Schemas (T030-T033)

    Parallel - Can be done simultaneously:

    T030-T033: Domain Schemas

    - Create schema files for each domain:
      - task.schema.ts: Task CRUD operations
      - hook.schema.ts: Tool interception hooks
      - system.schema.ts: Health, registration, metrics
      - common.schema.ts: Shared types (JSONRPC, errors)
    - Define input/output schemas using Zod
    - ~50 LOC total

    3. Event Handlers (T034-T046)

    Parallel - Can be done simultaneously after core + schemas:

    Task Handlers (T034-T037)

    - task.create.handler.ts: Create tasks, add to queue
    - task.update.handler.ts: Update task properties
    - task.assign.handler.ts: Assign to instances
    - task.complete.handler.ts: Mark complete/failed

    Hook Handlers (T038-T041)

    - hook.pre_tool.handler.ts: Validate before tool execution
    - hook.post_tool.handler.ts: Process after tool execution
    - hook.user_prompt.handler.ts: Intercept user prompts
    - hook.todo_write.handler.ts: Capture TodoWrite events

    System Handlers (T042-T046)

    - system.health.handler.ts: Check system health
    - system.register.handler.ts: Register instances
    - system.heartbeat.handler.ts: Update instance status
    - system.get_state.handler.ts: Get system snapshot
    - system.metrics.handler.ts: Collect metrics

    Key Design Patterns

    Decorator Pattern Example

    @EventHandler({
      event: 'task.create',
      inputSchema: taskCreateInput,
      outputSchema: taskCreateOutput,
      persist: true,
      rateLimit: 10
    })
    export class TaskCreateHandler {
      async handle(input: TaskCreateInput, ctx: EventContext) {
        // Implementation
      }
    }

    Redis Key Patterns

    - Events: cb:stream:{event}
    - Tasks: cb:task:{id}
    - Instances: cb:instance:{id}
    - Rate limits: cb:ratelimit:{event}:{client}
    - Circuit breaker: cb:circuit:{handler}:{state}

    Test Integration

    All handlers will be tested against existing contract and integration tests, which should start passing as implementation progresses.

    Success Criteria

    1. All contract tests (T008-T018) passing
    2. All integration tests (T019-T023) passing
    3. Core infrastructure under 150 LOC
    4. Handlers auto-generate transport interfaces
    5. Redis operations are performant (<50ms)
    6. Circuit breaker protects against cascading failures

    Next Steps After Phase 3.3

    - Phase 3.4: Transport Integration (HTTP, MCP, WebSocket)
    - Phase 3.5: Dashboard UI
    - Phase 3.6: CLI Tools
    - Phase 3.7: Polish & Documentation

⏺ Excellent! Let's begin implementing Phase 3.3. I'll start with the core infrastructure tasks.

  ★ Insight ─────────────────────────────────────
  • We'll build the event bus first as it's the foundation for all handlers
  • The decorator pattern will dramatically reduce boilerplate code
  • Each component will be small, focused, and testable
  ─────────────────────────────────────────────────

⏺ Let's start with T024 - Creating the event bus:

· Creating event bus… (esc to interrupt · ctrl+t to hide todos)
  ⎿  ☐ T024: Create event bus with Redis Streams
     ☐ T025: Implement EventHandler decorator
     ☐ T026: Create handler registry
     ☐ T027: Implement event context
     ☐ T028: Create rate limiter
     ☐ T029: Implement circuit breaker
     ☐ T030-T033: Create domain schemas
     ☐ T034-T037: Implement task handlers
     ☐ T038-T041: Implement hook handlers
     ☐ T042-T046: Implement system handlers
