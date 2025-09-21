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

/**
 * Task creation with atomic queue addition
 * Creates task and adds to global queue in single operation
 */
export const TASK_CREATE = `
local task_key = KEYS[1]          -- cb:task:{taskId}
local global_queue = KEYS[2]      -- cb:queue:tasks:pending
local task_id = ARGV[1]
local task_text = ARGV[2]
local priority = tonumber(ARGV[3])
local status = ARGV[4]
local created_at = ARGV[5]
local metadata = ARGV[6]

-- Check if task already exists
local exists = redis.call('exists', task_key)
if exists == 1 then
  return {0, 'Task already exists'}
end

-- Create task hash
redis.call('hset', task_key,
  'id', task_id,
  'text', task_text,
  'priority', tostring(priority),
  'status', status,
  'createdAt', created_at,
  'updatedAt', created_at,
  'metadata', metadata,
  'assignedTo', '',
  'result', '',
  'error', ''
)

-- Add to global queue (negative priority for descending order)
redis.call('zadd', global_queue, -priority, task_id)

-- Update queue metrics at creation
local metrics_key = 'cb:metrics:queues'
redis.call('hincrby', metrics_key, 'totalTasks', 1)
redis.call('hincrby', metrics_key, 'pendingTasks', 1)

-- Initialize throughput if it doesn't exist
local throughput_exists = redis.call('hexists', metrics_key, 'throughput')
if throughput_exists == 0 then
  redis.call('hset', metrics_key, 'throughput', '0')
end

-- Store creation timestamp for wait time calculation
-- Store as milliseconds for easy calculation
local now_ms = redis.call('time')[1] * 1000 + redis.call('time')[2] / 1000
redis.call('hset', task_key, 'createdAtMs', tostring(math.floor(now_ms)))

return {1, task_id}
`;

/**
 * Task claiming for pull-based model
 * Worker atomically claims next available task
 */
export const TASK_CLAIM = `
local global_queue = KEYS[1]      -- cb:queue:tasks:pending
local worker_queue = KEYS[2]      -- cb:queue:instance:{workerId}
local history_key = KEYS[3]       -- cb:history:assignments
local worker_id = ARGV[1]
local timestamp = ARGV[2]

-- Try to find a pending task (may need to check multiple tasks)
local max_attempts = 10  -- Check up to 10 tasks to find a pending one
local task_id = nil
local task_key = nil
local task_data = nil

for i = 1, max_attempts do
  -- Get highest priority task (first in sorted set with negative scores)
  local tasks = redis.call('zrange', global_queue, 0, 0)  -- zrange gets lowest score, which is highest priority (-90 < -10)
  if #tasks == 0 then
    return {0, nil, nil} -- No tasks available
  end
  
  local candidate_id = tasks[1]
  local candidate_key = 'cb:task:' .. candidate_id
  
  -- Check task status before claiming
  local status = redis.call('hget', candidate_key, 'status')
  
  if status == 'pending' or status == nil or status == '' then
    -- Found a pending task (or task with no status, treat as pending), try to claim it
    local removed = redis.call('zrem', global_queue, candidate_id)
    if removed == 1 then
      -- Successfully removed from queue
      task_id = candidate_id
      task_key = candidate_key
      task_data = redis.call('hgetall', task_key)
      break
    end
    -- If remove failed, another worker claimed it, continue to next task
  else
    -- Task is not pending (could be in_progress, completed, or failed)
    -- Remove it from the pending queue since it shouldn't be there
    redis.call('zrem', global_queue, candidate_id)
    -- Continue looking for a pending task
  end
end

if not task_id then
  return {0, nil, nil} -- No pending tasks found
end

if #task_data == 0 then
  -- Task doesn't exist, shouldn't happen
  return {0, nil, nil}
end

-- Update task assignment (status will be updated by task.update handler)
redis.call('hset', task_key,
  'assignedTo', worker_id,
  'assignedAt', timestamp,
  'updatedAt', timestamp
)

-- Add to worker's queue
redis.call('rpush', worker_queue, task_id)

-- Add to history
local history_entry = cjson.encode({
  taskId = task_id,
  instanceId = worker_id,
  timestamp = tonumber(timestamp),
  action = 'claimed'
})
redis.call('lpush', history_key, history_entry)
redis.call('ltrim', history_key, 0, 999)
redis.call('expire', history_key, 86400)

-- Update metrics
local metrics_key = 'cb:metrics:instance:' .. worker_id
redis.call('hincrby', metrics_key, 'tasksClaimed', 1)

-- Build task data for response
local task = {}
for i = 1, #task_data, 2 do
  task[task_data[i]] = task_data[i + 1]
end

return {1, task_id, cjson.encode(task)}
`;

/**
 * Task reassignment with deny list (taint/toleration pattern)
 * Allows MASTER to move tasks between workers or back to global queue
 */
