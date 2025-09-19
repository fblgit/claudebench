# swarm.resolve

Resolve conflicts between specialist solutions using LLM intelligence to make optimal decisions and maintain system coherence.

## Overview

The `swarm.resolve` handler uses Large Language Model intelligence to analyze conflicting solutions from different specialists and make informed decisions about which approach to adopt. It considers project context, requirements, and constraints to provide justified resolutions.

## Event Details

- **Event**: `swarm.resolve`
- **Type**: Conflict resolution using LLM
- **Persistence**: ✅ Enabled (PostgreSQL + Redis)
- **Rate Limit**: 20 resolutions per minute
- **LLM Timeout**: 300 seconds (5 minutes)
- **Caching**: 1 minute (60 seconds)

## Input Schema

```typescript
{
  conflictId: string;           // Unique conflict identifier
  solutions: Array<{           // At least 2 conflicting solutions
    instanceId: string;        // Specialist instance ID
    approach: string;          // Proposed solution approach
    reasoning: string;         // Justification for approach
    code?: string;            // Optional implementation code
  }>;
  context: {
    projectType: string;       // Type of project (e.g., "React application")
    requirements: string[];    // Project requirements
    constraints?: string[];    // Optional constraints
  };
}
```

## Output Schema

```typescript
{
  conflictId: string;
  resolution: {
    chosenSolution: string;    // "first", "second", "hybrid", etc.
    instanceId: string;        // Winning specialist instance
    justification: string;     // Detailed reasoning
    recommendations: string[]; // Additional suggestions
    modifications?: string[];   // Optional modifications to chosen solution
  };
}
```

## LLM Conflict Resolution

### Resolution Service Integration

```typescript
const resolution = await samplingService.resolveConflict(sessionId, {
  solutions: input.solutions,
  context: input.context
});
```

### Template-Based Analysis

Uses Nunjucks templates for structured conflict analysis:

```typescript
const prompt = templates.render("conflict-resolution.njk", {
  conflictId: input.conflictId,
  solutions: input.solutions,
  context: input.context,
  conflictInfo
});
```

### Decision Criteria

The LLM considers multiple factors:

- **Technical Merit**: Code quality, performance, maintainability
- **Requirements Alignment**: How well solutions meet stated requirements
- **Constraint Compliance**: Adherence to project constraints
- **Integration Impact**: Effect on existing codebase
- **Future Flexibility**: Extensibility and adaptability
- **Team Consensus**: Alignment with team practices

## Conflict Types

### Approach Conflicts
Different high-level strategies for solving the same problem:

```json
{
  "solutions": [
    {
      "instanceId": "specialist-frontend-1",
      "approach": "Use React hooks for state management",
      "reasoning": "More modern, follows React best practices, better performance"
    },
    {
      "instanceId": "specialist-frontend-2", 
      "approach": "Use Redux for state management",
      "reasoning": "Better for complex state, easier debugging, team familiarity"
    }
  ]
}
```

### Implementation Conflicts
Different ways to implement the same approach:

```json
{
  "solutions": [
    {
      "instanceId": "specialist-backend-1",
      "approach": "REST API with JWT authentication",
      "reasoning": "Standard approach, well-understood, good tooling",
      "code": "app.post('/api/auth', authenticateJWT, ...)"
    },
    {
      "instanceId": "specialist-backend-2",
      "approach": "GraphQL API with session-based auth", 
      "reasoning": "More flexible queries, better type safety, simpler auth",
      "code": "type Mutation { login(input: LoginInput!): AuthPayload }"
    }
  ]
}
```

### Architecture Conflicts
Fundamental disagreements about system structure:

```json
{
  "solutions": [
    {
      "instanceId": "specialist-backend-1",
      "approach": "Microservices architecture",
      "reasoning": "Better scalability, independent deployments, fault isolation"
    },
    {
      "instanceId": "specialist-backend-2",
      "approach": "Monolithic architecture",
      "reasoning": "Simpler development, easier testing, lower operational complexity"
    }
  ]
}
```

## Resolution Strategies

