# MCP Integration Guide

Complete guide to integrating ClaudeBench with Model Context Protocol (MCP) for use with Claude Code and Claude Desktop.

## Overview

ClaudeBench provides native MCP server capabilities, allowing Claude to interact with your task management system through standardized protocols. This enables:

- **Task Management**: Create, assign, and complete tasks via Claude
- **Swarm Intelligence**: Decompose complex projects using AI
- **Real-time Monitoring**: System health and metrics access
- **Hook System**: Pre/post-tool validation and processing

## MCP Server Setup

### 1. Basic MCP Configuration

ClaudeBench automatically exposes MCP tools for all registered handlers. The server starts on the same port as the HTTP API.

```typescript
// MCP is automatically enabled when handlers use @EventHandler decorator
@EventHandler({
  event: "task.create",
  inputSchema: taskCreateInput,
  outputSchema: taskCreateOutput,
  mcp: {
    title: "Create Task",
    metadata: {
      examples: [
        {
          description: "Create a development task",
          input: {
            text: "Review API documentation",
            priority: 75
          }
        }
      ],
      useCases: [
        "Creating work items for team management",
        "Adding todos to project workflows"
      ],
      warnings: [
        "Tasks are created in 'pending' status",
        "Priority values range from 0-100"
      ]
    }
  }
})
export class TaskCreateHandler {
  // Handler implementation
}
```

### 2. MCP Server Configuration

The MCP server configuration is defined in the main server setup:

```typescript
// apps/server/src/index.ts
import { createMCPServer } from "@/mcp/server";
import { TaskCreateHandler } from "@/handlers/task/task.create.handler";

const server = createMCPServer({
  name: "claudebench",
  version: "1.0.0",
  description: "ClaudeBench Task Management System"
});

// Register handlers (automatically creates MCP tools)
server.registerHandler(new TaskCreateHandler());

// Start server
const port = process.env.PORT || 3000;
server.listen(port);
```

### 3. Available MCP Tools

ClaudeBench automatically generates MCP tools for all handlers:

| Handler | MCP Tool | Description |
|---------|----------|-------------|
| `task.create` | `task__create` | Create new tasks |
| `task.update` | `task__update` | Update task properties |
| `task.complete` | `task__complete` | Mark tasks as completed |
| `task.assign` | `task__assign` | Assign tasks to workers |
| `system.health` | `system__health` | Check system status |
| `system.metrics` | `system__metrics` | Get performance metrics |
| `hook.pre_tool` | `hook__pre_tool` | Pre-tool validation |
| `swarm.decompose` | `swarm__decompose` | Decompose complex tasks |

## Claude Desktop Integration

### 1. Configuration File

Add ClaudeBench to your Claude Desktop MCP configuration:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "claudebench": {
      "command": "bun",
      "args": ["run", "mcp-server"],
      "cwd": "/path/to/claudebench",
      "env": {
        "NODE_ENV": "development",
        "DATABASE_URL": "postgresql://postgres:postgres@localhost:5432/claudebench",
        "REDIS_HOST": "localhost",
        "REDIS_PORT": "6379"
      }
    }
  }
}
```

### 2. Alternative: Remote MCP Server

Connect to a running ClaudeBench instance:

```json
{
  "mcpServers": {
    "claudebench": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-fetch"],
      "env": {
        "FETCH_BASE_URL": "http://localhost:3000/mcp"
      }
    }
  }
}
```

### 3. Verification

Restart Claude Desktop and verify the connection:

1. Open Claude Desktop
2. Start a new conversation
3. Look for ClaudeBench tools in the tool palette
4. Test with a simple command: "Create a test task with priority 75"

## Claude Code Integration

### 1. Setup for Claude Code

Claude Code can connect to ClaudeBench via the MCP protocol:

```bash
# Start ClaudeBench with MCP server
bun dev

