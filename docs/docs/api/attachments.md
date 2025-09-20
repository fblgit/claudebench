---
sidebar_position: 2
title: Attachments System
description: Universal key-value storage system for entity-related data
---

# Attachments System

The Task Attachment system provides a flexible key-value storage mechanism for associating various types of data with tasks. This system replaced the legacy `metadata.data` field, offering better type safety, improved query performance, and support for multiple attachment types.

## Overview

Task attachments are designed to store supplementary data that relates to tasks without cluttering the core task object. Each attachment is uniquely identified by a combination of task ID and key, allowing for efficient retrieval and management of task-related data.

### Key Features

- **Type-Safe Storage**: Five distinct attachment types (JSON, Markdown, Text, URL, Binary)
- **Key-Based Access**: Each attachment is uniquely keyed per task
- **Batch Operations**: Efficient batch retrieval of multiple attachments
- **Redis-First Architecture**: Fast access with PostgreSQL persistence
- **Automatic Indexing**: Efficient listing and filtering capabilities
- **Git Integration**: Built-in support for commit context tracking

## Migration from Metadata

⚠️ **Important**: As of PR #4, task data storage has migrated from `metadata.data` to the dedicated attachment system.

### Benefits of Migration

- **Better Type Safety**: Strongly typed attachment schemas prevent data corruption
- **Improved Query Performance**: Dedicated indexes for attachment queries
- **Support for Large Objects**: No longer constrained by task metadata limits
- **Multiple Attachment Types**: Specialized handling for different data formats
- **Cleaner Task Model**: Core task data separated from supplementary information

### Migration Guide

**Before (Deprecated)**:
```javascript
// ❌ Old approach using metadata.data
await task.create({
  text: "Implement feature",
  metadata: {
    data: {
      analysis: { complexity: "high" },
      notes: "Important implementation details"
    }
  }
});
```

**After (Current)**:
```javascript
// ✅ New approach using attachments
const task = await task.create({ text: "Implement feature" });

// Add structured data
await task.create_attachment({
  taskId: task.id,
  key: "analysis",
  type: "json",
  value: { complexity: "high" }
});

// Add documentation
await task.create_attachment({
  taskId: task.id,
  key: "notes",
  type: "markdown",
  content: "## Important\nImplementation details..."
});
```

## Attachment Types

| Type | Description | Use Case | Storage Field |
|------|-------------|----------|---------------|
| `json` | Structured JSON data | Configuration, analysis results, metadata | `value` |
| `markdown` | Markdown formatted text | Documentation, notes, specifications | `content` |
| `text` | Plain text content | Logs, outputs, simple notes | `content` |
| `url` | External references | Links to resources, documentation, issues | `url` |
| `binary` | Binary data reference | Files, images, documents (reference only) | `mimeType`, `size` |

### Type-Specific Requirements

Each attachment type has specific field requirements:

- **JSON**: Requires `value` field with any JSON-serializable data
- **Markdown/Text**: Requires `content` field with string data
- **URL**: Requires `url` field with valid URL string
- **Binary**: Optional `mimeType` and `size` fields (stores reference only)

## Core Operations

### Creating Attachments

```typescript
// JSON attachment for analysis results
await mcp__claudebench__task__create_attachment({
  taskId: "t-123456",
  key: "analysis",
  type: "json",
  value: {
    complexity: "high",
    estimatedHours: 8,
    dependencies: ["auth", "database"],
    risks: ["Migration required", "Downtime possible"]
  }
});

// Markdown attachment for documentation
await mcp__claudebench__task__create_attachment({
  taskId: "t-123456",
  key: "implementation_notes",
  type: "markdown",
  content: "## Implementation Plan\n\n1. Setup database schema\n2. Implement API endpoints\n3. Add frontend components"
});

// URL attachment for external reference
await mcp__claudebench__task__create_attachment({
  taskId: "t-123456",
  key: "design_doc",
  type: "url",
  url: "https://docs.example.com/design/feature-x"
});
```

### Retrieving Attachments

```typescript
// Get specific attachment
const attachment = await mcp__claudebench__task__get_attachment({
  taskId: "t-123456",
  key: "analysis"
});

// List all attachments for a task
const { attachments, totalCount } = await mcp__claudebench__task__list_attachments({
  taskId: "t-123456",
  limit: 50
});

// Filter by type
const jsonAttachments = await mcp__claudebench__task__list_attachments({
  taskId: "t-123456",
  type: "json",
  limit: 10
});
```

