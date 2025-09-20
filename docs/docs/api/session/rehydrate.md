---
sidebar_position: 2
title: session.rehydrate
description: Rehydrate session state for resuming interrupted work
---

# session.rehydrate

Restore session state for work continuation by rehydrating from snapshots and replaying recent events. This handler enables seamless recovery after interruptions, restarts, or context switches.

## Request

### Method
`session.rehydrate`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | ✓ | Session identifier to rehydrate |
| `instanceId` | string | ✓ | Worker instance taking over the session |
| `snapshotId` | string | ✗ | Specific snapshot to restore from |
| `fromTimestamp` | number | ✗ | Apply events after this timestamp |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "session.rehydrate",
  "params": {
    "sessionId": "session-123",
    "instanceId": "worker-2",
    "snapshotId": "snap-session-123-1758271000"
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
    "sessionId": "session-123",
    "rehydrated": true,
    "snapshot": {
      "id": "snap-session-123-1758271000",
      "timestamp": 1758271000000,
      "eventCount": 142
    },
    "context": {
      "lastTasks": [
        {
          "id": "t-123",
          "text": "Build dashboard component",
          "status": "in_progress"
        },
        {
          "id": "t-124",
          "text": "Write unit tests",
          "status": "pending"
        }
      ],
      "lastTools": [
        "task.create",
        "swarm.decompose",
        "Edit",
        "MultiEdit"
      ],
      "lastPrompt": "Help me build a real-time analytics dashboard with charts",
      "activeTodos": [
        {
          "content": "Implement data fetching",
          "status": "in_progress"
        },
        {
          "content": "Add WebSocket support",
          "status": "pending"
        }
      ]
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
      "validation": "sessionId and instanceId are required"
    }
  },
  "id": "req-001"
}
```

## Event Emission

This handler emits the following events:

| Event | When | Payload |
|-------|------|---------|
| `session.rehydrated` | After successful rehydration | Session ID, instance ID, snapshot ID, event count |

### Event Example

```json
{
  "type": "session.rehydrated",
  "payload": {
    "sessionId": "session-123",
    "instanceId": "worker-2",
    "snapshotId": "snap-session-123-1758271000",
    "eventCount": 142
  },
  "timestamp": 1758271800000
}
```

## Side Effects

### Redis Operations

**Read Operations:**
- `cb:session:state:{sessionId}` - Read current session state
- `cb:snapshot:{sessionId}:{snapshotId}` - Read snapshot data
- `cb:snapshot:{sessionId}:*` - Find available snapshots
- `cb:stream:session:{sessionId}` - Read events after snapshot/timestamp

**Write Operations:**
- `cb:session:state:{sessionId}` - Update instance association
  - Sets `instanceId`: Current worker
  - Sets `rehydratedAt`: Timestamp
  - Sets `isActive`: "true"
- `cb:metrics:session:rehydrations` - Update rehydration metrics
  - Increments `count`
  - Sets `lastRehydration`: Timestamp

### PostgreSQL Operations

This handler does not interact with PostgreSQL directly. Snapshots may be persisted by the snapshot creation handler.

## Performance Considerations

### Processing Time
- Snapshot restoration is fast (< 100ms)
- Event replay depends on event count (100 events ≈ 50ms)
- Large sessions (1000+ events) may take several seconds

### Optimization
- Rehydration is not cached (always fresh state)
- Uses latest snapshot if not specified
- Applies only new events after snapshot
- State processor maintains pre-computed context

### Rate Limiting
- Limited to 20 requests per minute per instance
- Circuit breaker activates after 3 failures
- 10-second timeout for complex rehydrations

## Usage Examples

### From Claude Code

```typescript
// Basic rehydration with auto-snapshot selection
await mcp__claudebench__session__rehydrate({
  sessionId: "session-123",
  instanceId: "worker-1"
});

// Rehydrate from specific snapshot
await mcp__claudebench__session__rehydrate({
  sessionId: "session-123",
  instanceId: "worker-1",
  snapshotId: "snap-session-123-1758270000"
});

// Rehydrate and apply recent events
await mcp__claudebench__session__rehydrate({
  sessionId: "session-123",
  instanceId: "worker-1",
  fromTimestamp: Date.now() - 3600000 // Last hour
});
```

### Use Cases

1. **Resume After Restart**: Continue work after worker restart
   ```typescript
   // Worker startup sequence
   const rehydrated = await mcp__claudebench__session__rehydrate({
     sessionId: savedSessionId,
     instanceId: myInstanceId
   });
   
   console.log("Resuming work on:", rehydrated.context.lastPrompt);
   console.log("Active tasks:", rehydrated.context.lastTasks);
   ```

2. **Context Switch**: Transfer session between workers
   ```typescript
   // Worker A releases session
   await notifySessionRelease(sessionId);
   
   // Worker B takes over
   const context = await mcp__claudebench__session__rehydrate({
     sessionId: sessionId,
     instanceId: "worker-b"
   });
   
   // Continue with restored context
   ```

3. **Error Recovery**: Restore from last known good state
   ```typescript
   try {
     // Risky operation...
   } catch (error) {
     // Restore from checkpoint
     const recovered = await mcp__claudebench__session__rehydrate({
       sessionId: sessionId,
       instanceId: instanceId,
       snapshotId: lastGoodSnapshot
     });
     
     console.log("Recovered to state with", 
       recovered.snapshot.eventCount, "events");
   }
   ```

## Rehydration Process

The rehydration process follows these steps:

1. **Update Session State**: Associate session with new instance
2. **Find Snapshot**: Use specified snapshot or find latest
3. **Load Context**: Retrieve pre-computed session context
4. **Apply New Events**: Process events after snapshot/timestamp
5. **Emit Event**: Notify system of successful rehydration
6. **Update Metrics**: Track rehydration statistics

## Prerequisites

- Session must exist with prior events
- For snapshot restoration, snapshot must exist
- Instance must be registered in the system
- State processor must be operational

## Related Handlers

- [`session.state.get`](./state_get) - View session state without rehydrating
- [`session.snapshot.create`](./snapshot_create) - Create recovery snapshots
- [`system.register`](../system/register) - Register worker instance