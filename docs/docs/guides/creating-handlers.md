# Creating Event Handlers

Learn how to build new event handlers in ClaudeBench using the `@EventHandler` decorator pattern.

## Overview

ClaudeBench uses a decorator-based architecture where a single handler automatically generates:
- **HTTP endpoints** (`POST /domain/action`)
- **MCP tools** (`domain__action`)
- **Event subscriptions** (`domain.action`)

## Handler Structure

### Basic Template

```typescript
import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { yourSchema, yourSchemaOutput } from "@/schemas/your.schema";
import type { YourInput, YourOutput } from "@/schemas/your.schema";

@EventHandler({
  event: "domain.action",           // Event name (flat hierarchy)
  inputSchema: yourSchema,          // Zod validation for input
  outputSchema: yourSchemaOutput,   // Zod validation for output
  persist: false,                   // Explicit persistence flag
  rateLimit: 100,                   // Metadata only
  description: "What this handler does"
})
export class DomainActionHandler {
  @Instrumented(300) // Cache TTL in seconds
  @Resilient({
    rateLimit: { limit: 100, windowMs: 60000 },
    timeout: 5000,
    circuitBreaker: { threshold: 5, timeout: 30000 }
  })
  async handle(input: YourInput, ctx: EventContext): Promise<YourOutput> {
    // Implementation here
    return result;
  }
}
```

### Complete Example

Here's a real handler from the codebase:

```typescript
import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import type { TaskCreateInput, TaskCreateOutput } from "@/schemas/task.schema";
import { redisScripts } from "@/core/redis-scripts";

@EventHandler({
  event: "task.create",
  inputSchema: taskCreateInput,
  outputSchema: taskCreateOutput,
  persist: true,
  description: "Create a new task and add it to the queue",
  mcp: {
    title: "Create Task",
    metadata: {
      examples: [
        {
          description: "Create a simple development task",
          input: {
            text: "Review the new API documentation",
            priority: 75
          }
        }
      ],
      useCases: [
        "Creating work items for team management",
        "Adding todos to project workflows"
      ],
      warnings: [
        "Tasks are created in 'pending' status and must be explicitly assigned",
        "Priority values range from 0-100 (higher = more important)"
      ]
    }
  }
})
export class TaskCreateHandler {
  @Instrumented(0) // No caching for state-changing operations
  @Resilient({
    rateLimit: { limit: 100, windowMs: 60000 },
    timeout: 5000,
    circuitBreaker: { 
      threshold: 5, 
      timeout: 30000,
      fallback: () => ({ 
        id: "t-fallback",
        text: "Service temporarily unavailable",
        status: "pending",
        priority: 50,
        createdAt: new Date().toISOString()
      })
    }
  })
  async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
    const taskId = `t-${Date.now()}`;
    const now = new Date().toISOString();
    
    // Use Lua script for atomic operations
    const result = await redisScripts.createTask(
      taskId,
      input.text,
      input.priority || 50,
      "pending",
      now,
      input.metadata || null
    );
    
    if (!result.success) {
      throw new Error(result.error || "Failed to create task");
    }
    
    // Persist to PostgreSQL if configured
    if (ctx.persist) {
      await ctx.prisma.task.create({
        data: {
          id: taskId,
          text: input.text,
          status: "pending",
          priority: input.priority || 50,
          metadata: input.metadata as any || undefined,
        },
      });
    }
    
    // Publish event for subscribers
    await ctx.publish({
      type: "task.created",
      payload: {
        id: taskId,
        text: input.text,
        status: "pending",
        priority: input.priority || 50,
        createdAt: now,
      },
      metadata: {
        createdBy: ctx.instanceId,
      },
    });
    
    return {
      id: taskId,
      text: input.text,
      status: "pending",
      priority: input.priority || 50,
      createdAt: now,
    };
  }
}
```

## Step-by-Step Creation

### 1. Define Schemas

Create or update schemas in `/apps/server/src/schemas/`:

```typescript
// schemas/my-domain.schema.ts
import { z } from "zod";

export const myActionInput = z.object({
  name: z.string().min(1).max(100),
  value: z.number().optional(),
  metadata: z.record(z.unknown()).optional()
});

export const myActionOutput = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  success: z.boolean()
});

export type MyActionInput = z.infer<typeof myActionInput>;
export type MyActionOutput = z.infer<typeof myActionOutput>;
```

### 2. Create Handler File

Create the handler in `/apps/server/src/handlers/domain/`:

