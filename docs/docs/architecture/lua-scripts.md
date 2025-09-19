---
sidebar_position: 5
---

# Lua Scripts for Atomicity

ClaudeBench uses Redis Lua scripts to provide atomic operations across multiple keys, ensuring consistency in distributed scenarios. These scripts implement the core coordination primitives that enable the system's reliability and correctness.

## Overview

### Why Lua Scripts?

Redis Lua scripts provide critical guarantees:

- **Atomicity**: All operations within a script execute as a single atomic unit
- **Consistency**: No other commands can execute during script execution
- **Isolation**: Scripts see a consistent view of data throughout execution
- **Performance**: Reduced network round trips compared to multiple commands

### Script Classification by Pattern

| Pattern | Scripts | Purpose |
|---------|---------|---------|
| **Pattern A (Centralized)** | 4 scripts | Atomic state management, centralized coordination |
| **Pattern B (Distributed)** | 2 scripts | Gossip protocols, consensus mechanisms |
| **Pattern C (Hybrid)** | 2 scripts | Coordinated distribution, hybrid workflows |

## Core Lua Scripts

### 1. EXACTLY_ONCE_DELIVERY (Pattern A)

**Purpose**: Ensures exactly-once event processing by tracking processed events and preventing duplicates.

**Redis Keys**:
- `KEYS[1]`: Processed events set (`cb:processed:events`)
- `KEYS[2]`: Duplicate counter (`cb:duplicates:prevented`)

**Parameters**:
- `ARGV[1]`: Event ID to check/mark as processed

**Script Logic**:
```lua
local processed = redis.call('SISMEMBER', KEYS[1], ARGV[1])
if processed == 1 then
    -- Event already processed, increment duplicate counter
    local count = redis.call('INCR', KEYS[2])
    redis.call('EXPIRE', KEYS[2], 3600)  -- 1 hour TTL
    return {1, count}  -- {is_duplicate, duplicate_count}
else
    -- First time processing, mark as processed
    redis.call('SADD', KEYS[1], ARGV[1])
    redis.call('EXPIRE', KEYS[1], 86400)  -- 24 hour TTL
    return {0, 0}  -- {not_duplicate, count_0}
end
```

**Atomic Guarantees**:
- Event is either marked as processed OR duplicate counter is incremented
- No race conditions between duplicate detection and marking
- TTL ensures cleanup of old tracking data

**Usage Example**:
```typescript
const [isDuplicate, count] = await redis.evalsha(
  'EXACTLY_ONCE_DELIVERY',
  2,
  'cb:processed:events',
  'cb:duplicates:prevented', 
  eventId
);

if (isDuplicate) {
  throw new Error(`Duplicate event: ${eventId}, total duplicates: ${count}`);
}
```

---

### 2. ASSIGN_TASK_WITH_LOAD_BALANCING (Pattern C)

**Purpose**: Assigns tasks to the least loaded instance while respecting capacity limits.

**Redis Keys**:
- `KEYS[1]`: Instance pattern (`cb:instance:*`)
- `KEYS[2]`: Global task queue (`cb:queue:tasks:pending`)
- `KEYS[3]`: Assignment history (`cb:history:assignments`)

**Parameters**:
- `ARGV[1]`: Task ID to assign
- `ARGV[2]`: Task priority

**Script Logic**:
```lua
-- Discover all active instances
local instances = redis.call('KEYS', KEYS[1])
if #instances == 0 then
    return {nil, 0, 0}  -- No instances available
end

local best_instance = nil
local min_load = math.huge

-- Find least loaded instance under capacity
for i = 1, #instances do
    local instance_id = instances[i]:match("cb:instance:(.*)")
    local capacity = redis.call('HGET', 'cb:capacity:' .. instance_id, 'max') or 100
    local current_load = redis.call('LLEN', 'cb:queue:instance:' .. instance_id)
    
    if current_load < tonumber(capacity) and current_load < min_load then
        min_load = current_load
        best_instance = instance_id
    end
end

if best_instance == nil then
    return {nil, 0, 0}  -- All instances at capacity
end

-- Assign task atomically
redis.call('LPUSH', 'cb:queue:instance:' .. best_instance, ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])  -- Remove from global queue

-- Record assignment in history
local assignment_record = cjson.encode({
    task_id = ARGV[1],
    instance_id = best_instance,
    timestamp = redis.call('TIME')[1],
    queue_depth = min_load + 1
})
redis.call('LPUSH', KEYS[3], assignment_record)
redis.call('LTRIM', KEYS[3], 0, 999)  -- Keep last 1000 assignments

return {best_instance, min_load + 1, 1}  -- {assigned_to, new_depth, success}
```

