# system.batch.process

Coordinate batch processing atomically via Lua script.

## Method

`system.batch.process`

## Description

Coordinates distributed batch processing across multiple ClaudeBench instances using atomic Redis operations. This method implements a distributed locking mechanism to ensure only one instance processes a given batch while providing progress tracking and failure recovery.

⚠️ **Distributed Coordination**: This method uses distributed locking to prevent race conditions in batch processing across multiple instances.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `batchId` | `string` | Yes | Unique identifier for the batch being processed |
| `instanceId` | `string` | Yes | Identifier of the instance requesting to process the batch |
| `items` | `array` | Yes | Array of items to be processed in the batch |

## Response

| Name | Type | Description |
|------|------|-------------|
| `processed` | `boolean` | Whether this instance successfully processed the batch |
| `processorId` | `string` | ID of the instance that processed (or is processing) the batch |
| `itemsProcessed` | `number` | Number of items processed (if processing completed) |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.batch.process",
  "params": {
    "batchId": "batch-2024-001",
    "instanceId": "worker-claude-001", 
    "items": [
      {"id": 1, "data": "item1"},
      {"id": 2, "data": "item2"},
      {"id": 3, "data": "item3"}
    ]
  },
  "id": "batch-process-1"
}
```

## JSON-RPC Response Example

### Successfully Acquired Lock and Processed
```json
{
  "jsonrpc": "2.0",
  "result": {
    "processed": true,
    "processorId": "worker-claude-001",
    "itemsProcessed": 3
  },
  "id": "batch-process-1"
}
```

### Lock Already Held by Another Instance
```json
{
  "jsonrpc": "2.0",
  "result": {
    "processed": false,
    "processorId": "worker-claude-002", 
    "itemsProcessed": 2
  },
  "id": "batch-process-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "processed": false
  },
  "id": "batch-process-1"
}
```

## Redis Keys Affected

**Created/Updated:**
- `cb:batch:{batchId}:lock` - Distributed lock with TTL
- `cb:batch:{batchId}:processor` - Current processor instance ID
- `cb:batch:{batchId}:progress` - Processing progress counter
- `cb:batch:{batchId}:status` - Batch processing status

**Read:**
- Previous batch state for coordination validation

## Lua Script Details

This method uses the `coordinateBatch` Lua script which atomically:

1. **Checks existing lock** - Determines if batch is already being processed
2. **Acquires lock if available** - Sets distributed lock with TTL
3. **Updates processor info** - Records which instance is processing
4. **Tracks progress** - Maintains item processing count
5. **Handles lock expiration** - Automatic cleanup on timeout

**Script Parameters:**
- `instanceId` (string): Instance requesting to process batch
- `batchId` (string): Unique batch identifier  
- `itemCount` (number): Total number of items to process

**Script Returns:**
```lua
{
  lockAcquired = true|false,
  currentProcessor = "instance_id",
  progress = number  -- Items processed so far
}
```

## Processing Flow

### Lock Acquisition
1. Instance calls `system.batch.process`
2. Lua script checks for existing lock
3. If no lock exists, instance acquires lock
4. Lock TTL set to prevent infinite holds
5. Instance proceeds with processing

### Progress Tracking
1. **Every 10 items** or at completion, progress is updated
2. **Atomic progress updates** via Lua script
3. **Progress visible** to other instances attempting to process
4. **Final completion** marks batch as done

### Lock Release
- **Automatic expiration** via TTL (prevents deadlock)
- **Explicit completion** when batch finishes
- **Error recovery** through TTL timeout

## Event Emissions

### batch.completed
Emitted when batch processing completes successfully:
```json
{
  "type": "batch.completed",
  "payload": {
    "batchId": "batch-2024-001",
    "processorId": "worker-claude-001", 
    "itemsProcessed": 3
  }
}
```

## Error Handling

### Lock Contention
- Multiple instances may attempt to process the same batch
- Only first instance acquires lock
- Others receive `processed: false` with current processor info

### Processing Failures
- **TTL expiration** automatically releases locks from failed instances
- **Retry logic** can re-attempt processing after lock expires
- **Progress preservation** maintains partial completion state

### Network Failures
- **Lock TTL** ensures eventual cleanup
- **Idempotent operations** allow safe retry
- **Progress tracking** prevents duplicate work

## Prerequisites

- Redis server must be available for atomic script execution
- Instance must be registered in the system
- Batch ID should be unique across the system
- Items array should contain processable data

## Warnings

⚠️ **Rate Limiting**: Limited to 10 batch operations per minute to prevent system overload

⚠️ **Circuit Breaker**: After 3 consecutive failures, circuit opens for 60 seconds

⚠️ **Timeout**: Operations timeout after 30 seconds due to potential batch processing time

⚠️ **Lock TTL**: Locks expire automatically to prevent deadlock - ensure processing completes within TTL

⚠️ **Progress Updates**: Progress is updated every 10 items - large batches may have delayed visibility

## Performance Characteristics

- **Lock acquisition**: ~5-20ms
- **Progress updates**: ~2-10ms per update
- **Processing time**: Dependent on item complexity (~10ms simulated per item)
- **Memory usage**: Proportional to items array size

## Batch Size Recommendations

- **Small batches**: 1-10 items (optimal for responsiveness)
- **Medium batches**: 10-100 items (balanced performance)
- **Large batches**: 100+ items (require careful TTL management)

## Related Methods

- [`system.quorum.vote`](./quorum_vote) - Distributed decision making
- [`task.create`](../task/create) - Individual task creation
- [`system.get_state`](./get_state) - Monitor batch processing status