### Direct Selection
Choose one solution as clearly superior:

```json
{
  "chosenSolution": "first",
  "instanceId": "specialist-frontend-1",
  "justification": "React hooks align better with project's modern stack and team expertise",
  "recommendations": [
    "Consider Redux for future complex features",
    "Document state management patterns for consistency"
  ]
}
```

### Hybrid Approach
Combine elements from multiple solutions:

```json
{
  "chosenSolution": "hybrid",
  "instanceId": "specialist-frontend-1",
  "justification": "Use React hooks for local state, Redux for global application state",
  "recommendations": [
    "Start with hooks for component-level state",
    "Introduce Redux when state becomes complex"
  ],
  "modifications": [
    "Add Redux DevTools integration",
    "Create custom hooks for common state patterns"
  ]
}
```

### Modified Solution
Improve the chosen solution with changes:

```json
{
  "chosenSolution": "second",
  "instanceId": "specialist-backend-2",
  "justification": "GraphQL provides better type safety and flexibility",
  "modifications": [
    "Add JWT token support for stateless authentication",
    "Implement query complexity limiting",
    "Add REST fallback for simple operations"
  ]
}
```

## Execution Flow

### 1. Conflict Data Retrieval
```typescript
// Try Redis first, fallback to PostgreSQL
const conflictKey = `cb:conflict:${input.conflictId}`;
const conflictData = await redis.pub.hget(conflictKey, "data");
```

### 2. Template Rendering
```typescript
const prompt = templates.render("conflict-resolution.njk", {
  conflictId: input.conflictId,
  solutions: input.solutions,
  context: input.context,
  conflict
});
```

### 3. LLM Resolution
- Analyzes all proposed solutions
- Considers project context and constraints
- Evaluates technical trade-offs
- Generates justified decision

### 4. Resolution Storage
```typescript
// Update conflict status in Redis and PostgreSQL
await redis.pub.hset(conflictKey, {
  status: "resolved",
  resolution: JSON.stringify(resolution),
  resolvedBy: ctx.instanceId,
  resolvedAt: Date.now()
});
```

### 5. Synthesis Triggering
```typescript
// Check if all conflicts resolved
const remainingConflicts = await ctx.prisma.swarmConflict.count({
  where: { taskId: conflict.taskId, status: "pending" }
});

if (remainingConflicts === 0) {
  await ctx.publish({
    type: "swarm.ready_for_synthesis",
    payload: { taskId: conflict.taskId }
  });
}
```

## Event Chain

1. **Conflict Detection**: Lua script detects conflicting solutions
2. **Resolution Request**: `swarm.resolve` triggered
3. **LLM Analysis**: 5-300 seconds processing
4. **Resolution Storage**: Conflict marked as resolved
5. **Event Publishing**: `swarm.resolved` event emitted
6. **Synthesis Check**: May trigger `swarm.ready_for_synthesis`

## Error Handling

### Circuit Breaker
- **Threshold**: 3 failures
- **Timeout**: 60 seconds
- **Fallback**: Defaults to first solution with service unavailable message

### Data Source Fallback
1. Redis conflict data (primary)
2. PostgreSQL conflict record (secondary)
3. Error if conflict not found

### Resilience Features
- Rate limiting: 20 resolutions/minute
- Timeout: 300 seconds for LLM response
- Brief caching for resolution results
- Template-based prompt generation

## Usage Examples

### Frontend Architecture Conflict

```bash
# Via MCP tool
swarm__resolve '{
  "conflictId": "conflict-t-123-1234567890",
  "solutions": [
    {
      "instanceId": "specialist-1",
      "approach": "Use React hooks for theme management",
      "reasoning": "Simpler, more modern, better performance",
      "code": "const [theme, setTheme] = useState(\"light\");"
    },
    {
      "instanceId": "specialist-2", 
      "approach": "Use Redux for theme management",
      "reasoning": "Centralized state, easier debugging, better for complex apps",
      "code": "dispatch(setTheme(\"light\"));"
    }
  ],
  "context": {
    "projectType": "React application",
    "requirements": [
      "Dark mode toggle",
      "Persistent user preference",
      "System theme detection"
    ],
    "constraints": [
      "Minimize bundle size",
      "Support server-side rendering"
    ]
  }
}'
```