**Atomic Guarantees**:
- Task assignment and global queue removal happen together
- Load balancing calculation uses consistent snapshot
- Assignment history maintains complete audit trail
- Capacity limits are strictly enforced

---

### 3. GOSSIP_HEALTH_UPDATE (Pattern B)

**Purpose**: Updates instance health in gossip protocol and automatically detects network partitions.

**Redis Keys**:
- `KEYS[1]`: Gossip health data (`cb:gossip:health`)
- `KEYS[2]`: Partition detection flag (`cb:partition:detected`)
- `KEYS[3]`: Recovery detection flag (`cb:partition:recovery`)

**Parameters**:
- `ARGV[1]`: Instance ID
- `ARGV[2]`: Health status (JSON)
- `ARGV[3]`: Current timestamp

**Script Logic**:
```lua
-- Update this instance's health
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], 300)  -- 5 minute TTL

-- Get all health data for partition detection
local all_health = redis.call('HGETALL', KEYS[1])
local total_instances = #all_health / 2  -- KEY-VALUE pairs
local healthy_count = 0
local current_time = tonumber(ARGV[3])

-- Count healthy instances (reported within last 60 seconds)
for i = 2, #all_health, 2 do
    local health_data = cjson.decode(all_health[i])
    if current_time - health_data.timestamp < 60 then
        if health_data.status == "healthy" then
            healthy_count = healthy_count + 1
        end
    end
end

local health_ratio = healthy_count / total_instances

-- Partition detection logic
if health_ratio < 0.5 then
    -- Less than half healthy = partition detected
    redis.call('SET', KEYS[2], '1', 'EX', 3600)
    redis.call('DEL', KEYS[3])  -- Clear recovery flag
    return {1, 1}  -- {updated, partition_detected}
elseif health_ratio > 0.7 then
    -- More than 70% healthy = recovery
    redis.call('SET', KEYS[3], '1', 'EX', 3600)  
    redis.call('DEL', KEYS[2])  -- Clear partition flag
    return {1, 0}  -- {updated, no_partition}
else
    -- Stable state
    return {1, 0}  -- {updated, no_partition}
end
```

**Atomic Guarantees**:
- Health update and partition detection use same data snapshot
- Partition state transitions are consistent across all instances
- Automatic recovery detection when connectivity restored

---

### 4. QUORUM_VOTE (Pattern B)

**Purpose**: Implements distributed voting with automatic quorum detection and majority decision.

**Redis Keys**:
- `KEYS[1]`: Voting data (`cb:quorum:decision:latest`)
- `KEYS[2]`: Decision result (`cb:quorum:result`)

**Parameters**:
- `ARGV[1]`: Instance ID
- `ARGV[2]`: Vote value
- `ARGV[3]`: Total instances participating
- `ARGV[4]`: Decision identifier

**Script Logic**:
```lua
-- Load existing votes
local votes_json = redis.call('HGET', KEYS[1], 'votes') or '{}'
local votes = cjson.decode(votes_json)

-- Add this vote
votes[ARGV[1]] = ARGV[2]
local vote_count = 0
for k, v in pairs(votes) do
    vote_count = vote_count + 1
end

-- Check if we have quorum (majority of total instances)
local total_instances = tonumber(ARGV[3])
local quorum_size = math.floor(total_instances / 2) + 1

if vote_count >= quorum_size then
    -- Count votes for each option
    local vote_tally = {}
    for instance, vote in pairs(votes) do
        vote_tally[vote] = (vote_tally[vote] or 0) + 1
    end
    
    -- Find majority decision
    local decision = nil
    local max_votes = 0
    for vote_option, count in pairs(vote_tally) do
        if count > max_votes then
            max_votes = count
            decision = vote_option
        end
    end
    
    -- Store decision and votes
    redis.call('HSET', KEYS[1], 'votes', cjson.encode(votes))
    redis.call('HSET', KEYS[1], 'decision', decision)
    redis.call('HSET', KEYS[1], 'vote_count', vote_count)
    redis.call('EXPIRE', KEYS[1], 3600)
    
    redis.call('SET', KEYS[2], decision, 'EX', 3600)
    
    return {1, decision, vote_count}  -- {quorum_reached, decision, total_votes}
else
    -- Update votes but no quorum yet
    redis.call('HSET', KEYS[1], 'votes', cjson.encode(votes))
    redis.call('HSET', KEYS[1], 'vote_count', vote_count)
    redis.call('EXPIRE', KEYS[1], 3600)
    
    return {0, nil, vote_count}  -- {no_quorum, no_decision, current_votes}
end
```

