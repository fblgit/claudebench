# swarm.context

Generate specialized context for subtask execution using LLM intelligence to provide focused guidance for specialist agents.

## Overview

The `swarm.context` handler takes a subtask and generates detailed, specialist-specific context to guide execution. It uses Large Language Model intelligence to analyze the codebase, understand requirements, and provide tailored instructions for different specialist types.

## Event Details

- **Event**: `swarm.context`
- **Type**: Specialist guidance generation
- **Persistence**: ❌ Disabled (ephemeral context)
- **Rate Limit**: 50 contexts per minute
- **LLM Timeout**: 300 seconds (5 minutes)
- **Caching**: 5 minutes (300 seconds)

## Input Schema

```typescript
{
  subtaskId: string;     // Unique subtask identifier
  specialist: "frontend" | "backend" | "testing" | "docs" | "general";
  parentTaskId: string;  // Parent task for related work context
}
```

## Output Schema

```typescript
{
  subtaskId: string;
  context: {
    taskId: string;
    description: string;
    scope: string;
    mandatoryReadings: Array<{
      title: string;
      path: string;
      reason: string;        // Why this reading is important
    }>;
    architectureConstraints: string[];
    relatedWork: Array<{
      instanceId: string;
      status: string;
      summary: string;
    }>;
    successCriteria: string[];
    discoveredPatterns?: {
      conventions: string[];
      technologies: string[];
      approaches: string[];
    };
    integrationPoints?: Array<{
      component: string;
      interface: string;
      considerations: string;
    }>;
    recommendedApproach?: string;
  };
  prompt: string;          // Generated specialist prompt
}
```

## LLM Sampling Features

### Context Generation Service

The handler uses MCP sampling for intelligent context generation:

```typescript
const specialistContext = await samplingService.generateContext(
  sessionId,
  input.subtaskId,
  input.specialist,
  subtaskInfo
);
```

### Template-Based Prompts

Uses Nunjucks templates for specialist-specific prompts:

```typescript
// Template directory: templates/swarm/
const prompt = nunjucksEnv.render("specialist-prompt.njk", context);
```

### Session Continuity

- Maintains context across related subtasks
- Uses `sessionId`, `clientId`, or `instanceId` 
- Enables conversation memory for LLM

## Specialist-Specific Context

### Frontend Specialists
- UI/UX patterns and conventions
- Component architecture guidelines
- Styling system requirements
- Accessibility considerations
- Browser compatibility constraints

### Backend Specialists  
- API design patterns
- Database schema considerations
- Authentication/authorization requirements
- Performance and scaling guidelines
- Security best practices

### Testing Specialists
- Test strategy and coverage requirements
- Testing framework patterns
- Integration test considerations
- Performance testing guidelines
- Accessibility testing requirements

### Documentation Specialists
- Documentation standards and formats
- API documentation requirements
- User guide considerations
- Code comment standards
- Architectural decision records

### General Specialists
- Cross-cutting concerns
- Configuration management
- Deployment considerations
- Monitoring and observability
- DevOps integration

## Context Components

### Mandatory Readings

Critical files that must be understood:

```typescript
mandatoryReadings: [
  {
    title: "Theme Context Provider",
    path: "src/contexts/ThemeContext.tsx",
    reason: "Core theme management implementation that must be extended"
  },
  {
    title: "Design System Tokens",
    path: "src/styles/tokens.ts", 
    reason: "Color and spacing tokens that define dark mode values"
  }
]
```

### Architecture Constraints

System-level constraints that must be followed:

```typescript
architectureConstraints: [
  "Must use CSS custom properties for theme switching",
  "Component must be accessible (WCAG 2.1 AA)",
  "No direct DOM manipulation outside React lifecycle",
  "Must support server-side rendering"
]
```

### Related Work Context

Information about other ongoing subtasks:

```typescript
relatedWork: [
  {
    instanceId: "specialist-backend-1",
    status: "in_progress", 
    summary: "User preferences API: 80% complete, authentication integrated"
  },
  {
    instanceId: "specialist-testing-1",
    status: "completed",
    summary: "Base theme tests: Unit tests for light theme completed"
  }
]
```

### Success Criteria

Clear definition of completion:

```typescript
successCriteria: [
  "Toggle component renders in both light and dark themes",
  "State persists across browser sessions",
  "Keyboard navigation works correctly",
  "Screen readers announce theme changes",
  "Component passes all accessibility tests"
]
```

## Execution Flow

### 1. Subtask Retrieval
```typescript
// Try Redis first, fallback to PostgreSQL
const subtaskKey = `cb:subtask:${input.subtaskId}`;
const subtaskData = await redis.pub.hget(subtaskKey, "data");
```

### 2. Related Work Analysis
```typescript
const relatedWork = await this.getRelatedWork(
  input.parentTaskId,
  input.subtaskId,
  ctx
);
```

### 3. LLM Context Generation
- Analyzes subtask requirements
- Considers specialist expertise
- Reviews related work progress
- Generates focused guidance

