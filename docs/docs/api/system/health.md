# system.health

Get system health status atomically via Lua script.

## Method

`system.health`

## Description

Performs a comprehensive health check of all ClaudeBench services (Redis, PostgreSQL, MCP) using atomic Lua script operations. This method provides real-time system status with circuit breaker protection and fallback responses.

⚠️ **Performance Note**: Health checks use a 5-second timeout and are subject to circuit breaker protection. Failed health checks return a predefined unhealthy status.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| _(no parameters)_ | - | - | This method takes no input parameters |

## Response

| Name | Type | Description |
|------|------|-------------|
| `status` | `string` | Overall system status: `"healthy"`, `"degraded"`, or `"unhealthy"` |
| `services` | `object` | Service-specific health status |
| `services.redis` | `boolean` | Redis connection and operation status |
| `services.postgres` | `boolean` | PostgreSQL connection and query status |
| `services.mcp` | `boolean` | MCP (Model Context Protocol) service status |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.health",
  "params": {},
  "id": "health-check-1"
}
```

## JSON-RPC Response Example

### Healthy System
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "healthy",
    "services": {
      "redis": true,
      "postgres": true,
      "mcp": true
    }
  },
  "id": "health-check-1"
}
```

### Degraded System
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "degraded",
    "services": {
      "redis": true,
      "postgres": false,
      "mcp": true
    }
  },
  "id": "health-check-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "status": "unhealthy",
    "services": {
      "redis": false,
      "postgres": false,
      "mcp": false
    }
  },
  "id": "health-check-1"
}
```

## Redis Keys Affected

The health check reads from various Redis keys to determine system status:

- `cb:instance:*` - Active instance registrations
- `cb:metrics:*` - System metrics and counters
- `cb:circuit:*` - Circuit breaker states
- Connection tests to Redis itself

## Lua Script Details

This method uses the `getSystemHealth` Lua script which atomically:

1. **Tests Redis connectivity** - Verifies Redis is responding
2. **Checks instance health** - Examines registered instances
3. **Validates service states** - Tests PostgreSQL and MCP connectivity
4. **Aggregates status** - Determines overall system health

**Script Parameters:**
- `timeout` (number): Maximum time in milliseconds for health checks (default: 5000)

**Script Returns:**
```lua
{
  status = "healthy|degraded|unhealthy",
  services = {
    redis = true|false,
    postgres = true|false, 
    mcp = true|false
  }
}
```

## Prerequisites

- Redis server must be available for script execution
- Instance registration system should be active
- Services being checked should be properly configured

## Warnings

⚠️ **Circuit Breaker**: After 10 consecutive failures, the circuit breaker opens for 20 seconds, returning fallback unhealthy status

⚠️ **Rate Limiting**: Limited to 100 calls per minute per instance

⚠️ **Timeout**: Health checks timeout after 3 seconds with circuit breaker fallback

## Related Methods

- [`system.check_health`](./check_health.md) - Check and handle instance failures
- [`system.metrics`](./metrics.md) - Get detailed system metrics
- [`system.get_state`](./get_state.md) - Get current system state