**Atomic Guarantees**:
- Vote addition and quorum checking happen atomically
- Majority decision calculated from consistent vote snapshot
- Race conditions between concurrent votes eliminated

---

### 5. AGGREGATE_GLOBAL_METRICS (Pattern A)

**Purpose**: Calculates system-wide metrics by aggregating data from all instances and components.

**Redis Keys**:
- `KEYS[1]`: Global metrics storage (`cb:metrics:global`)
- `KEYS[2]`: Instance pattern (`cb:instance:*`)
- `KEYS[3]`: Scaling metrics (`cb:metrics:scaling`)

**Script Logic**:
```lua
-- Count active instances
local instances = redis.call('KEYS', KEYS[2])
local instance_count = #instances

-- Aggregate events from all streams
local stream_pattern = 'cb:stream:*'
local streams = redis.call('KEYS', stream_pattern)
local total_events = 0

for i = 1, #streams do
    local stream_info = redis.call('XINFO', 'STREAM', streams[i])
    -- Extract length from stream info
    for j = 1, #stream_info, 2 do
        if stream_info[j] == 'length' then
            total_events = total_events + stream_info[j + 1]
            break
        end
    end
end

-- Count total tasks
local task_pattern = 'cb:task:*'
local tasks = redis.call('KEYS', task_pattern)
local task_count = #tasks

-- Calculate queue depths across instances
local total_queue_depth = 0
local max_queue_depth = 0

for i = 1, #instances do
    local instance_id = instances[i]:match("cb:instance:(.*)")
    local queue_depth = redis.call('LLEN', 'cb:queue:instance:' .. instance_id)
    total_queue_depth = total_queue_depth + queue_depth
    if queue_depth > max_queue_depth then
        max_queue_depth = queue_depth
    end
end

-- Calculate throughput (events in last minute)
local one_minute_ago = (redis.call('TIME')[1] - 60) * 1000
local recent_events = 0

for i = 1, #streams do
    local recent = redis.call('XRANGE', streams[i], one_minute_ago, '+')
    recent_events = recent_events + #recent
end

-- Store aggregated metrics
local metrics = {
    timestamp = redis.call('TIME')[1],
    instances = instance_count,
    events_total = total_events,
    events_per_minute = recent_events,
    tasks_total = task_count,
    queue_depth_total = total_queue_depth,
    queue_depth_max = max_queue_depth,
    throughput = recent_events / 60  -- events per second
}

redis.call('HSET', KEYS[1], 'data', cjson.encode(metrics))
redis.call('EXPIRE', KEYS[1], 3600)

-- Update scaling decision metrics
local scaling_data = {
    load_variance = max_queue_depth > 0 and (total_queue_depth / instance_count) / max_queue_depth or 0,
    throughput_trend = recent_events,
    capacity_utilization = total_queue_depth / (instance_count * 100)  -- Assuming 100 capacity per instance
}

redis.call('HSET', KEYS[3], 'data', cjson.encode(scaling_data))
redis.call('EXPIRE', KEYS[3], 3600)

return {total_events, task_count, recent_events / 60, total_queue_depth, instance_count}
```

**Atomic Guarantees**:
- All metrics calculated from same point-in-time snapshot
- Consistent view across all instances and components
- Throughput and capacity calculations use same data

---

## Additional Utility Scripts

### 6. PARTITION_EVENT (Pattern A)

**Purpose**: Adds events to partitions while maintaining ordering and bounded size.

```lua
-- Add event to partition with metadata
local event_data = cjson.encode({
    id = ARGV[1],
    timestamp = redis.call('TIME')[1],
    data = ARGV[2]
})

redis.call('LPUSH', KEYS[1], event_data)
redis.call('LTRIM', KEYS[1], 0, 999)  -- Keep last 1000 events
redis.call('EXPIRE', KEYS[1], 86400)  -- 24 hour TTL

return {1, redis.call('LLEN', KEYS[1])}  -- {success, partition_length}
```

### 7. COORDINATE_BATCH (Pattern C)

**Purpose**: Coordinates batch processing with distributed locking and progress tracking.

