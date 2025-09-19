# Event Naming Conventions

Comprehensive guide to ClaudeBench's flat event hierarchy and naming conventions following the `domain.action` pattern.

## Core Principles

ClaudeBench uses a **flat event hierarchy** with consistent naming patterns:

1. **Flat Structure**: No nesting - all events at the same level
2. **Domain.Action Pattern**: `{domain}.{action}` format
3. **Lowercase with Underscores**: Use `snake_case` for multi-word actions
4. **Descriptive but Concise**: Clear purpose without being verbose
5. **Forward-Only Evolution**: Replace events instead of versioning

## Event Naming Format

### Basic Pattern
```
{domain}.{action}
```

### Examples
```typescript
"task.create"         // Create a new task
"task.update"         // Update existing task
"task.complete"       // Mark task as completed
"hook.pre_tool"       // Pre-tool validation hook
"system.health"       // System health check
"swarm.decompose"     // Decompose complex task
```

## Domain Categories

### Task Domain (`task.*`)

Primary task management operations:

| Event | Description | When Triggered |
|-------|-------------|----------------|
| `task.create` | New task created | Handler creates task |
| `task.update` | Task properties modified | Task data changes |
| `task.assign` | Task assigned to worker | Task gets assigned |
| `task.complete` | Task marked completed | Worker completes task |
| `task.claim` | Worker claims pending task | Worker requests work |
| `task.fail` | Task execution failed | Error during processing |

### System Domain (`system.*`)

System-level operations and monitoring:

| Event | Description | When Triggered |
|-------|-------------|----------------|
| `system.register` | Instance registration | New instance joins |
| `system.health` | Health check performed | Health endpoint called |
| `system.heartbeat` | Instance heartbeat | Periodic instance ping |
| `system.metrics` | Metrics collection | Metrics endpoint called |
| `system.get_state` | State retrieval | System state requested |

### Hook Domain (`hook.*`)

Tool execution hooks and validations:

| Event | Description | When Triggered |
|-------|-------------|----------------|
| `hook.pre_tool` | Pre-tool validation | Before tool execution |
| `hook.post_tool` | Post-tool processing | After tool execution |
| `hook.user_prompt` | User prompt processing | User interaction |
| `hook.todo_write` | Todo write processing | Todo list updates |

### Swarm Domain (`swarm.*`)

Swarm intelligence operations:

| Event | Description | When Triggered |
|-------|-------------|----------------|
| `swarm.decompose` | Task decomposition | Complex task breakdown |
| `swarm.assign` | Subtask assignment | Subtask to specialist |
| `swarm.resolve` | Conflict resolution | Conflicting solutions |
| `swarm.synthesize` | Solution synthesis | Combining results |
| `swarm.context` | Context generation | Specialist context |
| `swarm.create_project` | Project creation | New swarm project |

### MCP Domain (`mcp.*`)

Model Context Protocol operations:

| Event | Description | When Triggered |
|-------|-------------|----------------|
| `mcp.tool_call` | MCP tool invocation | External tool call |
| `mcp.resource_read` | Resource access | Resource requested |
| `mcp.prompt_get` | Prompt retrieval | Prompt template used |

## Event Lifecycle Patterns

### Primary Events vs Status Events

**Primary Events**: Handler actions (match handler names)
```typescript
"task.create"     // Primary: Creates task
"task.assign"     // Primary: Assigns task  
"task.complete"   // Primary: Completes task
```

**Status Events**: Lifecycle notifications (past tense)
```typescript
"task.created"    // Status: Task was created
"task.assigned"   // Status: Task was assigned
"task.completed"  // Status: Task was completed
```

### Error Events

Error events use the same domain with `.error` suffix:
```typescript
"task.create.error"     // Task creation failed
"system.health.error"   // Health check failed
"swarm.decompose.error" // Decomposition failed
```

## Event Payload Structure

### Standard Event Structure

```typescript
interface ClaudeBenchEvent {
  type: string;           // Event name (domain.action)
  payload: unknown;       // Event-specific data
  metadata?: {
    timestamp?: string;   // ISO timestamp
    instanceId?: string;  // Originating instance
    correlationId?: string; // Request tracking
    version?: string;     // Payload version
  };
}
```

