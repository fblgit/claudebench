# swarm.assign

Assign subtasks to best available specialists with capability matching and load balancing using atomic Redis operations.

## Overview

The `swarm.assign` handler matches subtasks to the most suitable specialist instances based on capabilities, current load, and availability. It uses atomic Lua scripts to ensure consistent assignment and handles queuing when no specialists are available.

## Event Details

- **Event**: `swarm.assign`
- **Type**: Specialist assignment and load balancing
- **Persistence**: ✅ Enabled (PostgreSQL + Redis)
- **Rate Limit**: 50 assignments per minute
- **Timeout**: 5 seconds (fast assignment)
- **Caching**: 10 seconds (brief assignment cache)

## Input Schema

```typescript
{
  subtaskId: string;                    // Unique subtask identifier
  specialist: "frontend" | "backend" | "testing" | "docs" | "general";
  requiredCapabilities?: string[];     // Optional capability requirements
}
```

## Output Schema

```typescript
{
  subtaskId: string;
  assignment: {
    specialistId: string;      // Assigned specialist ID or "queue"
    score: number;             // Assignment score (0-100)
    assignedAt: string;        // ISO timestamp
    queuePosition?: number;    // Position if queued
  };
}
```

## Specialist Types & Capabilities

### Frontend Specialists
Typical capabilities:
- `react`, `vue`, `angular` - Framework expertise
- `typescript`, `javascript` - Language skills
- `css`, `sass`, `tailwind` - Styling technologies
- `accessibility`, `responsive-design` - UX specializations
- `testing-library`, `cypress` - Frontend testing tools

### Backend Specialists
Typical capabilities:
- `node`, `python`, `java`, `rust` - Runtime/language expertise
- `express`, `fastapi`, `spring` - Framework knowledge
- `postgresql`, `mongodb`, `redis` - Database technologies
- `rest-api`, `graphql`, `grpc` - API design patterns
- `authentication`, `security` - Security specializations

### Testing Specialists
Typical capabilities:
- `unit-testing`, `integration-testing`, `e2e-testing` - Test types
- `jest`, `vitest`, `playwright` - Testing frameworks
- `performance-testing`, `load-testing` - Performance analysis
- `accessibility-testing` - A11y validation
- `test-automation`, `ci-cd` - Automation expertise

### Documentation Specialists
Typical capabilities:
- `technical-writing`, `api-documentation` - Writing skills
- `markdown`, `mdx`, `asciidoc` - Format expertise
- `docusaurus`, `gitbook`, `notion` - Platform knowledge
- `user-guides`, `tutorials` - Content types
- `diagrams`, `architecture-docs` - Visual documentation

### General Specialists
Cross-cutting capabilities:
- `devops`, `deployment`, `monitoring` - Operations
- `configuration`, `environment-setup` - Infrastructure
- `code-review`, `refactoring` - Code quality
- `project-management`, `coordination` - Organization

## Assignment Algorithm

### Scoring System

The assignment uses a multi-factor scoring algorithm:

```typescript
// Implemented in Redis Lua script
const score = calculateAssignmentScore({
  capabilityMatch: 0.4,      // 40% - How well capabilities align
  currentLoad: 0.3,          // 30% - Current workload factor
  availability: 0.2,         // 20% - Online/active status
  recentPerformance: 0.1     // 10% - Recent completion rates
});
```

### Capability Matching

Exact capability matches score highest:

```typescript
// Example scoring
const requiredCapabilities = ["react", "typescript", "css"];
const specialistCapabilities = ["react", "typescript", "javascript", "tailwind"];

// Match score: 2/3 = 66.7% capability alignment
```

### Load Balancing

Current workload affects assignment priority:

```typescript
// Load factors
const loadFactor = {
  idle: 1.0,           // No current assignments
  light: 0.8,          // 1-2 assignments
  moderate: 0.6,       // 3-4 assignments  
  heavy: 0.4,          // 5+ assignments
  overloaded: 0.1      // 10+ assignments
};
```

### Availability Status

Specialist availability impacts scoring:

```typescript
const availabilityScore = {
  online: 1.0,         // Active and responsive
  idle: 0.9,           // Online but not actively working
  busy: 0.7,           // Working but can take new tasks
  away: 0.3,           // Temporarily unavailable
  offline: 0.0         // Not available for assignment
};
```

## Execution Flow

### 1. Subtask Validation
```typescript
// Retrieve subtask data from Redis or PostgreSQL
const subtaskKey = `cb:subtask:${input.subtaskId}`;
const subtaskData = await redis.pub.hget(subtaskKey, "data");

// Check if already assigned
if (subtask.assignedTo) {
  return existingAssignment;
}
```

### 2. Atomic Assignment
```typescript
// Use Lua script for atomic assignment
const result = await redisScripts.assignToSpecialist(
  input.subtaskId,
  input.specialist,
  input.requiredCapabilities || []
);
```

### 3. Queue Management
```typescript
if (!result.success) {
  // Add to specialist queue if no one available
  await redis.pub.zadd(
    `cb:queue:${input.specialist}`,
    Date.now(),
    input.subtaskId
  );
  
  const position = await redis.pub.zrank(
    `cb:queue:${input.specialist}`,
    input.subtaskId
  );
}
```

### 4. Database Persistence
```typescript
// Create assignment record
await ctx.prisma.swarmAssignment.create({
  data: {
    subtaskId: input.subtaskId,
    specialistId: result.specialistId,
    score: result.score,
    assignedAt: new Date()
  }
});

// Update subtask status
await ctx.prisma.swarmSubtask.update({
  where: { id: input.subtaskId },
  data: {
    status: "assigned",
    assignedTo: result.specialistId
  }
});
```

