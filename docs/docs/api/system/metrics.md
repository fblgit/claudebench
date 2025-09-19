# system.metrics

Get aggregated system metrics atomically via Lua script.

## Method

`system.metrics`

## Description

Retrieves comprehensive performance metrics and statistics from the ClaudeBench system. This method aggregates data from multiple Redis keys to provide insights into system performance, resource usage, and operational health. Supports both basic and detailed metric reporting.

⚠️ **Performance Impact**: Detailed metrics collection may take longer as it queries multiple Redis keys and performs calculations.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `detailed` | `boolean` | No | Request detailed metrics including per-handler stats, circuit breaker data, cache metrics (default: false) |

## Response

### Basic Metrics (detailed=false)

| Name | Type | Description |
|------|------|-------------|
| `eventsProcessed` | `number` | Total number of events processed |
| `tasksCompleted` | `number` | Total number of completed tasks |
| `averageLatency` | `number` | Average response latency in milliseconds |
| `memoryUsage` | `number` | Current memory usage in MB |

### Detailed Metrics (detailed=true)

Includes all basic metrics plus:

| Name | Type | Description |
|------|------|-------------|
| `circuitBreaker` | `object` | Circuit breaker statistics |
| `queue` | `object` | Task queue metrics |
| `cache` | `object` | Cache performance metrics |
| `counters` | `object` | System counters by category |
| `global` | `object` | Global system metrics |
| `scaling` | `object` | System scaling metrics |
| `current` | `object` | Current system state metrics |
| `mcpCalls` | `number` | Total MCP (Model Context Protocol) calls |
| `systemHealthCheck` | `object` | Health check metrics |
| `handlers` | `object` | Per-handler performance metrics |

## JSON-RPC Request Example

### Basic Metrics
```json
{
  "jsonrpc": "2.0",
  "method": "system.metrics",
  "params": {
    "detailed": false
  },
  "id": "metrics-basic-1"
}
```

### Detailed Metrics
```json
{
  "jsonrpc": "2.0",
  "method": "system.metrics", 
  "params": {
    "detailed": true
  },
  "id": "metrics-detailed-1"
}
```

## JSON-RPC Response Example

### Basic Metrics Response
```json
{
  "jsonrpc": "2.0",
  "result": {
    "eventsProcessed": 1250,
    "tasksCompleted": 85,
    "averageLatency": 45.67,
    "memoryUsage": 128.5
  },
  "id": "metrics-basic-1"
}
```

### Detailed Metrics Response
```json
{
  "jsonrpc": "2.0",
  "result": {
    "eventsProcessed": 1250,
    "tasksCompleted": 85,
    "averageLatency": 45.67,
    "memoryUsage": 128.5,
    "circuitBreaker": {
      "totalSuccesses": 1200,
      "totalFailures": 50,
      "totalTrips": 2,
      "successRate": 0.96
    },
    "queue": {
      "depth": 12,
      "pending": 8,
      "throughput": 15.5
    },
    "cache": {
      "hits": 450,
      "misses": 75,
      "sets": 125,
      "hitRate": 0.857
    },
    "global": {
      "taskSuccess": 82,
      "taskFailure": 3,
      "systemSuccess": 1200,
      "totalEvents": 1250,
      "totalTasks": 85,
      "avgLatency": 45.67,
      "throughput": 18.2
    },
    "current": {
      "eventsTotal": 1250,
      "queueDepth": 12,
      "instancesActive": 3,
      "tasksPending": 8,
      "tasksCompleted": 85,
      "metricsStartTime": 1640995000000
    },
    "handlers": {
      "task.create": {
        "totalCalls": 95,
        "successCount": 93,
        "errorCount": 2,
        "avgResponseTime": 25.3,
        "circuitState": "CLOSED",
        "rateLimitHits": 0,
        "cacheHitRate": 0.75,
        "lastCalled": "2024-01-01T12:30:45Z"
      },
      "system.health": {
        "totalCalls": 200,
        "successCount": 200,
        "errorCount": 0,
        "avgResponseTime": 12.1,
        "circuitState": "CLOSED",
        "rateLimitHits": 0,
        "lastCalled": "2024-01-01T12:35:00Z"
      }
    },
    "mcpCalls": 156,
    "systemHealthCheck": {
      "lastCheck": 1640995200000
    }
  },
  "id": "metrics-detailed-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "eventsProcessed": undefined,
    "tasksCompleted": undefined, 
    "averageLatency": undefined,
    "memoryUsage": undefined
  },
  "id": "metrics-1"
}
```

