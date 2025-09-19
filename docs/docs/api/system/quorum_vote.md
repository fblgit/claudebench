# system.quorum.vote

Submit vote for quorum-based decisions atomically via Lua script.

## Method

`system.quorum.vote`

## Description

Implements distributed consensus voting using quorum-based decision making. This method allows ClaudeBench instances to participate in collective decisions where a majority vote determines the outcome. Uses atomic Redis operations to ensure vote integrity and prevent race conditions.

⚠️ **Distributed Consensus**: This method implements critical distributed system coordination - ensure proper quorum sizing and vote validation.

## Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `instanceId` | `string` | Yes | Unique identifier of the instance casting the vote |
| `decision` | `string` | Yes | The decision topic being voted on |
| `value` | `string` | Yes | The vote value (e.g., "yes", "no", "approve", "deny") |
| `totalInstances` | `number` | No | Total number of instances expected to vote (default: 3, min: 1) |

## Response

| Name | Type | Description |
|------|------|-------------|
| `voted` | `boolean` | Whether the vote was successfully recorded |
| `quorumReached` | `boolean` | Whether enough votes have been collected to reach consensus |
| `finalDecision` | `string` | The winning vote value (only present if quorum reached) |
| `voteCount` | `number` | Total number of votes collected for this decision |

## JSON-RPC Request Example

```json
{
  "jsonrpc": "2.0",
  "method": "system.quorum.vote",
  "params": {
    "instanceId": "worker-claude-001",
    "decision": "upgrade-system",
    "value": "approve",
    "totalInstances": 5
  },
  "id": "quorum-vote-1"
}
```

## JSON-RPC Response Example

### Vote Recorded - Quorum Not Yet Reached
```json
{
  "jsonrpc": "2.0",
  "result": {
    "voted": true,
    "quorumReached": false,
    "voteCount": 2
  },
  "id": "quorum-vote-1"
}
```

### Vote Recorded - Quorum Reached
```json
{
  "jsonrpc": "2.0",
  "result": {
    "voted": true,
    "quorumReached": true,
    "finalDecision": "approve",
    "voteCount": 3
  },
  "id": "quorum-vote-1"
}
```

### Circuit Breaker Fallback
```json
{
  "jsonrpc": "2.0",
  "result": {
    "voted": false,
    "quorumReached": false
  },
  "id": "quorum-vote-1"
}
```

## Redis Keys Affected

**Created/Updated:**
- `cb:quorum:{decision}:votes` - Sorted set of votes by instance
- `cb:quorum:{decision}:tally` - Vote count by value  
- `cb:quorum:{decision}:result` - Final decision when quorum reached
- `cb:quorum:{decision}:metadata` - Voting metadata (total instances, quorum size)

**Read:**
- Existing vote state for the decision topic

## Quorum Calculation

**Quorum Size**: `floor(totalInstances / 2) + 1`

| Total Instances | Quorum Required |
|----------------|----------------|
| 1 | 1 |
| 2 | 2 |
| 3 | 2 |
| 4 | 3 |
| 5 | 3 |
| 6 | 4 |
| 7 | 4 |

## Lua Script Details

This method uses the `addQuorumVote` Lua script which atomically:

1. **Records vote** - Stores instance vote for the decision
2. **Prevents duplicate voting** - Each instance can only vote once per decision
3. **Tallies votes** - Counts votes by value
4. **Checks quorum** - Determines if enough votes collected
5. **Declares winner** - Identifies winning vote value when quorum reached

**Script Parameters:**
- `voteKey` (string): Redis key for this vote (`{decision}:{instanceId}`)
- `value` (string): The vote value being cast
- `totalInstances` (number): Expected number of voting instances

**Script Returns:**
```lua
{
  voteCount = number,        -- Total votes collected
  quorumReached = true|false, -- Whether quorum achieved  
  decision = "value"         -- Winning value (if quorum reached)
}
```

## Voting Rules

### Vote Validity
- **One vote per instance** per decision topic
- **Vote value can be any string** (e.g., "yes"/"no", "approve"/"deny")
- **Instance must be registered** in the system
- **Votes are immutable** once cast

### Quorum Requirements
- **Majority required**: More than half of total instances must vote
- **Winner determination**: Vote value with most votes wins
- **Tie breaking**: First value to reach majority wins (based on Redis ordering)

### Decision Finality
- **Decisions are final** once quorum reached
- **No vote changes** allowed after casting
- **Results persist** in Redis for auditing

## Event Emissions

### quorum.decision.made
Emitted when quorum is reached and decision finalized:
```json
{
  "type": "quorum.decision.made",
  "payload": {
    "decision": "upgrade-system",
    "value": "approve",
    "voteCount": 3,
    "quorum": 3
  }
}
```

## Use Cases

### System Upgrades
```json
{
  "decision": "upgrade-to-v2",
  "value": "approve"  // or "deny"
}
```

### Configuration Changes
```json
{
  "decision": "increase-rate-limit",
  "value": "yes"  // or "no" 
}
```

### Leader Selection
```json
{
  "decision": "elect-leader",
  "value": "instance-001"  // candidate instance ID
}
```

### Emergency Actions
```json
{
  "decision": "emergency-shutdown",
  "value": "proceed"  // or "abort"
}
```

## Prerequisites

- Redis server must be available for atomic script execution
- Instance must be registered via [`system.register`](./register)
- Decision topic should be unique and descriptive
- Total instances count should reflect actual system size

## Warnings

⚠️ **Rate Limiting**: Limited to 50 votes per minute to prevent vote spam

⚠️ **Circuit Breaker**: After 5 consecutive failures, circuit opens for 30 seconds

⚠️ **Timeout**: Vote operations timeout after 5 seconds

⚠️ **Immutable Votes**: Votes cannot be changed once cast

⚠️ **Instance Count Accuracy**: Incorrect `totalInstances` can prevent quorum achievement

⚠️ **Decision Persistence**: Results remain in Redis - clean up old decisions periodically

## Security Considerations

- **Vote authenticity**: Only registered instances can vote
- **Decision tampering**: Atomic operations prevent vote manipulation
- **Audit trail**: All votes recorded with instance attribution
- **Replay protection**: Duplicate votes from same instance rejected

## Performance Characteristics

- **Vote recording**: ~5-15ms for atomic operation
- **Quorum checking**: ~2-10ms for tally calculation  
- **Memory usage**: Minimal per vote (instance ID + value)
- **Network**: Low bandwidth for vote data

## Related Methods

- [`system.batch.process`](./batch_process) - Distributed batch coordination
- [`system.register`](./register) - Instance registration for voting eligibility
- [`system.get_state`](./get_state) - Monitor voting progress and results