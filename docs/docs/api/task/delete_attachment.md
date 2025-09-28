---
sidebar_position: 8
title: task.delete_attachment
description: Delete an attachment from a task
---

# task.delete_attachment

Delete a specific attachment from a task by its key. This method permanently removes the attachment from both Redis and PostgreSQL storage. The operation cannot be undone.

> 📚 **See Also**: [Attachments System Overview](../attachments) for comprehensive documentation on the attachment system and best practices.

## Request

### Method
`task.delete_attachment`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | ID of the task containing the attachment |
| `key` | string | ✓ | Key of the attachment to delete |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.delete_attachment",
  "params": {
    "taskId": "t-1234567890",
    "key": "analysis"
  },
  "id": "req-012"
}
```

### Example Request (Delete Git Attachment)

```json
{
  "jsonrpc": "2.0",
  "method": "task.delete_attachment",
  "params": {
    "taskId": "t-1234567890",
    "key": "git-commit-abc123d"
  },
  "id": "req-013"
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
    "deleted": true,
    "deletedAt": "2025-01-19T11:00:00Z"
  },
  "id": "req-012"
}
```

### Error Response (Attachment Not Found)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Attachment 'analysis' not found for task t-1234567890",
    "data": {
      "taskId": "t-1234567890",
      "key": "analysis"
    }
  },
  "id": "req-012"
}
```

## Event Emission

When an attachment is successfully deleted, an event is published:

```json
{
  "type": "task.attachment.deleted",
  "payload": {
    "taskId": "t-1234567890",
    "key": "analysis",
    "attachmentId": "ta-1758272800000-x8k2n9qp3"
  },
  "metadata": {
    "deletedBy": "instance-1",
    "deletedAt": "2025-01-19T11:00:00Z"
  }
}
```

## Use Cases

### Clean Up Outdated Attachments
Remove attachments that are no longer relevant or have been superseded:
- Old analysis results
- Deprecated documentation
- Obsolete configuration

### Remove Sensitive Data
Delete attachments containing sensitive information:
- API keys accidentally attached
- Personal data that should be removed
- Temporary debugging information

### Manage Storage
Free up storage by removing large attachments:
- Old git commit diffs
- Extensive log files
- Redundant documentation

### Workflow Cleanup
Remove temporary attachments used during task processing:
- Intermediate computation results
- Temporary configuration overrides
- Debug attachments

## Notes

### Prerequisites
- Task must exist in the system
- Attachment with specified key must exist for the task
- User must have permission to modify the task

### Warnings
- **This action cannot be undone** - deleted attachments are permanently removed
- Attachment will be removed from both Redis and PostgreSQL
- If PostgreSQL deletion fails, the operation continues (Redis deletion succeeds)
- Related references in other tasks are not automatically updated

### Storage Behavior
- Immediately removes from Redis hash (`cb:task:{taskId}:attachment:{key}`)
- Removes from Redis index (`cb:task:{taskId}:attachments`)
- Attempts deletion from PostgreSQL `task_attachments` table
- Graceful handling if PostgreSQL deletion fails (logs warning)

### Error Handling
- Returns error if attachment key doesn't exist
- Returns error if task doesn't exist
- Continues operation if PostgreSQL deletion fails (Redis deletion succeeds)
- Circuit breaker prevents cascading failures

### Performance
- O(1) complexity for Redis operations
- Rate limited to 100 deletions per minute
- 5 second timeout for operation
- Circuit breaker threshold of 10 failures

## Related

- [Attachments System Overview](../attachments) - Comprehensive attachment system guide
- [task.create_attachment](./create_attachment) - Add data to a task
- [task.get_attachment](./get_attachment) - Get specific attachment by key
- [task.list_attachments](./list_attachments) - List all attachments for a task
- [task.get_attachments_batch](./get_attachments_batch) - Batch retrieval of attachments
- [task.delete](./delete) - Delete an entire task and all its attachments