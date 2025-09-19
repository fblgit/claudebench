# system.unregister

Clean up instance registration when Claude Code session ends.

## Method

`system.unregister`

## Description

Performs graceful cleanup of a ClaudeBench instance registration when a session terminates. This method handles task reassignment to healthy workers, removes instance data from Redis, updates global system state, and triggers redistribution of workload to remaining instances.

⚠️ **Internal Operation**: This method is hidden from Claude and intended for session lifecycle management. Task reassignment is automatic and irreversible.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `instanceId` | `string` | Yes | Unique identifier of the instance to unregister (min 1 character) |
| `sessionId` | `string` | Yes | Session identifier associated with the instance (min 1 character) |
| `timestamp` | `number` | Yes | Timestamp when unregistration was requested |

## Response

| Name | Type | Description |
|------|------|-------------|
| `unregistered` | `boolean` | Whether the instance was successfully unregistered |
| `tasksReassigned` | `number` | Number of tasks that were reassigned to other workers |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.unregister",
  "params": {
    "instanceId": "worker-claude-001",
    "sessionId": "session-abc123",
    "timestamp": 1640995200000
  },
  "id": "unregister-1"
}
```

## JSON-RPC Response Example

### Successful Unregistration with Task Reassignment
```json
{
  "jsonrpc": "2.0",
  "result": {
    "unregistered": true,
    "tasksReassigned": 3
  },
  "id": "unregister-1"
}
```

### Instance Not Found (Still Success)
```json
{
  "jsonrpc": "2.0",
  "result": {
    "unregistered": true,
    "tasksReassigned": 0
  },
  "id": "unregister-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "unregistered": false,
    "tasksReassigned": 0
  },
  "id": "unregister-1"
}
```

## Redis Keys Affected

**Deleted:**
- `cb:instance:{instanceId}` - Instance registration data
- `cb:gossip:health:{instanceId}` - Health monitoring data

**Updated:**
- `cb:task:*` - Assigned tasks status changed to pending
- `cb:queue:tasks:pending` - Tasks added back to pending queue
- `cb:state:global` - Global system state with unregistration event
- `cb:metrics:global` - System metrics updated

**Read:**
- `cb:task:*` - Scan for tasks assigned to the unregistering instance
- `cb:instance:worker-*` - Find healthy workers for task reassignment

## Unregistration Process

### 1. Instance Validation
- Check if instance exists in Redis
- Retrieve instance roles and configuration
- Log instance details for audit trail

### 2. Task Reassignment (Workers Only)
For instances with "worker" role:
- **Scan assigned tasks** - Find tasks with `assignedTo: instanceId`
- **Update task status** - Change status from "assigned" to "pending"
- **Clear assignment** - Remove assignedTo field and add unassignment metadata
- **Return to queue** - Add tasks back to `cb:queue:tasks:pending` with priority
- **Track reassignments** - Count tasks moved for response

### Task Reassignment Details
```javascript
// Task update during reassignment
{
  status: "pending",           // Changed from "assigned"
  assignedTo: "",             // Cleared
  unassignedAt: "1640995200000", // Timestamp
  unassignReason: "instance_unregistered" // Reason code
}
```

### 3. Cleanup Operations
- **Remove instance key** from Redis
- **Delete gossip health** monitoring data
- **Clean associated data** structures

### 4. State Synchronization
- **Update global state** via `syncGlobalState` Lua script
- **Aggregate metrics** via `aggregateGlobalMetrics` script
- **Version tracking** for state consistency

### 5. Task Redistribution
After unregistration:
- **Find healthy workers** from remaining instances
- **Trigger auto-assignment** to redistribute reassigned tasks
- **Load balancing** across available workers

## Lua Script Integration

### syncGlobalState
**Parameters:**
```javascript
{
  action: "instance_unregistered",
  instanceId: "worker-claude-001",
  sessionId: "session-abc123", 
  tasksReassigned: 3,
  timestamp: 1640995200000
}
```

### aggregateGlobalMetrics
Updates system-wide metrics after instance removal.

### autoAssignTasks
Triggered on remaining workers to redistribute reassigned tasks.

## Event Emissions

### instance.unregistered
Emitted after successful unregistration:
```json
{
  "type": "instance.unregistered",
  "payload": {
    "id": "worker-claude-001",
    "sessionId": "session-abc123",
    "tasksReassigned": 3,
    "timestamp": 1640995200000
  }
}
```

## Task Reassignment Logic

### Assignment Strategy
1. **Identify assigned tasks** for the unregistering instance
2. **Preserve task priority** when returning to queue
3. **Maintain task metadata** including history
4. **Atomic operations** to prevent task loss
5. **Immediate redistribution** to healthy workers

### Queue Management
- Tasks maintain their original priority in the queue
- FIFO ordering within priority levels
- Automatic assignment triggers on available workers
- Load balancing across worker pool

## Error Handling

### Instance Not Found
- **Still returns success** since goal is ensured unregistration
- **No task reassignment** needed
- **Logs informational message**

### Partial Failures
- **Redis operations** may partially fail
- **Task reassignment** continues despite individual failures
- **Global state update** may proceed independently

### Recovery Mechanisms
- **Circuit breaker** provides fallback responses
- **Retry logic** in calling code for critical cases
- **Manual cleanup** possible via administrative tools

## Prerequisites

- Instance should be registered via [`system.register`](./register.md)
- Redis server must be available for cleanup operations
- Other healthy workers should exist for task reassignment
- Session management should track instance lifecycle

## Warnings

⚠️ **Hidden from Claude**: `mcp.visible: false` - not available to AI instances

⚠️ **Task Reassignment**: Assigned tasks are automatically moved to other workers

⚠️ **Rate Limiting**: Limited to 10 unregistrations per minute

⚠️ **Circuit Breaker**: After 5 consecutive failures, circuit opens for 30 seconds

⚠️ **State Consistency**: Unregistration affects global system state

⚠️ **Graceful Only**: No force termination - relies on cooperative shutdown

## Session Lifecycle Integration

This method is typically called by:
- **Session management** when Claude Code sessions terminate
- **Health monitoring** when instances become unresponsive  
- **Administrative tools** for planned maintenance
- **Graceful shutdown** procedures

## Performance Characteristics

- **Task scanning**: Linear with number of tasks assigned to instance
- **Reassignment**: ~5-10ms per task to reassign
- **Cleanup**: ~20-50ms for instance removal
- **State sync**: ~10-30ms for global state updates

## Related Methods

- [`system.register`](./register.md) - Instance registration
- [`system.heartbeat`](./heartbeat.md) - Instance liveness
- [`system.check_health`](./check_health.md) - Health monitoring with automatic cleanup
- [`task.claim`](../task/claim.md) - Manual task claiming by workers