### Example Event Payloads

**Task Creation Event**:
```typescript
{
  type: "task.created",
  payload: {
    id: "t-1726744215125",
    text: "Implement user authentication",
    priority: 85,
    status: "pending",
    createdAt: "2025-09-19T10:30:15.125Z"
  },
  metadata: {
    timestamp: "2025-09-19T10:30:15.127Z",
    instanceId: "server-1",
    correlationId: "req-abc123"
  }
}
```

**System Health Event**:
```typescript
{
  type: "system.health",
  payload: {
    status: "healthy",
    services: {
      redis: { status: "connected", latency: 2.5 },
      postgres: { status: "connected", connections: 5 }
    },
    handlers: { registered: 15, active: 15 }
  },
  metadata: {
    timestamp: "2025-09-19T10:30:20.000Z",
    instanceId: "server-1"
  }
}
```

**Swarm Decomposition Event**:
```typescript
{
  type: "swarm.decompose",
  payload: {
    taskId: "t-complex-123",
    subtasks: [
      {
        id: "st-1",
        specialist: "frontend",
        description: "Create user registration UI",
        dependencies: []
      },
      {
        id: "st-2", 
        specialist: "backend",
        description: "Implement authentication API",
        dependencies: []
      }
    ],
    totalSubtasks: 2
  },
  metadata: {
    timestamp: "2025-09-19T10:30:25.000Z",
    instanceId: "swarm-coordinator",
    correlationId: "swarm-decomp-456"
  }
}
```

## Handler to Event Mapping

### Automatic Event Generation

Handlers automatically generate events based on their configuration:

```typescript
@EventHandler({
  event: "task.create",  // Primary event name
  // ...
})
export class TaskCreateHandler {
  async handle(input, ctx) {
    // Handler logic...
    
    // Automatic status event publication
    await ctx.publish({
      type: "task.created",  // Status event (past tense)
      payload: { /* task data */ }
    });
    
    return result;
  }
}
```

### Custom Event Publication

Handlers can publish additional events:

```typescript
async handle(input, ctx) {
  try {
    const task = await createTask(input);
    
    // Primary status event
    await ctx.publish({
      type: "task.created",
      payload: task
    });
    
    // Additional domain events
    if (task.priority > 90) {
      await ctx.publish({
        type: "task.priority.high",
        payload: { taskId: task.id, priority: task.priority }
      });
    }
    
    return task;
  } catch (error) {
    // Error event
    await ctx.publish({
      type: "task.create.error",
      payload: { error: error.message, input }
    });
    
    throw error;
  }
}
```

## Event Subscription Patterns

### Redis Stream Keys

Events are published to Redis streams using domain-based keys:

```typescript
// Stream naming pattern
const streamKey = `cb:stream:${domain}`;

// Examples
"cb:stream:task"     // All task events
"cb:stream:system"   // All system events  
"cb:stream:hook"     // All hook events
"cb:stream:swarm"    // All swarm events
```

### Event Filtering

Subscribe to specific event patterns:

```typescript
// Subscribe to all task events
await redis.xread("STREAMS", "cb:stream:task", "$");

// Filter specific events in application code
const taskCreateEvents = events.filter(e => e.type === "task.created");

// Subscribe to multiple domains
await redis.xread("STREAMS", 
  "cb:stream:task", "$",
  "cb:stream:system", "$"
);
```

## Naming Best Practices

### 1. Use Clear Domains

**Good**:
```typescript
"task.create"      // Clear domain
"system.health"    // Obvious system operation
"hook.pre_tool"    // Hook with specific timing
```

**Avoid**:
```typescript
"create.task"      // Action-first (confusing)
"task.new"         // Ambiguous action
"t.create"         // Abbreviated domain
```

### 2. Use Standard Actions

**Common Actions**:
- `create` - Create new entity
- `update` - Modify existing entity
- `delete` - Remove entity
- `get` - Retrieve entity
- `list` - Get multiple entities
- `assign` - Associate entities
- `complete` - Finish operation
- `fail` - Operation failed

