# Hook Handlers Analysis Report

## Executive Summary

This analysis examines 4 hook handlers in the ClaudeBench event-driven architecture, documenting their implementation patterns, state management approaches, and consistency models. All handlers follow a similar architectural pattern with centralized state management and Redis-based persistence.

## Analysis Context

Based on the Pattern Migration Brief framework, handlers are classified into:
- **Pattern A**: Centralized (Manager-based) - Single component manages state, synchronous processing
- **Pattern B**: Distributed (Actor-based) - Multiple autonomous components, asynchronous message passing  
- **Pattern C**: Hybrid (Coordinated) - Central coordinator with distributed executors

## Handler Analysis

### 1. PreToolHookHandler (`hook.pre_tool`)

**Implementation Pattern**: Pattern A (Centralized)

**Event Type**: `hook.pre_tool`

**State Management Approach**:
- Centralized validation through `HookValidator` class
- Local in-memory cache (`Map<string, { result: HookResult; expires: number }>`)
- Redis-based audit logging and metrics tracking
- Synchronous validation pipeline with rule-based processing

**Dependencies Used**:
- `@/core/hook-validator` - Core validation logic
- `@Instrumented(300)` - 5-minute caching decorator
- `@Resilient` - Circuit breaker, rate limiting, timeout handling
- Redis for validation logging and audit trails

**Consistency Model**:
- **Strong consistency** within validation rules
- **Eventual consistency** for audit logs and metrics
- Cache invalidation based on TTL (5 minutes default)
- Fallback strategy: Allow by default when circuit breaker opens

**Key Characteristics**:
- Rate limit: 1000 requests/minute
- Timeout: 3 seconds
- Circuit breaker: 10 failures → 30 second timeout
- Cache TTL varies by severity (60s-600s)

---

### 2. PostToolHookHandler (`hook.post_tool`)

**Implementation Pattern**: Pattern A (Centralized)

**Event Type**: `hook.post_tool`

**State Management Approach**:
- Centralized result processing with Redis persistence
- Direct Redis operations for logging and metrics
- Tool-specific result handling with conditional logic
- Synchronous processing with immediate persistence

**Dependencies Used**:
- `@/core/redis` - Direct Redis key operations
- `@Instrumented(60)` - 1-minute caching (short TTL for frequent changes)
- `@Resilient` - Circuit breaker and rate limiting
- Event publishing via `ctx.publish()`

**Consistency Model**:
- **Immediate consistency** for tool execution logging
- **Eventual consistency** for metrics aggregation
- Error tracking with sliding window (5 minutes)
- Alert generation for consecutive failures (>5 errors)

**Key Characteristics**:
- Rate limit: 1000 requests/minute
- Timeout: 5 seconds
- Circuit breaker fallback: Mark as processed
- Log retention: 24 hours
- Error threshold: 5 consecutive failures trigger alerts

---

### 3. UserPromptHookHandler (`hook.user_prompt`)

**Implementation Pattern**: Pattern A (Centralized)

**Event Type**: `hook.user_prompt`

**State Management Approach**:
- Centralized prompt processing and modification
- Redis-based prompt history storage
- In-memory pattern matching for security warnings
- Synchronous modification pipeline

**Dependencies Used**:
- `@/core/redis` - Prompt history persistence
- `@Instrumented(120)` - 2-minute caching for repeated prompts
- `@Resilient` - Lower rate limits due to interactive nature
- Pattern matching for dangerous commands

**Consistency Model**:
- **Strong consistency** for prompt modifications
- **Eventual consistency** for history logging
- Conservative fallback: No modification when circuit opens
- Context-aware enhancement based on user preferences

**Key Characteristics**:
- Rate limit: 100 requests/minute (lower due to interactive nature)
- Timeout: 3 seconds
- Circuit breaker: 5 failures → 30 second timeout
- History retention: 24 hours
- Security patterns: rm -rf, database drops, sensitive info detection

---

### 4. TodoWriteHookHandler (`hook.todo_write`)

**Implementation Pattern**: Pattern C (Hybrid/Coordinated)

**Event Type**: `hook.todo_write`

**State Management Approach**:
- **Centralized coordination** through `TodoManager` 
- **Distributed execution** via `registry.executeHandler("task.create")`
- Atomic state transitions using Lua scripts
- Complex workflow orchestration with multiple Redis operations

