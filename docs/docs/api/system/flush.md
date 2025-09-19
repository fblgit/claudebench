# system.flush

Flush all ClaudeBench data from Redis and optionally PostgreSQL.

## Method

`system.flush`

## Description

**🚨 DANGEROUS OPERATION**: Completely removes all ClaudeBench data from Redis and optionally PostgreSQL. This method is designed for system reset, testing scenarios, and clean-state initialization. All tasks, instances, metrics, and system state will be permanently destroyed.

⚠️ **DESTRUCTIVE**: This operation cannot be undone. All system data will be permanently lost.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `confirm` | `string` | Yes | Must be exactly `"FLUSH_ALL_DATA"` to confirm the destructive operation |
| `includePostgres` | `boolean` | No | Whether to also clear PostgreSQL data (default: true) |

## Response

| Name | Type | Description |
|------|------|-------------|
| `redis` | `object` | Details of Redis data cleanup |
| `redis.keysDeleted` | `number` | Total number of Redis keys deleted |
| `redis.patterns` | `array` | List of key patterns that were cleared |
| `postgres` | `object` | PostgreSQL cleanup details (only if `includePostgres: true`) |
| `postgres.tasksDeleted` | `number` | Number of tasks deleted from PostgreSQL |
| `timestamp` | `string` | ISO timestamp when flush operation completed |

## JSON-RPC Request Example

### Complete System Flush
```json
{
  "jsonrpc": "2.0",
  "method": "system.flush",
  "params": {
    "confirm": "FLUSH_ALL_DATA",
    "includePostgres": true
  },
  "id": "flush-all-1"
}
```

### Redis-Only Flush
```json
{
  "jsonrpc": "2.0",
  "method": "system.flush",
  "params": {
    "confirm": "FLUSH_ALL_DATA",
    "includePostgres": false
  },
  "id": "flush-redis-1"
}
```

## JSON-RPC Response Example

### Successful Complete Flush
```json
{
  "jsonrpc": "2.0",
  "result": {
    "redis": {
      "keysDeleted": 1247,
      "patterns": [
        "cb:task:*",
        "cb:instance:*",
        "cb:queue:*", 
        "cb:stream:*",
        "cb:metrics:*",
        "cb:circuit:*",
        "cb:ratelimit:*",
        "cb:todo:*",
        "cb:service:*",
        "cb:hook:*",
        "cb:session:*",
        "cb:health:*",
        "cb:quorum:*",
        "cb:batch:*",
        "cb:scaling:*"
      ]
    },
    "postgres": {
      "tasksDeleted": 89
    },
    "timestamp": "2024-01-01T12:30:45.123Z"
  },
  "id": "flush-all-1"
}
```

### Redis-Only Flush Response
```json
{
  "jsonrpc": "2.0", 
  "result": {
    "redis": {
      "keysDeleted": 1247,
      "patterns": [
        "cb:task:*",
        "cb:instance:*",
        "cb:queue:*",
        "cb:stream:*",
        "cb:metrics:*",
        "cb:circuit:*",
        "cb:ratelimit:*",
        "cb:todo:*",
        "cb:service:*",
        "cb:hook:*",
        "cb:session:*",
        "cb:health:*",
        "cb:quorum:*",
        "cb:batch:*",
        "cb:scaling:*"
      ]
    },
    "timestamp": "2024-01-01T12:30:45.123Z"
  },
  "id": "flush-redis-1"
}
```

