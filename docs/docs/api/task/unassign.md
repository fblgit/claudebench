---
sidebar_position: 7
title: task.unassign
description: Remove assignment from a task
---

# task.unassign

Remove the current assignment from a task and return it to the pending queue. This allows the task to be claimed by another worker or reassigned manually.

## Request

### Method
`task.unassign`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | ID of the task to unassign |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.unassign",
  "params": {
    "taskId": "t-1234567890"
  },
  "id": "req-009"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "taskId": "t-1234567890",
    "previousAssignment": "worker-001",
    "unassignedAt": "2025-01-19T10:50:00Z"
  },
  "id": "req-009"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Task t-1234567890 is not currently assigned",
    "data": {
      "taskId": "t-1234567890"
    }
  },
  "id": "req-009"
}
```

## Event Emission

When a task is successfully unassigned, the following event is emitted:

```json
{
  "type": "task.unassigned",
  "payload": {
    "taskId": "t-1234567890",
    "previousAssignment": "worker-001"
  },
  "metadata": {
    "unassignedBy": "instance-1",
    "unassignedAt": "2025-01-19T10:50:00Z"
  },
  "timestamp": 1758273000000
}
```

## Notes

### Prerequisites
- Task must exist in the system
- Task must be currently assigned
- Task status cannot be "completed" or "failed"

### Behavior
- Removes assignment fields from task data
- Updates task status back to "pending"
- Returns task to pending queue with original priority
- Removes task from instance-specific queue
- Tracks unassignment in history
- Decrements instance task count metrics

### Priority Handling
Tasks are returned to the pending queue with their original priority value. The queue score is calculated as:
```
score = current_timestamp - (priority * 1000)
```
This ensures higher priority tasks (higher numeric value) get lower scores and are processed first.

### Limitations
- Rate limited to 20 requests per minute
- Cannot unassign completed or failed tasks
- Cannot unassign tasks that are not currently assigned

### Data Storage
- Assignment removal stored in both Redis and PostgreSQL (if configured)
- History tracking in Redis for audit purposes
- Instance metrics updated for monitoring

## Use Cases

1. **Worker Failure Recovery**: When a worker goes offline, unassign its tasks so they can be claimed by healthy workers
2. **Task Rebalancing**: Redistribute tasks across workers for load balancing
3. **Manual Intervention**: Admin needs to reassign a stuck or incorrectly assigned task
4. **Priority Changes**: Unassign and update priority when task urgency changes

## Related

- [task.assign](./assign) - Assign a task to a specific instance
- [task.claim](./claim) - Claim a pending task (preferred method)
- [task.update](./update) - Update task details
- [task.complete](./complete) - Mark task as completed
- [task.list](./list) - List and filter tasks