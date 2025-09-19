# swarm.synthesize

Synthesize completed subtasks into an integrated solution using LLM intelligence to merge specialist work into a cohesive implementation.

## Overview

The `swarm.synthesize` handler uses Large Language Model intelligence to analyze completed work from multiple specialists and create an integrated solution. It identifies potential conflicts, suggests integration steps, and produces a unified implementation.

## Event Details

- **Event**: `swarm.synthesize`
- **Type**: Work integration using LLM
- **Persistence**: ✅ Enabled (PostgreSQL + Redis)
- **Rate Limit**: 10 syntheses per minute
- **LLM Timeout**: 300 seconds (5 minutes)
- **Caching**: ❌ Disabled (no caching for synthesis)

## Input Schema

```typescript
{
  taskId: string;              // Parent task identifier
  completedSubtasks: Array<{   // Minimum 1 completed subtask
    id: string;                // Subtask identifier
    specialist: string;        // Specialist type that completed it
    output: string;            // Specialist's work output
    artifacts?: string[];      // Optional created/modified files
  }>;
  parentTask: string;          // Original task description
}
```

## Output Schema

```typescript
{
  taskId: string;
  integration: {
    status: "ready_for_integration" | "requires_fixes" | "integrated";
    integrationSteps: string[];     // Steps to integrate the work
    potentialIssues: string[];      // Identified integration problems
    nextActions: string[];          // Recommended next steps
    mergedCode?: string;            // Optional integrated code
  };
}
```

## Integration Status Types

### ready_for_integration
Work can be integrated with minimal effort:
- No conflicts detected
- Clear integration path identified
- All dependencies satisfied
- Minor coordination needed

### requires_fixes
Integration requires resolution of issues:
- Conflicts between specialist solutions
- Missing dependencies or interfaces
- Inconsistent patterns or approaches
- Architecture misalignment

### integrated
Work has been successfully merged:
- All pieces fit together seamlessly
- No outstanding conflicts
- Integration steps completed
- Ready for deployment

## LLM Synthesis Features

### Progress Analysis Service

```typescript
const integration = await samplingService.synthesizeProgress(sessionId, {
  completedSubtasks: input.completedSubtasks,
  parentTask: input.parentTask
});
```

### Template-Based Synthesis

Uses Nunjucks templates for structured analysis:

```typescript
const prompt = templates.render("progress-synthesis.njk", {
  taskId: input.taskId,
  parentTask: input.parentTask,
  completedSubtasks: input.completedSubtasks,
  decomposition,
  timestamp: new Date().toISOString()
});
```

### Decomposition Context

Retrieves original task decomposition for context:

```typescript
// Get decomposition data to understand original structure
const decompositionKey = `cb:decomposition:${input.taskId}`;
const decompositionData = await redis.pub.hget(decompositionKey, "data");
```

## Synthesis Analysis

### Integration Assessment

The LLM analyzes multiple aspects:

- **Code Compatibility**: Do the pieces work together?
- **Interface Alignment**: Are APIs and contracts consistent?
- **Data Flow**: Is information passed correctly between components?
- **Architecture Consistency**: Do patterns align across specialists?
- **Performance Impact**: Are there bottlenecks or inefficiencies?
- **Testing Coverage**: Is the integrated solution testable?

### Conflict Detection

Identifies various types of integration issues:

```typescript
// Integration conflicts trigger additional events
for (const issue of integration.potentialIssues) {
  if (issue.toLowerCase().includes("conflict") || 
      issue.toLowerCase().includes("incompatible")) {
    await ctx.publish({
      type: "swarm.integration_conflict",
      payload: {
        taskId: input.taskId,
        issue,
        requiresResolution: true
      }
    });
  }
}
```

### Code Merging

For compatible solutions, generates merged implementation:

```json
{
  "mergedCode": "// Integrated dark mode implementation\nimport { useTheme } from './hooks/useTheme';\nimport { ThemeToggle } from './components/ThemeToggle';\n\nexport const DarkModeFeature = {\n  component: ThemeToggle,\n  hook: useTheme,\n  api: '/api/user-preferences/theme'\n};"
}
```

## Execution Flow

