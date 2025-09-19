# HOWTO: Instrumented & Resilient Decorators

## Overview

All event handlers in ClaudeBench should use the `@Instrumented` and `@Resilient` decorators to ensure consistent cross-cutting concerns across the system. These decorators provide:

- **@Instrumented**: Caching, metrics collection, and audit logging
- **@Resilient**: Rate limiting, timeout protection, and circuit breaker pattern

## Implementation Pattern

```typescript
import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";

@EventHandler({
    event: "domain.action",
    inputSchema: domainActionInput,
    outputSchema: domainActionOutput,
    persist: false,
    rateLimit: 100, // Note: This is metadata only, actual rate limit is in @Resilient
    description: "Description of what this handler does",
})
export class DomainActionHandler {
    @Instrumented(300) // Cache TTL in seconds (5 minutes)
    @Resilient({
        rateLimit: { limit: 100, windowMs: 60000 }, // 100 requests per minute
        timeout: 5000, // 5 second timeout
        circuitBreaker: { 
            threshold: 5, // Open after 5 failures
            timeout: 30000, // Try again after 30 seconds
            fallback: () => ({ 
                // Return fallback response if circuit is open
                success: false,
                message: "Service temporarily unavailable"
            })
        }
    })
    async handle(input: DomainActionInput, ctx: EventContext): Promise<DomainActionOutput> {
        // Handler implementation
    }
}
```

## Decorator Parameters

### @Instrumented(ttl)
- **ttl**: Cache time-to-live in seconds
  - Use 0 (no caching) for:
    - State-changing operations (create, update, delete, assign, complete)
    - Real-time metrics and state queries
    - Operations that must always execute
  - Use short TTL (10-30s) for:
    - Frequently accessed but relatively stable data (heartbeats, health checks)
  - Use medium TTL (60-120s) for:
    - Read operations that don't change often (user prompts, todo reads)
  - Use longer TTL (300-600s) for:
    - Validation operations (pre-tool hooks)
    - Configuration or metadata reads

### @Resilient(options)
- **rateLimit**: 
  - `limit`: Maximum requests per window
  - `windowMs`: Time window in milliseconds (default: 60000)
  - Guidelines:
    - Critical operations: 10-50 requests/minute
    - Normal operations: 100-500 requests/minute
    - High-frequency operations: 1000+ requests/minute
    - Testing: Use higher limits (100+ for setup operations)

- **timeout**: Maximum execution time in milliseconds
  - Hook validations: 3000ms (3 seconds)
  - Database operations: 5000ms (5 seconds)
  - Complex computations: 10000ms (10 seconds)

- **circuitBreaker**:
  - `threshold`: Number of failures before opening circuit
  - `timeout`: Time in ms before attempting to close circuit
  - `fallback`: Function returning default response when circuit is open

## Decorator Order

The decorators must be applied in this specific order (top to bottom):
1. `@Instrumented` - First decorator (closest to method)
2. `@Resilient` - Second decorator

This ensures proper composition of the decorator chain.

## Rate Limit Guidelines by Handler Type

| Handler Type | Suggested Rate Limit | Reasoning |
|-------------|---------------------|-----------|
| Hook validation | 1000/min | High frequency, lightweight |
| Task creation | 100/min | Moderate frequency, involves queue operations |
| System registration | 100/min | Infrequent but may burst during startup |
| Health checks | 100/min | Monitoring tools may poll frequently |
| Metrics collection | 50/min | Periodic collection, not time-critical |
| User prompts | 100/min | User-driven, natural rate limiting |

## Testing Considerations

For handlers called during test setup (e.g., `system.register`, `task.create`):
- Use higher rate limits (100+ per minute)
- Consider shorter cache TTLs
- Ensure circuit breaker thresholds accommodate test scenarios

## Migration Progress

| Handler | Path | @Instrumented | @Resilient | Rate Limit | Notes |
|---------|------|--------------|------------|------------|-------|
| **Hook Handlers** |
| hook.pre_tool | `/handlers/hook/hook.pre_tool.handler.ts` | ✅ 300s | ✅ 1000/min | 1000/min | Completed, manual metrics removed |
| hook.post_tool | `/handlers/hook/hook.post_tool.handler.ts` | ✅ 60s | ✅ 1000/min | 1000/min | Completed, manual metrics removed |
| hook.user_prompt | `/handlers/hook/hook.user_prompt.handler.ts` | ✅ 120s | ✅ 100/min | 100/min | Completed, manual metrics removed |
| hook.todo_write | `/handlers/hook/hook.todo_write.handler.ts` | ✅ 60s | ✅ 50/min | 50/min | Completed, manual metrics removed |
| **System Handlers** |
| system.register | `/handlers/system/system.register.handler.ts` | ✅ 60s | ✅ 100/min | 100/min | Completed |
| system.health | `/handlers/system/system.health.handler.ts` | ✅ 30s | ✅ 100/min | 100/min | Completed |
| system.heartbeat | `/handlers/system/system.heartbeat.handler.ts` | ✅ 10s | ✅ 1000/min | 1000/min | Completed |
| system.metrics | `/handlers/system/system.metrics.handler.ts` | ✅ 0s | ✅ 20/min | 20/min | Completed, no cache (real-time data) |
| system.get_state | `/handlers/system/system.get_state.handler.ts` | ✅ 0s | ✅ 50/min | 50/min | Completed, no cache (real-time data) |
| **Task Handlers** |
| task.create | `/handlers/task/task.create.handler.ts` | ✅ 0s | ✅ 100/min | 100/min | Completed, no cache (state change) |
| task.assign | `/handlers/task/task.assign.handler.ts` | ✅ 0s | ✅ 20/min | 20/min | Completed, no cache (state change) |
| task.update | `/handlers/task/task.update.handler.ts` | ✅ 0s | ✅ 20/min | 20/min | Completed, no cache (state change) |
| task.complete | `/handlers/task/task.complete.handler.ts` | ✅ 0s | ✅ 20/min | 20/min | Completed, no cache (state change) |

## Implementation Checklist

When adding decorators to a handler:

- [ ] Import both decorators: `import { EventHandler, Instrumented, Resilient } from "@/core/decorator"`
- [ ] Add `@Instrumented` with appropriate cache TTL
- [ ] Add `@Resilient` with rate limit, timeout, and circuit breaker config
- [ ] Ensure rate limit is appropriate for handler's expected usage
- [ ] Define meaningful fallback response for circuit breaker
- [ ] Test that handler still works with decorators applied
- [ ] Update this progress table

## Common Issues & Solutions

### Issue: Rate limit too restrictive for tests
**Solution**: Increase rate limit to 100+ for handlers used in test setup

### Issue: Cache TTL too long for dynamic data
**Solution**: Reduce TTL or set to 0 for data that changes frequently

### Issue: Circuit breaker opens too easily
**Solution**: Increase threshold or adjust timeout based on expected failure patterns

### Issue: Timeout too short for complex operations
**Solution**: Increase timeout, but consider breaking operation into smaller chunks

## Benefits

By consistently applying these decorators:
1. **Automatic resilience**: Protection against overload and cascading failures
2. **Performance optimization**: Built-in caching reduces redundant computations
3. **Observability**: Automatic metrics and audit logging for all operations
4. **Consistency**: Uniform behavior across all handlers
5. **Separation of concerns**: Business logic remains clean and focused

## Next Steps

1. Complete migration for all remaining handlers (marked with ❌)
2. Add integration tests to verify decorator behavior
3. Set up monitoring dashboards for decorator metrics
4. Document decorator metrics in Prometheus/Grafana
5. Consider creating custom decorators for domain-specific concerns