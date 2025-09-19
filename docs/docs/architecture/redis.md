---
sidebar_position: 2
---

# Redis Infrastructure

ClaudeBench implements a Redis-first architecture where Redis serves as the primary infrastructure for all real-time operations, state coordination, and distributed system primitives.

## Philosophy: Redis as Infrastructure

Unlike traditional architectures that treat Redis as a cache, ClaudeBench uses Redis as the foundational infrastructure layer, providing:

- **State coordination** across multiple instances
- **Event distribution** via pub/sub and streams  
- **Atomic operations** via Lua scripts
- **Distributed primitives** like locks, queues, and counters
- **Time-based operations** with TTL and sliding windows

## Key Namespace Design

### Consistent Namespace Pattern

All Redis keys follow the `cb:{type}:{identifier}` pattern for clear organization and conflict prevention:

```
cb:instance:{id}          # Instance metadata and health
cb:task:{id}              # Task state and data
cb:queue:tasks:pending    # Global task queue
cb:queue:instance:{id}    # Per-instance task queues
cb:stream:{eventType}     # Event streams for persistence
cb:circuit:{event}:state  # Circuit breaker state
cb:metrics:global         # Aggregated system metrics
cb:gossip:health          # Distributed health data
cb:batch:{id}            # Batch processing coordination
cb:processed:events       # Event deduplication tracking
```

### Namespace Categories

| Category | Purpose | Examples | TTL Strategy |
|----------|---------|----------|--------------|
| **Instance** | Instance lifecycle | `cb:instance:*`, `cb:capacity:*` | Heartbeat-based (30s) |
| **Task** | Task management | `cb:task:*`, `cb:queue:*` | Business logic driven |
| **Event** | Event processing | `cb:stream:*`, `cb:processed:*` | Audit retention (24h) |
| **Coordination** | Distributed coordination | `cb:batch:*`, `cb:gossip:*` | Operation-based (60-300s) |
| **Metrics** | Observability | `cb:metrics:*`, `cb:circuit:*` | Retention policy (1h-24h) |

## Data Structures and Patterns

### 1. Task Management

**Global Task Queue (Sorted Set)**
```redis
ZADD cb:queue:tasks:pending {priority} {taskId}
ZRANGE cb:queue:tasks:pending 0 -1 WITHSCORES
```

**Task State (Hash)**
```redis
HSET cb:task:t-123 id t-123 status pending priority 75 text "Example task"
HGETALL cb:task:t-123
```

**Per-Instance Queues (List)**
```redis
LPUSH cb:queue:instance:worker-1 t-123
BRPOP cb:queue:instance:worker-1 30
```

### 2. Event Streaming

**Event Streams (Stream)**
```redis
XADD cb:stream:task.create * data '{"id":"t-123","text":"task"}'
XREAD STREAMS cb:stream:task.create $
```

**Event Deduplication (Set)**
```redis
SADD cb:processed:events event-id-123
SISMEMBER cb:processed:events event-id-123
```

### 3. Instance Coordination

**Instance Registry (Hash)**
```redis
HSET cb:instance:worker-1 id worker-1 status active roles "worker,processor"
EXPIRE cb:instance:worker-1 30
```

**Health Gossip (Hash with TTL)**
```redis
HSET cb:gossip:health worker-1 '{"status":"healthy","timestamp":123456}'
EXPIRE cb:gossip:health 300
```

### 4. Distributed Coordination

**Leadership Election (String with TTL)**
```redis
SET cb:leader:current worker-1 NX EX 30
```

**Batch Processing Lock (String with TTL)**
```redis
SET cb:batch:lock:process-1 worker-1 NX EX 300
```

**Circuit Breaker State (Hash)**
```redis
HSET cb:circuit:task.create:state status open failures 15 lastFailure 123456
EXPIRE cb:circuit:task.create:state 3600
```

## Atomic Operations with Lua Scripts

ClaudeBench uses 8 Lua scripts to ensure atomic operations across multiple keys:

### 1. EXACTLY_ONCE_DELIVERY

**Purpose**: Prevent duplicate event processing
**Keys**: `cb:processed:events`, `cb:duplicates:prevented`
**Guarantees**: Event processed XOR duplicate counted

```lua
local processed = redis.call('SISMEMBER', KEYS[1], ARGV[1])
if processed == 1 then
    local count = redis.call('INCR', KEYS[2])
    redis.call('EXPIRE', KEYS[2], 3600)
    return {1, count}
else
    redis.call('SADD', KEYS[1], ARGV[1])
    redis.call('EXPIRE', KEYS[1], 86400)
    return {0, 0}
end
```