### Invalid Confirmation
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": "confirm parameter must be exactly 'FLUSH_ALL_DATA'"
  },
  "id": "flush-invalid-1"
}
```

## Redis Patterns Cleared

The following key patterns are systematically deleted:

| Pattern | Description |
|---------|-------------|
| `cb:task:*` | All task data and metadata |
| `cb:instance:*` | Instance registrations and status |
| `cb:queue:*` | Task queues and assignments |
| `cb:stream:*` | Event streams and logs |
| `cb:metrics:*` | Performance metrics and counters |
| `cb:circuit:*` | Circuit breaker states |
| `cb:ratelimit:*` | Rate limiting data |
| `cb:todo:*` | Todo/checklist items |
| `cb:service:*` | Service configuration data |
| `cb:hook:*` | Lifecycle hook data |
| `cb:session:*` | Session and authentication data |
| `cb:health:*` | Health check data |
| `cb:quorum:*` | Voting and consensus data |
| `cb:batch:*` | Batch processing coordination |
| `cb:scaling:*` | Auto-scaling metrics |

## PostgreSQL Tables Cleared

When `includePostgres: true`:

- **tasks** table - All task records are deleted via `DELETE FROM tasks`
- **Events** are not stored in PostgreSQL (Redis-only)

## Batch Deletion Process

To avoid blocking Redis during large flushes:

1. **Key Discovery**: Each pattern is scanned for matching keys
2. **Batch Processing**: Keys deleted in batches of 100
3. **Progress Logging**: Deletion progress logged per pattern
4. **Error Handling**: Individual pattern failures don't stop the overall operation

## Event Emissions

### system.flushed
Emitted after successful flush completion:
```json
{
  "type": "system.flushed",
  "payload": {
    "redis": 1247,
    "postgres": {
      "tasksDeleted": 89
    },
    "timestamp": "2024-01-01T12:30:45.123Z"
  }
}
```

## Security & Safety Features

### Confirmation Requirement
- **Exact string match**: Must provide `"FLUSH_ALL_DATA"` exactly
- **Case sensitive**: Prevents accidental execution
- **No abbreviations**: No shortcuts accepted

### Rate Limiting
- **Extremely restrictive**: Only 1 flush operation per minute
- **Circuit breaker protection**: Prevents abuse
- **No caching**: Operation never cached

### MCP Visibility
- **Hidden from Claude**: `mcp.visible: false` in handler configuration
- **Administrative only**: Intended for human operators only

## Use Cases

### Development & Testing
```bash
# Reset development environment
curl -X POST localhost:3000/api/system/flush \
  -H "Content-Type: application/json" \
  -d '{"confirm": "FLUSH_ALL_DATA"}'
```

### CI/CD Pipeline
```javascript
// Clean state between test suites
await client.call('system.flush', {
  confirm: 'FLUSH_ALL_DATA',
  includePostgres: true
});
```

### System Migration
```javascript
// Prepare for data migration
await client.call('system.flush', {
  confirm: 'FLUSH_ALL_DATA',
  includePostgres: false  // Keep PostgreSQL for migration
});
```

### Emergency Reset
```javascript
// Emergency system reset
await client.call('system.flush', {
  confirm: 'FLUSH_ALL_DATA',
  includePostgres: true
});
```

## Prerequisites

- Redis server must be accessible for key deletion
- PostgreSQL connection required if `includePostgres: true`
- Administrative privileges should be verified before use
- Confirm system is in a state where data loss is acceptable

## Warnings

⚠️ **IRREVERSIBLE**: Once executed, all data is permanently lost

⚠️ **SYSTEM DISRUPTION**: Active instances and tasks will be terminated

⚠️ **NO BACKUP**: This method does not create backups - backup manually if needed

⚠️ **CASCADING EFFECTS**: Connected systems may be affected by data loss

⚠️ **PRODUCTION USE**: Extremely dangerous in production environments

⚠️ **RATE LIMITED**: Only 1 operation per minute - plan accordingly

## Recovery After Flush

After flushing, the system will be in a clean state:

1. **Re-register instances** via [`system.register`](./register.md)
2. **Recreate tasks** as needed via [`task.create`](../task/create.md)
3. **Restart monitoring** and health checks
4. **Verify system functionality** before resuming normal operations

## Related Methods

- [`system.health`](./health.md) - Check system health before flush
- [`system.get_state`](./get_state.md) - Verify clean state after flush  
- [`system.register`](./register.md) - Re-register instances after flush
- [`task.create`](../task/create.md) - Recreate tasks after flush