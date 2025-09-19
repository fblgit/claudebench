---
sidebar_position: 4
title: task.complete
description: Mark a task as completed or failed
---

# task.complete

Mark a task as completed or failed with optional result data. This method finalizes task execution and can store comprehensive results.

## Request

### Method
`task.complete`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | ✗* | Task ID (either `id` or `taskId` required) |
| `taskId` | string | ✗* | Task ID (alternative to `id`) |
| `workerId` | string | ✗ | Worker ID for tracking completion |
| `result` | any | ✗ | Result data (JSON, string, or any structure) |

*Either `id` or `taskId` must be provided.

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.complete",
  "params": {
    "id": "t-1234567890",
    "workerId": "worker-001",
    "result": {
      "documentsReviewed": 15,
      "issuesFound": 3,
      "timeSpent": "2h 30m",
      "optimizations": [
        "Added index on user_id column",
        "Optimized JOIN query in reports",
        "Reduced connection pool size"
      ]
    }
  },
  "id": "req-004"
}
```

### Simple Completion Example

```json
{
  "jsonrpc": "2.0",
  "method": "task.complete",
  "params": {
    "taskId": "t-1234567890"
  },
  "id": "req-005"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "t-1234567890",
    "status": "completed",
    "completedAt": "2025-01-19T12:45:00Z"
  },
  "id": "req-004"
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
  "id": "req-004"
}
```

## Event Emission

When a task is successfully completed, the following event is emitted:

```json
{
  "type": "task.completed",
  "payload": {
    "id": "t-1234567890",
    "status": "completed",
    "duration": 8700000
  },
  "metadata": {
    "completedBy": "worker-001"
  },
  "timestamp": 1758280500000
}
```

## Notes

### Prerequisites
- Task must exist and be in 'pending' or 'in_progress' status
- User must be the assigned worker or have admin privileges

### Warnings
- Tasks must be assigned before they can be completed
- Only assigned workers can complete their own tasks
- This action cannot be undone - use task.update to change status instead
- Large result objects are stored in PostgreSQL and may impact performance

### Additional Features
- Automatic duration calculation from task creation to completion
- Result data is stored in dedicated PostgreSQL field (up to 1GB)
- Graceful error handling for database persistence failures
- Atomic completion via Redis Lua scripts
- Rate limited to 100 requests per minute

## Related

- [task.create](./create.md) - Create a new task
- [task.claim](./claim.md) - Claim a pending task
- [task.update](./update.md) - Update task details
- [task.list](./list.md) - List tasks with filters