### 4. Template Rendering
```typescript
const prompt = this.generateSpecialistPrompt(specialistContext);
```

### 5. Event Publishing
```typescript
await ctx.publish({
  type: "swarm.context.generated",
  payload: {
    subtaskId: input.subtaskId,
    specialist: input.specialist,
    contextSize: prompt.length
  }
});
```

## Error Handling

### Circuit Breaker
- **Threshold**: 5 failures
- **Timeout**: 30 seconds
- **Fallback**: Returns basic context with service unavailable message

### Data Source Fallback
1. Redis cache (primary)
2. PostgreSQL database (secondary) 
3. Error if neither available

### Resilience Features
- Rate limiting: 50 requests/minute
- Timeout: 300 seconds for LLM response
- Caching: 5-minute context cache
- Template fallback for prompt generation

## Usage Examples

### Frontend Context Generation

```bash
# Via MCP tool
swarm__context '{
  "subtaskId": "st-1",
  "specialist": "frontend",
  "parentTaskId": "t-123"
}'
```

### Backend Context Generation

```bash
swarm__context '{
  "subtaskId": "st-2", 
  "specialist": "backend",
  "parentTaskId": "t-123"
}'
```

## Response Example

```json
{
  "subtaskId": "st-1",
  "context": {
    "taskId": "t-123",
    "description": "Create dark mode toggle component with React hooks",
    "scope": "Implement a reusable toggle component that manages theme state and integrates with the existing theme system",
    "mandatoryReadings": [
      {
        "title": "Theme Context Provider",
        "path": "src/contexts/ThemeContext.tsx",
        "reason": "Core theme management that must be extended for toggle integration"
      },
      {
        "title": "Existing Button Component", 
        "path": "src/components/ui/Button.tsx",
        "reason": "Design pattern reference for consistent component structure"
      }
    ],
    "architectureConstraints": [
      "Must use React hooks for state management",
      "Component must be accessible (WCAG 2.1 AA)",
      "Must integrate with existing ThemeContext",
      "No external dependencies beyond React"
    ],
    "relatedWork": [
      {
        "instanceId": "specialist-backend-1",
        "status": "in_progress",
        "summary": "User preferences API: Authentication integrated, persistence 70% complete"
      }
    ],
    "successCriteria": [
      "Toggle renders correctly in both themes",
      "State changes trigger theme context updates", 
      "Component is keyboard accessible",
      "Visual focus indicators work properly",
      "Component follows existing design patterns"
    ],
    "discoveredPatterns": {
      "conventions": [
        "Components use forwardRef for ref passing",
        "Event handlers use consistent naming (onToggle)",
        "Props interfaces extend HTMLButtonElement"
      ],
      "technologies": [
        "react",
        "typescript", 
        "css-modules",
        "react-context"
      ],
      "approaches": [
        "composition-over-inheritance",
        "controlled-components",
        "accessibility-first"
      ]
    },
    "integrationPoints": [
      {
        "component": "ThemeContext",
        "interface": "toggleTheme() method",
        "considerations": "Must handle transition animations and preference persistence"
      }
    ],
    "recommendedApproach": "Create a compound component with separate Toggle and Label parts, use useTheme hook for context access, implement proper ARIA attributes for screen readers"
  },
  "prompt": "You are a frontend specialist working on implementing a dark mode toggle component...\n\n[Generated specialist-specific prompt with context]"
}
```

## Template System

### Template Directory Structure
```
templates/swarm/
├── specialist-prompt.njk    # Main prompt template
├── frontend-context.njk     # Frontend-specific sections
├── backend-context.njk      # Backend-specific sections  
├── testing-context.njk      # Testing-specific sections
└── docs-context.njk         # Documentation-specific sections
```

### Template Variables
- `context`: Full context object
- `specialist`: Specialist type
- `relatedWork`: Other subtask progress
- `mandatoryReadings`: Required files
- `successCriteria`: Completion requirements

## Performance Considerations

### Caching Strategy
- **Duration**: 5 minutes
- **Key**: Subtask ID + specialist type
- **Benefits**: Reduces LLM calls for repeated contexts

### LLM Response Times
- **Typical**: 5-15 seconds
- **Complex contexts**: 30-60 seconds
- **Maximum timeout**: 300 seconds

### Database Queries
- Optimized related work queries (limit 5)
- Indexed subtask lookups
- Connection pooling for PostgreSQL

## Prerequisites

- Subtask must exist in Redis or PostgreSQL
- MCP sampling capability enabled
- Valid session ID in context metadata
- Template files available in templates/swarm/

## Warnings

⚠️ **LLM Sampling**: Context generation may take up to 600 seconds for complex subtasks

⚠️ **Ephemeral Data**: Generated context is not persisted by default - only cached briefly

⚠️ **Template Dependencies**: Requires Nunjucks templates in templates/swarm/ directory

## Related Handlers

- [`swarm.decompose`](./decompose) - Creates subtasks that need context
- [`swarm.assign`](./assign) - Uses context for specialist assignment
- [`swarm.resolve`](./resolve) - May need context for conflict resolution