export const TASK_REASSIGN = `
local task_key = KEYS[1]          -- cb:task:{taskId}
local global_queue = KEYS[2]      -- cb:queue:tasks:pending
local task_id = ARGV[1]
local target_worker = ARGV[2]     -- Optional: specific worker or nil for global
local reason = ARGV[3]            -- Why reassigning (failed, rebalance, etc)

-- Get task data
local task_data = redis.call('hgetall', task_key)
if #task_data == 0 then
  return {0, 'Task not found'}
end

-- Parse task fields
local current_status = nil
local current_assignee = nil
local deny_list = nil
local priority = nil

for i = 1, #task_data, 2 do
  local field = task_data[i]
  local value = task_data[i + 1]
  if field == 'status' then
    current_status = value
  elseif field == 'assignedTo' then
    current_assignee = value
  elseif field == 'deny' then
    deny_list = value  -- JSON array of denied worker IDs
  elseif field == 'priority' then
    priority = tonumber(value) or 50
  end
end

-- Allow reassignment if task is failed OR if MASTER is forcing it
-- (MASTER knows what they're doing - they might kill -9 the worker next)
local allow_reassign = (current_status == 'failed') or (reason == 'force')

-- If not failed and not forced, only allow if currently assigned
if not allow_reassign and (not current_assignee or current_assignee == '') then
  return {0, 'Task not assigned, use task.assign instead'}
end

-- Update deny list to prevent ping-pong
local deny_array = {}
if deny_list and deny_list ~= '' then
  deny_array = cjson.decode(deny_list)
end

-- Add current assignee to deny list (they couldn't handle it)
if current_assignee and current_assignee ~= '' then
  local already_denied = false
  for _, denied_id in ipairs(deny_array) do
    if denied_id == current_assignee then
      already_denied = true
      break
    end
  end
  if not already_denied then
    table.insert(deny_array, current_assignee)
  end
end

-- Remove from current worker's queue if assigned
if current_assignee and current_assignee ~= '' then
  local worker_queue = 'cb:queue:instance:' .. current_assignee
  redis.call('lrem', worker_queue, 0, task_id)
end

-- Determine target
if target_worker and target_worker ~= '' then
  -- Check if target is in deny list
  for _, denied_id in ipairs(deny_array) do
    if denied_id == target_worker then
      return {0, 'Target worker is in deny list for this task'}
    end
  end
  
  -- Assign to specific worker
  local target_queue = 'cb:queue:instance:' .. target_worker
  redis.call('lpush', target_queue, task_id)
  
  -- Update task
  redis.call('hset', task_key,
    'assignedTo', target_worker,
    'status', 'in_progress',
    'deny', cjson.encode(deny_array),
    'reassignedAt', redis.call('time')[1],
    'reassignReason', reason
  )
  
  return {1, target_worker}
else
  -- Return to global queue for redistribution
  redis.call('zadd', global_queue, -priority, task_id)
  
  -- Update task
  redis.call('hset', task_key,
    'assignedTo', '',
    'status', 'pending',
    'deny', cjson.encode(deny_array),
    'reassignedAt', redis.call('time')[1],
    'reassignReason', reason
  )
  
  return {1, 'global'}
end
`;

/**
 * Task completion with atomic cleanup
 * Completes task and removes from all queues
 */
export const TASK_COMPLETE = `
local task_key = KEYS[1]          -- cb:task:{taskId}
local task_id = ARGV[1]
local result = ARGV[2]
local completed_at = ARGV[3]
local duration = ARGV[4]

-- Check task exists
local exists = redis.call('exists', task_key)
if exists == 0 then
  return {0, 'Task not found'}
end

-- Get task data
local assigned_to = redis.call('hget', task_key, 'assignedTo')
if not assigned_to or assigned_to == '' then
  return {0, 'Task not assigned'}
end

local current_status = redis.call('hget', task_key, 'status')
if current_status == 'completed' or current_status == 'failed' then
  return {0, 'Task already completed'}
end

-- Determine final status based on result
local status = 'completed'
if result == '' or result == 'null' then
  status = 'failed'
end

-- Update task
redis.call('hset', task_key,
  'status', status,
  'completedAt', completed_at,
  'updatedAt', completed_at,
  'result', result,
  'duration', tostring(duration)
)

-- Remove from worker queue
local worker_queue = 'cb:queue:instance:' .. assigned_to
redis.call('lrem', worker_queue, 0, task_id)

-- Update instance metrics
local metrics_key = 'cb:metrics:instance:' .. assigned_to
redis.call('hincrby', metrics_key, 'tasksCompleted', 1)
if status == 'failed' then
  redis.call('hincrby', metrics_key, 'tasksFailed', 1)
end

-- Update queue metrics for throughput
local queue_metrics_key = 'cb:metrics:queues'
local completed_count = redis.call('hincrby', queue_metrics_key, 'completedTasks', 1)
-- Decrement assignedTasks only if it's positive (defensive)
local assigned = tonumber(redis.call('hget', queue_metrics_key, 'assignedTasks') or '0')
if assigned > 0 then
  redis.call('hincrby', queue_metrics_key, 'assignedTasks', -1)  -- No longer assigned
end
local now = redis.call('time')[1]

-- Calculate throughput (tasks per second)
local first_completion = redis.call('hget', queue_metrics_key, 'firstCompletionTime')
if not first_completion then
  redis.call('hset', queue_metrics_key, 'firstCompletionTime', tostring(now))
  redis.call('hset', queue_metrics_key, 'lastCompletionTime', tostring(now))
  redis.call('hset', queue_metrics_key, 'throughput', '0')  -- Will be calculated after more completions
else
  redis.call('hset', queue_metrics_key, 'lastCompletionTime', tostring(now))
  local elapsed = now - tonumber(first_completion)
  if elapsed > 0 then
    -- Tasks per second since first completion
    local throughput = completed_count / elapsed
    redis.call('hset', queue_metrics_key, 'throughput', tostring(throughput))
  else
    -- If no time elapsed, set high throughput (multiple completions in same second)
    redis.call('hset', queue_metrics_key, 'throughput', tostring(completed_count))
  end
end

-- Add to completion history
local history_key = 'cb:history:task:' .. task_id .. ':completions'
local history_entry = cjson.encode({
  status = status,
  completedAt = completed_at,
  completedBy = assigned_to,
  duration = duration
})
redis.call('rpush', history_key, history_entry)

-- Update queue metrics
local queue_metrics_key = 'cb:metrics:queues'
redis.call('hincrby', queue_metrics_key, 'tasksCompleted', 1)

return {1, status}
`;

/**
 * Task update with queue repositioning
 * Updates task and repositions in queue if needed
 */
export const TASK_UPDATE = `
local task_key = KEYS[1]          -- cb:task:{taskId}
local global_queue = KEYS[2]      -- cb:queue:tasks:pending
local task_id = ARGV[1]
local updates_json = ARGV[2]
local updated_at = ARGV[3]

-- Check task exists
local exists = redis.call('exists', task_key)
if exists == 0 then
  return {0, 'Task not found'}
end

-- Parse updates
local updates = cjson.decode(updates_json)

-- Get current task data
local current_status = redis.call('hget', task_key, 'status')
local current_priority = tonumber(redis.call('hget', task_key, 'priority'))

-- CRITICAL: Prevent regression of completed tasks (but allow retry of failed tasks)
if current_status == 'completed' and updates.status then
  if updates.status ~= 'completed' then
    return {0, 'Cannot change status of completed task to ' .. updates.status}
  end
end

-- Apply updates
redis.call('hset', task_key, 'updatedAt', updated_at)

if updates.text then
  redis.call('hset', task_key, 'text', updates.text)
end

if updates.status then
  redis.call('hset', task_key, 'status', updates.status)
  if updates.status == 'completed' or updates.status == 'failed' then
    redis.call('hset', task_key, 'completedAt', updated_at)
  end
end

if updates.metadata then
  redis.call('hset', task_key, 'metadata', updates.metadata)
end

-- Handle priority update with queue repositioning
if updates.priority then
  redis.call('hset', task_key, 'priority', tostring(updates.priority))
  
  -- If task is still pending, update queue position
  if current_status == 'pending' then
    redis.call('zrem', global_queue, task_id)
    redis.call('zadd', global_queue, -updates.priority, task_id)
  end
end

return {1, task_id}
`;