### 1. Decomposition Retrieval
```typescript
// Get original task structure for context
let decomposition = null;
const decompositionData = await redis.pub.hget(decompositionKey, "data");
if (decompositionData) {
  decomposition = JSON.parse(decompositionData);
}
```

### 2. Template Rendering
```typescript
const prompt = templates.render("progress-synthesis.njk", {
  taskId: input.taskId,
  parentTask: input.parentTask,
  completedSubtasks: input.completedSubtasks,
  decomposition,
  timestamp: new Date().toISOString()
});
```

### 3. LLM Synthesis
- Analyzes all completed subtask outputs
- Considers original task requirements
- Identifies integration patterns
- Generates unified solution

### 4. Progress Update
```typescript
const result = await redisScripts.synthesizeProgress(
  input.taskId,
  `synthesis-${Date.now().toString()}`,
  progressData
);
```

### 5. Database Persistence
```typescript
await ctx.prisma.swarmIntegration.create({
  data: {
    taskId: input.taskId,
    status: integration.status,
    steps: integration.integrationSteps,
    issues: integration.potentialIssues,
    mergedCode: integration.mergedCode,
    createdAt: new Date()
  }
});
```

### 6. Completion Events
```typescript
// If fully integrated, mark task complete
if (integration.status === "integrated") {
  await ctx.publish({
    type: "swarm.task_completed",
    payload: {
      taskId: input.taskId,
      mergedCode: !!integration.mergedCode,
      totalSubtasks: input.completedSubtasks.length
    }
  });
}
```

## Event Chain

1. **Trigger**: All subtasks completed OR triggered manually
2. **Analysis**: LLM processes completed work (5-300 seconds)
3. **Storage**: Integration results stored in Redis/PostgreSQL
4. **Events**: `swarm.synthesized` published
5. **Completion**: `swarm.task_completed` if fully integrated
6. **Conflicts**: `swarm.integration_conflict` if issues found

## Error Handling

### Circuit Breaker
- **Threshold**: 3 failures
- **Timeout**: 60 seconds
- **Fallback**: Returns `requires_fixes` status with error message

### Data Recovery
- Attempts Redis first, falls back to PostgreSQL
- Reconstructs decomposition from database if needed
- Handles missing subtask data gracefully

### Resilience Features
- Rate limiting: 10 syntheses/minute
- Timeout: 300 seconds for LLM response
- No caching (ensures fresh analysis)
- Atomic progress updates via Lua scripts

## Usage Examples

### Basic Feature Synthesis

```bash
# Via MCP tool
swarm__synthesize '{
  "taskId": "t-123",
  "completedSubtasks": [
    {
      "id": "st-1",
      "specialist": "frontend",
      "output": "Created DarkModeToggle component with React hooks",
      "artifacts": ["components/DarkModeToggle.tsx", "hooks/useTheme.ts"]
    },
    {
      "id": "st-2", 
      "specialist": "backend",
      "output": "Implemented user preferences API with theme persistence",
      "artifacts": ["api/preferences.ts", "models/UserPreference.ts"]
    },
    {
      "id": "st-3",
      "specialist": "testing",
      "output": "Added comprehensive test suite for dark mode feature",
      "artifacts": ["tests/DarkMode.test.tsx", "tests/preferences.test.ts"]
    }
  ],
  "parentTask": "Add dark mode toggle to settings page"
}'
```

### Complex Integration

```bash
swarm__synthesize '{
  "taskId": "t-456",
  "completedSubtasks": [
    {
      "id": "st-1",
      "specialist": "frontend", 
      "output": "Built analytics dashboard with chart components",
      "artifacts": ["Dashboard.tsx", "Chart.tsx", "MetricCard.tsx"]
    },
    {
      "id": "st-2",
      "specialist": "backend",
      "output": "Created real-time data streaming API with WebSocket",
      "artifacts": ["StreamingController.ts", "MetricsService.ts"]
    },
    {
      "id": "st-3",
      "specialist": "backend",
      "output": "Implemented data aggregation and caching layer", 
      "artifacts": ["AggregationService.ts", "CacheManager.ts"]
    },
    {
      "id": "st-4",
      "specialist": "testing",
      "output": "Created integration tests for real-time features",
      "artifacts": ["integration/streaming.test.ts"]
    }
  ],
  "parentTask": "Create real-time analytics dashboard with WebSocket updates"
}'
```