### 2. ASSIGN_TASK_WITH_LOAD_BALANCING

**Purpose**: Assign tasks to least loaded instance
**Keys**: Instance pattern, global queue, assignment history
**Guarantees**: Task assigned AND removed from global queue

```lua
-- Find least loaded instance under capacity
-- Assign task atomically
-- Record in history with trimming
```

### 3. GOSSIP_HEALTH_UPDATE

**Purpose**: Update health status and detect partitions
**Keys**: `cb:gossip:health`, `cb:partition:detected`
**Guarantees**: Health updated AND partition detection

```lua
-- Update instance health
-- Check all instance health
-- Detect partition if < 50% healthy
-- Set recovery flag if > 70% healthy
```

### 4. QUORUM_VOTE

**Purpose**: Distributed voting with majority decision
**Keys**: `cb:quorum:decision:latest`, `cb:quorum:result`
**Guarantees**: Vote added AND quorum checked

## TTL Strategy and Memory Management

### TTL Categories

**Short-term Coordination (60-300 seconds)**
- Distributed locks (`cb:batch:lock:*`)
- Instance health (`cb:instance:*`)
- Leadership election (`cb:leader:*`)

**Medium-term Tracking (3600 seconds)**  
- Circuit breaker state (`cb:circuit:*`)
- Metrics aggregation (`cb:metrics:*`)
- Partition detection (`cb:partition:*`)

**Long-term Audit (86400 seconds)**
- Processed events (`cb:processed:*`)
- Assignment history (`cb:history:*`)
- Event streams (`cb:stream:*`)

### Memory Management Patterns

**Automatic Cleanup**
```lua
-- Set TTL on all temporary data
redis.call('EXPIRE', key, ttl_seconds)

-- Trim lists to bounded size
redis.call('LTRIM', list_key, -1000, -1)

-- Clean up old sorted set entries
redis.call('ZREMRANGEBYSCORE', set_key, '-inf', old_timestamp)
```

**Bounded Collections**
- Event streams: Limited to 24h retention
- Assignment history: Last 1000 entries
- Metrics: Rolling windows with TTL
- Health data: Last 100 updates per instance

## Performance Characteristics

### Operation Latencies

| Operation Type | Latency | Use Case |
|---------------|---------|----------|
| Simple GET/SET | < 1ms | Basic state access |
| Hash operations | 1-2ms | Task/instance data |
| List operations | 2-5ms | Queue management |
| Sorted set operations | 3-8ms | Priority queues |
| Lua script execution | 5-20ms | Atomic operations |
| Stream operations | 10-30ms | Event processing |

### Scalability Limits

| Resource | Current Capacity | Bottleneck | Scaling Strategy |
|----------|-----------------|------------|------------------|
| Memory | 16GB typical | Large collections | TTL + trimming |
| Connections | 10,000 | Network sockets | Connection pooling |
| Operations/sec | 100,000+ | CPU bound | Redis cluster |
| Key space | Unlimited | Memory | Namespace sharding |

## Pattern Implementation

### Pattern A (Centralized) Redis Usage

**Direct Operations**
```typescript
// Simple state management
await redis.hset(`cb:task:${id}`, taskData);
await redis.hget(`cb:task:${id}`, 'status');

// Atomic counters
await redis.incr(`cb:metrics:tasks:created`);
await redis.expire(`cb:metrics:tasks:created`, 3600);
```

### Pattern B (Distributed) Redis Usage

**Pub/Sub Messaging**
```typescript
// Distributed event propagation
await redis.publish(`cb:events:health`, healthData);
await redis.subscribe(`cb:events:health`);

// Sorted sets for time-based operations
await redis.zadd(`cb:sliding:window`, Date.now(), operation);
await redis.zremrangebyscore(`cb:sliding:window`, '-inf', old_time);
```

### Pattern C (Hybrid) Redis Usage

**Complex Lua Scripts**
```typescript
// Hybrid coordination via atomic scripts
const result = await redis.evalsha(
  'ASSIGN_TASK_WITH_LOAD_BALANCING',
  3,
  'cb:instance:*',
  'cb:queue:tasks:pending', 
  'cb:history:assignments',
  taskId, priority
);
```

## Connection Management

