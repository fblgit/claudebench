# system.get_state

Get system state atomically via Lua script.

## Method

`system.get_state`

## Description

Retrieves a comprehensive snapshot of the current ClaudeBench system state including active tasks, registered instances, and recent events. This method provides an atomic view of the distributed system for monitoring and debugging purposes.

⚠️ **Performance Note**: System state queries are cached and optimized but may return large datasets in active systems.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| _(no parameters)_ | - | - | This method takes no input parameters |

## Response

| Name | Type | Description |
|------|------|-------------|
| `tasks` | `array` | Active tasks in the system (undefined if none) |
| `instances` | `array` | Registered instances with their status (undefined if none) |
| `recentEvents` | `array` | Recent system events and activities (undefined if none) |

### Task Object Structure
```typescript
{
  id: string,           // Task identifier
  status: string,       // pending, in_progress, completed, failed
  assignedTo?: string,  // Instance ID if assigned
  priority: number,     // Task priority (0-100)
  createdAt: number,    // Creation timestamp
  // Additional task-specific fields
}
```

### Instance Object Structure  
```typescript
{
  id: string,           // Instance identifier
  roles: string[],      // Instance roles
  status: string,       // ACTIVE, IDLE, BUSY, OFFLINE
  lastSeen: number,     // Last heartbeat timestamp
  isLeader?: boolean,   // Leader status
  // Additional instance fields
}
```

### Event Object Structure
```typescript
{
  type: string,         // Event type (e.g., "task.created")
  payload: object,      // Event-specific data
  timestamp: number,    // Event timestamp
  instanceId?: string   // Originating instance
}
```

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.get_state",
  "params": {},
  "id": "get-state-1"
}
```

## JSON-RPC Response Example

### Active System
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tasks": [
      {
        "id": "t-12345",
        "status": "pending",
        "priority": 75,
        "createdAt": 1640995200000,
        "text": "Process data analysis"
      },
      {
        "id": "t-12346", 
        "status": "in_progress",
        "assignedTo": "worker-001",
        "priority": 85,
        "createdAt": 1640995150000,
        "text": "Generate report"
      }
    ],
    "instances": [
      {
        "id": "worker-001",
        "roles": ["worker"],
        "status": "BUSY",
        "lastSeen": 1640995205000,
        "isLeader": false
      },
      {
        "id": "leader-001",
        "roles": ["leader", "monitor"],
        "status": "ACTIVE", 
        "lastSeen": 1640995208000,
        "isLeader": true
      }
    ],
    "recentEvents": [
      {
        "type": "task.created",
        "payload": {
          "taskId": "t-12345",
          "priority": 75
        },
        "timestamp": 1640995200000,
        "instanceId": "leader-001"
      },
      {
        "type": "instance.registered",
        "payload": {
          "id": "worker-001",
          "roles": ["worker"]
        },
        "timestamp": 1640995100000
      }
    ]
  },
  "id": "get-state-1"
}
```

### Empty System
```json
{
  "jsonrpc": "2.0",
  "result": {},
  "id": "get-state-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tasks": undefined,
    "instances": undefined,
    "recentEvents": undefined
  },
  "id": "get-state-1"
}
```

## Redis Keys Affected

**Read Only:**
- `cb:task:*` - Active task data
- `cb:instance:*` - Registered instances
- `cb:stream:*` - Event streams for recent activities
- `cb:queue:*` - Task queues and assignments
- `cb:state:global` - Global system state snapshot

## Lua Script Details

This method uses the `getSystemState` Lua script which atomically:

1. **Collects active tasks** from Redis task keys
2. **Gathers instance data** from registration keys  
3. **Retrieves recent events** from event streams
4. **Filters and formats** data for client consumption
5. **Returns consistent snapshot** of system state

**Script Returns:**
```lua
{
  tasks = { ... },        -- Array of task objects
  instances = { ... },    -- Array of instance objects  
  recentEvents = { ... }  -- Array of event objects
}
```

## Data Filtering

The method applies intelligent filtering:
- **Empty arrays are undefined** to reduce response size
- **Recent events limited** to last 100 events
- **Stale instances excluded** based on heartbeat timestamps
- **Completed tasks filtered** unless recently modified

## Caching Behavior

System state queries are not cached due to:
- **Real-time requirements** for accurate state
- **Frequent state changes** in active systems
- **Atomic consistency needs** across Redis operations

## Prerequisites

- Redis server must be available for atomic script execution
- System should have proper instance registrations
- Event streams should be properly maintained

## Warnings

⚠️ **Large Responses**: Active systems may return substantial data; use pagination in UI

⚠️ **Circuit Breaker**: After 5 consecutive failures, circuit opens for 30 seconds

⚠️ **Rate Limiting**: Limited to 50 calls per minute to prevent system overload

⚠️ **Memory Usage**: Large systems may have significant memory requirements for state collection

⚠️ **Consistency**: State represents point-in-time snapshot; changes may occur during processing

## Performance Characteristics

- **Latency**: ~10-50ms for typical systems
- **Memory**: Proportional to active tasks and instances
- **CPU**: Linear with number of Redis keys scanned
- **Network**: Response size varies with system activity

## Related Methods

- [`system.metrics`](./metrics) - Get numerical system metrics
- [`system.health`](./health) - Check system health status
- [`task.list`](../task/list) - Get detailed task information
- [`system.check_health`](./check_health) - Monitor instance health