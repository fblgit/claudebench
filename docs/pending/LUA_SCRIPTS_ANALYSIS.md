# Lua Scripts Analysis Report

## Executive Summary

This document analyzes the Redis Lua scripts in ClaudeBench's event-driven architecture. The system contains 9 atomic scripts that provide consistency guarantees across multi-instance scenarios. Each script implements specific patterns for distributed coordination, state management, and event processing.

## Script Catalog

### 1. EXACTLY_ONCE_DELIVERY

**Purpose**: Ensures exactly-once event delivery by tracking processed events and preventing duplicates.

**Atomic Operations Performed**:
- Check event ID membership in processed set
- Increment duplicate counter if already processed
- Add event ID to processed set if new
- Set TTL on both processed set and duplicate counter

**Redis Keys Accessed**:
- `KEYS[1]`: Processed events set (e.g., `cb:processed:events`)
- `KEYS[2]`: Duplicate counter key (e.g., `cb:duplicates:prevented`)

**Guarantees Provided**:
- Atomicity: Either event is marked as processed OR duplicate counter is incremented
- Consistency: Event processing state is never ambiguous
- Durability: TTL ensures cleanup of old tracking data (24h for processed, 1h for duplicates)

**Return Values**:
- `{0, 0}`: First time processing (not duplicate, count 0)
- `{1, N}`: Duplicate detected (is duplicate, count N)

**Pattern Classification**: **Pattern A (Centralized)** - Single atomic decision point for event processing state.

---

### 2. ASSIGN_TASK_WITH_LOAD_BALANCING

**Purpose**: Assigns tasks to instances based on current load, implementing load balancing with capacity checks.

**Atomic Operations Performed**:
- Discover all available instances via pattern matching
- Calculate current load for each instance
- Find instance with minimum load under capacity
- Assign task to selected instance's queue
- Remove task from global queue
- Record assignment in history with trimming

**Redis Keys Accessed**:
- `KEYS[1]`: Instance pattern (e.g., `cb:instance:*`)
- `KEYS[2]`: Global task queue (e.g., `cb:queue:tasks:pending`)
- `KEYS[3]`: Assignment history (e.g., `cb:history:assignments`)
- Dynamic keys: `cb:queue:instance:{id}`, `cb:capacity:{id}`

**Guarantees Provided**:
- Atomicity: Task assignment and global queue removal happen together
- Load balancing: Always selects least loaded instance under capacity
- Audit trail: All assignments recorded with timestamps
- Capacity enforcement: Never exceeds instance capacity limits

**Return Values**:
- `{instance_id, new_depth, 1}`: Successfully assigned
- `{nil, 0, 0}`: No instances available or all at capacity

**Pattern Classification**: **Pattern C (Hybrid)** - Central coordination for assignment with distributed execution queues.

---

### 3. GOSSIP_HEALTH_UPDATE

**Purpose**: Updates health status in gossip protocol and detects network partitions automatically.

**Atomic Operations Performed**:
- Update instance health status with timestamp
- Retrieve all instance health data
- Calculate healthy vs total instance ratios
- Detect partition if less than half are healthy
- Detect recovery if more than 70% are healthy
- Set partition/recovery flags with TTL

**Redis Keys Accessed**:
- `KEYS[1]`: Gossip health data hash (e.g., `cb:gossip:health`)
- `KEYS[2]`: Partition detection flag (e.g., `cb:partition:detected`)
- `KEYS[3]`: Recovery detection flag (e.g., `cb:partition:recovery`)

**Guarantees Provided**:
- Atomicity: Health update and partition detection happen together
- Consistency: Partition state reflects current health snapshot
- Automatic recovery: Self-healing when instances return online
- Time bounds: All data expires to prevent stale state

**Return Values**:
- `{1, 0}`: Updated successfully, no partition
- `{1, 1}`: Updated successfully, partition detected

**Pattern Classification**: **Pattern B (Distributed)** - Autonomous health reporting with distributed state aggregation.

