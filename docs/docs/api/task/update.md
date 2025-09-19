---
sidebar_position: 3
title: task.update
description: Update an existing task
---

# task.update

Update an existing task with new properties. This method allows partial updates to task fields.

## Request

### Method
`task.update`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | ✓ | Task ID to update |
| `updates` | object | ✓ | Object containing fields to update |
| `updates.text` | string | ✗ | Task description (1-500 chars) |
| `updates.status` | string | ✗ | Task status: "pending", "in_progress", "completed", "failed" |
| `updates.priority` | integer | ✗ | Priority level (0-100) |
| `updates.metadata` | object | ✗ | Additional task metadata (merged with existing) |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.update",
  "params": {
    "id": "t-1234567890",
    "updates": {
      "status": "in_progress",
      "priority": 85,
      "metadata": {
        "progress": "50%",
        "notes": "Started optimization work"
      }
    }
  },
  "id": "req-003"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "t-1234567890",
    "text": "Review and optimize database queries",
    "status": "in_progress",
    "priority": 85,
    "createdAt": "2025-01-19T10:30:00Z",
    "updatedAt": "2025-01-19T10:40:00Z"
  },
  "id": "req-003"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Task not found: t-1234567890",
    "data": {
      "taskId": "t-1234567890"
    }
  },
  "id": "req-003"
}
```

## Event Emission

When a task is successfully updated, the following event is emitted:

```json
{
  "type": "task.updated",
  "payload": {
    "id": "t-1234567890",
    "text": "Review and optimize database queries",
    "status": "in_progress",
    "priority": 85,
    "createdAt": "2025-01-19T10:30:00Z",
    "updatedAt": "2025-01-19T10:40:00Z"
  },
  "metadata": {
    "updatedBy": "instance-1",
    "changes": ["status", "priority", "metadata"]
  },
  "timestamp": 1758272400000
}
```

## Notes

- Only provided fields in `updates` object will be modified
- Metadata is merged with existing metadata, not replaced entirely
- Task queue position is automatically adjusted when priority changes
- Updates are atomic and handled via Redis Lua scripts
- Rate limited to 20 requests per minute
- Persistence to PostgreSQL is configurable via handler settings

## Related

- [task.create](./create.md) - Create a new task
- [task.claim](./claim.md) - Claim a pending task
- [task.complete](./complete.md) - Mark task as completed
- [task.list](./list.md) - List tasks with filters