---
sidebar_position: 2
title: task.claim
description: Worker claims next available task (pull model)
---

# task.claim

Worker claims next available task (pull model). This is the primary method for workers to obtain tasks in the distributed ClaudeBench system.

## Request

### Method
`task.claim`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `workerId` | string | ✓ | Unique identifier for the worker instance |
| `maxTasks` | integer | ✗ | Maximum number of tasks to claim (1-10, default: 1) |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.claim",
  "params": {
    "workerId": "worker-001",
    "maxTasks": 1
  },
  "id": "req-002"
}
```

## Response

### Success Response (Task Available)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "claimed": true,
    "taskId": "t-1234567890",
    "task": {
      "id": "t-1234567890",
      "text": "Review and optimize database queries",
      "priority": 75,
      "status": "in_progress",
      "assignedTo": "worker-001",
      "metadata": {
        "category": "optimization",
        "estimated_hours": 3
      },
      "result": null,
      "error": null,
      "createdAt": "2025-01-19T10:30:00Z",
      "updatedAt": "2025-01-19T10:35:00Z",
      "completedAt": null
    }
  },
  "id": "req-002"
}
```

### Success Response (No Tasks Available)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "claimed": false
  },
  "id": "req-002"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Worker not registered: worker-001",
    "data": {
      "validation": "Worker must be registered and active"
    }
  },
  "id": "req-002"
}
```

## Event Emission

When a task is successfully claimed, the following event is emitted:

```json
{
  "type": "task.claimed",
  "payload": {
    "taskId": "t-1234567890",
    "workerId": "worker-001"
  },
  "metadata": {
    "claimedAt": "2025-01-19T10:35:00Z"
  },
  "timestamp": 1758272100000
}
```

## Notes

- Workers must be registered and active to claim tasks
- Claiming is atomic and handled via Redis Lua scripts
- Workers cannot claim tasks if their status is "OFFLINE" or "unhealthy"
- Tasks are automatically set to "in_progress" status when claimed
- The system includes circuit breaker protection with fallback handling
- Rate limited to 100 claims per minute per worker

## Related

- [task.create](./create.md) - Create a new task
- [task.complete](./complete.md) - Mark task as completed
- [task.update](./update.md) - Update task details
- [task.list](./list.md) - List tasks with filters