# In another terminal, start Claude Code with MCP
claude-code --mcp-server http://localhost:3000/mcp
```

### 2. Environment Configuration

Create a `.claude-code.json` configuration file:

```json
{
  "mcp": {
    "servers": [
      {
        "name": "claudebench",
        "url": "http://localhost:3000/mcp",
        "description": "Task management and swarm intelligence"
      }
    ]
  },
  "hooks": {
    "pre_tool": {
      "enabled": true,
      "server": "claudebench",
      "method": "hook__pre_tool"
    },
    "post_tool": {
      "enabled": true,
      "server": "claudebench",
      "method": "hook__post_tool"
    }
  }
}
```

### 3. Using ClaudeBench in Claude Code

Once configured, you can use ClaudeBench features directly in Claude Code:

```
Create a high-priority task to "Implement user authentication" with metadata including the assignee "developer@company.com"
```

This will automatically call the `task__create` MCP tool.

## MCP Tool Examples

### Task Management

**Create a Task**:
```typescript
// Via MCP tool call
{
  "name": "task__create",
  "arguments": {
    "text": "Implement user registration flow",
    "priority": 85,
    "metadata": {
      "assignee": "frontend-team",
      "sprint": "sprint-2025-01",
      "tags": ["authentication", "frontend"]
    }
  }
}
```

**Complete a Task**:
```typescript
{
  "name": "task__complete",
  "arguments": {
    "taskId": "t-1726744215125",
    "workerId": "developer-1",
    "result": {
      "linesOfCode": 250,
      "testsAdded": 15,
      "documentation": true
    }
  }
}
```

### Swarm Intelligence

**Decompose Complex Project**:
```typescript
{
  "name": "swarm__decompose",
  "arguments": {
    "task": "Build a real-time analytics dashboard with user authentication, data visualization, and export functionality",
    "constraints": [
      "Use React and TypeScript",
      "Include responsive design",
      "Add comprehensive tests"
    ],
    "priority": 90
  }
}
```

### System Monitoring

**Check System Health**:
```typescript
{
  "name": "system__health",
  "arguments": {
    "verbose": true
  }
}
```

**Get Performance Metrics**:
```typescript
{
  "name": "system__metrics",
  "arguments": {
    "detailed": true,
    "timeRange": "1h"
  }
}
```

## Hook System Integration

### Pre-Tool Hooks

ClaudeBench can validate and modify Claude's tool calls before execution:

```typescript
// Example: Validate file operations
@EventHandler({
  event: "hook.pre_tool",
  inputSchema: preToolHookInput,
  outputSchema: preToolHookOutput
})
export class PreToolHookHandler {
  async handle(input: PreToolHookInput, ctx: EventContext) {
    const { toolName, parameters } = input;
    
    // Block dangerous operations
    if (toolName === "bash" && parameters.command?.includes("rm -rf")) {
      return {
        allowed: false,
        reason: "Dangerous file deletion command blocked",
        modifiedParameters: null
      };
    }
    
    // Modify parameters if needed
    if (toolName === "edit_file" && !parameters.backup) {
      return {
        allowed: true,
        reason: "Added automatic backup",
        modifiedParameters: {
          ...parameters,
          backup: true
        }
      };
    }
    
    return {
      allowed: true,
      reason: "Tool execution approved",
      modifiedParameters: null
    };
  }
}
```

### Post-Tool Hooks

Process tool results after execution:

```typescript
@EventHandler({
  event: "hook.post_tool",
  inputSchema: postToolHookInput,
  outputSchema: postToolHookOutput
})
export class PostToolHookHandler {
  async handle(input: PostToolHookInput, ctx: EventContext) {
    const { toolName, result, duration } = input;
    
    // Log slow operations
    if (duration > 5000) {
      await ctx.publish({
        type: "performance.slow_tool",
        payload: { toolName, duration }
      });
    }
    
    // Transform results if needed
    if (toolName === "read_file" && result.content) {
      return {
        transformedResult: {
          ...result,
          content: result.content.substring(0, 10000), // Truncate large files
          truncated: result.content.length > 10000
        }
      };
    }
    
    return {
      transformedResult: result
    };
  }
}
```

## Advanced MCP Configuration

### Custom MCP Server

For advanced use cases, create a custom MCP server:

```typescript
// mcp/custom-server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  {
    name: "claudebench-custom",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    },
  }
);

