---
sidebar_position: 7
title: task.create_attachment
description: Add data linked to a task, like a key-value store for tasks
---

# task.create_attachment

Add data linked to a task, functioning like a key-value store for tasks. This method allows you to attach various types of data including JSON objects, markdown documentation, text content, URLs, and binary references.

> 📚 **See Also**: [Task Attachments Overview](./attachments) for comprehensive documentation on the attachment system, migration guide, and best practices.

## Request

### Method
`task.create_attachment`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | ID of the task to attach data to |
| `key` | string | ✓ | Unique key for this attachment (1-100 chars) |
| `type` | string | ✓ | Type: "json", "markdown", "text", "url", "binary" |
| `value` | any | ✗* | Data for JSON attachments |
| `content` | string | ✗* | Content for text/markdown attachments |
| `url` | string | ✗* | URL for URL attachments |
| `mimeType` | string | ✗ | MIME type for binary attachments |
| `size` | integer | ✗ | Size in bytes (positive integer) |

*Required field depends on `type`: JSON requires `value`, text/markdown requires `content`, URL requires `url`.

### Example Request (JSON Attachment)

```json
{
  "jsonrpc": "2.0",
  "method": "task.create_attachment",
  "params": {
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
    }
  },
  "id": "req-009"
}
```

### Example Request (Markdown Documentation)

```json
{
  "jsonrpc": "2.0",
  "method": "task.create_attachment",
  "params": {
    "taskId": "t-1234567890",
    "key": "implementation_notes",
    "type": "markdown",
    "content": "## Implementation Details\n\n- Use Redis for caching query results\n- Implement rate limiting on API endpoints\n- Add indexes on frequently queried columns\n\n### Performance Targets\n- < 100ms average response time\n- Support 1000 concurrent users"
  },
  "id": "req-010"
}
```

### Example Request (URL Reference)

```json
{
  "jsonrpc": "2.0",
  "method": "task.create_attachment",
  "params": {
    "taskId": "t-1234567890",
    "key": "reference_doc",
    "type": "url",
    "url": "https://docs.example.com/database-optimization-guide"
  },
  "id": "req-011"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "id": "ta-1758272800000-x8k2n9qp3",
    "taskId": "t-1234567890",
    "key": "analysis",
    "type": "json",
    "createdAt": "2025-01-19T11:00:00Z"
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
    "message": "Task t-1234567890 not found",
    "data": {
      "taskId": "t-1234567890"
    }
  },
  "id": "req-009"
}
```

## Event Emission

When an attachment is successfully created, an event is published:

```json
{
  "type": "task.attachment_created",
  "payload": {
    "taskId": "t-1234567890",
    "key": "analysis",
    "type": "json",
    "attachmentId": "ta-1758272800000-x8k2n9qp3",
    "instanceId": "instance-1",
    "timestamp": 1758272800000
  }
}
```

## Attachment Types

### JSON (`"json"`)
- Stores structured data in the `value` field
- Automatically serialized/deserialized
- Ideal for analysis results, configuration, metadata

### Markdown (`"markdown"`)
- Stores markdown content in the `content` field
- Perfect for documentation, notes, implementation details

### Text (`"text"`)
- Stores plain text in the `content` field
- Suitable for logs, simple notes, raw data

### URL (`"url"`)
- Stores URL reference in the `url` field
- Links to external resources, documentation, repositories

### Binary (`"binary"`)
- Stores reference information only (not actual binary data)
- Requires `mimeType` and optionally `size`
- Used for referencing files, images, documents

## Migration Notice

⚠️ **Important**: As of PR #4, task data storage has migrated from `metadata.data` to this dedicated attachment system. See the [migration guide](./attachments#migration-from-metadata) for details.

## Notes

### Prerequisites
- Task must exist (checked in both Redis and PostgreSQL)
- Unique key per task (will overwrite if key already exists)

### Warnings
- Large attachments may impact performance
- Binary attachments store only references, not actual data
- PostgreSQL JSON fields can handle up to 1GB of data
- Avoid using `metadata.data` (deprecated) - use attachments instead

### Storage
- Primary storage in Redis for fast access
- Optional persistence to PostgreSQL for durability
- Automatic indexing in Redis for efficient listing
- Graceful fallback if PostgreSQL persistence fails

### Features
- Automatic attachment ID generation
- Key-based replacement (upsert behavior)
- Metrics tracking for monitoring
- TTL support for Redis caching

## Related

- [Task Attachments Overview](./attachments) - Comprehensive attachment system guide
- [task.get_attachment](./get_attachment) - Get specific attachment by key
- [task.list_attachments](./list_attachments) - List all attachments for a task
- [task.get_attachments_batch](./get_attachments_batch) - Batch retrieval of attachments
- [task.create](./create) - Create a new task
- [task.complete](./complete) - Mark task as completed