---

### 4. QUORUM_VOTE

**Purpose**: Implements distributed voting with automatic quorum detection and majority decision.

**Atomic Operations Performed**:
- Load existing votes from hash
- Add new vote to collection
- Check if quorum size reached (majority of total instances)
- Count vote values to find majority decision
- Store updated votes and decision
- Set expiration for cleanup

**Redis Keys Accessed**:
- `KEYS[1]`: Quorum voting data (e.g., `cb:quorum:decision:latest`)
- `KEYS[2]`: Decision result storage (e.g., `cb:quorum:result`)

**Guarantees Provided**:
- Atomicity: Vote addition and quorum check happen together
- Majority rule: Decision requires majority of total instances
- Consistency: Vote state and decision always synchronized
- Durability: Results persisted with TTL for cleanup

**Return Values**:
- `{0, nil, N}`: Quorum not reached, no decision, N votes
- `{1, "decision", N}`: Quorum reached, majority decision, N votes

**Pattern Classification**: **Pattern B (Distributed)** - Distributed consensus mechanism with autonomous voting.

---

### 5. AGGREGATE_GLOBAL_METRICS

**Purpose**: Calculates system-wide metrics by aggregating data from all instances and components.

**Atomic Operations Performed**:
- Count active instances via pattern matching
- Sum events across all Redis streams
- Count total tasks from task keys
- Calculate throughput and load variance
- Store aggregated metrics with TTL
- Update scaling decision metrics

**Redis Keys Accessed**:
- `KEYS[1]`: Global metrics storage (e.g., `cb:metrics:global`)
- `KEYS[2]`: Instance pattern (e.g., `cb:instance:*`)
- `KEYS[3]`: Scaling metrics (e.g., `cb:metrics:scaling`)
- Dynamic patterns: `cb:task:*`, `cb:stream:*`, `cb:queue:instance:*`

**Guarantees Provided**:
- Atomicity: All metric calculations happen in single operation
- Consistency: Metrics reflect same point-in-time snapshot
- Completeness: Includes all discoverable instances and tasks
- Freshness: Regular TTL ensures metrics stay current

**Return Values**:
- `{events, tasks, latency, throughput, instances}`: Complete metrics tuple

**Pattern Classification**: **Pattern A (Centralized)** - Centralized aggregation of distributed state for global view.

---

### 6. PARTITION_EVENT

**Purpose**: Adds events to partitions while maintaining timestamp ordering and bounded size.

**Atomic Operations Performed**:
- Encode event with metadata (ID, timestamp, data)
- Append to partition list (maintaining insertion order)
- Trim list to last 1000 events for memory management
- Set TTL for automatic cleanup

**Redis Keys Accessed**:
- `KEYS[1]`: Partition list (e.g., `cb:partition:{key}`)

**Guarantees Provided**:
- Atomicity: Event insertion and list trimming happen together
- Ordering: Events maintain chronological order within partition
- Bounded memory: Never exceeds 1000 events per partition
- Durability: TTL prevents indefinite memory growth

**Return Values**:
- `{1, length}`: Success with current partition length

**Pattern Classification**: **Pattern A (Centralized)** - Centralized partitioning with ordered event storage.

---

### 7. COORDINATE_BATCH

**Purpose**: Coordinates batch processing across instances using distributed locking and progress tracking.

**Atomic Operations Performed**:
- Attempt to acquire exclusive processing lock
- Set current batch identifier
- Initialize progress tracking (processed/total/processor)
- Set TTL on all coordination state
- Return current state if lock not acquired

**Redis Keys Accessed**:
- `KEYS[1]`: Batch processing lock (e.g., `cb:batch:lock`)
- `KEYS[2]`: Progress tracking hash (e.g., `cb:batch:progress`)
- `KEYS[3]`: Current batch identifier (e.g., `cb:batch:current`)