### Connection Patterns

**Single Instance Setup**
```typescript
const redis = new Redis({
  host: 'localhost',
  port: 6379,
  db: 0,
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3
});
```

**Multi-Instance with Pooling**
```typescript
const redisCluster = new Redis.Cluster([
  { host: 'redis-1', port: 6379 },
  { host: 'redis-2', port: 6379 },
  { host: 'redis-3', port: 6379 }
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD
  }
});
```

**Specialized Connections**
```typescript
interface RedisClients {
  main: Redis;      // Primary operations
  pub: Redis;       // Publishing events  
  sub: Redis;       // Subscribing to events
  scripts: Redis;   // Lua script execution
}
```

## Monitoring and Observability

### Key Metrics to Track

**Performance Metrics**
```typescript
{
  operationsPerSecond: 1000,
  averageLatency: 15,
  connectionPoolSize: 10,
  memoryUsage: "2.1GB",
  keyspaceHits: 95.5,
  keyspaceMisses: 4.5
}
```

**Business Metrics**
```typescript
{
  activeTasks: 150,
  queueDepth: 25,
  instanceCount: 5,
  eventsProcessed: 10000,
  circuitBreakerTrips: 2
}
```

### Redis Commands for Monitoring

```bash
# Memory usage
MEMORY USAGE cb:task:*
MEMORY STATS

# Performance stats  
INFO stats
INFO memory
INFO replication

# Key analysis
SCAN 0 MATCH cb:* COUNT 1000
KEYS cb:queue:*
```

### Alerting Thresholds

- Memory usage > 80%
- Average latency > 100ms
- Connection pool exhausted
- TTL expiration rate > 1000/sec
- Lua script execution time > 50ms

## Security and Access Control

### Redis ACL Configuration

```redis
# Create user for ClaudeBench
ACL SETUSER claudebench on >password
ACL SETUSER claudebench allkeys
ACL SETUSER claudebench +@read +@write +@stream +@scripting
ACL SETUSER claudebench -@dangerous
```

### Network Security

- TLS encryption for Redis connections
- Network isolation via VPC/security groups
- Authentication via Redis AUTH
- Connection limiting and rate limiting

## Backup and Recovery

### Backup Strategy

**RDB Snapshots**
- Scheduled snapshots every 6 hours
- Point-in-time recovery capability
- Stored in separate availability zone

**AOF (Append Only File)**
- Real-time operation logging
- Faster recovery for recent data
- Combined with RDB for complete coverage

### Recovery Procedures

**Event Replay**
```typescript
// Rebuild state from event streams
const events = await redis.xrange('cb:stream:task.create', '-', '+');
for (const event of events) {
  await replayEvent(event);
}
```

**State Reconstruction**
```typescript
// Rebuild from persistent data + event streams
await rebuildInstanceRegistry();
await rebuildTaskQueues();
await rebuildMetrics();
```

## Evolution and Scaling

### Current Architecture

- Single Redis instance for simplicity
- Connection pooling for concurrency
- Lua scripts for atomicity
- TTL for automatic cleanup

### Scaling Strategies

**Vertical Scaling**
- Increase Redis instance size
- More memory for larger datasets
- Better CPU for more operations

**Horizontal Scaling**
- Redis Cluster for data sharding
- Read replicas for query scaling
- Separate instances for different use cases

**Hybrid Approach**
- Redis Cluster for high-volume data
- Single instance for coordination
- Specialized instances for streaming

## Best Practices

### Key Design

1. **Consistent naming**: Always use `cb:type:id` pattern
2. **Appropriate TTL**: Set TTL based on data lifecycle
3. **Bounded collections**: Use LTRIM, ZREMRANGE for memory control
4. **Atomic operations**: Use Lua scripts for multi-key operations

### Performance Optimization

1. **Connection pooling**: Reuse connections efficiently
2. **Pipeline operations**: Batch multiple commands
3. **Appropriate data types**: Choose optimal Redis data structure
4. **Memory optimization**: Use hash compression, expire unused keys

### Operational Excellence

1. **Monitoring**: Track all key metrics and set appropriate alerts
2. **Backup**: Regular snapshots with tested recovery procedures
3. **Security**: ACL, TLS, network isolation
4. **Capacity planning**: Monitor growth trends and plan scaling

This Redis infrastructure provides the solid foundation for ClaudeBench's distributed, event-driven architecture with excellent performance, reliability, and scalability characteristics.