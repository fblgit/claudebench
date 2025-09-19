# system.check_health

Check instance health and handle failures.

## Method

`system.check_health`

## Description

Monitors the health of all registered ClaudeBench instances and automatically handles failures by reassigning tasks to healthy instances. This method scans instance heartbeat timestamps, identifies stale instances, and performs atomic task reassignment to maintain system reliability.

⚠️ **Automatic Task Reassignment**: Failed instances have their tasks automatically redistributed to healthy workers - this operation is irreversible.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `timeout` | `number` | No | Timeout in milliseconds for considering an instance stale (default: 10000ms) |

## Response

| Name | Type | Description |
|------|------|-------------|
| `healthy` | `array` | List of instance IDs that are healthy and responding |
| `failed` | `array` | List of instance IDs that have been marked as failed |
| `reassigned` | `object` | Map of failed instance IDs to number of tasks reassigned from each |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.check_health",
  "params": {
    "timeout": 15000
  },
  "id": "check-health-1"
}
```

### Default Timeout Request
```json
{
  "jsonrpc": "2.0", 
  "method": "system.check_health",
  "params": {},
  "id": "check-health-2"
}
```

## JSON-RPC Response Example

### All Instances Healthy
```json
{
  "jsonrpc": "2.0",
  "result": {
    "healthy": [
      "worker-claude-001",
      "worker-claude-002", 
      "leader-001"
    ],
    "failed": [],
    "reassigned": {}
  },
  "id": "check-health-1"
}
```

### Some Instances Failed
```json
{
  "jsonrpc": "2.0",
  "result": {
    "healthy": [
      "worker-claude-001",
      "leader-001"
    ],
    "failed": [
      "worker-claude-002",
      "worker-claude-003"
    ],
    "reassigned": {
      "worker-claude-002": 3,
      "worker-claude-003": 1
    }
  },
  "id": "check-health-1"
}
```

### No Instances Registered
```json
{
  "jsonrpc": "2.0",
  "result": {
    "healthy": [],
    "failed": [],
    "reassigned": {}
  },
  "id": "check-health-1"
}
```

## Redis Keys Affected

**Read:**
- `cb:instance:*` - All instance registration keys
- Instance-specific fields:
  - `lastSeen` - Last heartbeat timestamp
  - `status` - Current instance status

**Updated:**
- `cb:metrics:health` - Health check statistics
- Task assignment keys (via `reassignFailedTasks` script)

**Created:**
- Health metrics with current timestamp

## Health Check Algorithm

### Instance Status Evaluation

1. **Get all instances** from `cb:instance:*` pattern
2. **For each instance**:
   - Check current `status` field
   - If `OFFLINE` → Add to failed list (skip further checks)
   - Get `lastSeen` timestamp
   - Calculate time since last heartbeat
   - If `timeSinceLastSeen > timeout` → Mark as failed

3. **For failed instances**:
   - Call `reassignFailedTasks` Lua script
   - Update instance status to `OFFLINE`
   - Emit `instance.failed` event

### Task Reassignment Process

When an instance fails, the `reassignFailedTasks` Lua script:

1. **Identifies assigned tasks** for the failed instance
2. **Redistributes tasks** to healthy worker instances
3. **Updates task assignment** atomically
4. **Returns reassignment statistics**

## Lua Script Details

### reassignFailedTasks Script

**Parameters:**
- `instanceId` (string): Failed instance identifier

**Script Returns:**
```lua
{
  reassigned = number,  -- Number of tasks reassigned
  workers = number     -- Number of worker instances that received tasks
}
```

**Operations:**
- Atomically moves tasks from failed instance to healthy workers
- Updates task assignment metadata
- Maintains task queue integrity

## Event Emissions

### instance.failed
Emitted for each failed instance:
```json
{
  "type": "instance.failed",
  "payload": {
    "id": "worker-claude-002",
    "lastSeen": 1640995100000,
    "tasksReassigned": 3
  }
}
```

## Health Metrics

The method updates `cb:metrics:health` with:
```json
{
  "healthyInstances": "2",
  "failedInstances": "1", 
  "lastCheck": "1640995200000"
}
```

## Caching

- **Cache Duration**: 5 seconds to prevent excessive health checks
- **Cache Key**: Based on timeout parameter
- **Cache Benefits**: Reduces Redis load during frequent health monitoring

## Timeout Behavior

### Instance Classification by Timeout

| Last Seen | Status | Action |
|-----------|--------|---------|
| < timeout | Healthy | Continue normal operation |
| ≥ timeout | Failed | Mark offline, reassign tasks |
| No timestamp | Failed | Consider dead, reassign tasks |
| Status=OFFLINE | Failed | Already marked, skip checks |

### Recommended Timeouts

- **Development**: 10-15 seconds (default: 10s)
- **Production**: 30-60 seconds  
- **High-latency networks**: 60+ seconds
- **Testing**: 5 seconds

## Prerequisites

- Redis server must be available for health checks and task reassignment
- Instances should be registered via [`system.register`](./register)
- Healthy instances should send regular [`system.heartbeat`](./heartbeat)
- Task assignment system should be properly configured

## Warnings

⚠️ **Automatic Reassignment**: Tasks are automatically moved from failed instances - ensure timeout is appropriate

⚠️ **Rate Limiting**: Limited to 100 health checks per minute

⚠️ **Caching**: Results cached for 5 seconds - immediate consistency not guaranteed

⚠️ **False Positives**: Network issues may cause healthy instances to appear failed

⚠️ **Cascading Failures**: Large numbers of failures may overload remaining instances

## Performance Characteristics

- **Scan time**: Linear with number of registered instances (~1-5ms per instance)
- **Reassignment time**: Depends on number of tasks to reassign (~10-50ms per batch)
- **Memory usage**: Minimal for result collection
- **Redis operations**: Proportional to instance count and task reassignments

## Monitoring Integration

Health check results are ideal for:
- **System dashboards** showing instance status
- **Alerting systems** for instance failures  
- **Load balancing** decisions
- **Capacity planning** based on failure patterns

## Related Methods

- [`system.heartbeat`](./heartbeat) - Instance liveness reporting
- [`system.register`](./register) - Instance registration
- [`system.metrics`](./metrics) - System performance metrics
- [`system.get_state`](./get_state) - Current system state overview
- [`task.list`](../task/list) - View task assignments after reassignment