## Response Examples

### Successful Integration

```json
{
  "taskId": "t-123",
  "integration": {
    "status": "integrated",
    "integrationSteps": [
      "Import DarkModeToggle component in Settings page",
      "Wrap application with ThemeProvider context",
      "Connect toggle to user preferences API",
      "Add theme persistence to user profile",
      "Update CSS variables for dark mode styles"
    ],
    "potentialIssues": [],
    "nextActions": [
      "Deploy updated theme system to staging",
      "Run accessibility tests with screen readers",
      "Update user documentation with dark mode instructions"
    ],
    "mergedCode": "// Integrated dark mode implementation\nexport const DarkModeFeature = {\n  component: DarkModeToggle,\n  hook: useTheme,\n  api: ThemePreferencesAPI,\n  provider: ThemeProvider\n};"
  }
}
```

### Requires Fixes

```json
{
  "taskId": "t-456", 
  "integration": {
    "status": "requires_fixes",
    "integrationSteps": [
      "Resolve WebSocket connection lifecycle conflicts",
      "Align chart data formats between frontend and backend",
      "Standardize error handling across components",
      "Implement proper connection retry logic"
    ],
    "potentialIssues": [
      "Frontend expects REST API format but backend provides WebSocket-only data",
      "Chart component assumes synchronous data but streaming is asynchronous",
      "Missing error boundaries for connection failures",
      "Inconsistent timestamp formats between services"
    ],
    "nextActions": [
      "Create data transformation layer for format compatibility",
      "Add fallback REST endpoints for initial data loading",
      "Implement proper loading states for streaming data",
      "Standardize timestamp handling across all components"
    ]
  }
}
```

## Template System

### Synthesis Template Structure

```nunjucks
# Progress Synthesis for Task: {{ taskId }}

## Original Task
{{ parentTask }}

## Completed Subtasks
{% for subtask in completedSubtasks %}
### {{ subtask.specialist | title }} Work ({{ subtask.id }})
**Output**: {{ subtask.output }}
{% if subtask.artifacts %}
**Files**: {{ subtask.artifacts | join(", ") }}
{% endif %}
{% endfor %}

{% if decomposition %}
## Original Decomposition Context
- **Strategy**: {{ decomposition.strategy }}
- **Total Complexity**: {{ decomposition.totalComplexity }}
- **Expected Subtasks**: {{ decomposition.subtasks | length }}
{% endif %}

## Integration Analysis Required

Please analyze the completed work and provide:

1. **Integration Status**: Can these pieces work together?
2. **Integration Steps**: What needs to be done to combine them?
3. **Potential Issues**: What conflicts or problems do you identify?
4. **Next Actions**: What should happen after integration?
5. **Merged Code**: If applicable, provide unified implementation

Consider code compatibility, interface alignment, data flow, architecture consistency, and testing coverage.
```

## Performance Considerations

### LLM Processing Time
- **Simple integrations**: 15-30 seconds
- **Complex multi-specialist work**: 60-180 seconds
- **Maximum timeout**: 300 seconds

### Database Impact
- Creates integration records for tracking
- Updates decomposition progress
- May update multiple subtask statuses
- Uses transactions for consistency

### Memory Usage
- Processes all subtask outputs in memory
- May include large code artifacts
- Template rendering for prompts

## Prerequisites

- Triggered by SYNTHESIZE_PROGRESS Lua script
- All subtasks must be completed
- MCP sampling capability enabled
- Valid session ID in context metadata

## Warnings

⚠️ **LLM Processing**: Synthesis uses LLM sampling which may take up to 600 seconds

⚠️ **Large Codebases**: May require multiple synthesis passes for complex projects

⚠️ **Integration Conflicts**: May require manual resolution if automated synthesis fails

## Related Handlers

- [`swarm.decompose`](./decompose.md) - Creates the subtasks being synthesized
- [`swarm.resolve`](./resolve.md) - May be needed for integration conflicts
- [`swarm.assign`](./assign.md) - Assigns the subtasks that feed into synthesis