### Backend API Design Conflict

```bash
swarm__resolve '{
  "conflictId": "conflict-t-456-9876543210",
  "solutions": [
    {
      "instanceId": "backend-specialist-1",
      "approach": "REST API with resource-based endpoints",
      "reasoning": "Standard HTTP semantics, cacheable, well-understood"
    },
    {
      "instanceId": "backend-specialist-2",
      "approach": "GraphQL API with single endpoint", 
      "reasoning": "Flexible queries, strong typing, reduced over-fetching"
    }
  ],
  "context": {
    "projectType": "Full-stack web application",
    "requirements": [
      "User authentication",
      "Real-time updates",
      "Mobile app support"
    ],
    "constraints": [
      "Team has limited GraphQL experience",
      "Must integrate with existing REST services"
    ]
  }
}'
```

## Response Example

```json
{
  "conflictId": "conflict-t-123-1234567890",
  "resolution": {
    "chosenSolution": "first",
    "instanceId": "specialist-1",
    "justification": "React hooks are the better choice for this theme management scenario. Given the constraints of minimizing bundle size and supporting SSR, hooks provide a lighter-weight solution without additional dependencies. Redux would add ~15KB to the bundle and complexity for what is essentially a boolean state. The modern React patterns align with the project's technology choices.",
    "recommendations": [
      "Consider using useReducer for more complex theme state in the future",
      "Implement custom hook (useTheme) to encapsulate theme logic",
      "Add proper TypeScript types for theme values",
      "Consider React Context for sharing theme state across components"
    ],
    "modifications": [
      "Add localStorage persistence to the hook implementation",
      "Include system theme preference detection",
      "Add proper error handling for localStorage access"
    ]
  }
}
```

## Template System

### Conflict Resolution Template

```nunjucks
# Conflict Resolution Analysis

## Context
- **Project Type**: {{ context.projectType }}
- **Requirements**: {{ context.requirements | join(", ") }}
- **Constraints**: {{ context.constraints | join(", ") }}

## Conflicting Solutions

Each solution in the conflict contains:
- **Instance ID**: The specialist that proposed the solution
- **Approach**: High-level description of the solution strategy
- **Reasoning**: Justification for the chosen approach
- **Code Sample** (optional): Implementation example

## Resolution Criteria
Evaluate each solution based on:
1. Technical merit and code quality
2. Alignment with stated requirements
3. Compliance with project constraints
4. Integration impact on existing codebase
5. Long-term maintainability and flexibility
6. Team expertise and learning curve

Please provide a detailed resolution with clear justification.
```

## Performance Considerations

### LLM Response Times
- **Simple conflicts**: 10-20 seconds
- **Complex architectural decisions**: 60-120 seconds
- **Maximum timeout**: 300 seconds

### Resolution Impact
- Blocks synthesis until all conflicts resolved
- May trigger cascading assignment changes
- Critical path for task completion

### Caching Strategy
- Brief 1-minute cache for repeated resolution requests
- Redis storage for conflict persistence
- PostgreSQL for audit trail

## Prerequisites

- Conflict must be detected by DETECT_AND_QUEUE_CONFLICT Lua script
- At least 2 conflicting solutions must exist
- MCP sampling capability enabled
- Valid session ID in context metadata

## Warnings

⚠️ **LLM Processing**: Resolution uses LLM sampling which may take up to 600 seconds

⚠️ **Final Decision**: Resolution is final and cannot be undone - use `task.update` to change conflict status

⚠️ **Synthesis Blocking**: May trigger `swarm.synthesize` if all conflicts for a task are resolved

## Related Handlers

- [`swarm.decompose`](./decompose) - May create conflicting subtasks
- [`swarm.assign`](./assign) - May lead to conflicting solutions
- [`swarm.synthesize`](./synthesize) - Triggered when conflicts resolved