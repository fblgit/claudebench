# MCP Sampling for Swarm Intelligence in ClaudeBench

## Overview

MCP Sampling enables ClaudeBench to orchestrate multiple Claude instances as an intelligent swarm by requesting LLM completions for decision-making. This document describes the architecture, implementation patterns, and usage of MCP Sampling for swarm coordination.

## Architecture

### Core Concept

```
┌─────────────────────────────────────────────────────────┐
│                 ClaudeBench Server                       │
│                                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │        Swarm Intelligence Layer                  │   │
│  │                                                   │   │
│  │  • Task Decomposer (via sampling)                │   │
│  │  • Context Generator (via templates)             │   │
│  │  • Conflict Resolver (via sampling)              │   │
│  │  • Progress Synthesizer (via sampling)           │   │
│  │                                                   │   │
│  │  mcpServer.server.createMessage() ←──────────────┼───┼── Ask Claude
│  │                                                   │   │   for decisions
│  └─────────────────────────────────────────────────┘   │
│                         ↓                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Redis Lua Atomic Operations              │   │
│  │                                                   │   │
│  │  • DECOMPOSE_AND_STORE_SUBTASKS                  │   │
│  │  • ASSIGN_TO_SPECIALIST                          │   │
│  │  • DETECT_AND_QUEUE_CONFLICT                     │   │
│  │  • SYNTHESIZE_PROGRESS                           │   │
│  └─────────────────────────────────────────────────┘   │
│                         ↓                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │         Event Distribution Layer                  │   │
│  │     (Redis pub/sub, task queues)                 │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         ↓
     ┌──────────┐   ┌──────────┐   ┌──────────┐
     │ Claude 1 │   │ Claude 2 │   │ Claude 3 │
     │ Frontend │   │ Backend  │   │ Testing  │
     └──────────┘   └──────────┘   └──────────┘
```

### Components

#### 1. MCP Sampling Service (`src/core/sampling.ts`)

```typescript
export class SamplingService {
  constructor(private mcpServers: Map<string, McpServer>) {}
  
  async requestDecomposition(task: string, context: DecompositionContext): Promise<Decomposition>
  async generateContext(subtask: Subtask, specialist: SpecialistType): Promise<SpecialistContext>
  async resolveConflict(solutions: Solution[]): Promise<Resolution>
  async synthesizeProgress(subtasks: CompletedSubtask[]): Promise<Integration>
}
```

#### 2. Swarm Event Handlers

All handlers follow the ClaudeBench decorator pattern:

- `swarm.decompose` - Breaks complex tasks into subtasks
- `swarm.context` - Generates specialized agent contexts
- `swarm.resolve` - Resolves conflicts between solutions
- `swarm.synthesize` - Merges partial work into complete solution

#### 3. Nunjucks Templates

Dynamic templates for generating prompts:

- `decomposition.njk` - Task breakdown prompt
- `specialist-context.njk` - Agent-specific context
- `conflict-resolution.njk` - Conflict resolution prompt
- `progress-synthesis.njk` - Work integration prompt

#### 4. Redis Lua Scripts

Atomic operations for swarm coordination:

```lua
-- DECOMPOSE_AND_STORE_SUBTASKS
-- Atomically stores decomposition with dependencies
-- Keys: decomposition_key, subtasks_queue, dependency_graph
-- Args: parent_id, subtasks_json, timestamp

-- ASSIGN_TO_SPECIALIST
-- Finds best specialist for subtask based on capabilities
-- Keys: specialists_key, subtask_key, assignment_key
-- Args: subtask_id, specialist_type, required_capabilities

-- DETECT_AND_QUEUE_CONFLICT
-- Detects conflicts and queues for resolution
-- Keys: solutions_key, conflicts_queue
-- Args: task_id, instance_id, solution_json

-- SYNTHESIZE_PROGRESS
-- Tracks and merges progress from multiple instances
-- Keys: progress_key, integration_queue
-- Args: parent_id, subtask_id, progress_json
```

## Implementation Patterns

### Task Decomposition Flow

