---
sidebar_position: 1
title: git.auto_commit.notify
description: Notify ClaudeBench about auto-commits from git hooks
---

# git.auto_commit.notify

Notifies ClaudeBench about auto-commits made by git hooks, creating task attachments and tracking code evolution.

## Request

### Method
`git.auto_commit.notify`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instanceId` | string | ✓ | Worker instance identifier |
| `sessionId` | string | ✓ | Current session identifier |
| `commitHash` | string | ✓ | Full git commit hash |
| `branch` | string | ✓ | Git branch name |
| `files` | string[] | ✓ | List of modified files |
| `diff` | string | ✓ | Git diff output |
| `stats` | object | ✗ | Commit statistics |
| `stats.additions` | integer | ✓ | Lines added |
| `stats.deletions` | integer | ✓ | Lines removed |
| `stats.filesChanged` | integer | ✓ | Number of files changed |
| `taskContext` | object | ✓ | Task context information |
| `taskContext.taskIds` | string[] | ✓ | Related task IDs |
| `taskContext.toolUsed` | string | ✓ | Tool that triggered the commit |
| `taskContext.timestamp` | integer | ✓ | Unix timestamp |
| `commitMessage` | string | ✓ | Structured JSON commit message |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "git.auto_commit.notify",
  "params": {
    "instanceId": "worker-1",
    "sessionId": "session-123",
    "commitHash": "abc123def456789",
    "branch": "main",
    "files": [
      "src/components/Dashboard.tsx",
      "src/utils/helpers.ts"
    ],
    "diff": "+ export const formatDate = (date: Date) => {\n+   return date.toISOString();\n+ };\n- // Old implementation removed",
    "stats": {
      "additions": 15,
      "deletions": 3,
      "filesChanged": 2
    },
    "taskContext": {
      "taskIds": ["t-123", "t-124"],
      "toolUsed": "Edit",
      "timestamp": 1234567890
    },
    "commitMessage": "{\"task\":\"Add date formatting utility\",\"files\":[\"src/utils/helpers.ts\"]}"
  },
  "id": "req-001"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "acknowledged": true,
    "attachmentId": "ta-123-abc456",
    "eventId": "git-commit-1234567890-abc123"
  },
  "id": "req-001"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "issues": [
        {
          "path": ["commitHash"],
          "message": "String must contain at least 1 character(s)"
        }
      ]
    }
  },
  "id": "req-001"
}
```

## Event Emission

This handler emits the following events:

| Event | When | Payload |
|-------|------|---------|
| `git.auto_commit.created` | After processing notification | Commit details with metadata |

### Event Payload Example

```json
{
  "type": "git.auto_commit.created",
  "payload": {
    "instanceId": "worker-1",
    "sessionId": "session-123",
    "commitHash": "abc123def456789",
    "branch": "main",
    "files": ["src/utils/helpers.ts"],
    "stats": {
      "additions": 15,
      "deletions": 3,
      "filesChanged": 2
    },
    "taskContext": {
      "taskIds": ["t-123"],
      "toolUsed": "Edit",
      "timestamp": 1234567890
    },
    "commitMessage": "{\"task\":\"Add date formatting utility\"}",
    "timestamp": 1234567890000
  },
  "metadata": {
    "eventId": "git-commit-1234567890-abc123"
  }
}
```

## Side Effects

### Redis Keys Created

| Key Pattern | Type | Purpose | TTL |
|-------------|------|---------|-----|
| `cb:git:commit:{hash}` | Hash | Stores commit metadata | 7 days |
| `cb:session:commits:{sessionId}` | List | Session's commit history (last 100) | 7 days |
| `cb:metrics:git:commits` | Hash | Global git metrics | Persistent |

### Task Attachments

Creates attachments for each referenced task:

**Primary Task Attachment** (first task in taskIds):
```json
{
  "taskId": "t-123",
  "key": "git-commit-abc123d",
  "type": "json",
  "value": {
    "commitHash": "abc123def456789",
    "branch": "main",
    "files": ["src/utils/helpers.ts"],
    "diff": "+ export const formatDate...", // Limited to 10KB
    "stats": {
      "additions": 15,
      "deletions": 3,
      "filesChanged": 2
    },
    "toolUsed": "Edit",
    "timestamp": 1234567890,
    "commitMessage": {
      "task": "Add date formatting utility",
      "files": ["src/utils/helpers.ts"]
    }
  }
}
```

**Secondary Task References** (remaining tasks):
```json
{
  "taskId": "t-124",
  "key": "git-ref-abc123d",
  "type": "json",
  "value": {
    "commitHash": "abc123def456789",
    "branch": "main",
    "files": 2, // Just count
    "primaryTaskId": "t-123",
    "toolUsed": "Edit",
    "timestamp": 1234567890
  }
}
```

