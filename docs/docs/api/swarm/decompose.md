# swarm.decompose

> **⚠️ DEPRECATED**: This handler has been replaced by [`task.decompose`](../task/decompose.md). Please migrate to the new handler for better domain alignment, attachment-based storage, and enhanced session support. See the [migration guide](../../guides/task-decompose-migration.md) for details.

Decompose complex tasks into subtasks using LLM intelligence for distributed execution across specialist agents.

## Overview

The `swarm.decompose` handler takes a complex task description and uses Large Language Model intelligence to break it down into smaller, manageable subtasks that can be executed in parallel or sequentially by different specialist agents.

## Event Details

- **Event**: `swarm.decompose`
- **Type**: Core swarm orchestration
- **Persistence**: ✅ Enabled (PostgreSQL + Redis)
- **Rate Limit**: 10 decompositions per minute
- **LLM Timeout**: 300 seconds (5 minutes)

## Input Schema

```typescript
{
  taskId: string;           // Unique task identifier
  task: string;             // Task description (1-1000 chars)
  priority: number;         // Priority 0-100 (default: 50)
  constraints?: string[];   // Optional constraints
}
```

## Output Schema

```typescript
{
  taskId: string;
  subtaskCount: number;
  decomposition: {
    subtasks: Array<{
      id: string;
      description: string;
      specialist: "frontend" | "backend" | "testing" | "docs" | "general";
      dependencies: string[];
      complexity: number;      // 1-100 scale
      context: {
        files: string[];
        patterns: string[];
        constraints: string[];
      };
      estimatedMinutes: number;
      rationale?: string;
    }>;
    executionStrategy: "parallel" | "sequential" | "mixed";
    totalComplexity: number;
    reasoning: string;
    architecturalConsiderations?: string[];
  };
}
```

## Specialist Types

The system supports five specialist types for task assignment:

- **frontend**: React, TypeScript, CSS, UI/UX components
- **backend**: APIs, databases, server logic, authentication
- **testing**: Unit tests, integration tests, E2E testing
- **docs**: Documentation, README files, API docs
- **general**: Cross-cutting concerns, configuration, deployment

## LLM Sampling Features

### Sampling Service Integration

The handler uses the MCP (Model Context Protocol) sampling service for intelligent decomposition:

```typescript
const decomposition = await samplingService.requestDecomposition(
  sessionId,
  input.task,
  {
    specialists,
    priority: input.priority,
    constraints: input.constraints
  }
);
```

### Session Management

- Requires `sessionId` from context metadata
- Uses `clientId` or `instanceId` as fallback
- Session enables LLM conversation continuity

## Execution Flow

### 1. Validation & Setup
- Validates input schema
- Checks for active specialists
- Retrieves sampling service session

### 2. LLM Decomposition
- Sends task to LLM with context
- Receives structured decomposition
- Validates response against schema

### 3. Atomic Storage
```typescript
const result = await redisScripts.decomposeAndStoreSubtasks(
  input.taskId,
  decomposition,
  Date.now()
);
```

### 4. Database Persistence
- Creates `SwarmDecomposition` record
- Creates related `SwarmSubtask` records
- Handles updates for existing decompositions

### 5. Assignment Triggering
For subtasks without dependencies:
```typescript
await ctx.publish({
  type: "swarm.assign",
  payload: {
    subtaskId: subtask.id,
    specialist: subtask.specialist,
    requiredCapabilities: subtask.context.patterns
  }
});
```

## Event Chain

1. **Input**: `swarm.decompose` called
2. **LLM Processing**: 5-300 seconds
3. **Output**: `swarm.decomposed` event published
4. **Triggers**: `swarm.assign` events for ready subtasks

## Error Handling

### Circuit Breaker
- **Threshold**: 3 failures
- **Timeout**: 60 seconds
- **Fallback**: Returns empty decomposition with error message

### Resilience Features
- Rate limiting: 10 requests/minute
- Timeout: 300 seconds for LLM response
- Database failure fallback to Redis
- Specialist availability checking

## Usage Examples

### Basic Task Decomposition

```bash
# Via MCP tool
swarm__decompose '{
  "taskId": "t-123",
  "task": "Add dark mode toggle to settings page",
  "priority": 75
}'
```

### Complex Project with Constraints

```bash
swarm__decompose '{
  "taskId": "t-456",
  "task": "Create analytics dashboard with real-time data",
  "priority": 90,
  "constraints": [
    "Use React and TypeScript",
    "WebSocket integration required",
    "Mobile-responsive design"
  ]
}'
```

## Response Example

```json
{
  "taskId": "t-123",
  "subtaskCount": 4,
  "decomposition": {
    "subtasks": [
      {
        "id": "st-1",
        "description": "Create toggle component with state management",
        "specialist": "frontend",
        "dependencies": [],
        "complexity": 30,
        "context": {
          "files": ["components/DarkModeToggle.tsx"],
          "patterns": ["react-hooks", "context-api"],
          "constraints": ["accessible", "keyboard-navigation"]
        },
        "estimatedMinutes": 45,
        "rationale": "Core UI component for theme switching"
      },
      {
        "id": "st-2", 
        "description": "Add user preference persistence API",
        "specialist": "backend",
        "dependencies": [],
        "complexity": 25,
        "context": {
          "files": ["api/user-preferences.ts"],
          "patterns": ["rest-api", "database-storage"],
          "constraints": ["user-scoped", "fast-retrieval"]
        },
        "estimatedMinutes": 30
      },
      {
        "id": "st-3",
        "description": "Integrate toggle with theme system",
        "specialist": "frontend", 
        "dependencies": ["st-1", "st-2"],
        "complexity": 40,
        "context": {
          "files": ["contexts/ThemeContext.tsx"],
          "patterns": ["css-variables", "context-provider"],
          "constraints": ["no-flash", "system-preference"]
        },
        "estimatedMinutes": 60
      },
      {
        "id": "st-4",
        "description": "Add comprehensive tests",
        "specialist": "testing",
        "dependencies": ["st-3"],
        "complexity": 35,
        "context": {
          "files": ["tests/dark-mode.test.ts"],
          "patterns": ["unit-testing", "integration-testing"],
          "constraints": ["theme-persistence", "accessibility"]
        },
        "estimatedMinutes": 50
      }
    ],
    "executionStrategy": "mixed",
    "totalComplexity": 130,
    "reasoning": "Frontend and backend work can proceed in parallel, integration requires both, testing validates complete feature",
    "architecturalConsiderations": [
      "Theme persistence across browser sessions",
      "System theme preference detection",
      "CSS variable approach for theme switching"
    ]
  }
}
```

## Performance Considerations

### LLM Sampling Timeouts
- **Maximum**: 300 seconds (5 minutes)
- **Typical**: 10-30 seconds for standard tasks
- **Complex tasks**: 60-120 seconds

### Scalability
- Redis atomic operations for consistency
- Async event publishing for assignments
- PostgreSQL persistence for durability

## Prerequisites

- Active specialists registered in system
- MCP sampling capability enabled
- Redis and PostgreSQL available
- Valid session ID in context

## Warnings

⚠️ **LLM Sampling**: May take up to 600 seconds for complex decompositions

⚠️ **Specialist Availability**: Ensure sufficient specialists are registered before decomposition

⚠️ **System Load**: Large tasks may generate many subtasks affecting overall system performance

## Related Handlers

- [`swarm.assign`](./assign) - Assigns subtasks to specialists
- [`swarm.context`](./context) - Generates specialist context
- [`swarm.synthesize`](./synthesize) - Integrates completed work