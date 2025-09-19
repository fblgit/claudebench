---
sidebar_position: 9
title: task.list_attachments
description: List and filter task attachments with pagination
---

# task.list_attachments

List and filter task attachments with pagination support. This method provides comprehensive querying of attachments associated with a specific task.

## Request

### Method
`task.list_attachments`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | ID of the task to list attachments for |
| `type` | string | ✗ | Filter by type: "json", "markdown", "text", "url", "binary" |
| `limit` | integer | ✗ | Maximum number of attachments to return (1-100, default: 50) |
| `offset` | integer | ✗ | Number of attachments to skip (default: 0) |

### Example Request (All Attachments)

```json
{
  "jsonrpc": "2.0",
  "method": "task.list_attachments",
  "params": {
    "taskId": "t-1234567890"
  },
  "id": "req-013"
}
```

### Example Request (Filtered by Type)

```json
{
  "jsonrpc": "2.0",
  "method": "task.list_attachments",
  "params": {
    "taskId": "t-1234567890",
    "type": "json",
    "limit": 10,
    "offset": 0
  },
  "id": "req-014"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "attachments": [
      {
        "id": "ta-1758272800000-x8k2n9qp3",
        "taskId": "t-1234567890",
        "key": "analysis",
        "type": "json",
        "value": {
          "complexity": "high",
          "estimatedHours": 8,
          "dependencies": ["auth", "database"]
        },
        "createdBy": "instance-1",
        "createdAt": "2025-01-19T11:00:00Z",
        "updatedAt": "2025-01-19T11:00:00Z"
      },
      {
        "id": "ta-1758272900000-k9m3p5xr7",
        "taskId": "t-1234567890",
        "key": "implementation_notes",
        "type": "markdown",
        "content": "## Implementation Details\n\n- Use Redis for caching\n- Add database indexes",
        "createdBy": "instance-1",
        "createdAt": "2025-01-19T11:01:40Z",
        "updatedAt": "2025-01-19T11:01:40Z"
      },
      {
        "id": "ta-1758273000000-n7q4r8xt2",
        "taskId": "t-1234567890",
        "key": "reference_doc",
        "type": "url",
        "url": "https://docs.example.com/database-optimization-guide",
        "createdBy": "instance-1",
        "createdAt": "2025-01-19T11:03:20Z",
        "updatedAt": "2025-01-19T11:03:20Z"
      },
      {
        "id": "ta-1758273100000-p5w8v2zy6",
        "taskId": "t-1234567890",
        "key": "performance_report",
        "type": "binary",
        "size": 2048576,
        "mimeType": "application/pdf",
        "createdBy": "instance-1",
        "createdAt": "2025-01-19T11:05:00Z",
        "updatedAt": "2025-01-19T11:05:00Z"
      }
    ],
    "totalCount": 4,
    "hasMore": false
  },
  "id": "req-013"
}
```

### Success Response (Empty)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "attachments": [],
    "totalCount": 0,
    "hasMore": false
  },
  "id": "req-013"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32500,
    "message": "Failed to retrieve attachments",
    "data": {
      "taskId": "t-1234567890",
      "reason": "Database connection timeout"
    }
  },
  "id": "req-013"
}
```

## Response Fields

### Attachment Object Properties

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique attachment identifier |
| `taskId` | string | Parent task ID |
| `key` | string | Attachment key |
| `type` | string | Attachment type |
| `value` | any | Data for JSON attachments |
| `content` | string | Content for text/markdown attachments |
| `url` | string | URL for URL attachments |
| `size` | integer | Size in bytes for binary attachments |
| `mimeType` | string | MIME type for binary attachments |
| `createdBy` | string | Instance that created the attachment |
| `createdAt` | string | ISO datetime of creation |
| `updatedAt` | string | ISO datetime of last update |

### Pagination Properties

| Field | Type | Description |
|-------|------|-------------|
| `totalCount` | integer | Total number of matching attachments |
| `hasMore` | boolean | Whether more results are available |

## Notes

### Performance Strategy
- Primary lookup in Redis for maximum speed
- Fallback to PostgreSQL when Redis data is unavailable
- Automatic cache population from PostgreSQL results
- Redis pipeline operations for efficient multi-key fetching

### Caching Behavior
- Redis attachments are fetched in parallel for efficiency
- PostgreSQL fallback includes automatic Redis cache warming
- Attachment index maintained in Redis for fast enumeration
- 1-hour TTL applied to cached data

### Features
- Type-based filtering for specific attachment types
- Pagination support with offset/limit
- Automatic deserialization of JSON values
- Circuit breaker protection with empty result fallback
- Metrics tracking for monitoring list operation frequency

### Use Cases
- Viewing all attachments for a task
- Filtering attachments by type (e.g., only JSON data)
- Paginating through large attachment lists
- Checking what data is attached to a task

## Filter Examples

### JSON Attachments Only
```json
{
  "taskId": "t-1234567890",
  "type": "json"
}
```

### Recent Attachments (First Page)
```json
{
  "taskId": "t-1234567890",
  "limit": 20,
  "offset": 0
}
```

### Documentation Attachments
```json
{
  "taskId": "t-1234567890",
  "type": "markdown"
}
```

## Related

- [task.create_attachment](./create_attachment.md) - Create a new attachment
- [task.get_attachment](./get_attachment.md) - Get specific attachment by key
- [task.create](./create.md) - Create a new task
- [task.list](./list.md) - List tasks with filters