### Batch Operations

```typescript
// Retrieve multiple attachments efficiently
const { attachments } = await mcp__claudebench__task__get_attachments_batch({
  requests: [
    { taskId: "t-123456", key: "analysis" },
    { taskId: "t-123456", key: "implementation_notes" },
    { taskId: "t-789012", key: "test_results" }
  ]
});
```

## Integration with Git Hooks

The attachment system is deeply integrated with ClaudeBench's git auto-commit functionality, automatically storing commit context and diffs as task attachments.

### Automatic Commit Tracking

When a git commit is made in the context of a task, the system automatically:

1. Creates a primary attachment with full commit details
2. Stores the diff (limited to 10KB for performance)
3. Links the commit to relevant tasks
4. Creates lightweight references for secondary tasks

### Example: Git Commit Attachment

```typescript
// Automatically created by git.auto_commit.notify handler
{
  taskId: "t-123456",
  key: "git-commit-abc123d",
  type: "json",
  value: {
    commitHash: "abc123def456789",
    branch: "feature/attachments",
    files: ["src/handler.ts", "src/schema.ts"],
    diff: "+ Added attachment handler\n- Removed legacy code",
    stats: {
      additions: 145,
      deletions: 23,
      filesChanged: 2
    },
    toolUsed: "Edit",
    timestamp: 1705680000000,
    commitMessage: {
      task: "Implement attachment system",
      files: ["src/handler.ts", "src/schema.ts"]
    }
  }
}
```

### Querying Git History

```typescript
// Get all git commits for a task
const { attachments } = await mcp__claudebench__task__list_attachments({
  taskId: "t-123456",
  type: "json"
});

// Filter for git commits
const gitCommits = attachments.filter(a => a.key.startsWith("git-commit-"));
```

## Performance Considerations

### Size Limits

- **JSON Attachments**: PostgreSQL JSON fields support up to 1GB, but keep under 1MB for optimal performance
- **Text/Markdown**: Unlimited in PostgreSQL, but consider pagination for large content
- **URL**: Standard URL length limits apply (2048 characters recommended)
- **Diffs in Git Attachments**: Automatically truncated to 10KB

### Caching Strategy

- Attachments are cached in Redis with 1-hour TTL
- Batch operations are cached for 5 minutes
- Cache hit/miss metrics tracked for monitoring

### Batch Operation Guidelines

- Maximum 100 attachments per batch request
- Use batch operations when retrieving 3+ attachments
- Batch queries execute as single database operation

## Storage Architecture

### Redis Storage

```
Key Structure:
cb:task:{taskId}:attachment:{key}     # Individual attachment data
cb:task:{taskId}:attachments          # Sorted set index of keys
```

### PostgreSQL Schema

```sql
TaskAttachment {
  id: String (Primary Key)
  taskId: String (Foreign Key)
  key: String
  type: Enum["json", "markdown", "text", "url", "binary"]
  value: JSON (nullable)
  content: Text (nullable)
  url: String (nullable)
  mimeType: String (nullable)
  size: Integer (nullable)
  createdBy: String (nullable)
  createdAt: DateTime
  updatedAt: DateTime
  
  Unique Index: (taskId, key)
}
```

## Best Practices

### 1. Choose Appropriate Types

- Use `json` for structured data that needs querying
- Use `markdown` for human-readable documentation
- Use `text` for logs or simple content
- Use `url` for external references
- Use `binary` only for reference metadata

### 2. Key Naming Conventions

```typescript
// Good key naming
"analysis"              // Simple, descriptive
"git-commit-abc123"     // Prefixed for grouping
"test-results-2024-01"  // Timestamped data
"config-v2"             // Versioned configuration

// Avoid
"data"                  // Too generic
"my_special_key!!!"     // Special characters
"very-long-key-name..." // Exceeds 100 character limit
```

### 3. Handle Missing Attachments

```typescript
try {
  const attachment = await mcp__claudebench__task__get_attachment({
    taskId: "t-123456",
    key: "analysis"
  });
  // Process attachment
} catch (error) {
  if (error.message.includes("not found")) {
    // Handle missing attachment gracefully
    console.log("Attachment not found, using defaults");
  } else {
    throw error;
  }
}
```