/**
 * Check for tasks that need auto-assignment after delay
 * Returns tasks that have been waiting longer than the specified delay
 */
export const CHECK_DELAYED_TASKS = `
local global_queue = KEYS[1]      -- cb:queue:tasks:pending
local delay_ms = tonumber(ARGV[1]) -- Milliseconds to wait before auto-assign
local max_tasks = tonumber(ARGV[2]) -- Max tasks to return

local now_ms = redis.call('time')[1] * 1000 + redis.call('time')[2] / 1000
local tasks_needing_assignment = {}

-- Get all pending tasks with scores (priority)
local pending_tasks = redis.call('zrange', global_queue, 0, -1, 'WITHSCORES')  -- Use zrange for correct priority order

for i = 1, #pending_tasks, 2 do
  local task_id = pending_tasks[i]
  local priority = pending_tasks[i + 1]
  
  -- Check task age
  local task_key = 'cb:task:' .. task_id
  local created_at_ms = redis.call('hget', task_key, 'createdAtMs')
  local assigned_to = redis.call('hget', task_key, 'assignedTo')
  
  -- Only consider unassigned tasks
  if created_at_ms and (not assigned_to or assigned_to == '') then
    local age_ms = now_ms - tonumber(created_at_ms)
    
    -- If task is older than delay, add to list
    if age_ms >= delay_ms then
      table.insert(tasks_needing_assignment, task_id)
      
      -- Limit results
      if #tasks_needing_assignment >= max_tasks then
        break
      end
    end
  end
end

return tasks_needing_assignment
`;

/**
 * Auto-assign tasks to workers on registration
 * Distributes pending tasks to available workers
 */
export const AUTO_ASSIGN_TASKS = `
local global_queue = KEYS[1]        -- cb:queue:tasks:pending
local worker_id = ARGV[1]
local worker_queue_key = 'cb:queue:instance:' .. worker_id

-- Get all workers to calculate fair share
local worker_keys = redis.call('keys', 'cb:instance:worker-*')
local active_workers = #worker_keys

if active_workers == 0 then
  return {0, 0, 'No workers found'} -- No workers, no assignment
end

-- Get pending tasks from global queue (sorted by priority)
local pending_tasks = redis.call('zrange', global_queue, 0, -1, 'WITHSCORES') -- Use zrange for high priority first (negative scores)
local total_tasks = #pending_tasks / 2  -- Each task has score, so divide by 2

if total_tasks == 0 then
  return {0, 0, 'No tasks in queue'} -- No tasks to assign
end

-- Assign tasks to this worker
local assigned_count = 0
local checked_count = 0

for i = 1, #pending_tasks, 2 do
  local task_id = pending_tasks[i]
  local priority = pending_tasks[i + 1]
  checked_count = checked_count + 1
  
  -- Check if this specific task is already in THIS worker's queue
  local already_has = redis.call('lpos', worker_queue_key, task_id)
  
  if not already_has then
    -- Check if task is already assigned to someone else
    local task_key = 'cb:task:' .. task_id
    local current_assignee = redis.call('hget', task_key, 'assignedTo')
    local deny_list = redis.call('hget', task_key, 'deny')
    
    -- Check if this worker is in the deny list
    local is_denied = false
    if deny_list and deny_list ~= '' then
      local deny_array = cjson.decode(deny_list)
      for _, denied_id in ipairs(deny_array) do
        if denied_id == worker_id then
          is_denied = true
          break
        end
      end
    end
    
    -- Only assign if not already assigned AND not denied
    if (not current_assignee or current_assignee == '') and not is_denied then
      -- Assign to this worker
      redis.call('lpush', worker_queue_key, task_id)
      assigned_count = assigned_count + 1
      
      -- Update task assignment
      redis.call('hset', task_key,
        'assignedTo', worker_id,
        'status', 'in_progress',
        'assignedAt', redis.call('time')[1]
      )
      
      -- Calculate actual wait time using stored timestamp
      local created_at_ms = redis.call('hget', task_key, 'createdAtMs')
      
      if created_at_ms then
        local now_ms = redis.call('time')[1] * 1000 + redis.call('time')[2] / 1000
        local wait_time = math.floor(now_ms - tonumber(created_at_ms))
        
        -- Update wait time metrics
        local metrics_key = 'cb:metrics:queues'
        local total_wait = redis.call('hget', metrics_key, 'totalWaitTime') or '0'
        local wait_count = redis.call('hget', metrics_key, 'waitCount') or '0'
        
        total_wait = tonumber(total_wait) + wait_time
        wait_count = tonumber(wait_count) + 1
        local avg_wait = math.floor(total_wait / wait_count)
        
        redis.call('hset', metrics_key, 
          'totalWaitTime', tostring(total_wait),
          'waitCount', tostring(wait_count),
          'avgWaitTime', tostring(avg_wait)
        )
        
        -- Decrement pending tasks only if it's positive (defensive)
        local pending = tonumber(redis.call('hget', metrics_key, 'pendingTasks') or '0')
        if pending > 0 then
          redis.call('hincrby', metrics_key, 'pendingTasks', -1)
        end
        redis.call('hincrby', metrics_key, 'assignedTasks', 1)
      end
      
      -- Track assignment in list format as expected by tests
      local assignment = cjson.encode({
        taskId = task_id,
        instanceId = worker_id,
        timestamp = redis.call('time')[1]
      })
      redis.call('lpush', 'cb:history:assignments', assignment)
    end
    
    -- Only assign one task at a time for fair distribution
    break
  end
end

return {assigned_count, total_tasks}
`;

/**
 * Instance registration with atomic setup
 * Registers instance, sets up roles, capabilities, and leader election
 */
