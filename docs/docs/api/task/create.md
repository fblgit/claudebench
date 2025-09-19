---
sidebar_position: 1
title: task.create
description: Create a new task in the ClaudeBench system
---

# task.create

Create a new task and add it to the queue.

## Request

### Method
`task.create`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | ✓ | Task description (1-500 chars) |
| `priority` | integer | ✗ | Priority level (0-100, default: 50) |
| `metadata` | object | ✗ | Additional task metadata |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.create",
  "params": {
    "text": "Review and optimize database queries",
    "priority": 75,
    "metadata": {
      "category": "optimization",
      "estimated_hours": 3
    }
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
    "id": "t-1234567890",
    "text": "Review and optimize database queries",
    "status": "pending",
    "priority": 75,
    "metadata": {
      "category": "optimization",
      "estimated_hours": 3
    },
    "createdAt": "2025-01-19T10:30:00Z"
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
      "validation": "Text must be between 1 and 500 characters"
    }
  },
  "id": "req-001"
}
```

## Event Emission

When a task is successfully created, the following event is emitted:

```json
{
  "type": "task.created",
  "payload": {
    "id": "t-1234567890",
    "text": "Review and optimize database queries",
    "status": "pending",
    "priority": 75,
    "createdAt": "2025-01-19T10:30:00Z"
  },
  "metadata": {
    "createdBy": "worker-1"
  },
  "timestamp": 1758271800000
}
```

## Notes

- Tasks are created in `pending` status and must be explicitly claimed or assigned
- Priority values range from 0-100 (higher = more important)
- Large metadata objects may impact performance
- The task ID follows the pattern `t-{timestamp}`

## Related

- [task.claim](./claim) - Claim a pending task
- [task.update](./update) - Update task details
- [task.complete](./complete) - Mark task as completed
- [task.list](./list) - List tasks with filters