---
sidebar_position: 3
title: session.snapshot.create
description: Create a snapshot of session state for recovery and archival
---

# session.snapshot.create

Create a point-in-time snapshot of session state for fast recovery, archival, or checkpoint creation. Snapshots capture the complete session context including tasks, tools, prompts, and todos.

## Request

### Method
`session.snapshot.create`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | ✓ | Session identifier to snapshot |
| `instanceId` | string | ✓ | Worker instance creating the snapshot |
| `reason` | enum | ✓ | Reason for snapshot: `pre_compact`, `manual`, `checkpoint`, `error_recovery` |
| `includeEvents` | boolean | ✗ | Include event references (default: true) |
| `metadata` | object | ✗ | Additional metadata to store with snapshot |

### Snapshot Reasons

| Reason | Description | Use Case |
|--------|-------------|----------|
| `pre_compact` | Before event stream compaction | Preserve state before removing old events |
| `manual` | User-initiated snapshot | Explicit recovery point creation |
| `checkpoint` | Periodic checkpoint | Regular interval backups |
| `error_recovery` | After error detection | Create recovery point after issues |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "session.snapshot.create",
  "params": {
    "sessionId": "session-123",
    "instanceId": "worker-1",
    "reason": "checkpoint",
    "metadata": {
      "description": "Before deploying new feature",
      "risk_level": "medium",
      "created_by": "automated_checkpoint"
    }
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
    "snapshotId": "snap-session-123-1758271800",
    "sessionId": "session-123",
    "timestamp": 1758271800000,
    "size": 4096,
    "eventCount": 256
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
      "validation": "reason must be one of: pre_compact, manual, checkpoint, error_recovery"
    }
  },
  "id": "req-001"
}
```

## Event Emission

This handler emits the following events:

| Event | When | Payload |
|-------|------|---------|
| `session.snapshot.created` | After successful snapshot creation | Snapshot details including ID, size, event count |

### Event Example

```json
{
  "type": "session.snapshot.created",
  "payload": {
    "snapshotId": "snap-session-123-1758271800",
    "sessionId": "session-123",
    "instanceId": "worker-1",
    "reason": "checkpoint",
    "eventCount": 256,
    "size": 4096,
    "timestamp": 1758271800000
  },
  "timestamp": 1758271800000
}
```

## Side Effects

### Redis Operations

**Read Operations:**
- `cb:snapshot:{sessionId}:{snapshotId}` - Read snapshot after creation
- Session context from state processor

**Write Operations:**
- `cb:snapshot:{sessionId}:{snapshotId}` - Create snapshot with:
  - `snapshotId`: Unique identifier
  - `sessionId`: Parent session
  - `timestamp`: Creation time
  - `eventCount`: Number of events captured
  - `context`: Serialized session state
  - `metadata`: Optional user metadata
- `cb:metrics:snapshots` - Update snapshot metrics:
  - Increment `count`
  - Increment `reason:{reason}` counter
  - Set `lastSnapshot` timestamp

### PostgreSQL Operations

When `persist: true` (default), snapshots are also stored in PostgreSQL:

**Table: `SessionSnapshot`**
- Creates new record with:
  - Complete snapshot data
  - Serialized context
  - Event statistics
  - Metadata
  - Time range covered

This provides:
- Durability beyond Redis
- Query capabilities
- Long-term archival
- Compliance/audit trail

## Performance Considerations

### Snapshot Size
- Context size depends on session activity
- Typical snapshot: 2-10 KB
- Large sessions (1000+ events): 10-50 KB
- Metadata adds minimal overhead

### Creation Time
- Small sessions: < 100ms
- Medium sessions: 100-500ms
- Large sessions: 500-2000ms
- PostgreSQL persistence adds 50-200ms

### Storage Impact
- Redis memory usage: ~5KB per snapshot
- PostgreSQL storage: ~10KB per snapshot
- Consider retention policies for old snapshots
- Automatic cleanup recommended

### Rate Limiting
- Limited to 10 snapshots per minute
- Circuit breaker after 3 failures
- 15-second timeout for large snapshots

## Usage Examples

### From Claude Code

```typescript
// Create checkpoint before risky operation
const snapshot = await mcp__claudebench__session__snapshot__create({
  sessionId: "session-123",
  instanceId: "worker-1",
  reason: "checkpoint",
  metadata: {
    operation: "database_migration",
    backup_before: true
  }
});

// Manual snapshot for archival
await mcp__claudebench__session__snapshot__create({
  sessionId: "session-123",
  instanceId: "worker-1",
  reason: "manual",
  metadata: {
    milestone: "v1.0 complete",
    archive: true
  }
});

// Pre-compaction snapshot
await mcp__claudebench__session__snapshot__create({
  sessionId: "session-123",
  instanceId: "worker-1",
  reason: "pre_compact",
  includeEvents: true
});
```

### Use Cases

1. **Checkpoint Strategy**: Regular checkpoints for long sessions
   ```typescript
   // Create checkpoint every hour
   async function createHourlyCheckpoint(sessionId: string) {
     const snapshot = await mcp__claudebench__session__snapshot__create({
       sessionId,
       instanceId: workerId,
       reason: "checkpoint",
       metadata: {
         type: "hourly",
         auto: true,
         hour: new Date().getHours()
       }
     });
     
     console.log(`Checkpoint created: ${snapshot.snapshotId}`);
     console.log(`Captured ${snapshot.eventCount} events`);
   }
   ```

2. **Pre-Operation Backup**: Safety before major changes
   ```typescript
   async function safeOperation(sessionId: string) {
     // Create recovery point
     const backup = await mcp__claudebench__session__snapshot__create({
       sessionId,
       instanceId: workerId,
       reason: "manual",
       metadata: {
         purpose: "pre-deployment",
         canRevert: true
       }
     });
     
     try {
       await performRiskyOperation();
     } catch (error) {
       // Can revert using backup.snapshotId
       await revertToSnapshot(backup.snapshotId);
     }
   }
   ```

3. **Error Recovery Point**: Snapshot after detecting issues
   ```typescript
   async function handleError(sessionId: string, error: Error) {
     // Create recovery snapshot
     const recovery = await mcp__claudebench__session__snapshot__create({
       sessionId,
       instanceId: workerId,
       reason: "error_recovery",
       metadata: {
         error: error.message,
         stack: error.stack,
         timestamp: Date.now()
       }
     });
     
     console.log(`Recovery point: ${recovery.snapshotId}`);
     // Attempt recovery procedures...
   }
   ```

## Snapshot Lifecycle

1. **Creation**: State processor captures current context
2. **Storage**: Saved to Redis (fast) and PostgreSQL (durable)
3. **Usage**: Available for rehydration and recovery
4. **Retention**: Subject to cleanup policies
5. **Archival**: Long-term storage in PostgreSQL

## Best Practices

1. **Strategic Timing**: Create snapshots at logical boundaries
2. **Descriptive Metadata**: Include context for future reference
3. **Retention Policy**: Implement cleanup for old snapshots
4. **Size Monitoring**: Track snapshot sizes for capacity planning
5. **Recovery Testing**: Regularly test snapshot restoration

## Prerequisites

- Active session with events to snapshot
- State processor must be operational
- Sufficient Redis memory for snapshot storage
- PostgreSQL connection for persistence (if enabled)

## Related Handlers

- [`session.rehydrate`](./rehydrate) - Restore from snapshots
- [`session.state.get`](./state_get) - View current session state
- [`system.metrics`](../system/metrics) - Monitor snapshot statistics