---
sidebar_position: 6
title: task.assign
description: Assign a task to an instance (backward compatibility)
---

# task.assign

Assign a task to a specific instance. This method provides backward compatibility with push-model task assignment while the system primarily uses the pull model (task.claim).

## Request

### Method
`task.assign`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | ID of the task to assign |
| `instanceId` | string | ✓ | ID of the instance/worker to assign the task to |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.assign",
  "params": {
    "taskId": "t-1234567890",
    "instanceId": "worker-001"
  },
  "id": "req-008"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "taskId": "t-1234567890",
    "instanceId": "worker-001",
    "assignedAt": "2025-01-19T10:45:00Z"
  },
  "id": "req-008"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Task t-1234567890 is already assigned to worker-002.",
    "data": {
      "taskId": "t-1234567890",
      "currentAssignment": "worker-002"
    }
  },
  "id": "req-008"
}
```

## Event Emission

When a task is successfully assigned, the following event is emitted:

```json
{
  "type": "task.assigned",
  "payload": {
    "taskId": "t-1234567890",
    "instanceId": "worker-001",
    "previousAssignment": null
  },
  "metadata": {
    "assignedBy": "instance-1"
  },
  "timestamp": 1758272700000
}
```

## Notes

### Backward Compatibility
This handler maintains backward compatibility with existing contracts and tests while the system primarily uses the pull model. It actually assigns the task rather than just suggesting it to maintain expected behavior.

### Prerequisites
- Task must exist and not be already assigned
- Instance must be registered and active
- Instance status cannot be "OFFLINE" or "unhealthy"

### Behavior
- Task is removed from the pending queue
- Task is added to the instance's specific queue
- Task status remains "pending" per contract requirements
- Assignment history is tracked in Redis
- Instance metrics are updated

### Limitations
- Rate limited to 20 requests per minute
- Cannot reassign already assigned tasks
- Requires explicit unassignment before reassigning

### Data Storage
- Assignment data stored in both Redis and PostgreSQL (if configured)
- History tracking in Redis for audit purposes
- Instance metrics updated for monitoring

## Related

- [task.create](./create) - Create a new task
- [task.claim](./claim) - Claim a pending task (preferred method)
- [task.update](./update) - Update task details
- [task.complete](./complete) - Mark task as completed