```typescript
@EventHandler({
  event: "swarm.decompose",
  inputSchema: swarmDecomposeInput,
  outputSchema: swarmDecomposeOutput,
  persist: true,
  description: "Decompose complex task into subtasks using LLM intelligence"
})
export class SwarmDecomposeHandler {
  @Instrumented(0) // No caching for decomposition
  @Resilient({
    rateLimit: { limit: 10, windowMs: 60000 },
    timeout: 30000 // Allow time for LLM response
  })
  async handle(input: SwarmDecomposeInput, ctx: EventContext): Promise<SwarmDecomposeOutput> {
    // 1. Get available specialists
    const specialists = await redisScripts.getActiveSpecialists();
    
    // 2. Request decomposition via sampling
    const decomposition = await samplingService.requestDecomposition(
      input.task,
      { specialists, priority: input.priority }
    );
    
    // 3. Store atomically in Redis
    const result = await redisScripts.decomposeAndStoreSubtasks(
      input.taskId,
      decomposition,
      Date.now()
    );
    
    // 4. Trigger assignment for ready subtasks
    for (const subtask of decomposition.subtasks) {
      if (subtask.dependencies.length === 0) {
        await ctx.publish({
          type: "swarm.assign",
          payload: { subtaskId: subtask.id }
        });
      }
    }
    
    return {
      taskId: input.taskId,
      subtaskCount: result.subtaskCount,
      decomposition: decomposition
    };
  }
}
```

### Sampling Request Pattern

```typescript
async requestDecomposition(task: string, context: DecompositionContext): Promise<Decomposition> {
  const prompt = await nunjucks.renderString(
    decompositionTemplate,
    { task, ...context }
  );
  
  const response = await this.mcpServer.server.createMessage({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: prompt
      }
    }],
    maxTokens: 2000,
    temperature: 0.7 // Balanced creativity for decomposition
  });
  
  // Parse structured response
  const content = response.content.type === "text" 
    ? response.content.text 
    : throw new Error("Invalid response format");
    
  return JSON.parse(content) as Decomposition;
}
```

### Template Example (decomposition.njk)

```nunjucks
Decompose this task into specialized subtasks for parallel execution:

Task: {{ task }}
Priority: {{ priority }}

Available Specialists:
{% for specialist in specialists %}
- {{ specialist.id }} ({{ specialist.type }}): {{ specialist.capabilities | join(", ") }}
  Current Load: {{ specialist.currentLoad }}/{{ specialist.maxCapacity }}
{% endfor %}

Requirements:
1. Identify which parts can be done in parallel vs sequentially
2. Assign the most appropriate specialist type for each subtask
3. Define clear dependencies between subtasks
4. Estimate complexity (1-10) for each subtask
5. Provide specific context/constraints for each subtask

Output as JSON with this exact structure:
{
  "subtasks": [
    {
      "id": "unique-subtask-id",
      "description": "Clear description of what needs to be done",
      "specialist": "frontend|backend|testing|docs",
      "dependencies": ["list", "of", "subtask", "ids"],
      "complexity": 5,
      "context": {
        "files": ["relevant/file/paths"],
        "patterns": ["patterns to follow"],
        "constraints": ["specific limitations or requirements"]
      },
      "estimatedMinutes": 30
    }
  ],
  "executionStrategy": "parallel|sequential|mixed",
  "totalComplexity": 15,
  "reasoning": "Brief explanation of the decomposition strategy"
}
```

## Usage Examples

### Example 1: Simple Task Decomposition

```typescript
// User request: "Add dark mode toggle to settings"
const result = await registry.executeHandler("swarm.decompose", {
  taskId: "t-123",
  task: "Add dark mode toggle to settings page",
  priority: 75
});

// Result: Decomposed into subtasks
{
  subtasks: [
    {
      id: "st-1",
      description: "Create theme context provider",
      specialist: "frontend",
      dependencies: [],
      complexity: 3
    },
    {
      id: "st-2",
      description: "Add toggle UI component",
      specialist: "frontend",
      dependencies: ["st-1"],
      complexity: 2
    },
    {
      id: "st-3",
      description: "Persist theme preference to backend",
      specialist: "backend",
      dependencies: [],
      complexity: 2
    },
    {
      id: "st-4",
      description: "Write tests for theme switching",
      specialist: "testing",
      dependencies: ["st-1", "st-2", "st-3"],
      complexity: 3
    }
  ]
}
```