export const INSTANCE_REGISTER = `
local instance_key = KEYS[1]      -- cb:instance:{id}
local active_key = KEYS[2]        -- cb:instances:active
local instance_id = ARGV[1]
local roles_json = ARGV[2]
local timestamp = ARGV[3]
local ttl = tonumber(ARGV[4])

-- Register instance
redis.call('hset', instance_key,
  'id', instance_id,
  'roles', roles_json,
  'health', 'healthy',
  'status', 'ACTIVE',
  'lastSeen', timestamp
)
redis.call('expire', instance_key, ttl)

-- Add to active instances
redis.call('sadd', active_key, instance_id)
redis.call('expire', active_key, ttl)

-- Register roles
local roles = cjson.decode(roles_json)
for _, role in ipairs(roles) do
  local role_key = 'cb:role:' .. role
  redis.call('sadd', role_key, instance_id)
  redis.call('expire', role_key, ttl)
  
  -- Set capabilities
  local caps_key = 'cb:capabilities:' .. instance_id
  redis.call('sadd', caps_key, role)
  redis.call('sadd', caps_key, 'instance-' .. instance_id)
  redis.call('expire', caps_key, ttl)
end

-- Try to become leader if no current leader
local leader_key = 'cb:leader:current'
local lock_key = 'cb:leader:lock'
local current_leader = redis.call('get', leader_key)

local became_leader = 0
if not current_leader then
  local lock_acquired = redis.call('setnx', lock_key, instance_id)
  if lock_acquired == 1 then
    redis.call('expire', lock_key, 30)
    redis.call('setex', leader_key, 30, instance_id)
    became_leader = 1
  end
end

return {1, became_leader}
`;

/**
 * Instance heartbeat with gossip update
 * Updates heartbeat and gossip health atomically
 */
export const INSTANCE_HEARTBEAT = `
local instance_key = KEYS[1]      -- cb:instance:{id}
local gossip_key = KEYS[2]        -- cb:gossip:health
local instance_id = ARGV[1]
local timestamp = ARGV[2]
local ttl = tonumber(ARGV[3])
local iso_date = ARGV[4]          -- ISO string for lastHeartbeat

-- Check instance exists
local exists = redis.call('exists', instance_key)
if exists == 0 then
  return {0, 'Instance not registered'}
end

-- Update heartbeat with both timestamp and ISO date
redis.call('hset', instance_key,
  'lastSeen', timestamp,
  'lastHeartbeat', iso_date
)
redis.call('expire', instance_key, ttl)

-- Update gossip health
local health_data = cjson.encode({
  status = 'healthy',
  lastSeen = timestamp
})
redis.call('hset', gossip_key, instance_id, health_data)
redis.call('expire', gossip_key, 300)

-- Check if this instance is leader and renew if so
local leader_key = 'cb:leader:current'
local current_leader = redis.call('get', leader_key)
local is_leader = 0
if current_leader == instance_id then
  redis.call('expire', leader_key, 30)
  redis.call('expire', 'cb:leader:lock', 30)
  is_leader = 1
end

return {1, is_leader}
`;

/**
 * Get aggregated system health
 * Checks all instances and returns overall health
 */
export const GET_SYSTEM_HEALTH = `
local instances_pattern = KEYS[1]  -- cb:instance:*
local gossip_key = KEYS[2]         -- cb:gossip:health
local current_time = tonumber(ARGV[1])
local timeout = tonumber(ARGV[2])

-- Get all instances
local instance_keys = redis.call('keys', instances_pattern)
local total = #instance_keys
local healthy = 0
local degraded = 0

for _, key in ipairs(instance_keys) do
  local last_seen = redis.call('hget', key, 'lastSeen')
  if last_seen then
    local time_diff = current_time - tonumber(last_seen)
    if time_diff < timeout then
      healthy = healthy + 1
    elseif time_diff < timeout * 2 then
      degraded = degraded + 1
    end
  end
end

-- Determine overall health
local status = 'unhealthy'
if healthy == total and total > 0 then
  status = 'healthy'
elseif healthy + degraded >= total / 2 then
  status = 'degraded'
end

-- Check services
local redis_ok = 1  -- Redis is working if we're here
local postgres_ok = redis.call('get', 'cb:service:postgres:status') == 'ok' and 1 or 0
local mcp_ok = redis.call('get', 'cb:service:mcp:status') == 'ok' and 1 or 0

return {status, redis_ok, postgres_ok, mcp_ok, healthy, total}
`;

/**
 * Get current system state
 * Returns tasks, instances, and recent events
 */
export const GET_SYSTEM_STATE = `
local instance_pattern = KEYS[1]   -- cb:instance:*
local task_pattern = KEYS[2]       -- cb:task:*
local event_stream = KEYS[3]       -- cb:stream:events

-- Get instances (max 10)
local instance_keys = redis.call('keys', instance_pattern)
local instances = {}
for i = 1, math.min(#instance_keys, 10) do
  local data = redis.call('hgetall', instance_keys[i])
  if #data > 0 then
    local instance = {}
    for j = 1, #data, 2 do
      instance[data[j]] = data[j + 1]
    end
    table.insert(instances, instance)
  end
end

-- Get tasks (max 10)
local task_keys = redis.call('keys', task_pattern)
local tasks = {}
for i = 1, math.min(#task_keys, 10) do
  -- Skip attachment-related keys
  if not string.match(task_keys[i], ':attachment') then
    local data = redis.call('hgetall', task_keys[i])
    if #data > 0 then
      local task = {}
      for j = 1, #data, 2 do
        task[data[j]] = data[j + 1]
      end
      table.insert(tasks, task)
    end
  end
end

-- Get recent events (max 10)
local events = {}
local stream_exists = redis.call('exists', event_stream)
if stream_exists == 1 then
  local stream_data = redis.call('xrevrange', event_stream, '+', '-', 'COUNT', '10')
  for _, entry in ipairs(stream_data) do
    table.insert(events, entry[2])
  end
end

return {
  cjson.encode(instances),
  cjson.encode(tasks),
  cjson.encode(events)
}
`;

/**
 * Reassigns tasks from failed instances to healthy workers
 */
