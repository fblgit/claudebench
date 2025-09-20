---
sidebar_position: 1
title: session.state.get
description: Retrieve session state and events with flexible filtering options
---

# session.state.get

Retrieve session state and events from the event stream. Supports both raw event retrieval and condensed state summaries for efficient context understanding.

## Request

### Method
`session.state.get`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | ✓ | Session identifier |
| `condensed` | boolean | ✗ | Return condensed state summary (default: false) |
| `limit` | number | ✗ | Maximum events to return (1-1000, default: 100) |
| `fromTimestamp` | number | ✗ | Start timestamp for event range |
| `toTimestamp` | number | ✗ | End timestamp for event range |
| `eventTypes` | string[] | ✗ | Filter by specific event types |

### Example Request - Raw Events

```json
{
  "jsonrpc": "2.0",
  "method": "session.state.get",
  "params": {
    "sessionId": "session-123",
    "limit": 50,
    "eventTypes": ["hook.pre_tool", "hook.post_tool"]
  },
  "id": "req-001"
}
```

### Example Request - Condensed State

```json
{
  "jsonrpc": "2.0",
  "method": "session.state.get",
  "params": {
    "sessionId": "session-123",
    "condensed": true
  },
  "id": "req-002"
}
```

## Response

### Success Response - Raw Events

```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "session-123",
    "events": [
      {
        "eventId": "evt-1234567890",
        "eventType": "hook.pre_tool",
        "timestamp": 1758271800000,
        "data": {
          "params": {
            "tool": "task.create",
            "input": {
              "text": "Build dashboard component"
            }
          },
          "result": {}
        },
        "labels": ["tool-usage", "task-management"]
      },
      {
        "eventId": "evt-1234567891",
        "eventType": "hook.post_tool",
        "timestamp": 1758271801000,
        "data": {
          "params": {
            "tool": "task.create"
          },
          "result": {
            "id": "t-123",
            "status": "pending"
          }
        }
      }
    ],
    "summary": {
      "totalEvents": 2,
      "firstEvent": 1758271800000,
      "lastEvent": 1758271801000,
      "eventCounts": {
        "hook.pre_tool": 1,
        "hook.post_tool": 1
      }
    }
  },
  "id": "req-001"
}
```

### Success Response - Condensed State

```json
{
  "jsonrpc": "2.0",
  "result": {
    "sessionId": "session-123",
    "events": [],
    "condensed": {
      "tasks": [
        {
          "id": "t-123",
          "text": "Build dashboard component",
          "status": "in_progress",
          "result": null
        }
      ],
      "tools": [
        {
          "name": "task.create",
          "count": 3,
          "lastUsed": 1758271800000
        },
        {
          "name": "swarm.decompose",
          "count": 1,
          "lastUsed": 1758271700000
        }
      ],
      "prompts": [
        {
          "prompt": "Help me build a real-time analytics dashboard",
          "timestamp": 1758271600000
        }
      ],
      "todos": [
        {
          "content": "Design dashboard layout",
          "status": "completed"
        },
        {
          "content": "Implement data fetching",
          "status": "in_progress"
        }
      ]
    },
    "summary": {
      "totalEvents": 42,
      "firstEvent": 1758270000000,
      "lastEvent": 1758271800000,
      "eventCounts": {
        "hook.pre_tool": 10,
        "hook.post_tool": 10,
        "hook.user_prompt": 3,
        "hook.todo_write": 5,
        "task.created": 8,
        "task.completed": 6
      }
    }
  },
  "id": "req-002"
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
      "validation": "sessionId is required"
    }
  },
  "id": "req-001"
}
```

## Event Emission

This handler does not emit events as it is a read-only operation.

## Side Effects

### Redis Operations

**Read Operations:**
- `cb:stream:session:{sessionId}` - Reads event stream using XRANGE
- `cb:session:context:{sessionId}` - Reads processed context (condensed mode)

**No Write Operations** - This is a read-only handler

### PostgreSQL Operations

This handler does not interact with PostgreSQL.

## Performance Considerations

### Caching
- Results are cached for 60 seconds to reduce Redis load
- Cache key includes all query parameters for accuracy
- Condensed state leverages pre-processed context

### Limits
- Maximum 1000 events per request to prevent memory issues
- Large sessions should use pagination with timestamps
- Condensed mode is significantly faster for state overview

### Optimization Tips
1. **Use Condensed Mode** for quick state checks
2. **Apply Event Type Filters** to reduce data transfer
3. **Use Time Ranges** for targeted event retrieval
4. **Implement Pagination** for large event histories

## Usage Examples

### From Claude Code

```typescript
// Get condensed state for quick context
const state = await mcp__claudebench__session__state__get({
  sessionId: "session-123",
  condensed: true
});

// Get recent tool usage events
const toolEvents = await mcp__claudebench__session__state__get({
  sessionId: "session-123",
  eventTypes: ["hook.pre_tool", "hook.post_tool"],
  limit: 100
});

// Get events from last hour
const recentEvents = await mcp__claudebench__session__state__get({
  sessionId: "session-123",
  fromTimestamp: Date.now() - 3600000,
  toTimestamp: Date.now()
});
```

### Use Cases

1. **Session Overview**: Quick state check using condensed mode
   ```typescript
   const overview = await mcp__claudebench__session__state__get({
     sessionId: currentSession,
     condensed: true
   });
   console.log("Active tasks:", overview.condensed.tasks.length);
   console.log("Recent tools:", overview.condensed.tools);
   ```

2. **Debugging Tool Usage**: Analyze tool execution patterns
   ```typescript
   const toolUsage = await mcp__claudebench__session__state__get({
     sessionId: debugSession,
     eventTypes: ["hook.pre_tool", "hook.post_tool"],
     limit: 200
   });
   // Analyze tool success/failure patterns
   ```

3. **Activity Timeline**: Build session activity timeline
   ```typescript
   const timeline = await mcp__claudebench__session__state__get({
     sessionId: sessionId,
     fromTimestamp: startTime,
     toTimestamp: endTime,
     limit: 500
   });
   // Visualize session activity over time
   ```

## Prerequisites

- Session must exist with at least one event
- For condensed mode, state processor must have processed events

## Related Handlers

- [`session.rehydrate`](./rehydrate) - Restore session state for continuation
- [`session.snapshot.create`](./snapshot_create) - Create recovery snapshot
- [`task.list`](../task/list) - List tasks (alternative view)