```typescript
// handlers/my-domain/my-domain.action.handler.ts
import { EventHandler, Instrumented, Resilient } from "@/core/decorator";
import type { EventContext } from "@/core/context";
import { myActionInput, myActionOutput } from "@/schemas/my-domain.schema";
import type { MyActionInput, MyActionOutput } from "@/schemas/my-domain.schema";

@EventHandler({
  event: "my-domain.action",
  inputSchema: myActionInput,
  outputSchema: myActionOutput,
  persist: false, // Set to true if you want PostgreSQL persistence
  description: "Perform action on my domain"
})
export class MyDomainActionHandler {
  @Instrumented(60) // Cache for 1 minute
  @Resilient({
    rateLimit: { limit: 100, windowMs: 60000 },
    timeout: 5000,
    circuitBreaker: { threshold: 5, timeout: 30000 }
  })
  async handle(input: MyActionInput, ctx: EventContext): Promise<MyActionOutput> {
    // Generate ID
    const id = `md-${Date.now()}`;
    
    // Store in Redis
    await ctx.redis.hset(`cb:my-domain:${id}`, {
      name: input.name,
      value: input.value?.toString() || "0",
      createdAt: new Date().toISOString()
    });
    
    // Optional: Persist to PostgreSQL
    if (ctx.persist) {
      await ctx.prisma.myDomain.create({
        data: {
          id,
          name: input.name,
          value: input.value,
          metadata: input.metadata
        }
      });
    }
    
    // Publish event
    await ctx.publish({
      type: "my-domain.action.completed",
      payload: { id, name: input.name }
    });
    
    return {
      id,
      name: input.name,
      createdAt: new Date().toISOString(),
      success: true
    };
  }
}
```

### 3. Register Handler

Add to `/apps/server/src/index.ts`:

```typescript
import { MyDomainActionHandler } from "@/handlers/my-domain/my-domain.action.handler";

// Register handler
server.registerHandler(new MyDomainActionHandler());
```

### 4. Write Tests

Create contract tests in `/apps/server/tests/contract/`:

```typescript
// tests/contract/my-domain.action.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { testClient } from "../helpers/test-client";
import { cleanupRedis } from "../helpers/cleanup";

describe("my-domain.action Contract", () => {
  beforeEach(async () => {
    await cleanupRedis();
  });

  afterEach(async () => {
    await cleanupRedis();
  });

  it("should create new domain entity", async () => {
    const input = {
      name: "test-entity",
      value: 42
    };

    const result = await testClient.call("my-domain.action", input);

    expect(result.id).toMatch(/^md-\d+$/);
    expect(result.name).toBe("test-entity");
    expect(result.success).toBe(true);
    expect(result.createdAt).toBeDefined();
  });

  it("should reject invalid input parameters", async () => {
    const input = {
      name: "", // Invalid - empty string
      value: 42
    };

    await expect(testClient.call("my-domain.action", input)).rejects.toThrow();
  });
});
```

## Event Naming Conventions

### Pattern: `domain.action`

- **Domains**: `task`, `hook`, `system`, `swarm`, `mcp`
- **Actions**: `create`, `update`, `delete`, `assign`, `complete`, `validate`

### Examples
```typescript
"task.create"          // Create a new task
"task.update"          // Update task properties
"task.complete"        // Mark task as completed
"hook.pre_tool"        // Pre-tool validation hook
"system.health"        // System health check
"swarm.decompose"      // Decompose complex task
```

## Decorator Configuration

### @EventHandler Options

```typescript
@EventHandler({
  event: "domain.action",           // Required: Event name
  inputSchema: zodSchema,           // Required: Input validation
  outputSchema: zodSchema,          // Required: Output validation
  persist: false,                   // Optional: Auto-persist to PostgreSQL
  rateLimit: 100,                   // Optional: Metadata only
  description: "Handler purpose",   // Optional: Documentation
  mcp: {                           // Optional: MCP tool configuration
    title: "Human Readable Name",
    metadata: {
      examples: [/* examples */],
      useCases: [/* use cases */],
      warnings: [/* warnings */]
    }
  }
})
```

### @Instrumented Configuration

```typescript
@Instrumented(ttl) // Cache TTL in seconds

// Guidelines:
// 0 - No caching (state-changing operations)
// 10-30 - Short TTL (frequently changing data)
// 60-120 - Medium TTL (moderate change frequency) 
// 300-600 - Long TTL (stable data, validation)
```

### @Resilient Configuration

```typescript
@Resilient({
  rateLimit: { 
    limit: 100,        // Requests per window
    windowMs: 60000    // Window in milliseconds
  },
  timeout: 5000,       // Maximum execution time
  circuitBreaker: {
    threshold: 5,      // Failures before opening
    timeout: 30000,    // Time before retry
    fallback: () => ({ /* fallback response */ })
  }
})
```

## Redis Integration

### Key Patterns

All Redis keys follow the pattern `cb:{type}:{id}`:

```typescript
// Examples
await ctx.redis.hset(`cb:task:${taskId}`, data);
await ctx.redis.zadd(`cb:queue:tasks`, priority, taskId);
await ctx.redis.set(`cb:instance:${instanceId}`, status);
```