### Example 2: Conflict Resolution

```typescript
// Two instances propose different authentication methods
const resolution = await registry.executeHandler("swarm.resolve", {
  conflictId: "c-456",
  solutions: [
    {
      instanceId: "worker-1",
      approach: "JWT tokens",
      reasoning: "Stateless, scalable, industry standard"
    },
    {
      instanceId: "worker-2",
      approach: "Session cookies",
      reasoning: "Simpler, better for server-side rendering"
    }
  ],
  context: {
    projectType: "SPA with API",
    requirements: ["scalability", "security", "simplicity"]
  }
});

// Result: Intelligent resolution
{
  chosenSolution: "JWT tokens",
  instanceId: "worker-1",
  justification: "For a SPA with API architecture, JWT tokens provide better scalability and align with RESTful principles. The stateless nature supports horizontal scaling.",
  recommendations: [
    "Implement refresh token rotation",
    "Use secure httpOnly cookies for refresh tokens",
    "Add rate limiting to token endpoints"
  ]
}
```

### Example 3: Progress Synthesis

```typescript
// Merge work from multiple specialists
const integration = await registry.executeHandler("swarm.synthesize", {
  taskId: "t-789",
  completedSubtasks: [
    {
      id: "st-1",
      specialist: "frontend",
      output: "React component with dark mode support"
    },
    {
      id: "st-2",
      specialist: "backend",
      output: "REST endpoint for theme persistence"
    },
    {
      id: "st-3",
      specialist: "testing",
      output: "E2E tests for theme switching"
    }
  ]
});

// Result: Integrated solution
{
  status: "ready_for_integration",
  integrationSteps: [
    "1. Merge frontend theme context provider",
    "2. Connect to backend persistence endpoint",
    "3. Run E2E tests to validate integration"
  ],
  potentialIssues: [
    "Ensure CORS headers for theme API",
    "Check theme persistence across sessions"
  ],
  nextActions: [
    "Deploy to staging environment",
    "User acceptance testing"
  ]
}
```

## Configuration

### Enabling Sampling in MCP Server

```typescript
// In src/mcp/handler.ts
const server = new McpServer({
  name: "claudebench-mcp",
  version: "0.1.0"
}, {
  capabilities: {
    logging: {},
    tools: {},
    sampling: {} // Enable sampling capability
  }
});
```

### Sampling Service Configuration

```typescript
// In src/core/sampling.ts
export const samplingConfig = {
  defaultMaxTokens: 2000,
  defaultTemperature: 0.7,
  retryAttempts: 3,
  retryDelay: 1000,
  timeoutMs: 30000
};
```

### Redis Configuration for Swarm

```
# Redis keys for swarm coordination
cb:decomposition:{task_id}     # Decomposition graph
cb:subtask:{subtask_id}         # Individual subtask data
cb:specialist:{type}            # Available specialists by type
cb:assignment:{subtask_id}      # Subtask assignments
cb:solutions:{task_id}          # Multiple solutions for comparison
cb:conflicts:{conflict_id}      # Conflicts awaiting resolution
cb:progress:{task_id}           # Progress tracking
cb:integration:{task_id}        # Integration queue
```

## Testing

### Contract Tests

Ensure all swarm handlers comply with JSONRPC contract:

```typescript
describe("Contract: swarm.decompose", () => {
  it("should accept valid decomposition request", () => {
    const input = {
      taskId: "t-123",
      task: "Build user profile component",
      priority: 80
    };
    expect(swarmDecomposeInput.safeParse(input).success).toBe(true);
  });
});
```

### Integration Tests

Test Lua scripts and sampling flow:

```typescript
describe("Swarm Integration", () => {
  it("should decompose and assign subtasks atomically", async () => {
    const decomposition = await samplingService.requestDecomposition(
      "Add authentication",
      { specialists: mockSpecialists }
    );
    
    const result = await redisScripts.decomposeAndStoreSubtasks(
      "t-123",
      decomposition,
      Date.now()
    );
    
    expect(result.subtaskCount).toBe(decomposition.subtasks.length);
    
    // Verify atomic storage
    const stored = await redis.hgetall("cb:decomposition:t-123");
    expect(stored.subtasks).toBeDefined();
  });
});
```

### E2E Experiments

Full cycle testing:

```typescript
describe("E2E: Swarm Orchestration", () => {
  it("should complete full decompose-execute-synthesize cycle", async () => {
    // 1. Decompose task
    const decomposed = await executeHandler("swarm.decompose", {
      task: "Build dashboard"
    });
    
    // 2. Generate contexts for specialists
    for (const subtask of decomposed.subtasks) {
      const context = await executeHandler("swarm.context", {
        subtaskId: subtask.id
      });
      expect(context).toHaveProperty("prompt");
    }
    
    // 3. Simulate work completion
    // 4. Synthesize results
    const synthesis = await executeHandler("swarm.synthesize", {
      taskId: decomposed.taskId
    });
    
    expect(synthesis.status).toBe("integrated");
  });
});
```

## Performance Considerations

### Sampling Latency

- Typical sampling request: 2-5 seconds
- Cache decompositions when possible
- Use streaming for large responses

### Redis Operations

- Lua scripts ensure atomicity
- Use pipelining for bulk operations
- TTL on temporary keys (decompositions: 1 hour)

### Template Rendering

- Pre-compile frequently used templates
- Cache rendered prompts for identical inputs
- Limit template complexity

## Security Considerations

### Prompt Injection Prevention

- Validate and sanitize all inputs
- Use structured prompts with clear boundaries
- Limit token counts to prevent abuse

### Access Control

- Session-based sampling access
- Rate limiting per instance
- Audit trail for all sampling requests

## Monitoring

### Metrics to Track

```typescript
// Sampling metrics
cb:metrics:sampling:requests     // Total sampling requests
cb:metrics:sampling:latency      // Average response time
cb:metrics:sampling:errors       // Failed requests
cb:metrics:sampling:tokens       // Token usage

// Swarm metrics
cb:metrics:swarm:decompositions  // Tasks decomposed
cb:metrics:swarm:conflicts       // Conflicts detected
cb:metrics:swarm:resolutions     // Successful resolutions
cb:metrics:swarm:syntheses       // Progress syntheses
```

### Dashboard Integration

Add to web dashboard:
- Active decompositions
- Specialist utilization
- Conflict queue depth
- Integration pipeline status

## Future Enhancements

### Phase 2 Features

1. **Learning System**
   - Store successful decompositions
   - Learn optimal specialist assignments
   - Improve estimation accuracy

2. **Advanced Coordination**
   - Cross-instance code review
   - Automated integration testing
   - Performance profiling

3. **Specialist Profiles**
   - Dynamic capability discovery
   - Performance tracking per specialist
   - Automatic load balancing

### Phase 3 Features

1. **Hierarchical Decomposition**
   - Multi-level task breakdown
   - Sub-swarms for complex tasks
   - Recursive synthesis

2. **Consensus Mechanisms**
   - Multi-instance voting
   - Byzantine fault tolerance
   - Conflict prevention

3. **Adaptive Strategies**
   - Learn from success patterns
   - Adjust decomposition based on results
   - Optimize for different task types

## Conclusion

MCP Sampling transforms ClaudeBench from a task orchestrator into an intelligent swarm coordinator. By combining Claude's decision-making capabilities with Redis's atomic operations, we achieve a scalable, resilient system for coordinating multiple AI instances working towards common goals.

The architecture maintains ClaudeBench's principles of simplicity (decorator pattern), atomicity (Lua scripts), and observability (event-driven), while adding the intelligence layer needed for true swarm behavior.