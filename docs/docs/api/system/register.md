# system.register

Register an instance atomically via Lua script.

## Method

`system.register`

## Description

Atomically registers a new ClaudeBench instance with specified roles in the distributed system. This method handles instance registration, leader election, task auto-assignment for workers, and global state synchronization.

⚠️ **Critical Operation**: Instance registration is atomic and affects system-wide state including task assignment and leader election.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier for the instance (min 1 character) |
| `roles` | `array` | Yes | Array of role strings this instance can fulfill |

### Common Roles

- `"worker"` - Can execute tasks from the queue
- `"leader"` - Can coordinate system operations
- `"specialist"` - Specialized for certain task types
- `"monitor"` - System monitoring and health checks

## Response

| Name | Type | Description |
|------|------|-------------|
| `registered` | `boolean` | Whether the instance was successfully registered |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.register",
  "params": {
    "id": "worker-claude-001",
    "roles": ["worker", "specialist"]
  },
  "id": "register-1"
}
```

## JSON-RPC Response Example

### Successful Registration
```json
{
  "jsonrpc": "2.0",
  "result": {
    "registered": true
  },
  "id": "register-1"
}
```

### Registration Failed
```json
{
  "jsonrpc": "2.0",
  "result": {
    "registered": false
  },
  "id": "register-1"
}
```

## Redis Keys Affected

**Created/Updated:**
- `cb:instance:{id}` - Instance registration data with TTL (30 seconds)
- `cb:health:gossip:{id}` - Instance health status
- `cb:metrics:global` - Global system metrics  
- `cb:queue:tasks:pending` - Task queue (for auto-assignment)
- `cb:state:global` - Global system state with version

**Read:**
- `cb:instance:*` - Existing instances for leader election
- `cb:queue:tasks:pending` - Pending tasks for worker assignment

## Lua Script Details

This method uses multiple Lua scripts in sequence:

### 1. `registerInstance`
**Parameters:**
- `instanceId` (string): Unique instance identifier
- `roles` (array): List of role strings  
- `ttl` (number): Time-to-live for registration (30 seconds)

**Returns:**
```lua
{
  success = true|false,
  becameLeader = true|false,
  message = "description"
}
```

### 2. `updateGossipHealth` 
**Parameters:**
- `instanceId` (string): Instance ID
- `status` (string): Health status ("healthy")

### 3. `syncGlobalState`
**Parameters:**
- `stateData` (object): State change information

**Returns:**
```lua
{
  version = number  -- New global state version
}
```

### 4. `aggregateGlobalMetrics`
Updates system-wide metrics after instance change.

### 5. `autoAssignTasks` (Workers Only)
**Parameters:**
- `instanceId` (string): Worker instance ID

**Returns:**
```lua
{
  assigned = number,  -- Tasks assigned
  total = number     -- Total tasks available
}
```

## Event Emissions

### instance.registered
Emitted when registration succeeds:
```json
{
  "type": "instance.registered", 
  "payload": {
    "id": "worker-claude-001",
    "roles": ["worker", "specialist"],
    "becameLeader": false,
    "timestamp": 1640995200000
  }
}
```

## Auto-Assignment Logic

When a worker registers:

1. **Check queue size** before assignment
2. **Atomic assignment** via Lua script to prevent race conditions  
3. **Log assignment results** for monitoring
4. **Respects task priorities** and worker capabilities

Assignment algorithm:
- Distributes tasks evenly across available workers
- Prioritizes higher-priority tasks first
- Considers worker specialization roles

## Prerequisites

- Redis server must be available for atomic script execution
- Instance ID must be unique within the system
- Roles array must contain valid role strings

## Warnings

⚠️ **TTL Management**: Instances expire after 30 seconds without heartbeat renewal

⚠️ **Rate Limiting**: Limited to 10 registrations per minute to prevent abuse

⚠️ **Circuit Breaker**: After 5 consecutive failures, circuit opens for 30 seconds

⚠️ **Leader Election**: First successful registration may become system leader

⚠️ **Auto-Assignment**: Worker instances automatically receive pending tasks

## Related Methods

- [`system.heartbeat`](./heartbeat) - Renew instance registration
- [`system.unregister`](./unregister) - Clean shutdown and task reassignment  
- [`task.claim`](../task/claim) - Manual task claiming for workers
- [`system.get_state`](./get_state) - View registered instances