---
sidebar_position: 20
title: Migrating to task.decompose
description: Guide for migrating from swarm.decompose to task.decompose
---

# Migrating from swarm.decompose to task.decompose

This guide helps you migrate from the old `swarm.decompose` handler to the new `task.decompose` handler, which provides better domain alignment and improved functionality.

## Why Migrate?

The new `task.decompose` handler offers several advantages:

1. **Better Domain Alignment**: Tasks decomposing into subtasks is more intuitive than swarm operations
2. **Attachment-Based Storage**: Leverages the unified attachment system instead of separate tables
3. **Enhanced Session Support**: Full session-aware workflow tracking
4. **Improved Event Model**: Granular events for better observability
5. **Redis Integration**: Fast caching with automatic expiration

## Quick Migration Checklist

- [ ] Update event name from `swarm.decompose` to `task.decompose`
- [ ] Add `sessionId` parameter for better tracking
- [ ] Update event listeners for new event types
- [ ] Migrate data retrieval to use attachment API
- [ ] Update error handling for new error codes

## API Changes

### Request Parameters

| Parameter | swarm.decompose | task.decompose | Notes |
|-----------|----------------|----------------|--------|
| `taskId` | ✓ Required | ✓ Required | No change |
| `task` | ✓ Required | ✓ Required | No change |
| `priority` | ✓ Optional | ✓ Optional | No change |
| `constraints` | ✓ Optional | ✓ Optional | No change |
| `sessionId` | ✗ Not supported | ✓ Optional | **New** - Recommended for tracking |
| `metadata` | ✗ Not supported | ✓ Optional | **New** - Additional context |

### Response Structure

The response structure remains largely the same, with one addition:

```javascript
// New field in task.decompose response
{
  // ... existing fields ...
  "attachmentKey": "decomposition_1734567890123"  // New field
}
```

## Code Migration Examples

### Basic Usage

```javascript
// Before (swarm.decompose)
const result = await client.call('swarm.decompose', {
  taskId: 't-123',
  task: 'Build dashboard feature',
  priority: 75
});

// After (task.decompose)
const result = await client.call('task.decompose', {
  taskId: 't-123',
  task: 'Build dashboard feature',
  priority: 75,
  sessionId: sessionManager.getCurrentSession()  // Recommended
});
```

### With Constraints

```javascript
// Before (swarm.decompose)
const result = await client.call('swarm.decompose', {
  taskId: 't-456',
  task: 'Add authentication',
  constraints: ['Use OAuth2', 'Support MFA']
});

// After (task.decompose)
const result = await client.call('task.decompose', {
  taskId: 't-456',
  task: 'Add authentication',
  constraints: ['Use OAuth2', 'Support MFA'],
  sessionId: sessionId,
  metadata: {
    requester: 'user-123',
    project: 'main-app'
  }
});
```

## Event Handling Migration

### Old Event Model

```javascript
// swarm.decompose published single event
eventBus.on('swarm.decomposed', (event) => {
  console.log(`Task ${event.taskId} decomposed into ${event.subtaskCount} subtasks`);
});
```

### New Event Model

```javascript
// task.decompose publishes multiple events
eventBus.on('task.decomposed', (event) => {
  const { taskId, subtaskCount, attachmentKey } = event.payload;
  console.log(`Task ${taskId} decomposed into ${subtaskCount} subtasks`);
  console.log(`Decomposition stored as attachment: ${attachmentKey}`);
});

eventBus.on('task.subtask.ready', (event) => {
  const { subtaskId, specialist } = event.payload;
  console.log(`Subtask ${subtaskId} ready for ${specialist}`);
});
```

## Data Retrieval Migration

### Old Method (Database Tables)

```javascript
// Direct database access (no longer supported)
const decomposition = await prisma.taskDecomposition.findUnique({
  where: { taskId: 't-123' },
  include: { subtasks: true }
});
```

### New Method (Attachments)

```javascript
// Method 1: Using attachment key from response
const attachment = await client.call('task.get_attachment', {
  taskId: 't-123',
  key: result.attachmentKey
});

// Method 2: Finding all decompositions
const attachments = await client.call('task.list_attachments', {
  taskId: 't-123',
  type: 'json'
});

const decompositions = attachments.attachments
  .filter(a => a.key.startsWith('decomposition_'))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

const latestDecomposition = decompositions[0];
```

## Redis Cache Access

The new handler stores decomposition data in Redis for quick access:

```javascript
// Direct Redis access (if needed)
const redis = getRedis();
const decompositionData = await redis.hgetall(`cb:decomposition:${taskId}`);

// Individual subtask data
const subtaskData = await redis.hgetall(`cb:subtask:${subtaskId}`);
```

## Error Handling Updates

### New Error Codes

| Error Scenario | Old Code | New Code | Description |
|----------------|----------|----------|-------------|
| Task not found | -32602 | -32602 | No change |
| No session | N/A | -32603 | Session required for sampling |
| Storage failure | -32000 | -32000 | No change |

### Error Handling Example

```javascript
try {
  const result = await client.call('task.decompose', params);
} catch (error) {
  switch (error.code) {
    case -32602:
      console.error('Task not found');
      break;
    case -32603:
      console.error('Session ID required');
      // Retry with session
      params.sessionId = await createSession();
      break;
    case -32000:
      console.error('Storage failure - check attachment system');
      break;
  }
}
```

## Session Management Best Practices

The new handler emphasizes session-aware operations:

```javascript
class TaskManager {
  constructor() {
    this.sessionId = null;
  }
  
  async initializeSession() {
    // Create or retrieve session
    this.sessionId = await client.call('session.create', {
      metadata: { type: 'task-decomposition' }
    });
  }
  
  async decomposeTask(taskId, description, constraints) {
    if (!this.sessionId) {
      await this.initializeSession();
    }
    
    return await client.call('task.decompose', {
      taskId,
      task: description,
      constraints,
      sessionId: this.sessionId  // Always include session
    });
  }
}
```

## Performance Considerations

### Caching Strategy

The new handler implements Redis caching with 7-day expiration:

```javascript
// Cache-aware retrieval
async function getDecomposition(taskId) {
  // Try Redis cache first
  const cached = await redis.hgetall(`cb:decomposition:${taskId}`);
  
  if (cached && cached.taskId) {
    return JSON.parse(cached.data);
  }
  
  // Fall back to attachment system
  const attachments = await client.call('task.list_attachments', {
    taskId,
    type: 'json'
  });
  
  return attachments.attachments
    .find(a => a.key.startsWith('decomposition_'));
}
```

## Testing Your Migration

### Unit Tests

```javascript
describe('task.decompose migration', () => {
  it('should handle task decomposition with session', async () => {
    const result = await client.call('task.decompose', {
      taskId: 't-test-123',
      task: 'Test task',
      sessionId: 'test-session'
    });
    
    expect(result).toHaveProperty('attachmentKey');
    expect(result.attachmentKey).toMatch(/^decomposition_\d+$/);
  });
  
  it('should publish correct events', async () => {
    const events = [];
    eventBus.on('task.decomposed', e => events.push(e));
    eventBus.on('task.subtask.ready', e => events.push(e));
    
    await client.call('task.decompose', {
      taskId: 't-test-456',
      task: 'Complex task'
    });
    
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'task.decomposed' })
    );
  });
});
```

## Rollback Plan

If you need to temporarily rollback:

1. **Dual Support Period**: Both handlers can coexist during migration
2. **Event Bridge**: Create a bridge to translate between event formats
3. **Data Sync**: Keep data synchronized during transition

```javascript
// Temporary bridge during migration
eventBus.on('task.decomposed', async (event) => {
  // Emit legacy event for backward compatibility
  eventBus.emit('swarm.decomposed', {
    taskId: event.payload.taskId,
    subtaskCount: event.payload.subtaskCount
  });
});
```

## Migration Timeline

### Phase 1: Preparation (Week 1)
- Review existing swarm.decompose usage
- Identify all consumers of decomposition events
- Plan session management strategy

### Phase 2: Implementation (Week 2)
- Update code to use task.decompose
- Add session management
- Update event handlers

### Phase 3: Testing (Week 3)
- Run parallel tests with both handlers
- Verify data consistency
- Performance testing

### Phase 4: Cutover (Week 4)
- Switch production traffic to task.decompose
- Monitor for issues
- Deprecate swarm.decompose

## Getting Help

If you encounter issues during migration:

1. Check the [task.decompose API documentation](../api/task/decompose.md)
2. Review the [attachment system guide](../api/attachments.md)
3. Consult the [session management documentation](../api/session/index.md)
4. Report issues in the GitHub repository

## Summary

The migration from `swarm.decompose` to `task.decompose` is straightforward:

1. ✅ Update the event name
2. ✅ Add session management
3. ✅ Update event handlers for new events
4. ✅ Switch to attachment-based data retrieval
5. ✅ Test thoroughly before full migration

The new handler provides better performance, cleaner architecture, and improved observability while maintaining backward compatibility during the transition period.