**Guarantees Provided**:
- Exclusivity: Only one instance can process batch at a time
- Progress visibility: All instances can see current progress
- Timeout safety: Lock expires to prevent deadlocks
- State consistency: Progress and lock state always synchronized

**Return Values**:
- `{1, processor_id, 0}`: Lock acquired, ready to process
- `{0, current_processor, progress}`: Lock held by another instance

**Pattern Classification**: **Pattern C (Hybrid)** - Centralized coordination with distributed progress visibility.

---

### 8. SYNC_GLOBAL_STATE

**Purpose**: Updates global state with automatic version incrementation for optimistic concurrency control.

**Atomic Operations Performed**:
- Read current version number
- Increment version atomically
- Update state data with new version
- Set timestamp for tracking
- Apply TTL for cleanup

**Redis Keys Accessed**:
- `KEYS[1]`: Global state hash (e.g., `cb:state:global`)

**Guarantees Provided**:
- Atomicity: Version increment and state update happen together
- Versioning: Each update gets unique monotonic version
- Timestamp tracking: Update times recorded for audit
- Consistency: Version always matches current state

**Return Values**:
- `{1, new_version}`: Update successful with new version number

**Pattern Classification**: **Pattern A (Centralized)** - Centralized state management with version control.

---

## Pattern Analysis

### Script Distribution by Pattern

| Pattern | Script Count | Scripts |
|---------|--------------|---------|
| **Pattern A (Centralized)** | 4 | EXACTLY_ONCE_DELIVERY, AGGREGATE_GLOBAL_METRICS, PARTITION_EVENT, SYNC_GLOBAL_STATE |
| **Pattern B (Distributed)** | 2 | GOSSIP_HEALTH_UPDATE, QUORUM_VOTE |
| **Pattern C (Hybrid)** | 2 | ASSIGN_TASK_WITH_LOAD_BALANCING, COORDINATE_BATCH |

### Consistency Models Implemented

1. **Strong Consistency**: EXACTLY_ONCE_DELIVERY, SYNC_GLOBAL_STATE
2. **Eventual Consistency**: GOSSIP_HEALTH_UPDATE
3. **Consensus-based**: QUORUM_VOTE
4. **Load-balanced**: ASSIGN_TASK_WITH_LOAD_BALANCING
5. **Batch Coordination**: COORDINATE_BATCH

### Atomic Guarantees Summary

| Script | Atomicity Guarantee | Failure Mode | Recovery Strategy |
|--------|-------------------|--------------|------------------|
| EXACTLY_ONCE_DELIVERY | Event processed XOR duplicate counted | Script failure | TTL cleanup + retry |
| ASSIGN_TASK_WITH_LOAD_BALANCING | Task assigned AND removed from global queue | Partial assignment | Orphan detection via history |
| GOSSIP_HEALTH_UPDATE | Health updated AND partition detected | Stale health data | TTL expiration |
| QUORUM_VOTE | Vote added AND quorum checked | Lost votes | TTL cleanup + re-vote |
| AGGREGATE_GLOBAL_METRICS | All metrics calculated together | Stale metrics | TTL expiration + recalc |
| PARTITION_EVENT | Event added AND list trimmed | Memory growth | TTL cleanup |
| COORDINATE_BATCH | Lock acquired AND progress initialized | Deadlock | TTL expiration |
| SYNC_GLOBAL_STATE | Version incremented AND state updated | Version drift | Monotonic versioning |

## Redis Key Patterns

### Key Namespace Organization
All scripts follow the `cb:{type}:{identifier}` pattern:

- **Instance Management**: `cb:instance:*`, `cb:capacity:*`, `cb:queue:instance:*`
- **Event Processing**: `cb:processed:events`, `cb:duplicates:prevented`, `cb:stream:*`
- **Coordination**: `cb:batch:*`, `cb:partition:*`, `cb:quorum:*`
- **Metrics**: `cb:metrics:global`, `cb:metrics:scaling`
- **State**: `cb:state:global`, `cb:gossip:health`