## Redis Keys Accessed

**Metrics Sources:**
- `cb:metrics:current` - Current system metrics
- `cb:metrics:queues` - Queue performance data
- `cb:metrics:circuit:all` - Circuit breaker statistics
- `cb:metrics:counters` - System counters
- `cb:metrics:cache:global` - Global cache metrics
- `cb:metrics:cache:handler` - Per-handler cache data
- `cb:metrics:global` - Global system metrics
- `cb:metrics:scaling` - Scaling and load metrics
- `cb:metrics:system:health` - Health check metrics
- `cb:metrics:events:*` - Per-event type metrics
- `cb:metrics:mcp:calls` - MCP call counter

**Backward Compatibility Keys:**
- `cb:metrics:events:total` - Legacy total events
- `cb:metrics:tasks:completed` - Legacy completed tasks
- `cb:metrics:latency:average` - Legacy average latency

## Metric Calculations

### Average Latency
Calculated by aggregating latency across all event types:
```
totalLatency = Σ(avgLatency[i] × count[i]) for all events
totalEvents = Σ(count[i]) for all events  
averageLatency = totalLatency / totalEvents
```

### Memory Usage
Real-time Node.js heap usage converted to MB:
```
memoryUsage = process.memoryUsage().heapUsed / 1024 / 1024
```

### Cache Hit Rate
Combined across all cache sources:
```
hitRate = totalHits / (totalHits + totalMisses)
```

## Detailed Metrics Structure

### Circuit Breaker Object
```typescript
{
  totalSuccesses: number,   // Successful operations
  totalFailures: number,    // Failed operations  
  totalTrips: number,       // Circuit breaker activations
  successRate: number       // Success percentage (0-1)
}
```

### Queue Object
```typescript
{
  depth: number,           // Current queue depth
  pending: number,         // Pending tasks count
  throughput: number       // Tasks per second
}
```

### Cache Object  
```typescript
{
  hits: number,           // Cache hits
  misses: number,         // Cache misses
  sets: number,           // Cache writes
  hitRate?: number        // Hit rate percentage (0-1)
}
```

### Handler Object
```typescript
{
  totalCalls: number,        // Total invocations
  successCount: number,      // Successful calls
  errorCount: number,        // Failed calls
  avgResponseTime: number,   // Average latency (ms)
  circuitState: string,      // OPEN/CLOSED/HALF_OPEN
  rateLimitHits?: number,    // Rate limit violations
  cacheHitRate?: number,     // Handler cache hit rate
  lastCalled?: string        // ISO timestamp of last call
}
```

## Prerequisites

- Redis server must be available for metric collection
- Metrics collection should be properly configured
- System should be actively processing events for meaningful data

## Warnings

⚠️ **Rate Limiting**: Limited to 20 calls per minute to prevent performance impact

⚠️ **Circuit Breaker**: After 5 consecutive failures, circuit opens for 30 seconds

⚠️ **Performance**: Detailed metrics may take 1-3 seconds for large systems

⚠️ **Memory**: Large handler counts may increase response size significantly

⚠️ **Calculation Overhead**: Complex aggregations performed in real-time

## Performance Characteristics

**Basic Metrics:**
- Latency: ~50-100ms
- Memory: Minimal
- CPU: Low

**Detailed Metrics:**  
- Latency: ~200-1000ms
- Memory: Moderate (proportional to handlers)
- CPU: Higher due to aggregation

## Related Methods

- [`system.health`](./health) - System health status
- [`system.get_state`](./get_state) - Current system state
- [`system.check_health`](./check_health) - Instance health monitoring