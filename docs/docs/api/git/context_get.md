---
sidebar_position: 2
title: git.context.get
description: Get task context for git commits
---

# git.context.get

Retrieves task context, recent tools, and session information to provide context for git commit message generation.

## Request

### Method
`git.context.get`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `instanceId` | string | ✓ | Worker instance identifier |
| `sessionId` | string | ✓ | Current session identifier |
| `limit` | integer | ✗ | Maximum number of tasks to return (1-10, default: 5) |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "git.context.get",
  "params": {
    "instanceId": "worker-1",
    "sessionId": "session-123",
    "limit": 3
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
    "tasks": [
      {
        "id": "t-123",
        "text": "Implement dark mode toggle",
        "status": "in_progress",
        "priority": 75,
        "assignedAt": "2024-01-15T10:30:00Z"
      },
      {
        "id": "t-124",
        "text": "Add user preferences API",
        "status": "pending",
        "priority": 60,
        "assignedAt": "2024-01-15T10:25:00Z"
      }
    ],
    "recentTools": [
      "Edit",
      "Write",
      "Read",
      "Edit",
      "MultiEdit"
    ],
    "currentTodos": [
      {
        "content": "Update theme context provider",
        "status": "in_progress",
        "activeForm": "Updating theme context provider"
      },
      {
        "content": "Add preference persistence",
        "status": "pending",
        "activeForm": "Adding preference persistence"
      }
    ],
    "lastPrompt": "Add dark mode toggle to the settings page",
    "metadata": {
      "sessionId": "session-123",
      "instanceId": "worker-1",
      "projectDir": "/Users/dev/project",
      "eventCount": 42
    }
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
          "path": ["instanceId"],
          "message": "String must contain at least 1 character(s)"
        }
      ]
    }
  },
  "id": "req-001"
}
```

## Response Fields

### tasks

Array of active tasks assigned to the instance:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Task identifier |
| `text` | string | Task description |
| `status` | enum | Task status: `pending`, `in_progress`, `completed`, `failed` |
| `priority` | integer | Task priority (0-100) |
| `assignedAt` | string | Optional timestamp when task was assigned |

### recentTools

Array of recently used tool names from the session (last 10).

### currentTodos

Array of active TODO items from the session:

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | TODO item description |
| `status` | enum | Status: `pending`, `in_progress`, `completed` |
| `activeForm` | string | Optional active form of the TODO |

### lastPrompt

Optional string containing the last user prompt from the session.

### metadata

Session and instance metadata:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string | Current session ID |
| `instanceId` | string | Worker instance ID |
| `projectDir` | string | Optional project directory path |
| `eventCount` | integer | Optional number of events in session |

## Event Emission

This handler does not emit any events.

## Side Effects

This handler is read-only and creates no side effects. It queries the following Redis keys:

### Redis Keys Read

| Key Pattern | Type | Purpose |
|-------------|------|---------|
| `cb:task:t-*` | Hash | Query task data |
| `cb:session:tools:{sessionId}` | List | Get recent tool usage |
| `cb:session:context:{sessionId}` | Hash | Get session context |
| `cb:session:state:{sessionId}` | Hash | Get session state |
| `cb:session:tasks:{sessionId}` | List | Fallback task list |

## Rate Limiting

- **Handler limit**: 100 requests per minute
- **Timeout**: 3 seconds
- **Circuit breaker**: Opens after 5 failures, resets after 30 seconds
- **Cache**: 5 second cache for identical requests

## Usage Examples

### From Claude Code

```typescript
// Get context before making a commit
const context = await mcp__claudebench__git__context__get({
  instanceId: "worker-1",
  sessionId: "session-123",
  limit: 5
});

// Use context to generate commit message
const commitMessage = {
  task: context.tasks[0]?.text || "Update code",
  todos: context.currentTodos.filter(t => t.status === "completed").map(t => t.content),
  tools: context.recentTools.slice(0, 3)
};

// Make the commit with context
await git.commit({
  message: JSON.stringify(commitMessage),
  // ... other git operations
});
```

### From HTTP

```bash
curl -X POST http://localhost:3000/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "git.context.get",
    "params": {
      "instanceId": "worker-1",
      "sessionId": "session-123"
    },
    "id": "req-001"
  }'
```

### For Commit Message Generation

```typescript
// Helper function to generate contextual commit messages
function generateCommitMessage(context: GitContextGetOutput): string {
  const activeTasks = context.tasks.filter(t => t.status === "in_progress");
  const completedTodos = context.currentTodos.filter(t => t.status === "completed");
  
  let message = "";
  
  if (activeTasks.length > 0) {
    message = activeTasks[0].text;
  } else if (completedTodos.length > 0) {
    message = completedTodos.map(t => t.content).join(", ");
  } else if (context.lastPrompt) {
    message = context.lastPrompt;
  } else {
    message = "Update code";
  }
  
  // Add tool context
  if (context.recentTools.length > 0) {
    const toolSummary = context.recentTools
      .slice(0, 3)
      .filter((v, i, a) => a.indexOf(v) === i) // unique
      .join(", ");
    message += ` (via ${toolSummary})`;
  }
  
  return message;
}
```

## Query Behavior

The handler follows this query pattern:

1. **Direct Task Query**: First searches for tasks directly assigned to the instance
   - Filters tasks by `assignedTo === instanceId`
   - Only includes `in_progress` or `pending` status
   - Stops when limit is reached

2. **Session Task Fallback**: If no direct tasks found, queries session tasks
   - Reads from `cb:session:tasks:{sessionId}` list
   - Returns up to `limit` tasks from session history

3. **Tool History**: Retrieves last 10 tools from `cb:session:tools:{sessionId}`

4. **Session Context**: Reads current todos and last prompt from session context

5. **Metadata Assembly**: Combines session state and environment information

## Prerequisites

- ClaudeBench server must be running
- Valid session must exist with the provided `sessionId`
- Instance should be registered for best results

## Warnings

- **Returns empty arrays if no active tasks or tools** - Check array lengths before use
- **Cache duration is 5 seconds** - Rapid successive calls return cached data
- **Task query may be expensive** - Limits help control performance
- **Session tasks are fallback only** - Direct assignment takes precedence

## Performance Considerations

- Uses key pattern scanning for tasks (may be slow with many tasks)
- Filters attachment keys to avoid false matches
- Caches results for 5 seconds to reduce Redis load
- Circuit breaker provides fallback with empty data

## Related Handlers

- [`git.auto_commit.notify`](./auto_commit_notify.md) - Use context to notify about commits
- [`task.list`](../task/list.md) - Alternative way to query tasks
- [`system.get_state`](../system/get_state.md) - Get broader system state