### 5. Context Generation Trigger
```typescript
// Trigger context generation for assigned specialist
await ctx.publish({
  type: "swarm.generate_context",
  payload: {
    subtaskId: input.subtaskId,
    specialist: input.specialist,
    specialistId: result.specialistId
  }
});
```

### 6. Dependency Check
```typescript
// Check if this assignment unblocks other subtasks
await this.checkDependencyUnblocking(
  input.subtaskId,
  subtask.parentId,
  ctx
);
```

## Queue Management

### Queue Structure

Redis sorted sets maintain assignment queues:

```typescript
// Queue key format
const queueKey = `cb:queue:${specialist}`;

// Score is timestamp for FIFO ordering
await redis.pub.zadd(queueKey, Date.now(), subtaskId);
```

### Queue Processing

When specialists become available:

```typescript
// Get next queued subtask
const nextTask = await redis.pub.zpopmin(queueKey);

if (nextTask) {
  // Attempt assignment
  await this.assignSubtask(nextTask.member, specialist);
}
```

### Queue Position

Users can check their position:

```typescript
const position = await redis.pub.zrank(queueKey, subtaskId);
return { queuePosition: (position || 0) + 1 };
```

## Dependency Management

### Dependency Resolution

Checks if completed subtasks unblock others:

```typescript
private async checkDependencyUnblocking(
  completedSubtaskId: string,
  parentId: string,
  ctx: EventContext
): Promise<void> {
  // Find subtasks depending on this one
  const dependentSubtasks = await ctx.prisma.swarmSubtask.findMany({
    where: {
      parentId,
      dependencies: { has: completedSubtaskId },
      status: "pending"
    }
  });
  
  // Check if all dependencies resolved
  for (const dependent of dependentSubtasks) {
    const unresolvedDeps = await ctx.prisma.swarmSubtask.count({
      where: {
        id: { in: dependent.dependencies },
        status: { not: "completed" }
      }
    });
    
    if (unresolvedDeps === 0) {
      // Trigger assignment for unblocked subtask
      await ctx.publish({
        type: "swarm.assign",
        payload: {
          subtaskId: dependent.id,
          specialist: dependent.specialist
        }
      });
    }
  }
}
```

## Error Handling

### Circuit Breaker
- **Threshold**: 5 failures
- **Timeout**: 30 seconds
- **Fallback**: Returns queue assignment with position 1

### Assignment Failures
- No specialists available → Queue subtask
- Database errors → Continue with Redis assignment
- Capability mismatch → Assign to general specialist

### Resilience Features
- Rate limiting: 50 assignments/minute
- Fast timeout: 5 seconds
- Brief caching for repeated assignments
- Atomic operations prevent race conditions

## Usage Examples

### Basic Frontend Assignment

```bash
# Via MCP tool
swarm__assign '{
  "subtaskId": "st-1",
  "specialist": "frontend",
  "requiredCapabilities": ["react", "typescript", "css"]
}'
```

### Backend API Assignment

```bash
swarm__assign '{
  "subtaskId": "st-2",
  "specialist": "backend", 
  "requiredCapabilities": ["node", "express", "postgresql"]
}'
```

### Testing Assignment

```bash
swarm__assign '{
  "subtaskId": "st-3",
  "specialist": "testing",
  "requiredCapabilities": ["jest", "integration-testing", "accessibility"]
}'
```

## Response Examples

### Successful Assignment

```json
{
  "subtaskId": "st-1",
  "assignment": {
    "specialistId": "specialist-frontend-42",
    "score": 87,
    "assignedAt": "2025-09-19T07:30:15.123Z"
  }
}
```

### Queued Assignment

```json
{
  "subtaskId": "st-2", 
  "assignment": {
    "specialistId": "queue",
    "score": 0,
    "assignedAt": "2025-09-19T07:30:15.456Z",
    "queuePosition": 3
  }
}
```

## Event Chain

1. **Input**: `swarm.assign` triggered (from decompose or dependency resolution)
2. **Assignment**: Atomic specialist selection via Lua script
3. **Storage**: Assignment persisted to Redis and PostgreSQL
4. **Events**: `swarm.assigned` published
5. **Context**: `swarm.generate_context` triggered for specialist
6. **Dependencies**: Check for unblocked subtasks

## Performance Considerations

### Assignment Speed
- **Target**: &lt;100ms for assignment decision
- **Atomic operations**: Lua scripts prevent race conditions
- **Caching**: Brief cache for repeated assignment queries

### Load Balancing Effectiveness
- Real-time load tracking per specialist
- Dynamic scoring based on current workload
- Queue management for fair distribution

### Scalability
- Horizontal scaling through specialist registration
- Queue partitioning by specialist type
- Database indexing for fast dependency lookups

## Prerequisites

- Triggered by `swarm.decompose` for ready subtasks
- Triggered when dependencies resolved
- Specialists must be registered and active
- Redis and PostgreSQL must be available

## Warnings

⚠️ **Atomic Operations**: Assignment uses atomic Lua scripts to prevent race conditions

⚠️ **Queue Overflow**: May queue indefinitely if no specialists available for a type

⚠️ **Load Calculation**: Score calculation considers current load and capabilities

## Related Handlers

- [`swarm.decompose`](./decompose.md) - Creates subtasks that need assignment
- [`swarm.context`](./context.md) - Triggered after successful assignment
- [`swarm.resolve`](./resolve.md) - May reassign after conflict resolution