// Add custom tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "custom_task_analysis",
      description: "Analyze task complexity and provide recommendations",
      inputSchema: {
        type: "object",
        properties: {
          taskDescription: { type: "string" },
          context: { type: "object" }
        }
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "custom_task_analysis") {
    const { taskDescription, context } = request.params.arguments;
    
    // Custom analysis logic
    const analysis = await analyzeTask(taskDescription, context);
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(analysis, null, 2)
        }
      ]
    };
  }
  
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);
```

### Resource Providers

Expose ClaudeBench data as MCP resources:

```typescript
// Add resource capabilities
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "claudebench://tasks",
      name: "Active Tasks",
      description: "List of all active tasks"
    },
    {
      uri: "claudebench://metrics",
      name: "System Metrics",
      description: "Real-time system performance metrics"
    }
  ]
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri;
  
  if (uri === "claudebench://tasks") {
    const tasks = await getActiveTasks();
    return {
      contents: [
        {
          uri: uri,
          mimeType: "application/json",
          text: JSON.stringify(tasks, null, 2)
        }
      ]
    };
  }
  
  if (uri === "claudebench://metrics") {
    const metrics = await getSystemMetrics();
    return {
      contents: [
        {
          uri: uri,
          mimeType: "application/json",
          text: JSON.stringify(metrics, null, 2)
        }
      ]
    };
  }
  
  throw new Error(`Unknown resource: ${uri}`);
});
```

## Security Considerations

### Authentication

Secure your MCP server in production:

```typescript
// Add authentication middleware
server.use(async (request, next) => {
  const token = request.headers.authorization?.split(' ')[1];
  
  if (!token || !await validateToken(token)) {
    throw new Error("Unauthorized");
  }
  
  return next();
});
```

### Rate Limiting

Implement rate limiting for MCP calls:

```typescript
// Rate limiting for MCP tools
@Resilient({
  rateLimit: { limit: 50, windowMs: 60000 } // 50 calls per minute
})
async handle(input: any, ctx: EventContext) {
  // Handler implementation
}
```

### Input Validation

Always validate MCP tool inputs:

```typescript
// Strict input validation
@EventHandler({
  event: "task.create",
  inputSchema: z.object({
    text: z.string().min(1).max(500),
    priority: z.number().min(0).max(100).optional(),
    metadata: z.record(z.unknown()).optional()
  }),
  outputSchema: taskCreateOutput
})
```

## Troubleshooting MCP Integration

### Common Issues

**MCP Server Not Connecting**:
```bash
# Check if server is running
curl http://localhost:3000/mcp/health

# Verify MCP configuration
cat ~/.config/claude/claude_desktop_config.json

# Check server logs
bun relay --filter="mcp.*"
```

**Tool Not Found Errors**:
```bash
# List available tools
curl http://localhost:3000/mcp/tools

# Check handler registration
grep "registerHandler" apps/server/src/index.ts
```

**Permission Denied**:
```bash
# Check authentication
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/mcp/tools

# Verify environment variables
env | grep -E "(AUTH|TOKEN|SECRET)"
```

### Debugging MCP Calls

Enable detailed MCP logging:

```typescript
// Enable MCP debug logging
process.env.MCP_DEBUG = "true";

// Log all MCP requests/responses
server.use((request, next) => {
  console.log("MCP Request:", JSON.stringify(request, null, 2));
  const result = await next();
  console.log("MCP Response:", JSON.stringify(result, null, 2));
  return result;
});
```

## Best Practices

### 1. Tool Design
- Use descriptive tool names and descriptions
- Provide comprehensive examples in MCP metadata
- Include usage warnings and prerequisites
- Design for both interactive and programmatic use

### 2. Error Handling
- Return structured error responses
- Include helpful error messages
- Log errors for debugging
- Implement graceful degradation

### 3. Performance
- Cache frequently accessed data
- Use appropriate rate limits
- Implement timeouts for long operations
- Monitor MCP call performance

### 4. Security
- Validate all inputs thoroughly
- Implement authentication where needed
- Use rate limiting to prevent abuse
- Log security-relevant events

For advanced integration patterns and webhook system setup, see the [Claude Hooks Guide](claude-hooks.md).