export const REASSIGN_FAILED_TASKS = `
local failed_instance_id = ARGV[1]
local failed_instance_key = 'cb:instance:' .. failed_instance_id
local failed_queue_key = 'cb:queue:instance:' .. failed_instance_id
local redistributed_key = 'cb:redistributed:from:' .. failed_instance_id

-- Mark instance as OFFLINE
redis.call('hset', failed_instance_key, 'status', 'OFFLINE')

-- Get all tasks from failed instance queue
local orphaned_tasks = redis.call('lrange', failed_queue_key, 0, -1)
if #orphaned_tasks == 0 then
  return {0, 'No tasks to reassign'}
end

-- Find healthy workers
local worker_keys = redis.call('keys', 'cb:instance:worker-*')
local healthy_workers = {}
for _, key in ipairs(worker_keys) do
  local status = redis.call('hget', key, 'status')
  if status == 'ACTIVE' then
    local worker_id = string.match(key, 'cb:instance:(.*)')
    if worker_id ~= failed_instance_id then
      table.insert(healthy_workers, worker_id)
    end
  end
end

if #healthy_workers == 0 then
  return {0, 'No healthy workers available'}
end

-- Reassign tasks round-robin to healthy workers
local reassigned_count = 0
for i, task_id in ipairs(orphaned_tasks) do
  local target_worker = healthy_workers[((i - 1) % #healthy_workers) + 1]
  local target_queue = 'cb:queue:instance:' .. target_worker
  
  -- Add to new worker's queue
  redis.call('lpush', target_queue, task_id)
  
  -- Track redistribution as a list with JSON objects
  local redistribution_data = cjson.encode({
    taskId = task_id,
    redistributedAt = redis.call('time')[1],
    targetWorker = target_worker
  })
  redis.call('lpush', redistributed_key, redistribution_data)
  reassigned_count = reassigned_count + 1
end

-- Clear failed instance queue
redis.call('del', failed_queue_key)

return {reassigned_count, #healthy_workers}
`;

/**
 * SWARM INTELLIGENCE LUA SCRIPTS
 * Atomic operations for coordinating multiple Claude instances
 */

/**
 * Decompose and store subtasks atomically
 * Creates subtask graph with dependencies
 */
export const DECOMPOSE_AND_STORE_SUBTASKS = `
local decomposition_key = KEYS[1]  -- cb:decomposition:{parent_task_id}
local subtasks_queue = KEYS[2]      -- cb:queue:subtasks
local dependency_graph = KEYS[3]    -- cb:graph:dependencies

local parent_id = ARGV[1]
local subtasks_json = ARGV[2]  -- From sampling response
local timestamp = ARGV[3]

-- Parse subtasks from sampling response
local subtasks = cjson.decode(subtasks_json)

-- Store decomposition atomically
redis.call('hset', decomposition_key, 'parent', parent_id)
redis.call('hset', decomposition_key, 'subtasks', subtasks_json)
redis.call('hset', decomposition_key, 'created_at', timestamp)
redis.call('expire', decomposition_key, 3600) -- 1 hour TTL

-- Build dependency graph and queue ready subtasks
local queued_count = 0
for i, subtask in ipairs(subtasks.subtasks) do
  -- Store subtask with its dependencies
  local subtask_key = 'cb:subtask:' .. subtask.id
  redis.call('hset', subtask_key, 'data', cjson.encode(subtask))
  redis.call('hset', subtask_key, 'parent', parent_id)
  redis.call('hset', subtask_key, 'status', 'pending')
  redis.call('expire', subtask_key, 3600)
  
  -- Build dependency graph
  if subtask.dependencies and #subtask.dependencies > 0 then
    for _, dep in ipairs(subtask.dependencies) do
      redis.call('sadd', 'cb:dependencies:' .. parent_id .. ':' .. subtask.id, dep)
      redis.call('expire', 'cb:dependencies:' .. parent_id .. ':' .. subtask.id, 3600)
    end
  else
    -- No dependencies, can start immediately
    redis.call('zadd', subtasks_queue, subtask.complexity, subtask.id)
    queued_count = queued_count + 1
  end
end

-- Update metrics
redis.call('incr', 'cb:metrics:swarm:decompositions')
redis.call('hincrby', 'cb:metrics:swarm:subtasks', 'total', #subtasks.subtasks)
redis.call('hincrby', 'cb:metrics:swarm:subtasks', 'queued', queued_count)

return {#subtasks.subtasks, 1, queued_count}  -- {subtask_count, success, queued_count}
`;

/**
 * Assign subtask to best specialist based on capabilities
 * Considers load, capabilities match, and current performance
 */
export const ASSIGN_TO_SPECIALIST = `
local specialists_key = KEYS[1]     -- cb:specialists:{type}
local subtask_key = KEYS[2]         -- cb:subtask:{id}
local assignment_key = KEYS[3]      -- cb:assignment:{subtask_id}

local subtask_id = ARGV[1]
local specialist_type = ARGV[2]
local required_capabilities = cjson.decode(ARGV[3])
local timestamp = ARGV[4]

-- Get all specialists of this type
local specialists = redis.call('smembers', specialists_key)
if #specialists == 0 then
  return {nil, 0, 0} -- No specialists available
end

local best_specialist = nil
local best_score = -1

for _, specialist_id in ipairs(specialists) do
  local spec_key = 'cb:instance:' .. specialist_id
  local capabilities = redis.call('hget', spec_key, 'capabilities')
  local health = redis.call('hget', spec_key, 'health')
  
  -- Skip unhealthy instances
  if health == 'healthy' and capabilities then
    local caps = cjson.decode(capabilities)
    local score = 0
    
    -- Score based on capability match
    for _, req_cap in ipairs(required_capabilities) do
      for _, spec_cap in ipairs(caps) do
        if req_cap == spec_cap then
          score = score + 10  -- 10 points per matching capability
        end
      end
    end
    
    -- Check current load (penalty for high load)
    local load = redis.call('llen', 'cb:queue:instance:' .. specialist_id)
    local max_capacity = redis.call('hget', spec_key, 'maxCapacity') or '5'
    max_capacity = tonumber(max_capacity)
    
    -- Calculate load penalty (0-50 points penalty based on load)
    local load_ratio = load / max_capacity
    local load_penalty = math.floor(load_ratio * 50)
    score = score - load_penalty
    
    -- Bonus for recent successful completions
    local recent_success = redis.call('hget', 'cb:metrics:instance:' .. specialist_id, 'recentSuccess')
    if recent_success then
      score = score + tonumber(recent_success)
    end
    
    if score > best_score then
      best_score = score
      best_specialist = specialist_id
    end
  end
end

if best_specialist then
  -- Assign atomically
  redis.call('hset', assignment_key, 'specialist', best_specialist)
  redis.call('hset', assignment_key, 'subtask', subtask_id)
  redis.call('hset', assignment_key, 'assigned_at', timestamp)
  redis.call('hset', assignment_key, 'score', tostring(best_score))
  redis.call('expire', assignment_key, 3600)
  
  -- Add to specialist's queue
  redis.call('rpush', 'cb:queue:instance:' .. best_specialist, subtask_id)
  
  -- Update subtask status
  redis.call('hset', subtask_key, 'status', 'assigned')
  redis.call('hset', subtask_key, 'assigned_to', best_specialist)
  
  -- Update metrics
  redis.call('incr', 'cb:metrics:swarm:assignments')
  redis.call('hincrby', 'cb:metrics:specialist:' .. best_specialist, 'assigned', 1)
  
  return {best_specialist, best_score, 1}  -- {specialist_id, score, success}
else
  -- No suitable specialist found
  redis.call('incr', 'cb:metrics:swarm:assignment_failures')
  return {nil, 0, 0}
end
`;

