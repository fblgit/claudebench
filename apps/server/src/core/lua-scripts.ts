/**
 * Redis Lua Scripts for Atomic Operations
 * These scripts ensure consistency in multi-instance scenarios
 */

/**
 * Exactly-once event delivery
 * Checks if event was processed, adds to set if not, tracks duplicates
 */
export const EXACTLY_ONCE_DELIVERY = `
local processed_key = KEYS[1]
local duplicate_key = KEYS[2]
local event_id = ARGV[1]

-- Check if already processed
local is_member = redis.call('sismember', processed_key, event_id)

if is_member == 1 then
  -- Event already processed, increment duplicate counter
  local count = redis.call('incr', duplicate_key)
  redis.call('expire', duplicate_key, 3600)
  return {1, count} -- {is_duplicate, duplicate_count}
else
  -- First time processing, add to set
  redis.call('sadd', processed_key, event_id)
  redis.call('expire', processed_key, 86400) -- 24 hour TTL
  return {0, 0} -- {not_duplicate, 0}
end
`;

/**
 * Task assignment with load balancing
 * Finds best instance, checks capacity, assigns task atomically
 */
export const ASSIGN_TASK_WITH_LOAD_BALANCING = `
local instances_pattern = KEYS[1]
local global_queue = KEYS[2]
local history_key = KEYS[3]
local task_id = ARGV[1]

-- Get all instance keys
local instance_keys = redis.call('keys', instances_pattern)
if #instance_keys == 0 then
  return {nil, 0, 0} -- No instances available
end

local best_instance = nil
local min_load = 999999

-- Find instance with minimum load
for i, instance_key in ipairs(instance_keys) do
  local instance_id = string.match(instance_key, "([^:]+)$")
  local queue_key = 'cb:queue:instance:' .. instance_id
  local capacity_key = 'cb:capacity:' .. instance_id
  
  local current_load = redis.call('llen', queue_key)
  local max_capacity = redis.call('hget', capacity_key, 'maxTasks') or '10'
  max_capacity = tonumber(max_capacity)
  
  if current_load < max_capacity and current_load < min_load then
    min_load = current_load
    best_instance = instance_id
  end
end

if best_instance then
  -- Assign task to best instance
  local queue_key = 'cb:queue:instance:' .. best_instance
  redis.call('rpush', queue_key, task_id)
  
  -- Remove from global queue
  redis.call('zrem', global_queue, task_id)
  
  -- Add to history
  local history_entry = cjson.encode({
    taskId = task_id,
    instanceId = best_instance,
    timestamp = tonumber(ARGV[2])
  })
  redis.call('lpush', history_key, history_entry)
  redis.call('ltrim', history_key, 0, 999)
  redis.call('expire', history_key, 86400)
  
  return {best_instance, min_load + 1, 1} -- {assigned_to, new_queue_depth, success}
else
  return {nil, 0, 0} -- All instances at capacity
end
`;

/**
 * Gossip protocol health update
 * Updates health data and detects partitions atomically
 */
export const GOSSIP_HEALTH_UPDATE = `
local gossip_key = KEYS[1]
local partition_key = KEYS[2]
local recovery_key = KEYS[3]
local instance_id = ARGV[1]
local health_status = ARGV[2]
local timestamp = ARGV[3]

-- Update gossip health data
local health_data = cjson.encode({
  status = health_status,
  lastSeen = timestamp
})
redis.call('hset', gossip_key, instance_id, health_data)
redis.call('expire', gossip_key, 300)

-- Check for partition detection
local all_instances = redis.call('hgetall', gossip_key)
local healthy_count = 0
local total_count = 0

for i = 1, #all_instances, 2 do
  total_count = total_count + 1
  local data = cjson.decode(all_instances[i + 1])
  if data.status == 'healthy' then
    healthy_count = healthy_count + 1
  end
end

-- Detect partition if less than half are healthy
local partition_detected = 0
if total_count > 2 and healthy_count < (total_count / 2) then
  redis.call('set', partition_key, 'true', 'EX', 300)
  partition_detected = 1
elseif healthy_count > (total_count * 0.7) then
  -- Recovery detected
  redis.call('set', recovery_key, 'true', 'EX', 300)
end

return {1, partition_detected} -- {updated, partition_detected}
`;

/**
 * Quorum-based voting
 * Adds vote and checks for quorum atomically
 */
export const QUORUM_VOTE = `
local quorum_key = KEYS[1]
local decision_key = KEYS[2]
local vote_id = ARGV[1]
local vote_value = ARGV[2]
local total_instances = tonumber(ARGV[3])

-- Get current votes
local votes_json = redis.call('hget', quorum_key, 'votes') or '[]'
local votes = cjson.decode(votes_json)

-- Add new vote
table.insert(votes, {id = vote_id, value = vote_value})

-- Check if quorum reached (majority)
local quorum_size = math.floor(total_instances / 2) + 1
local quorum_reached = #votes >= quorum_size

local decision = nil
if quorum_reached then
  -- Count vote values
  local vote_counts = {}
  for _, vote in ipairs(votes) do
    vote_counts[vote.value] = (vote_counts[vote.value] or 0) + 1
  end
  
  -- Find majority decision
  for value, count in pairs(vote_counts) do
    if count >= quorum_size then
      decision = value
      break
    end
  end
end

-- Store updated votes and decision
redis.call('hset', quorum_key, 'votes', cjson.encode(votes))
if decision then
  redis.call('hset', quorum_key, 'decision', decision)
  redis.call('hset', quorum_key, 'timestamp', ARGV[4])
end
redis.call('expire', quorum_key, 300)

return {quorum_reached and 1 or 0, decision, #votes}
`;

