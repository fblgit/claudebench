---
sidebar_position: 1
title: Event Handlers
---

# Event Handlers

Event handlers are the core of ClaudeBench's business logic. They process events and execute operations.

## Handler Pattern

All handlers use the decorator pattern for automatic registration:

```typescript
@EventHandler({
  event: 'domain.action',
  inputSchema: z.object({ /* ... */ }),
  outputSchema: z.object({ /* ... */ }),
  persist: false,
  rateLimit: 100
})
export class DomainActionHandler {
  async handle(input: Input, context: EventContext) {
    // Handler logic
    return output;
  }
}
```

## Decorators

### @EventHandler

The main decorator that registers handlers:

- **event**: Event name in `domain.action` format
- **inputSchema**: Zod schema for input validation
- **outputSchema**: Zod schema for output validation  
- **persist**: Whether to persist to PostgreSQL
- **rateLimit**: Max events per second

### @Instrumented

Adds metrics and telemetry:

```typescript
@Instrumented({ 
  category: 'task',
  operation: 'create'
})
```

### @Resilient

Adds circuit breaker and retry logic:

```typescript
@Resilient({
  maxFailures: 5,
  timeout: 30000,
  resetTimeout: 60000
})
```

## Handler Categories

### Task Handlers
- [task.create](../api/task/create) - Create tasks
- [task.update](../api/task/update) - Update tasks
- [task.complete](../api/task/complete) - Complete tasks
- [task.claim](../api/task/claim) - Claim tasks
- [task.list](../api/task/list) - List tasks

### System Handlers
- [system.health](../api/system/health) - Health checks
- [system.metrics](../api/system/metrics) - Metrics collection
- [system.register](../api/system/register) - Instance registration

### Swarm Handlers  
- [swarm.decompose](../api/swarm/decompose) - Task decomposition
- [swarm.assign](../api/swarm/assign) - Specialist assignment
- [swarm.synthesize](../api/swarm/synthesize) - Result synthesis

### Hook Handlers
*Note: Hook handlers are internal and not exposed via API*
- hook.pre_tool - Pre-tool execution validation
- hook.post_tool - Post-tool execution processing
- hook.user_prompt - User prompt filtering

## Creating Custom Handlers

1. Create handler file in appropriate domain folder
2. Apply decorators for functionality
3. Implement handle method
4. Export from domain index

Example:

```typescript
// src/handlers/custom/custom.example.handler.ts
import { EventHandler, Instrumented, Resilient } from '@/core/decorator';
import { z } from 'zod';

@EventHandler({
  event: 'custom.example',
  inputSchema: z.object({
    data: z.string()
  }),
  outputSchema: z.object({
    result: z.string()
  })
})
@Instrumented({ category: 'custom' })
@Resilient()
export class CustomExampleHandler {
  async handle(input, context) {
    // Your logic here
    return { result: 'processed' };
  }
}
```