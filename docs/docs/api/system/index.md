# System API Reference

The ClaudeBench System API provides core infrastructure management capabilities for distributed instance coordination, health monitoring, and system administration. All system methods use atomic Redis operations and Lua scripts to ensure consistency in distributed environments.

## Core Instance Management

### [system.register](./register.md)
Register a new instance in the distributed system with specified roles. Handles leader election, auto-assignment of tasks to workers, and global state synchronization.

- **Purpose**: Instance lifecycle initialization
- **Key Features**: Leader election, automatic task assignment, role-based registration
- **Redis Scripts**: `registerInstance`, `updateGossipHealth`, `syncGlobalState`, `autoAssignTasks`

### [system.heartbeat](./heartbeat.md)
Maintain instance liveness through periodic heartbeat updates. Critical for preventing task reassignment and maintaining distributed system health.

- **Purpose**: Instance liveness reporting
- **Key Features**: TTL refresh, leader status detection, high-frequency support
- **Redis Scripts**: `instanceHeartbeat`

### [system.unregister](./unregister.md)
Clean shutdown of instance with automatic task reassignment to healthy workers.

- **Purpose**: Graceful instance shutdown
- **Key Features**: Task redistribution, cleanup, state synchronization
- **Redis Scripts**: `syncGlobalState`, `aggregateGlobalMetrics`, `autoAssignTasks`

## Health & Monitoring

### [system.health](./health.md)
Comprehensive system health check across all services (Redis, PostgreSQL, MCP) with circuit breaker protection.

- **Purpose**: Overall system health assessment  
- **Key Features**: Multi-service validation, circuit breaker fallback
- **Redis Scripts**: `getSystemHealth`

### [system.check_health](./check_health.md)
Monitor instance health and automatically handle failures by reassigning tasks to healthy instances.

- **Purpose**: Instance failure detection and recovery
- **Key Features**: Automatic task reassignment, stale instance detection
- **Redis Scripts**: `reassignFailedTasks`

### [system.metrics](./metrics.md)
Retrieve comprehensive performance metrics and statistics with optional detailed reporting.

- **Purpose**: Performance monitoring and analytics
- **Key Features**: Basic and detailed metrics, per-handler statistics, cache analytics

### [system.get_state](./get_state.md)
Get atomic snapshot of current system state including tasks, instances, and recent events.

- **Purpose**: System state introspection
- **Key Features**: Atomic state collection, filtered responses
- **Redis Scripts**: `getSystemState`

## Distributed Coordination

### [system.batch.process](./batch_process.md)
Coordinate distributed batch processing with atomic locking and progress tracking.

- **Purpose**: Distributed batch coordination
- **Key Features**: Distributed locking, progress tracking, failure recovery
- **Redis Scripts**: `coordinateBatch`

### [system.quorum.vote](./quorum_vote.md)
Implement distributed consensus through quorum-based voting mechanisms.

- **Purpose**: Distributed decision making
- **Key Features**: Majority voting, atomic vote recording, consensus detection
- **Redis Scripts**: `addQuorumVote`

## System Administration

### [system.discover](./discover.md)
Dynamic discovery of available methods and their schemas for client introspection.

- **Purpose**: API discovery and client code generation
- **Key Features**: Schema conversion, domain filtering, dynamic introspection

### [system.flush](./flush.md)
**🚨 DANGEROUS**: Complete system reset by clearing all ClaudeBench data from Redis and PostgreSQL.

- **Purpose**: System reset and testing
- **Key Features**: Complete data destruction, batch deletion, safety confirmations

## Redis Key Patterns

All system operations use consistent Redis key patterns:

### Instance Management
- `cb:instance:{id}` - Instance registration data
- `cb:health:gossip:{id}` - Health status tracking

### Coordination
- `cb:batch:{id}:*` - Batch processing coordination
- `cb:quorum:{decision}:*` - Voting and consensus data

### Metrics & Monitoring  
- `cb:metrics:*` - Performance metrics and counters
- `cb:circuit:*` - Circuit breaker states
- `cb:state:global` - Global system state

### Infrastructure
- `cb:queue:*` - Task queues and assignments
- `cb:stream:*` - Event streams and logs

## Common Patterns

### Atomic Operations
All system methods prioritize atomicity through Lua scripts:
- **Consistency**: Multi-key operations are atomic
- **Race condition prevention**: Distributed coordination is safe
- **Failure handling**: Partial failures are prevented

### Circuit Breaker Protection
Most methods include circuit breaker patterns:
- **Failure thresholds**: Automatic circuit opening after consecutive failures
- **Fallback responses**: Graceful degradation during outages
- **Recovery**: Automatic circuit closing when service recovers

### Rate Limiting
All methods include rate limiting for system protection:
- **Per-instance limits**: Prevent abuse from single instances
- **Sliding window**: Smooth traffic distribution
- **Critical operations**: Lower limits for dangerous operations

## Error Handling

### Standard Error Responses
```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal error",
    "data": "Circuit breaker open"
  },
  "id": "request-id"
}
```

### Common Error Conditions
- **Circuit breaker open**: Service temporarily unavailable
- **Rate limit exceeded**: Too many requests from instance  
- **Invalid parameters**: Schema validation failed
- **Redis unavailable**: Infrastructure connectivity issues
- **Instance not registered**: Must call `system.register` first

## Best Practices

### Instance Lifecycle
1. **Register** instance with appropriate roles
2. **Send heartbeats** every 10-15 seconds
3. **Monitor** system health regularly
4. **Unregister** cleanly on shutdown

### Distributed Coordination
- Use **quorum voting** for important decisions
- Implement **batch processing** for bulk operations
- Monitor **system state** for coordination awareness

### Monitoring & Observability
- Regular **health checks** for system monitoring
- **Metrics collection** for performance analysis
- **State introspection** for debugging

### Error Recovery
- Handle **circuit breaker** fallbacks gracefully
- Implement **retry logic** with exponential backoff
- Monitor **instance health** for automatic recovery

## Related Documentation

- [Task API](../task/index.md) - Task management operations
- [Hook API](../hook/index.md) - Lifecycle event handling
- [Architecture Overview](../../architecture.md) - System design patterns
- [Redis Scripts](../../internals/redis-scripts.md) - Lua script implementations