/**
 * Detect conflicts and queue for resolution
 * Compares multiple solutions and identifies conflicts
 */
export const DETECT_AND_QUEUE_CONFLICT = `
local solutions_key = KEYS[1]       -- cb:solutions:{task_id}
local conflicts_queue = KEYS[2]     -- cb:queue:conflicts

local task_id = ARGV[1]
local instance_id = ARGV[2]
local solution_json = ARGV[3]
local timestamp = ARGV[4]

-- Store solution
local solution_key = solutions_key .. ':' .. instance_id
redis.call('set', solution_key, solution_json, 'EX', 3600)

-- Get all solutions for this task
local pattern = solutions_key .. ':*'
local all_solutions = {}
local cursor = '0'
repeat
  local result = redis.call('SCAN', cursor, 'MATCH', pattern, 'COUNT', 100)
  cursor = result[1]
  for _, key in ipairs(result[2]) do
    table.insert(all_solutions, key)
  end
until cursor == '0'

if #all_solutions > 1 then
  -- Multiple solutions exist, analyze for conflicts
  local solutions = {}
  local approaches = {}
  
  for _, sol_key in ipairs(all_solutions) do
    local sol = redis.call('get', sol_key)
    if sol then
      table.insert(solutions, sol)
      -- Extract approach for comparison (simple heuristic)
      local sol_data = cjson.decode(sol)
      if sol_data.approach then
        table.insert(approaches, sol_data.approach)
      end
    end
  end
  
  -- Check if approaches differ (simple conflict detection)
  local has_conflict = false
  if #approaches > 1 then
    local first_approach = approaches[1]
    for i = 2, #approaches do
      if approaches[i] ~= first_approach then
        has_conflict = true
        break
      end
    end
  end
  
  if has_conflict then
    -- Create conflict record
    local conflict = {
      id = 'conflict-' .. task_id .. '-' .. timestamp,
      task_id = task_id,
      solutions = solutions,
      instance_count = #all_solutions,
      created_at = timestamp
    }
    
    -- Queue for resolution via sampling
    redis.call('zadd', conflicts_queue, tonumber(timestamp), cjson.encode(conflict))
    
    -- Update metrics
    redis.call('incr', 'cb:metrics:swarm:conflicts')
    redis.call('hincrby', 'cb:metrics:swarm:conflicts_by_task', task_id, 1)
    
    return {1, #all_solutions}  -- {conflict_detected, solution_count}
  end
end

return {0, #all_solutions}  -- {no_conflict, solution_count}
`;

/**
 * Track and synthesize progress from multiple specialists
 * Determines when all subtasks are complete and ready for integration
 */
export const SYNTHESIZE_PROGRESS = `
local progress_key = KEYS[1]        -- cb:progress:{parent_task}
local integration_queue = KEYS[2]   -- cb:queue:integration
local decomposition_key = KEYS[3]   -- cb:decomposition:{parent_task}

local parent_id = ARGV[1]
local subtask_id = ARGV[2]
local progress_json = ARGV[3]
local timestamp = ARGV[4]

-- Store subtask progress
redis.call('hset', progress_key, subtask_id, progress_json)
redis.call('expire', progress_key, 3600)

-- Update subtask status to completed and remove from queue
local subtask_key = 'cb:subtask:' .. subtask_id
redis.call('hset', subtask_key, 'status', 'completed')
redis.call('hset', subtask_key, 'completed_at', timestamp)

-- Remove completed subtask from queue
redis.call('zrem', 'cb:queue:subtasks', subtask_id)

-- Check if dependencies are resolved for other subtasks
local deps_pattern = 'cb:dependencies:' .. parent_id .. ':*'
local waiting_subtasks = {}
local cursor = '0'
repeat
  local result = redis.call('SCAN', cursor, 'MATCH', deps_pattern, 'COUNT', 100)
  cursor = result[1]
  for _, dep_key in ipairs(result[2]) do
    -- Check if this completed subtask was a dependency
    local is_member = redis.call('sismember', dep_key, subtask_id)
    if is_member == 1 then
      -- Remove from dependencies
      redis.call('srem', dep_key, subtask_id)
      
      -- Check if all dependencies are now resolved
      local remaining = redis.call('scard', dep_key)
      if remaining == 0 then
        -- Extract subtask ID from key (escape parent_id for pattern matching)
        local escaped_parent = string.gsub(parent_id, "%-", "%%-")
        local waiting_id = string.match(dep_key, "cb:dependencies:" .. escaped_parent .. ":(.+)")
        if waiting_id then
          table.insert(waiting_subtasks, waiting_id)
          -- Queue this subtask as it's now ready
          local subtask_data = redis.call('hget', 'cb:subtask:' .. waiting_id, 'data')
          if subtask_data then
            local data = cjson.decode(subtask_data)
            redis.call('zadd', 'cb:queue:subtasks', data.complexity or 5, waiting_id)
          end
        end
      end
    end
  end
until cursor == '0'

-- Check if all subtasks complete
local decomposition = redis.call('hget', decomposition_key, 'subtasks')
if decomposition then
  local subtasks = cjson.decode(decomposition)
  local all_complete = true
  local completed_count = 0
  
  for _, subtask in ipairs(subtasks.subtasks) do
    local progress = redis.call('hget', progress_key, subtask.id)
    if progress then
      completed_count = completed_count + 1
    else
      all_complete = false
    end
  end
  
  if all_complete then
    -- Queue for synthesis via sampling
    redis.call('zadd', integration_queue, tonumber(timestamp), parent_id)
    
    -- Update metrics
    redis.call('incr', 'cb:metrics:swarm:syntheses')
    
    return {1, 1, #waiting_subtasks}  -- {ready_for_synthesis, success, unblocked_count}
  else
    -- Update progress percentage
    local percentage = math.floor((completed_count / #subtasks.subtasks) * 100)
    redis.call('hset', decomposition_key, 'progress', tostring(percentage))
    
    return {0, 1, #waiting_subtasks}  -- {not_ready, success, unblocked_count}
  end
end

return {0, 0, 0}  -- {not_ready, no_decomposition, 0}
`;