### Metrics Updated

```
cb:metrics:git:commits
  - total: +1
  - tool:{toolUsed}: +1
  - files: +{fileCount}
  - additions: +{additions}
  - deletions: +{deletions}
```

## Rate Limiting

- **Handler limit**: 50 requests per minute
- **Timeout**: 5 seconds
- **Circuit breaker**: Opens after 5 failures, resets after 30 seconds

## Usage Examples

### From Claude Code

```typescript
await mcp__claudebench__git__auto_commit__notify({
  instanceId: "worker-1",
  sessionId: "session-123",
  commitHash: "abc123def456789",
  branch: "main",
  files: ["src/feature.ts"],
  diff: "+ added code\n- removed code",
  stats: {
    additions: 10,
    deletions: 5,
    filesChanged: 1
  },
  taskContext: {
    taskIds: ["t-123"],
    toolUsed: "Edit",
    timestamp: Date.now() / 1000
  },
  commitMessage: JSON.stringify({
    task: "Implement feature",
    files: ["src/feature.ts"]
  })
});
```

### From Git Hook

```bash
#!/bin/bash
# .git/hooks/post-commit

COMMIT_HASH=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
FILES=$(git diff-tree --no-commit-id --name-only -r HEAD | jq -R -s -c 'split("\n")[:-1]')
DIFF=$(git diff HEAD~1 HEAD | jq -Rs .)
ADDITIONS=$(git diff HEAD~1 HEAD --stat | tail -1 | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)
DELETIONS=$(git diff HEAD~1 HEAD --stat | tail -1 | grep -oE '[0-9]+ deletion' | grep -oE '[0-9]+' || echo 0)
FILES_CHANGED=$(git diff HEAD~1 HEAD --stat | tail -1 | grep -oE '[0-9]+ file' | grep -oE '[0-9]+' || echo 1)

curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d "{
    \"jsonrpc\": \"2.0\",
    \"method\": \"git.auto_commit.notify\",
    \"params\": {
      \"instanceId\": \"$CLAUDEBENCH_INSTANCE_ID\",
      \"sessionId\": \"$CLAUDEBENCH_SESSION_ID\",
      \"commitHash\": \"$COMMIT_HASH\",
      \"branch\": \"$BRANCH\",
      \"files\": $FILES,
      \"diff\": $DIFF,
      \"stats\": {
        \"additions\": $ADDITIONS,
        \"deletions\": $DELETIONS,
        \"filesChanged\": $FILES_CHANGED
      },
      \"taskContext\": {
        \"taskIds\": [\"$CLAUDEBENCH_TASK_ID\"],
        \"toolUsed\": \"$CLAUDEBENCH_TOOL\",
        \"timestamp\": $(date +%s)
      },
      \"commitMessage\": \"{\\\"task\\\":\\\"$CLAUDEBENCH_TASK_TEXT\\\",\\\"files\\\":$FILES}\"
    },
    \"id\": \"hook-$(date +%s)\"
  }"
```

### From HTTP

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "git.auto_commit.notify",
    "params": {
      "instanceId": "worker-1",
      "sessionId": "session-123",
      "commitHash": "abc123def456789",
      "branch": "main",
      "files": ["src/feature.ts"],
      "diff": "+ new feature code",
      "taskContext": {
        "taskIds": ["t-123"],
        "toolUsed": "Edit",
        "timestamp": 1234567890
      },
      "commitMessage": "{\"task\":\"Add feature\",\"files\":[\"src/feature.ts\"]}"
    },
    "id": "req-001"
  }'
```

## Prerequisites

- Git repository must be initialized
- ClaudeBench server must be running on port 3000
- Task IDs should exist in the system for attachment creation
- Environment variables for git hooks:
  - `CLAUDEBENCH_INSTANCE_ID`: Worker instance ID
  - `CLAUDEBENCH_SESSION_ID`: Current session ID
  - `CLAUDEBENCH_TASK_ID`: Active task ID
  - `CLAUDEBENCH_TOOL`: Tool being used
  - `CLAUDEBENCH_TASK_TEXT`: Task description

## Warnings

- **Large diffs are truncated** - Diffs larger than 10KB are truncated in task attachments
- **Attachment creation is non-blocking** - Failed attachments don't fail the notification
- **Secondary task references are lightweight** - Only the first task gets the full diff
- **Commit message must be valid JSON** - Parsing errors are logged but don't fail the handler

## Related Handlers

- [`git.context.get`](./context_get.md) - Get task context for generating commit messages
- [`task.create_attachment`](../task/attachments.md) - Create task attachments directly
- [`task.list`](../task/list.md) - List tasks to find active work items