### Common Operations

```typescript
// Store hash data
await ctx.redis.hset(`cb:entity:${id}`, {
  field1: "value1",
  field2: "value2"
});

// Get hash data
const data = await ctx.redis.hgetall(`cb:entity:${id}`);

// Add to sorted set (queue)
await ctx.redis.zadd(`cb:queue:entities`, priority, id);

// Publish event
await ctx.redis.publish(`cb:events`, JSON.stringify(event));

// Add to stream
await ctx.redis.xadd(`cb:stream:events`, "*", "type", eventType, "data", JSON.stringify(data));
```

### Using Lua Scripts

For atomic operations, use Redis Lua scripts:

```typescript
import { redisScripts } from "@/core/redis-scripts";

// Example: Atomic task creation
const result = await redisScripts.createTask(
  taskId,
  text,
  priority,
  status,
  createdAt,
  metadata
);
```

## Database Integration

### PostgreSQL Persistence

When `persist: true` is set in `@EventHandler`:

```typescript
// Automatic persistence via ctx.persist flag
if (ctx.persist) {
  await ctx.prisma.myEntity.create({
    data: {
      id: entityId,
      name: input.name,
      // ... other fields
    }
  });
}
```

### Schema Definition

Define Prisma schemas in `/apps/server/prisma/schema/`:

```prisma
model MyEntity {
  id        String   @id
  name      String
  value     Int?
  metadata  Json?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  
  @@map("my_entities")
}
```

## Event Publishing

### Publishing Events

```typescript
// Publish domain event
await ctx.publish({
  type: "domain.action.completed",
  payload: {
    id: entityId,
    // ... event data
  },
  metadata: {
    createdBy: ctx.instanceId,
    timestamp: new Date().toISOString()
  }
});
```

### Event Types

- **Primary Events**: Match handler name (`task.create`)
- **Status Events**: Lifecycle updates (`task.created`, `task.completed`)
- **Error Events**: Failure notifications (`task.failed`)

## Testing Strategies

### Contract Tests

Test the handler interface and behavior:

```typescript
describe("Handler Contract", () => {
  it("should handle valid input", async () => {
    const result = await testClient.call("domain.action", validInput);
    expect(result).toMatchObject(expectedOutput);
  });

  it("should reject invalid input", async () => {
    await expect(testClient.call("domain.action", invalidInput)).rejects.toThrow();
  });
});
```

### Integration Tests

Test Redis and database integration:

```typescript
describe("Handler Integration", () => {
  it("should store data in Redis", async () => {
    await testClient.call("domain.action", input);
    const stored = await redis.hgetall(`cb:entity:${id}`);
    expect(stored.name).toBe(input.name);
  });
});
```

## Best Practices

### 1. Handler Design
- Keep handlers focused on a single responsibility
- Use descriptive event names following `domain.action` pattern
- Always validate input and output with Zod schemas
- Handle errors gracefully with meaningful messages

### 2. Performance
- Use appropriate cache TTLs in `@Instrumented`
- Set reasonable rate limits in `@Resilient`
- Use Redis Lua scripts for atomic operations
- Minimize database calls where possible

### 3. Error Handling
- Provide fallback responses in circuit breakers
- Use structured error messages
- Log errors with context for debugging
- Test error scenarios thoroughly

### 4. Testing
- Write contract tests for all handlers
- Test both success and failure cases
- Use integration tests for complex operations
- Mock external dependencies appropriately

### 5. Documentation
- Add clear descriptions to `@EventHandler`
- Provide MCP metadata with examples
- Document complex business logic
- Keep schema definitions up to date

## Common Patterns

### State-Changing Operations

```typescript
@Instrumented(0) // No caching
@Resilient({ rateLimit: { limit: 50, windowMs: 60000 } })
// Lower rate limits for operations that modify state
```

### Read Operations

```typescript
@Instrumented(300) // 5 minute cache
@Resilient({ rateLimit: { limit: 500, windowMs: 60000 } })
// Higher rate limits and caching for reads
```

### Validation Operations

```typescript
@Instrumented(600) // 10 minute cache
@Resilient({ rateLimit: { limit: 1000, windowMs: 60000 } })
// Long cache and high rate limits for validation
```

## Troubleshooting

### Common Issues

**Handler not registering**:
- Check import paths
- Verify handler is added to server registration
- Ensure decorator syntax is correct

**Schema validation failing**:
- Verify Zod schema definitions
- Check input/output type matching
- Test schema with sample data

**Redis connection issues**:
- Verify Redis is running
- Check key patterns follow `cb:` prefix
- Test Redis commands manually

**Rate limiting too restrictive**:
- Adjust limits in `@Resilient` decorator
- Consider different limits for different operations
- Monitor actual usage patterns

For more troubleshooting help, see the [Debugging Guide](debugging.md).