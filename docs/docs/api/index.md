---
sidebar_position: 1
title: API Reference
---

# API Reference

ClaudeBench provides a comprehensive API through JSONRPC 2.0 protocol.

## Endpoints

### HTTP Endpoints

- **POST /rpc** - Single JSONRPC request
- **POST /rpc/batch** - Batch JSONRPC requests
- **GET /ws** - WebSocket connection for real-time events
- **GET /metrics** - Prometheus metrics
- **GET /mcp** - MCP health check

### WebSocket Events

Connect to `/ws` for real-time event subscriptions:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');
ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log(event.type, event.payload);
});
```

## Event Domains

ClaudeBench organizes events into domains:

### Task Domain
- [task.create](./task/create.md) - Create new task
- [task.update](./task/update.md) - Update task
- [task.complete](./task/complete.md) - Complete task
- [task.claim](./task/claim.md) - Claim tasks for processing
- [task.list](./task/list.md) - List tasks with filters

### System Domain
- [system.health](./system/health.md) - System health check
- [system.metrics](./system/metrics.md) - Get metrics
- [system.register](./system/register.md) - Register instance

### Swarm Domain
- [swarm.decompose](./swarm/decompose.md) - Decompose complex tasks using LLM intelligence
- [swarm.context](./swarm/context.md) - Generate specialized context for subtasks
- [swarm.assign](./swarm/assign.md) - Assign subtasks to best available specialists  
- [swarm.resolve](./swarm/resolve.md) - Resolve conflicts between specialist solutions
- [swarm.synthesize](./swarm/synthesize.md) - Synthesize completed work into integrated solution
- [swarm.create_project](./swarm/create_project.md) - Create new projects using swarm intelligence

## Request Format

All requests follow JSONRPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "method": "task.create",
  "params": {
    "text": "Task description",
    "priority": 75
  }
}
```

## Response Format

Successful response:

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "result": {
    "id": "t-123",
    "status": "pending"
  }
}
```

Error response:

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id",
  "error": {
    "code": -32000,
    "message": "Error description"
  }
}
```