/**
 * SESSION STATE MANAGEMENT LUA SCRIPTS
 * Atomic operations for session state tracking and event processing
 */

/**
 * Process hook event and update session state atomically
 * Stores event, updates state, and manages context in one operation
 */
export const PROCESS_HOOK_EVENT = `
local stream_key = KEYS[1]        -- cb:stream:session:{sessionId}
local state_key = KEYS[2]         -- cb:session:state:{sessionId}
local context_key = KEYS[3]       -- cb:session:context:{sessionId}
local tools_key = KEYS[4]         -- cb:session:tools:{sessionId}
local metrics_key = KEYS[5]       -- cb:metrics:session:{sessionId}

local event_id = ARGV[1]
local event_type = ARGV[2]
local session_id = ARGV[3]
local instance_id = ARGV[4]
local timestamp = ARGV[5]
local params_json = ARGV[6]
local result_json = ARGV[7]
local labels_json = ARGV[8]

-- Store event in stream
local stream_entry = redis.call('xadd', stream_key, '*',
  'eventId', event_id,
  'eventType', event_type,
  'sessionId', session_id,
  'instanceId', instance_id,
  'timestamp', timestamp,
  'params', params_json,
  'result', result_json,
  'labels', labels_json
)

-- Set stream expiry (7 days)
redis.call('expire', stream_key, 604800)

-- Update session state
local event_count = redis.call('hincrby', state_key, 'eventCount', 1)
redis.call('hset', state_key,
  'lastEventId', event_id,
  'lastActivity', timestamp,
  'instanceId', instance_id
)
redis.call('expire', state_key, 604800)

-- Parse params for context updates
local params = cjson.decode(params_json)

-- Update condensed context based on hook type
if event_type == 'hook.pre_tool' or event_type == 'hook.post_tool' then
  if params.tool then
    -- Track tool usage
    redis.call('lpush', tools_key, params.tool)
    redis.call('ltrim', tools_key, 0, 9)  -- Keep last 10
    redis.call('expire', tools_key, 604800)
  end
elseif event_type == 'hook.user_prompt' then
  if params.prompt then
    redis.call('hset', context_key,
      'lastPrompt', params.prompt,
      'lastPromptTime', timestamp
    )
  end
elseif event_type == 'hook.todo_write' then
  if params.todos then
    redis.call('hset', context_key,
      'activeTodos', params_json,  -- Store the full todos JSON
      'lastTodoUpdate', timestamp
    )
  end
end

-- Set context expiry
redis.call('expire', context_key, 604800)

-- Update metrics
redis.call('hincrby', metrics_key, event_type, 1)
redis.call('hincrby', metrics_key, 'total', 1)
redis.call('expire', metrics_key, 86400)

-- Check if snapshot needed (every 100 events)
local needs_snapshot = (event_count % 100) == 0

return {stream_entry, event_count, needs_snapshot and 1 or 0}
`;

/**
 * Build condensed context from session events
 * Aggregates session data for quick retrieval
 */
export const BUILD_SESSION_CONTEXT = `
local stream_key = KEYS[1]        -- cb:stream:session:{sessionId}
local context_key = KEYS[2]       -- cb:session:context:{sessionId}
local tools_key = KEYS[3]         -- cb:session:tools:{sessionId}
local tasks_key = KEYS[4]         -- cb:session:tasks:{sessionId}

local session_id = ARGV[1]
local limit = tonumber(ARGV[2] or '100')

-- Get recent events from stream
local events = redis.call('xrevrange', stream_key, '+', '-', 'COUNT', limit)

local context = {
  lastTasks = {},
  lastTools = {},
  lastPrompt = nil,
  activeTodos = {},
  eventCounts = {},
  instanceId = nil
}

-- Process events to build context
for _, entry in ipairs(events) do
  local event = {}
  -- Parse entry fields (they come as flat array)
  for i = 1, #entry[2], 2 do
    event[entry[2][i]] = entry[2][i + 1]
  end
  
  -- Update event counts
  local event_type = event.eventType
  if not context.eventCounts[event_type] then
    context.eventCounts[event_type] = 0
  end
  context.eventCounts[event_type] = context.eventCounts[event_type] + 1
  
  -- Capture instanceId
  if event.instanceId and not context.instanceId then
    context.instanceId = event.instanceId
  end
  
  -- Process specific event types
  if event.params then
    local params = cjson.decode(event.params)
    
    if event_type == 'hook.user_prompt' and params.prompt then
      context.lastPrompt = params.prompt
    end
    
    if (event_type == 'hook.pre_tool' or event_type == 'hook.post_tool') and params.tool then
      -- Add tool to list if not already there
      local found = false
      for _, tool in ipairs(context.lastTools) do
        if tool == params.tool then
          found = true
          break
        end
      end
      if not found then
        table.insert(context.lastTools, params.tool)
        if #context.lastTools > 10 then
          table.remove(context.lastTools, 1)
        end
      end
    end
    
    if event_type == 'hook.todo_write' and params.todos then
      context.activeTodos = params.todos
    end
  end
end

-- Get recent tools from list
local tools = redis.call('lrange', tools_key, 0, 9)
if #tools > 0 then
  context.lastTools = tools
end

-- Get recent tasks
local task_ids = redis.call('lrange', tasks_key, 0, 4)
for _, task_id in ipairs(task_ids) do
  local task_key = 'cb:task:' .. task_id
  local task_data = redis.call('hgetall', task_key)
  if #task_data > 0 then
    local task = {}
    for i = 1, #task_data, 2 do
      task[task_data[i]] = task_data[i + 1]
    end
    table.insert(context.lastTasks, {
      id = task.id or task_id,
      text = task.text or '',
      status = task.status or 'unknown'
    })
  end
end

-- Get stored context data
local stored_context = redis.call('hgetall', context_key)
if #stored_context > 0 then
  for i = 1, #stored_context, 2 do
    local field = stored_context[i]
    local value = stored_context[i + 1]
    
    if field == 'lastPrompt' and not context.lastPrompt then
      context.lastPrompt = value
    elseif field == 'activeTodos' then
      -- Try to parse todos
      local ok, todos = pcall(cjson.decode, value)
      if ok then
        context.activeTodos = todos
      end
    end
  end
end

return cjson.encode(context)
`;

