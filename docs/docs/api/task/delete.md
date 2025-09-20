---
sidebar_position: 15
title: task.delete
description: Delete a task from the ClaudeBench system
---

# task.delete

Permanently delete a task from both Redis and PostgreSQL storage.

## Overview

The `task.delete` handler provides atomic deletion of tasks from the ClaudeBench system. It removes the task from Redis (including all queues and metrics), deletes associated attachments, and if persistence is enabled, removes the task from PostgreSQL storage.

## Request

### Method
`task.delete`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | ✓ | The ID of the task to delete |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.delete",
  "params": {
    "id": "t-123456"
  },
  "id": "req-001"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "t-123456",
    "deleted": true,
    "deletedAt": "2025-01-20T10:30:00.000Z"
  },
  "id": "req-001"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "error": "Failed to delete task"
    }
  },
  "id": "req-001"
}
```

## Event Emission

When a task is successfully deleted, the following event is emitted:

```json
{
  "type": "task.deleted",
  "payload": {
    "id": "t-123456",
    "deletedAt": "2025-01-20T10:30:00.000Z",
    "deletedBy": "worker-1"
  },
  "metadata": {
    "instanceId": "worker-1",
    "eventId": "evt-789012"
  }
}
```

## Deletion Process

The deletion process follows this sequence:

1. **Redis Deletion (Atomic via Lua Script)**:
   - Remove task hash from `cb:task:{taskId}`
   - Remove from pending queue `cb:queue:tasks`
   - Remove from priority queue `cb:queue:priority`
   - Remove from worker-specific queues
   - Clean up any task-related metrics
   - Delete task attachments from Redis

2. **PostgreSQL Deletion (if persistence enabled)**:
   - Delete all task attachments (foreign key constraint)
   - Delete the task record
   - Cascading deletes for related data

3. **Event Publishing**:
   - Emit `task.deleted` event for system observers

## Atomic Operations

The Redis deletion is performed atomically using the `deleteTask` Lua script, ensuring:
- All task-related data is removed in a single operation
- No partial deletion states
- Consistent state across all Redis data structures
- Queue integrity is maintained

## Error Handling

- If the task doesn't exist in Redis, an error is thrown
- PostgreSQL deletion failures are logged but don't fail the operation (Redis is the source of truth)
- The handler ensures Redis consistency even if PostgreSQL operations fail

## Warnings

⚠️ **This action cannot be undone** - Once deleted, the task and all its associated data are permanently removed

⚠️ **All task attachments will be deleted** - Including generated context, results, and any stored data

⚠️ **Task will be removed from all queues** - Active assignments will be terminated

## Prerequisites

- Task must exist in the system
- User must have appropriate permissions to delete tasks
- No active locks on the task (e.g., not currently being processed)

## Use Cases

1. **Cleanup Completed Tasks**: Remove successfully completed tasks to free up storage
2. **Remove Failed Tasks**: Delete permanently failed tasks after investigation
3. **Cancel Mistaken Tasks**: Remove tasks created in error
4. **Data Management**: Regular cleanup of old tasks as part of maintenance
5. **Privacy Compliance**: Delete tasks containing sensitive data when required

## Performance Considerations

- Atomic Redis deletion ensures minimal lock time
- PostgreSQL cascading deletes may take longer for tasks with many attachments
- Event emission is asynchronous and doesn't block the deletion

## Best Practices

1. **Verify Before Deletion**: Always confirm the task ID before deletion
2. **Check Dependencies**: Ensure no other tasks depend on the task being deleted
3. **Archive if Needed**: Consider archiving important task data before deletion
4. **Batch Deletions**: For multiple deletions, consider implementing batch operations
5. **Monitor Events**: Subscribe to `task.deleted` events for audit trails

## Integration Points

- **Redis Scripts**: Uses `redisScripts.deleteTask()` for atomic deletion
- **Prisma ORM**: Handles PostgreSQL cascading deletes
- **Event Bus**: Publishes deletion events for system-wide notification
- **Attachment System**: Automatically cleans up all task attachments

## Notes

- The task ID follows the pattern `t-{timestamp}`
- Deletion is irreversible - implement soft deletes if recovery is needed
- Redis is the source of truth - PostgreSQL deletion failures are non-fatal
- The handler does not implement caching as deletions should always execute

## Related

- [task.create](./create) - Create a new task
- [task.update](./update) - Update task details
- [task.list](./list) - List tasks before deletion
- [task.create_attachment](./create_attachment) - Attachments that will be deleted
- [task.get_attachment](./get_attachment) - Retrieve attachments before deletion