### TTL Strategy
Scripts implement consistent TTL patterns:
- **Short-term coordination**: 60-300 seconds (locks, health)
- **Medium-term tracking**: 3600 seconds (metrics, partitions)
- **Long-term audit**: 86400 seconds (processed events, history)

## Performance Characteristics

### Script Complexity Analysis
| Script | Time Complexity | Space Complexity | Network Calls |
|--------|----------------|------------------|---------------|
| EXACTLY_ONCE_DELIVERY | O(1) | O(1) | 2-4 |
| ASSIGN_TASK_WITH_LOAD_BALANCING | O(n) instances | O(n) | 6n+5 |
| GOSSIP_HEALTH_UPDATE | O(n) instances | O(n) | 3+n |
| QUORUM_VOTE | O(n) votes | O(n) | 4-6 |
| AGGREGATE_GLOBAL_METRICS | O(n+m) instances+tasks | O(n+m) | 4+2n+m |
| PARTITION_EVENT | O(1) | O(1) | 4 |
| COORDINATE_BATCH | O(1) | O(1) | 4-6 |
| SYNC_GLOBAL_STATE | O(1) | O(1) | 4 |

## Integration with ClaudeBench Architecture

### Event-Driven Architecture Support
The scripts support ClaudeBench's Redis-first architecture by providing:

1. **Event Deduplication**: EXACTLY_ONCE_DELIVERY prevents duplicate processing
2. **Load Distribution**: ASSIGN_TASK_WITH_LOAD_BALANCING enables horizontal scaling
3. **Health Monitoring**: GOSSIP_HEALTH_UPDATE provides failure detection
4. **Consensus Mechanisms**: QUORUM_VOTE enables distributed decisions
5. **Observability**: AGGREGATE_GLOBAL_METRICS provides system insights
6. **Event Ordering**: PARTITION_EVENT maintains chronological consistency
7. **Coordination**: COORDINATE_BATCH prevents race conditions
8. **State Management**: SYNC_GLOBAL_STATE provides versioned updates

### Handler Pattern Alignment
Scripts align with ClaudeBench's handler patterns:

- **Pattern A Handlers** use centralized scripts for state management
- **Pattern B Handlers** use distributed scripts for autonomous operation  
- **Pattern C Handlers** use hybrid scripts for coordinated distribution

### Testing Integration
Scripts support the ContractTest Driven Development approach:
- **Contract tests** verify script interfaces and return values
- **Integration tests** validate Redis key patterns and TTL behavior
- **System tests** confirm multi-instance coordination works correctly

## Recommendations

### Operational Considerations
1. **Monitoring**: Add observability for script execution times and failure rates
2. **Alerting**: Monitor TTL expirations and key pattern growth
3. **Capacity Planning**: Track memory usage of lists and hashes with automatic trimming
4. **Error Handling**: Implement retry logic in TypeScript wrappers for transient failures

### Performance Optimizations
1. **Script Caching**: Redis automatically caches compiled scripts for reuse
2. **Key Locality**: Group related operations to minimize network roundtrips  
3. **Batch Operations**: Use fewer scripts with more operations rather than many small scripts
4. **Memory Management**: Consistent TTL and trimming prevents unbounded growth

### Security Considerations
1. **Input Validation**: All ARGV parameters should be validated before script execution
2. **Key Isolation**: Namespace prevents collision with other Redis users
3. **Resource Limits**: TTL and trimming prevent resource exhaustion attacks
4. **Access Control**: Scripts should run with appropriate Redis ACL permissions

## Conclusion

The Lua scripts provide a solid foundation for ClaudeBench's distributed event-driven architecture. They implement appropriate consistency models for different use cases, maintain proper atomicity guarantees, and follow consistent patterns for key naming and TTL management. The mix of centralized, distributed, and hybrid patterns aligns well with the system's handler architecture and testing approach.