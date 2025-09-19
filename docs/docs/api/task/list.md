---
sidebar_position: 5
title: task.list
description: List and filter tasks with pagination and sorting
---

# task.list

List and filter tasks from PostgreSQL with pagination and sorting capabilities. This method provides comprehensive task querying functionality.

## Request

### Method
`task.list`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `status` | string | ✗ | Filter by status: "pending", "in_progress", "completed", "failed" |
| `assignedTo` | string | ✗ | Filter by assigned worker/instance ID |
| `priority` | integer | ✗ | Filter by exact priority (0-100) |
| `limit` | integer | ✗ | Maximum number of tasks to return (1-1000, default: 100) |
| `offset` | integer | ✗ | Number of tasks to skip (default: 0) |
| `orderBy` | string | ✗ | Sort field: "createdAt", "updatedAt", "priority", "status", "assignedTo" (default: "createdAt") |
| `order` | string | ✗ | Sort direction: "asc" or "desc" (default: "desc") |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.list",
  "params": {
    "status": "in_progress",
    "orderBy": "priority",
    "order": "desc",
    "limit": 25,
    "offset": 0
  },
  "id": "req-006"
}
```

### Example Request (All Tasks)

```json
{
  "jsonrpc": "2.0",
  "method": "task.list",
  "params": {},
  "id": "req-007"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "tasks": [
      {
        "id": "t-1234567890",
        "text": "Review and optimize database queries",
        "status": "in_progress",
        "priority": 85,
        "assignedTo": "worker-001",
        "metadata": {
          "category": "optimization",
          "progress": "50%"
        },
        "result": null,
        "error": null,
        "createdAt": "2025-01-19T10:30:00Z",
        "updatedAt": "2025-01-19T10:40:00Z",
        "completedAt": null,
        "attachmentCount": 2
      },
      {
        "id": "t-1234567891",
        "text": "Update API documentation",
        "status": "in_progress",
        "priority": 75,
        "assignedTo": "worker-002",
        "metadata": {
          "category": "documentation"
        },
        "result": null,
        "error": null,
        "createdAt": "2025-01-19T11:00:00Z",
        "updatedAt": "2025-01-19T11:05:00Z",
        "completedAt": null,
        "attachmentCount": 0
      }
    ],
    "totalCount": 47,
    "hasMore": true
  },
  "id": "req-006"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32500,
    "message": "Database query failed",
    "data": {
      "reason": "Connection timeout"
    }
  },
  "id": "req-006"
}
```

## Response Fields

### Task Object Properties

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique task identifier |
| `text` | string | Task description |
| `status` | string | Current status |
| `priority` | integer | Priority level (0-100) |
| `assignedTo` | string\|null | Assigned worker/instance ID |
| `metadata` | object\|null | Additional task data |
| `result` | any\|null | Task completion result |
| `error` | string\|null | Error message if failed |
| `createdAt` | string | ISO datetime of creation |
| `updatedAt` | string | ISO datetime of last update |
| `completedAt` | string\|null | ISO datetime of completion |
| `attachmentCount` | integer | Number of attachments (from Redis) |

### Pagination Properties

| Field | Type | Description |
|-------|------|-------------|
| `totalCount` | integer | Total number of matching tasks |
| `hasMore` | boolean | Whether more results are available |

## Notes

- Data is fetched from PostgreSQL for consistency
- Attachment counts are retrieved from Redis for performance
- Circuit breaker protection with fallback (returns empty list)
- Rate limited to 100 requests per minute
- Supports complex filtering and sorting combinations
- Efficient parallel queries for count and data retrieval

## Examples

### Filter by Status and Priority
```json
{
  "status": "pending",
  "priority": 90,
  "limit": 10
}
```

### Recent Completed Tasks
```json
{
  "status": "completed",
  "orderBy": "completedAt",
  "order": "desc",
  "limit": 50
}
```

### Tasks by Worker
```json
{
  "assignedTo": "worker-001",
  "orderBy": "updatedAt",
  "order": "asc"
}
```

## Related

- [task.create](./create) - Create a new task
- [task.claim](./claim) - Claim a pending task
- [task.update](./update) - Update task details
- [task.complete](./complete) - Mark task as completed