/**
 * Global metrics aggregation
 * Calculates metrics across all instances atomically
 */
export const AGGREGATE_GLOBAL_METRICS = `
local metrics_key = KEYS[1]
local instances_pattern = KEYS[2]
local scaling_key = KEYS[3]

-- Count instances
local instance_keys = redis.call('keys', instances_pattern)
local instance_count = #instance_keys

-- Aggregate metrics
local total_events = 0
local total_tasks = 0
local total_latency = 0
local latency_count = 0

-- Get event count from various sources
local task_keys = redis.call('keys', 'cb:task:*')
total_tasks = #task_keys

local event_keys = redis.call('keys', 'cb:stream:*')
for _, key in ipairs(event_keys) do
  local count = redis.call('xlen', key)
  total_events = total_events + count
end

-- Calculate throughput (events per second)
local throughput = 0
if total_events > 0 then
  throughput = total_events / 60 -- Assuming 60 second window
end

-- Calculate average latency (mock for now, would come from real measurements)
local avg_latency = 50 -- Default 50ms

-- Store aggregated metrics
redis.call('hset', metrics_key, 'totalEvents', tostring(total_events))
redis.call('hset', metrics_key, 'totalTasks', tostring(total_tasks))
redis.call('hset', metrics_key, 'avgLatency', tostring(avg_latency))
redis.call('hset', metrics_key, 'throughput', tostring(throughput))
redis.call('expire', metrics_key, 3600)

-- Calculate load balance
local load_variance = 0
local total_load = 0
local loads = {}

for _, instance_key in ipairs(instance_keys) do
  local instance_id = string.match(instance_key, "([^:]+)$")
  local queue_key = 'cb:queue:instance:' .. instance_id
  local load = redis.call('llen', queue_key)
  table.insert(loads, load)
  total_load = total_load + load
end

if instance_count > 0 then
  local avg_load = total_load / instance_count
  for _, load in ipairs(loads) do
    load_variance = load_variance + math.abs(load - avg_load)
  end
  load_variance = load_variance / instance_count
end

-- Store scaling metrics
redis.call('hset', scaling_key, 'instanceCount', tostring(instance_count))
redis.call('hset', scaling_key, 'loadBalance', tostring(load_variance))
redis.call('hset', scaling_key, 'totalLoad', tostring(total_load))
redis.call('expire', scaling_key, 300)

return {total_events, total_tasks, avg_latency, throughput, instance_count}
`;

/**
 * Event partitioning with ordering
 * Adds event to partition maintaining timestamp order
 */
export const PARTITION_EVENT = `
local partition_key = KEYS[1]
local event_id = ARGV[1]
local timestamp = ARGV[2]
local event_data = ARGV[3]

-- Create event entry
local entry = cjson.encode({
  id = event_id,
  timestamp = tonumber(timestamp),
  data = event_data
})

-- Add to partition list (already ordered by insertion time)
redis.call('rpush', partition_key, entry)

-- Trim to keep only recent events (last 1000)
redis.call('ltrim', partition_key, -1000, -1)
redis.call('expire', partition_key, 3600)

local length = redis.call('llen', partition_key)
return {1, length} -- {success, list_length}
`;

/**
 * Batch processing coordination
 * Acquires lock and tracks progress atomically
 */
export const COORDINATE_BATCH = `
local lock_key = KEYS[1]
local progress_key = KEYS[2]
local current_key = KEYS[3]
local processor_id = ARGV[1]
local batch_id = ARGV[2]
local total_items = tonumber(ARGV[3])

-- Try to acquire lock
local lock_acquired = redis.call('set', lock_key, processor_id, 'NX', 'EX', 60)

if lock_acquired then
  -- Set current batch
  redis.call('set', current_key, batch_id, 'EX', 300)
  
  -- Initialize progress
  redis.call('hset', progress_key, 'processed', '0')
  redis.call('hset', progress_key, 'total', tostring(total_items))
  redis.call('hset', progress_key, 'processor', processor_id)
  redis.call('expire', progress_key, 300)
  
  return {1, processor_id, 0} -- {success, processor, progress}
else
  -- Lock not acquired, return current processor
  local current_processor = redis.call('get', lock_key)
  local processed = redis.call('hget', progress_key, 'processed') or '0'
  return {0, current_processor, tonumber(processed)}
end
`;

/**
 * Global state synchronization with versioning
 * Updates state with automatic version increment
 */
export const SYNC_GLOBAL_STATE = `
local state_key = KEYS[1]
local state_data = ARGV[1]

-- Get current version
local current_version = redis.call('hget', state_key, 'version') or '0'
local new_version = tonumber(current_version) + 1

-- Update state with new version
redis.call('hset', state_key, 'data', state_data)
redis.call('hset', state_key, 'version', tostring(new_version))
redis.call('hset', state_key, 'timestamp', ARGV[2])
redis.call('expire', state_key, 300)

return {1, new_version}
`;