```lua
-- Try to acquire processing lock
local lock_acquired = redis.call('SET', KEYS[1], ARGV[2], 'NX', 'EX', 300)
if lock_acquired then
    -- Initialize progress tracking
    redis.call('HSET', KEYS[2], 'processor', ARGV[2])
    redis.call('HSET', KEYS[2], 'processed', 0)
    redis.call('HSET', KEYS[2], 'total', ARGV[3])
    redis.call('EXPIRE', KEYS[2], 300)
    
    redis.call('SET', KEYS[3], ARGV[1], 'EX', 300)  -- Current batch ID
    return {1, ARGV[2], 0}  -- {acquired, processor, progress}
else
    -- Lock held by another instance
    local current_processor = redis.call('GET', KEYS[1])
    local progress = redis.call('HGET', KEYS[2], 'processed') or 0
    return {0, current_processor, progress}  -- {not_acquired, current_processor, progress}
end
```

### 8. SYNC_GLOBAL_STATE (Pattern A)

**Purpose**: Updates global state with automatic version incrementation for optimistic concurrency control.

```lua
-- Read current version and increment
local current_version = redis.call('HGET', KEYS[1], 'version') or 0
local new_version = current_version + 1

-- Update state with new version
redis.call('HSET', KEYS[1], 'version', new_version)
redis.call('HSET', KEYS[1], 'data', ARGV[1])
redis.call('HSET', KEYS[1], 'timestamp', redis.call('TIME')[1])
redis.call('EXPIRE', KEYS[1], 86400)

return {1, new_version}  -- {success, new_version}
```

## Script Performance Analysis

### Complexity Analysis

| Script | Time Complexity | Space Complexity | Network Ops |
|--------|----------------|------------------|-------------|
| EXACTLY_ONCE_DELIVERY | O(1) | O(1) | 3-4 |
| ASSIGN_TASK_WITH_LOAD_BALANCING | O(n) instances | O(n) | 5n+6 |
| GOSSIP_HEALTH_UPDATE | O(n) instances | O(n) | 4+n |
| QUORUM_VOTE | O(n) votes | O(n) | 4-8 |
| AGGREGATE_GLOBAL_METRICS | O(n+m) | O(n+m) | 6+3n+2m |
| PARTITION_EVENT | O(1) | O(1) | 4 |
| COORDINATE_BATCH | O(1) | O(1) | 5-8 |
| SYNC_GLOBAL_STATE | O(1) | O(1) | 5 |

### Performance Recommendations

**High-Frequency Scripts** (called > 100/sec):
- EXACTLY_ONCE_DELIVERY: Optimize with bloom filters for large event sets
- PARTITION_EVENT: Consider stream-based alternatives for high throughput

**Medium-Frequency Scripts** (called 1-100/sec):
- ASSIGN_TASK_WITH_LOAD_BALANCING: Cache instance discovery between calls
- GOSSIP_HEALTH_UPDATE: Use incremental health tracking

**Low-Frequency Scripts** (called < 1/sec):
- AGGREGATE_GLOBAL_METRICS: Acceptable overhead for comprehensive metrics
- QUORUM_VOTE: Reasonable for consensus decisions

## Error Handling and Recovery

### Script Failure Modes

**Redis Connection Loss**:
- Scripts fail immediately with connection error
- Client should implement retry with exponential backoff
- No partial execution - atomicity preserved

**Memory Pressure**:
- Scripts may fail with out-of-memory error
- Implement TTL and trimming in all scripts
- Monitor Redis memory usage and alert

**Key Expiration During Execution**:
- Scripts handle missing keys gracefully
- Use default values where appropriate
- Return status indicators for key availability

### Recovery Strategies

```typescript
async function executeScriptWithRetry(
  scriptName: string, 
  keys: string[], 
  args: string[],
  maxRetries: number = 3
) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await redis.evalsha(scriptName, keys.length, ...keys, ...args);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      
      // Exponential backoff
      await sleep(Math.pow(2, attempt) * 100);
    }
  }
}
```

## Best Practices

### Script Design

1. **Idempotent Operations**: Design scripts to be safely retryable
2. **Bounded Execution**: Set appropriate TTL and collection limits
3. **Error Handling**: Return status codes and error information
4. **Documentation**: Include clear comments explaining logic

### Performance Optimization

1. **Key Locality**: Group related operations to minimize lookups
2. **Efficient Data Structures**: Choose optimal Redis types for each use case
3. **Minimal Network**: Reduce round trips through batching
4. **Memory Management**: Use TTL and trimming to prevent growth

### Operational Excellence

1. **Monitoring**: Track script execution time and frequency
2. **Alerting**: Set alerts for script failures or performance degradation
3. **Versioning**: Manage script updates carefully to avoid breaking changes
4. **Testing**: Thoroughly test scripts with various edge cases

This Lua script architecture provides ClaudeBench with powerful atomic operations that ensure consistency across distributed scenarios while maintaining excellent performance characteristics.