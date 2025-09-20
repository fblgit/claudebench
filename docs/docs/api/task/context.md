---
sidebar_position: 14
title: task.context
description: Generate AI-powered execution context for tasks
---

# task.context

Generate execution context for a task using LLM intelligence to provide focused guidance for implementation.

## Overview

The `task.context` handler generates specialized execution context for tasks by analyzing the task requirements and producing structured guidance tailored to specific specialist roles (frontend, backend, testing, docs, or general). The generated context includes mandatory readings, architecture constraints, success criteria, and a customized prompt to guide implementation.

## Request

### Method
`task.context`

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | ✓ | The ID of the task to generate context for |
| `specialist` | enum | ✓ | Specialist type: `frontend`, `backend`, `testing`, `docs`, or `general` |
| `customDescription` | string | ✗ | Override the task's description with custom text |
| `constraints` | string[] | ✗ | Additional constraints to consider during implementation |
| `requirements` | string[] | ✗ | Additional requirements the implementation must satisfy |
| `existingFiles` | string[] | ✗ | List of existing files to consider in the implementation |
| `additionalContext` | string | ✗ | Additional context information for the specialist |
| `metadata` | object | ✗ | Additional metadata for the context generation |

### Example Request

```json
{
  "jsonrpc": "2.0",
  "method": "task.context",
  "params": {
    "taskId": "t-123456",
    "specialist": "frontend",
    "constraints": [
      "Use React hooks",
      "Follow atomic design pattern",
      "Ensure mobile responsiveness"
    ],
    "requirements": [
      "Dark mode support",
      "Responsive design",
      "Accessibility compliance (WCAG 2.1)"
    ],
    "existingFiles": [
      "src/components/ThemeProvider.tsx",
      "src/hooks/useTheme.ts"
    ],
    "additionalContext": "This feature is part of the settings page redesign project"
  },
  "id": "req-001"
}
```

## Response

### Success Response

```json
{
  "jsonrpc": "2.0",
  "result": {
    "taskId": "t-123456",
    "context": {
      "taskId": "t-123456",
      "description": "Add dark mode toggle to settings page",
      "scope": "Implement a user-friendly dark mode toggle in the application settings",
      "mandatoryReadings": [
        {
          "title": "Theme Provider Component",
          "path": "src/components/ThemeProvider.tsx",
          "reason": "Core theme management system that must be integrated"
        },
        {
          "title": "Theme Hook",
          "path": "src/hooks/useTheme.ts",
          "reason": "Existing hook for theme state management"
        }
      ],
      "architectureConstraints": [
        "Use React hooks",
        "Follow atomic design pattern",
        "Ensure mobile responsiveness",
        "Maintain existing theme system architecture"
      ],
      "relatedWork": [
        {
          "instanceId": "specialist-2",
          "status": "in_progress",
          "summary": "Implementing user preferences API endpoint"
        }
      ],
      "successCriteria": [
        "Toggle switches between light and dark themes",
        "User preference persists across sessions",
        "No visual glitches during theme transition",
        "Component is accessible via keyboard navigation"
      ],
      "discoveredPatterns": [
        "Theme state managed via React Context",
        "CSS variables used for theme colors",
        "LocalStorage for preference persistence"
      ],
      "integrationPoints": [
        "Theme context provider",
        "User preferences API",
        "LocalStorage for client-side persistence"
      ],
      "recommendedApproach": "Implement a toggle component that integrates with the existing ThemeProvider, uses the useTheme hook for state management, and persists the preference via the user preferences API"
    },
    "prompt": "You are a frontend specialist working on the following task:\n\n## Task Overview\n**ID:** t-123456\n**Description:** Add dark mode toggle to settings page\n...[full specialist prompt generated from template]..."
  },
  "id": "req-001"
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "error": "Task t-999999 not found"
    }
  },
  "id": "req-001"
}
```

## Event Emission

When context is successfully generated, the following event is emitted:

```json
{
  "type": "task.context.generated",
  "payload": {
    "taskId": "t-123456",
    "specialist": "frontend",
    "contextSize": 2048
  },
  "metadata": {
    "generatedBy": "worker-1",
    "timestamp": 1758271800000
  }
}
```

## Context Storage

The generated context is automatically stored as a task attachment with the key pattern `context_{specialist}_{timestamp}`, allowing multiple context generations for different specialists or at different times.

## Caching

Context generation results are cached for 5 minutes (300 seconds) to avoid redundant LLM calls when the same context is requested multiple times in quick succession.

## Rate Limiting

- Maximum 50 context generation requests per minute
- Timeout: 300 seconds (5 minutes) for LLM response

## Circuit Breaker

If the LLM service fails 5 times within the circuit breaker window, the handler will return a fallback response indicating service unavailability:

```json
{
  "taskId": "",
  "context": {
    "taskId": "",
    "description": "Service unavailable",
    "scope": "",
    "mandatoryReadings": [],
    "architectureConstraints": [],
    "relatedWork": [],
    "successCriteria": []
  },
  "prompt": "Context generation service temporarily unavailable"
}
```

## Use Cases

1. **Feature Implementation**: Generate focused context for implementing new features
2. **Bug Fixing**: Provide context about related code and patterns for bug fixes
3. **Refactoring**: Generate guidance for code refactoring tasks
4. **Documentation**: Create context for documentation tasks
5. **Testing**: Generate test requirements and coverage expectations

## Best Practices

1. **Specialist Selection**: Choose the appropriate specialist based on the task nature:
   - `frontend`: UI/UX tasks, component development
   - `backend`: API development, data processing, business logic
   - `testing`: Test creation, coverage improvement
   - `docs`: Documentation writing, API docs, guides
   - `general`: Cross-cutting concerns, infrastructure

2. **Constraints and Requirements**: Be specific with constraints and requirements to get more targeted context

3. **Existing Files**: Include relevant existing files to help the LLM understand the current codebase structure

4. **Additional Context**: Provide project-specific information that might not be evident from the task description

## Integration with Swarm Intelligence

The context handler integrates with the swarm intelligence system:
- Retrieves related tasks being worked on by other specialists
- Identifies integration points between different specialists' work
- Ensures consistency across distributed task execution

## Notes

- Context generation uses LLM sampling which may take up to 5 minutes
- Generated context is stored as a task attachment for future reference
- The handler requires MCP sampling capability to be enabled
- Task must exist in the system before context can be generated
- Related tasks are fetched from the database to provide collaborative context

## Related

- [task.create](./create) - Create a new task
- [task.create_attachment](./create_attachment) - Store generated context as attachment
- [swarm.context](../swarm/context) - Generate context for swarm subtasks
- [swarm.decompose](../swarm/decompose) - Decompose complex tasks