**Specialized Actions**:
- `claim` - Worker claims task
- `decompose` - Break down complex task
- `synthesize` - Combine results
- `validate` - Check validity
- `process` - Generic processing

### 3. Be Consistent Across Domains

Use same action names across domains when possible:

```typescript
"task.create"      // Create task
"instance.create"  // Create instance  
"project.create"   // Create project

"task.update"      // Update task
"instance.update"  // Update instance
"project.update"   // Update project
```

### 4. Use Descriptive Multi-word Actions

For complex actions, use underscores:

```typescript
"hook.pre_tool"     // Before tool execution
"hook.post_tool"    // After tool execution
"swarm.create_project" // Create swarm project
"task.claim_batch"  // Claim multiple tasks
```

## Event Evolution Strategy

### Forward-Only Evolution

Replace events instead of versioning:

**Instead of versioning**:
```typescript
"task.create.v1"   // ❌ Don't version events
"task.create.v2"   
```

**Replace with new events**:
```typescript
"task.create"      // Old event
"task.create_enhanced" // New event with additional features
```

### Deprecation Process

1. **Add new event** alongside old event
2. **Update handlers** to publish both events  
3. **Migrate consumers** to new event
4. **Remove old event** after migration

```typescript
// Transition period - publish both
await ctx.publish({ type: "task.created", payload: basicData });
await ctx.publish({ type: "task.created_enhanced", payload: enhancedData });
```

## Event Monitoring

### Event Metrics

Track event patterns for system health:

```typescript
// Event publication rates
"cb:metrics:events:task.created:rate"
"cb:metrics:events:system.health:count"
"cb:metrics:events:swarm.decompose:duration"

// Error rates
"cb:metrics:events:task.create.error:rate"
"cb:metrics:events:system.health.error:count"
```

### Event Debugging

Use the relay to monitor event flow:

```bash
# Monitor all events
bun relay

# Filter by domain
bun relay --filter="task.*"

# Filter by specific event
bun relay --filter="task.created"

# Monitor error events
bun relay --filter="*.error"
```

## Common Anti-Patterns

### ❌ Avoid These Patterns

**Nested Domains**:
```typescript
"task.management.create"  // ❌ Too nested
"user.profile.update"     // ❌ Unnecessary nesting
```

**Unclear Actions**:
```typescript
"task.do"        // ❌ Vague action
"task.handle"    // ❌ Non-specific
"task.process"   // ❌ Generic (unless truly generic)
```

**Inconsistent Naming**:
```typescript
"task.create"    // ✅ Good
"taskUpdate"     // ❌ Different format
"task-delete"    // ❌ Hyphen instead of dot
```

**Action-First Naming**:
```typescript
"create.task"    // ❌ Action first
"update.system"  // ❌ Confusing hierarchy
```

## Implementation Checklist

When implementing new events:

- [ ] Use `domain.action` format
- [ ] Choose appropriate domain from standard set
- [ ] Use standard action names when possible
- [ ] Include both primary and status events
- [ ] Define clear payload structure
- [ ] Add metadata for tracing
- [ ] Document in handler `@EventHandler` decorator
- [ ] Add to event monitoring
- [ ] Test event publication and consumption
- [ ] Update this guide if adding new patterns

## Event Registry

Maintain a registry of all events for reference:

```typescript
// events/registry.ts
export const EVENTS = {
  TASK: {
    CREATE: "task.create",
    CREATED: "task.created", 
    UPDATE: "task.update",
    UPDATED: "task.updated",
    ASSIGN: "task.assign",
    ASSIGNED: "task.assigned",
    COMPLETE: "task.complete",
    COMPLETED: "task.completed"
  },
  SYSTEM: {
    REGISTER: "system.register",
    REGISTERED: "system.registered",
    HEALTH: "system.health",
    HEARTBEAT: "system.heartbeat",
    METRICS: "system.metrics"
  }
  // ... etc
} as const;

// Type-safe event names
export type EventName = typeof EVENTS[keyof typeof EVENTS][keyof typeof EVENTS[keyof typeof EVENTS]];
```

This ensures consistency and provides IDE autocompletion for event names.