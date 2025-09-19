# system.heartbeat

Simple heartbeat check atomically via Lua script.

## Method

`system.heartbeat`

## Description

Renews an instance registration and maintains its presence in the ClaudeBench system. This lightweight operation updates the instance's last-seen timestamp and extends its TTL atomically. Essential for maintaining instance liveness and preventing task reassignment.

⚠️ **Critical for Instance Liveness**: Instances must send heartbeats every 30 seconds or less to avoid being marked as failed and having their tasks reassigned.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `instanceId` | `string` | Yes | Unique identifier of the instance sending the heartbeat (min 1 character) |

## Response

| Name | Type | Description |
|------|------|-------------|
| `alive` | `boolean` | Whether the heartbeat was successfully processed and instance is alive |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.heartbeat",
  "params": {
    "instanceId": "worker-claude-001"
  },
  "id": "heartbeat-1"
}
```

## JSON-RPC Response Example

### Successful Heartbeat
```json
{
  "jsonrpc": "2.0",
  "result": {
    "alive": true
  },
  "id": "heartbeat-1"
}
```

### Failed Heartbeat
```json
{
  "jsonrpc": "2.0",
  "result": {
    "alive": false
  },
  "id": "heartbeat-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "alive": false
  },
  "id": "heartbeat-1"
}
```

## Redis Keys Affected

**Updated:**
- `cb:instance:{instanceId}` - Instance registration data with refreshed TTL (30 seconds)
- `cb:instance:{instanceId}:lastSeen` - Timestamp of last heartbeat

**Read:**
- `cb:instance:{instanceId}` - Current instance state for validation

## Lua Script Details

This method uses the `instanceHeartbeat` Lua script which atomically:

1. **Validates instance exists** - Checks if instance is registered
2. **Updates last-seen timestamp** - Records current time
3. **Refreshes TTL** - Extends instance registration expiration
4. **Checks leader status** - Determines if instance is current leader

**Script Parameters:**
- `instanceId` (string): Instance identifier to refresh
- `ttl` (number): Time-to-live extension in seconds (30)

**Script Returns:**
```lua
{
  success = true|false,
  isLeader = true|false,
  error = "error_message"  -- Only present if success=false
}
```

## Error Conditions

The heartbeat can fail in several scenarios:

1. **Instance not registered** - Instance must call `system.register` first
2. **Redis connection failure** - Script execution fails
3. **Instance already expired** - TTL expired before heartbeat
4. **Circuit breaker open** - Too many recent failures

## Heartbeat Frequency

**Recommended frequency:** Every 10-15 seconds
**Maximum safe interval:** 25 seconds  
**Instance TTL:** 30 seconds
**Grace period:** 5 seconds before expiration

## Leader Status Detection

The heartbeat response includes leader status information:
- Leaders are logged when detected
- Used for leader-specific operations
- Helps with distributed coordination

## Prerequisites

- Instance must be registered via [`system.register`](./register)
- Redis server must be available for atomic operations
- Instance ID must match registration

## Warnings

⚠️ **High Frequency**: This method supports up to 1000 calls per minute due to its critical nature

⚠️ **Circuit Breaker**: After 20 consecutive failures, circuit opens for 10 seconds

⚠️ **Timeout**: Operations timeout after 2 seconds with fallback response

⚠️ **Instance Expiration**: Missing heartbeats for >30 seconds triggers task reassignment

⚠️ **Leader Coordination**: Leaders have additional responsibilities and longer heartbeat expectations

## Health Check Integration

Heartbeats are monitored by [`system.check_health`](./check_health):
- Stale instances (no heartbeat) are marked as failed
- Tasks are automatically reassigned to healthy instances
- Failed instances are removed from the active pool

## Related Methods

- [`system.register`](./register) - Initial instance registration
- [`system.check_health`](./check_health) - Instance failure detection
- [`system.unregister`](./unregister) - Clean instance shutdown
- [`system.get_state`](./get_state) - View instance status