### 4. Efficient Batch Retrieval

```typescript
// Instead of multiple individual calls
// ❌ Inefficient
const a1 = await get_attachment({ taskId, key: "key1" });
const a2 = await get_attachment({ taskId, key: "key2" });
const a3 = await get_attachment({ taskId, key: "key3" });

// ✅ Efficient batch operation
const { attachments } = await get_attachments_batch({
  requests: [
    { taskId, key: "key1" },
    { taskId, key: "key2" },
    { taskId, key: "key3" }
  ]
});
```

### 5. Clean Up Attachments

When tasks are deleted, ensure associated attachments are also cleaned up. The system doesn't automatically cascade delete attachments to prevent accidental data loss.

## Event System

### Published Events

**task.attachment_created**
```json
{
  "type": "task.attachment_created",
  "payload": {
    "taskId": "t-123456",
    "key": "analysis",
    "type": "json",
    "attachmentId": "ta-1234567890-abc",
    "instanceId": "worker-1",
    "timestamp": 1705680000000
  }
}
```

### Metrics Tracking

The system tracks several metrics for monitoring:

- `cb:metrics:attachments:created` - Total attachments created
- `cb:metrics:attachments:type:{type}` - Count by type
- `cb:metrics:attachments:cache_hits` - Redis cache hits
- `cb:metrics:attachments:cache_misses` - Redis cache misses
- `cb:metrics:attachments:list_queries` - List operation count

## Examples

### Complex Analysis Storage

```typescript
// Store comprehensive task analysis
await mcp__claudebench__task__create_attachment({
  taskId: "t-123456",
  key: "full_analysis",
  type: "json",
  value: {
    technical: {
      complexity: "high",
      estimatedLOC: 500,
      testCoverage: 0.85,
      dependencies: {
        external: ["redis", "postgres"],
        internal: ["auth", "logger"]
      }
    },
    business: {
      priority: "critical",
      stakeholders: ["engineering", "product"],
      deadline: "2024-02-01"
    },
    risks: [
      {
        type: "technical",
        description: "Database migration required",
        mitigation: "Schedule maintenance window"
      },
      {
        type: "resource",
        description: "Limited QA availability",
        mitigation: "Automate test coverage"
      }
    ]
  }
});
```

### Documentation Workflow

```typescript
// Initial specs
await create_attachment({
  taskId,
  key: "requirements",
  type: "markdown",
  content: "## Requirements\n- Feature A\n- Feature B"
});

// Implementation notes
await create_attachment({
  taskId,
  key: "implementation",
  type: "markdown",
  content: "## Implementation\nUsing pattern X for efficiency"
});

// Test documentation
await create_attachment({
  taskId,
  key: "test_plan",
  type: "markdown",
  content: "## Test Plan\n1. Unit tests\n2. Integration tests"
});

// Retrieve all documentation
const { attachments } = await list_attachments({
  taskId,
  type: "markdown"
});
```

### Git Integration Example

```typescript
// Automatic attachment creation on commit
// This happens automatically via git hooks
{
  taskId: "t-implement-feature",
  key: "git-commit-f3a4b5c",
  type: "json",
  value: {
    commitHash: "f3a4b5c6d7e8f9a0b1c2d3e4",
    branch: "feature/user-auth",
    files: [
      "src/auth/handler.ts",
      "src/auth/middleware.ts",
      "tests/auth.test.ts"
    ],
    diff: "+ export class AuthHandler {\n+   async handle()",
    stats: {
      additions: 234,
      deletions: 45,
      filesChanged: 3
    },
    toolUsed: "MultiEdit",
    timestamp: 1705680000000,
    commitMessage: {
      task: "Add authentication handler",
      description: "Implements JWT-based authentication"
    }
  }
}
```

## API Reference

### Handlers

- [task.create_attachment](./create_attachment) - Create or update an attachment
- [task.list_attachments](./list_attachments) - List and filter attachments
- [task.get_attachment](./get_attachment) - Retrieve specific attachment
- [task.get_attachments_batch](./get_attachments_batch) - Batch retrieval of attachments

### Related

- [task.create](./create) - Create a new task
- [task.complete](./complete) - Complete a task with results
- [git.auto_commit.notify](../git/auto_commit_notify) - Git commit tracking