**Dependencies Used**:
- `@/core/todo-manager` - Centralized state management with Lua scripts
- `@/core/registry` - Distributed task creation via other handlers
- `@Instrumented(60)` - 1-minute caching
- `@Resilient` - Circuit breaker with persistence guarantee
- PostgreSQL persistence (`persist: true`)

**Consistency Model**:
- **Strong consistency** for todo state transitions (Lua scripts)
- **Eventual consistency** for task creation and mapping
- **Hybrid coordination** - central orchestrator, distributed executors
- Error isolation: Task creation failures don't affect todo processing

**Key Characteristics**:
- Rate limit: 50 requests/minute (lowest due to DB writes)
- Timeout: 5 seconds (longest for DB operations)
- Only handler with `persist: true`
- Lua scripts for atomic Redis operations
- Cross-handler coordination via registry
- Session-based todo-task mapping

---

## Pattern Distribution Summary

| Pattern | Handlers | Characteristics |
|---------|----------|-----------------|
| **Pattern A** | 3/4 (75%) | `pre_tool`, `post_tool`, `user_prompt` - Centralized processing |
| **Pattern C** | 1/4 (25%) | `todo_write` - Hybrid coordination with distributed task creation |
| **Pattern B** | 0/4 (0%) | No pure actor-based implementations found |

## State Management Analysis

### Redis Key Patterns Used

| Handler | Key Patterns | Purpose |
|---------|-------------|---------|
| `pre_tool` | `cb:validation:*`, `cb:audit:*` | Validation results, audit trails |
| `post_tool` | `cb:log:tool:*`, `cb:metrics:tools:*` | Execution logs, tool metrics |
| `user_prompt` | `cb:history:prompts:*` | Prompt history |
| `todo_write` | `cb:todos:*`, `cb:aggregate:*` | Todo state, aggregations |

### Consistency Models Comparison

| Handler | Consistency Model | Failure Handling |
|---------|------------------|------------------|
| `pre_tool` | Strong (validation) + Eventual (audit) | Allow by default |
| `post_tool` | Immediate (logging) + Eventual (metrics) | Mark as processed |
| `user_prompt` | Strong (modifications) + Eventual (history) | No modifications |
| `todo_write` | Strong (state) + Eventual (tasks) | Always processed |

## Architectural Observations

### Common Design Patterns

1. **Decorator-Driven Architecture**: All handlers use `@Instrumented` and `@Resilient` decorators
2. **Centralized State Management**: 75% use Pattern A with single-component control
3. **Redis-First Persistence**: All handlers use Redis as primary state store
4. **Fallback Strategies**: Each handler defines specific circuit breaker fallbacks
5. **Event Publishing**: Consistent event emission pattern via `ctx.publish()`

### Unique Characteristics

- **TodoWriteHandler** is the only hybrid pattern (Pattern C)
- **TodoWriteHandler** is the only handler with PostgreSQL persistence
- **PreToolHandler** has the most complex validation logic with rule groups
- **UserPromptHandler** has the lowest rate limits (interactive workload)
- **PostToolHandler** implements error-based alerting

### Dependencies and Coupling

| Handler | External Dependencies | Coupling Level |
|---------|----------------------|----------------|
| `pre_tool` | HookValidator, Config | Medium |
| `post_tool` | Redis utilities only | Low |
| `user_prompt` | Redis utilities only | Low |
| `todo_write` | TodoManager, Registry, Task handlers | High |

## Recommendations

### Pattern Consistency
- Consider standardizing error handling patterns across all handlers
- Evaluate if `todo_write`'s hybrid pattern provides sufficient benefits over centralized approach

### State Management
- Document Lua script atomicity guarantees for `todo_write`
- Consider implementing similar atomic operations for other handlers where needed

### Resilience
- Review circuit breaker thresholds - they vary significantly (5-10 failures)
- Standardize timeout values based on operation complexity rather than handler type

### Monitoring
- All handlers emit events but metric granularity varies
- Consider standardized metric collection patterns across handlers

## Transformation Scenarios

### Potential A → B Transformations
- `post_tool` could be distributed across multiple worker instances
- `user_prompt` could use actor-based pattern matching

### Potential C → A Transformations  
- `todo_write` could be simplified to pure centralized pattern if cross-handler coordination proves problematic

### Potential A → C Transformations
- `pre_tool` could distribute validation across multiple validators for complex rule sets

---

*Analysis completed on 2025-09-12*
*Based on ClaudeBench codebase at /Users/mrv/Desktop/GIT/cb3/claudebench/apps/server/src/handlers/hook/*