/**
 * Create session snapshot atomically
 * Captures current state and stores for recovery
 */
export const CREATE_SESSION_SNAPSHOT = `
local stream_key = KEYS[1]        -- cb:stream:session:{sessionId}
local snapshot_key = KEYS[2]      -- cb:snapshot:{sessionId}:{snapshotId}
local state_key = KEYS[3]         -- cb:session:state:{sessionId}

local session_id = ARGV[1]
local snapshot_id = ARGV[2]
local reason = ARGV[3]
local timestamp = ARGV[4]

-- Get all events from stream
local events = redis.call('xrange', stream_key, '-', '+')

if #events == 0 then
  return {0, 'No events to snapshot'}
end

-- Get session state
local state = redis.call('hgetall', state_key)
local state_obj = {}
for i = 1, #state, 2 do
  state_obj[state[i]] = state[i + 1]
end

-- Build context from events (reuse logic)
local context = {
  lastTasks = {},
  lastTools = {},
  eventCounts = {},
  instanceId = state_obj.instanceId or 'unknown'
}

local first_timestamp = nil
local last_timestamp = nil

-- Process events
for _, entry in ipairs(events) do
  local event = {}
  for i = 1, #entry[2], 2 do
    event[entry[2][i]] = entry[2][i + 1]
  end
  
  -- Track timestamps
  if not first_timestamp then
    first_timestamp = event.timestamp
  end
  last_timestamp = event.timestamp
  
  -- Count event types
  local event_type = event.eventType
  context.eventCounts[event_type] = (context.eventCounts[event_type] or 0) + 1
end

-- Store snapshot
redis.call('hset', snapshot_key,
  'snapshotId', snapshot_id,
  'sessionId', session_id,
  'reason', reason,
  'eventCount', tostring(#events),
  'timestamp', timestamp,
  'context', cjson.encode(context),
  'fromTime', first_timestamp or timestamp,
  'toTime', last_timestamp or timestamp
)

-- Set expiry (30 days)
redis.call('expire', snapshot_key, 2592000)

-- Mark snapshot created in state
redis.call('hset', state_key, 'lastSnapshot', snapshot_id)

return {1, snapshot_id, #events}
`;

/**
 * Update session metrics atomically
 * Tracks event counts and timing metrics
 */
export const UPDATE_SESSION_METRICS = `
local metrics_key = KEYS[1]       -- cb:metrics:session:{sessionId}
local global_metrics = KEYS[2]    -- cb:metrics:global:hooks

local session_id = ARGV[1]
local hook_type = ARGV[2]
local timestamp = ARGV[3]

-- Update session-specific metrics
local event_count = redis.call('hincrby', metrics_key, hook_type, 1)
local total_count = redis.call('hincrby', metrics_key, 'total', 1)

-- Track timing
local first_event = redis.call('hget', metrics_key, 'firstEventTime')
if not first_event then
  redis.call('hset', metrics_key, 'firstEventTime', timestamp)
end
redis.call('hset', metrics_key, 'lastEventTime', timestamp)

-- Calculate events per minute
local start_time = tonumber(first_event or timestamp)
local current_time = tonumber(timestamp)
local elapsed_seconds = (current_time - start_time) / 1000  -- Convert ms to seconds

if elapsed_seconds > 0 then
  local events_per_minute = (total_count / elapsed_seconds) * 60
  redis.call('hset', metrics_key, 'eventsPerMinute', tostring(events_per_minute))
end

-- Update global metrics
redis.call('hincrby', global_metrics, hook_type, 1)
redis.call('hincrby', global_metrics, 'total', 1)

-- Set expiries
redis.call('expire', metrics_key, 86400)  -- 24 hours
redis.call('expire', global_metrics, 604800)  -- 7 days

return {event_count, total_count}
`;

/**
 * Delete task atomically
 * Removes task from all queues and data structures
 */
export const DELETE_TASK = `
local task_key = KEYS[1]           -- cb:task:{taskId}
local global_queue = KEYS[2]       -- cb:queue:tasks:pending
local metrics_key = KEYS[3]        -- cb:metrics:task.delete
local task_id = ARGV[1]
local timestamp = ARGV[2]

-- Check if task exists
local task_exists = redis.call('exists', task_key)
if task_exists == 0 then
  return {0, 'Task not found'}
end

-- Get task status before deletion for metrics
local task_status = redis.call('hget', task_key, 'status')
local assigned_to = redis.call('hget', task_key, 'assignedTo')

-- Remove from global queue if pending
if task_status == 'pending' then
  redis.call('zrem', global_queue, task_id)
end

-- Remove from worker queue if assigned
if assigned_to then
  local worker_queue = 'cb:queue:instance:' .. assigned_to
  redis.call('lrem', worker_queue, 0, task_id)
end

-- Delete attachments if any
local attachment_keys = redis.call('keys', 'cb:attachment:' .. task_id .. ':*')
if #attachment_keys > 0 then
  redis.call('del', unpack(attachment_keys))
end

-- Delete the task
redis.call('del', task_key)

-- Update metrics
redis.call('hincrby', metrics_key, 'total', 1)
redis.call('hincrby', metrics_key, task_status or 'unknown', 1)
redis.call('hset', metrics_key, 'lastDeleted', timestamp)

return {1, task_id}
`;