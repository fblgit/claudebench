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
- [task.create](./task/create.md) - Create tasks
- [task.update](./task/update.md) - Update tasks
- [task.complete](./task/complete.md) - Complete tasks
- [task.claim](./task/claim.md) - Claim tasks
- [task.list](./task/list.md) - List tasks

### System Handlers
- [system.health](./system/health.md) - Health checks
- [system.metrics](./system/metrics.md) - Metrics collection
- [system.register](./system/register.md) - Instance registration

### Swarm Handlers  
- [swarm.decompose](./swarm/decompose.md) - Task decomposition
- [swarm.assign](./swarm/assign.md) - Specialist assignment
- [swarm.synthesize](./swarm/synthesize.md) - Result synthesis

### Hook Handlers
- [hook.pre_tool](./hook/pre_tool.md) - Pre-tool execution
- [hook.post_tool](./hook/post_tool.md) - Post-tool execution
- [hook.user_prompt](./hook/user_prompt.md) - User prompts

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