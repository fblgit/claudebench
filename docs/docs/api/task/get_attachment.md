---
sidebar_position: 8
title: task.get_attachment
description: Get a specific task attachment by key
---

# task.get_attachment

Get a specific task attachment by its key. This method retrieves attachment data with automatic caching and fallback mechanisms.

> 📚 **See Also**: [Attachments System Overview](../attachments) for comprehensive documentation on the attachment system, migration guide, and best practices.

## Request

### Method
`task.get_attachment`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | ID of the task containing the attachment |
| `key` | string | ✓ | Unique key of the attachment to retrieve |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.get_attachment",
  "params": {
    "taskId": "t-1234567890",
    "key": "analysis"
  },
  "id": "req-012"
}
```

## Response

### Success Response (JSON Attachment)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "ta-1758272800000-x8k2n9qp3",
    "taskId": "t-1234567890",
    "key": "analysis",
    "type": "json",
    "value": {
      "complexity": "high",
      "estimatedHours": 8,
      "dependencies": ["auth", "database"],
      "risks": [
        "Database migration required",
        "Potential downtime during deployment"
      ]
    },
    "createdBy": "instance-1",
    "createdAt": "2025-01-19T11:00:00Z",
    "updatedAt": "2025-01-19T11:00:00Z"
  },
  "id": "req-012"
}
```

### Success Response (Markdown Attachment)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "ta-1758272900000-k9m3p5xr7",
    "taskId": "t-1234567890",
    "key": "implementation_notes",
    "type": "markdown",
    "content": "## Implementation Details\n\n- Use Redis for caching query results\n- Implement rate limiting on API endpoints\n- Add indexes on frequently queried columns",
    "createdBy": "instance-1",
    "createdAt": "2025-01-19T11:01:40Z",
    "updatedAt": "2025-01-19T11:01:40Z"
  },
  "id": "req-012"
}
```

### Success Response (URL Attachment)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "ta-1758273000000-n7q4r8xt2",
    "taskId": "t-1234567890",
    "key": "reference_doc",
    "type": "url",
    "url": "https://docs.example.com/database-optimization-guide",
    "createdBy": "instance-1",
    "createdAt": "2025-01-19T11:03:20Z",
    "updatedAt": "2025-01-19T11:03:20Z"
  },
  "id": "req-012"
}
```

### Success Response (Binary Attachment)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "ta-1758273100000-p5w8v2zy6",
    "taskId": "t-1234567890",
    "key": "performance_report",
    "type": "binary",
    "size": 2048576,
    "mimeType": "application/pdf",
    "createdBy": "instance-1",
    "createdAt": "2025-01-19T11:05:00Z",
    "updatedAt": "2025-01-19T11:05:00Z"
  },
  "id": "req-012"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Attachment with key 'analysis' not found for task t-1234567890",
    "data": {
      "taskId": "t-1234567890",
      "key": "analysis"
    }
  },
  "id": "req-012"
}
```

## Response Fields

### Common Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique attachment identifier |
| `taskId` | string | Parent task ID |
| `key` | string | Attachment key |
| `type` | string | Attachment type |
| `createdBy` | string | Instance that created the attachment |
| `createdAt` | string | ISO datetime of creation |
| `updatedAt` | string | ISO datetime of last update |

### Type-Specific Fields

| Field | Type | Present For | Description |
|-------|------|-------------|-------------|
| `value` | any | json | Structured data object |
| `content` | string | text, markdown | Text content |
| `url` | string | url | URL reference |
| `size` | integer | binary | Size in bytes |
| `mimeType` | string | binary | MIME type |

## Notes

### Performance
- Primary lookup in Redis for fast access
- Automatic fallback to PostgreSQL if not cached
- Cache miss data is automatically stored in Redis with 1-hour TTL
- Metrics tracking for cache hits/misses

### Prerequisites
- Task must exist
- Attachment with specified key must exist

### Caching Strategy
1. First attempts Redis lookup for immediate response
2. Falls back to PostgreSQL if not found in Redis
3. Populates Redis cache from PostgreSQL data
4. Updates attachment index for future list operations

### Error Handling
- Specific error messages for missing tasks or attachments
- Graceful handling of Redis/PostgreSQL connectivity issues
- Circuit breaker protection for resilience

## Migration Notice

⚠️ **Important**: As of PR #4, task data storage has migrated from `metadata.data` to this dedicated attachment system. See the [migration guide](../attachments#migration-from-metadata) for transitioning from the legacy approach.

## Related

- [Attachments System Overview](../attachments) - Comprehensive attachment system guide
- [task.create_attachment](./create_attachment) - Create a new attachment
- [task.list_attachments](./list_attachments) - List all attachments for a task
- [task.get_attachments_batch](./get_attachments_batch) - Batch retrieval of attachments
- [task.delete_attachment](./delete_attachment) - Delete an attachment from a task
- [task.create](./create) - Create a new task
- [task.update](./update) - Update task details