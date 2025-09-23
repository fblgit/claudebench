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
- [task.create](./task/create) - Create new task
- [task.update](./task/update) - Update task
- [task.complete](./task/complete) - Complete task
- [task.assign](./task/assign) - Assign task to instance (backward compatibility)
- [task.unassign](./task/unassign) - Remove assignment from task
- [task.claim](./task/claim) - Claim tasks for processing
- [task.list](./task/list) - List tasks with filters
- [task.decompose](./task/decompose) - Decompose complex tasks into subtasks (replaces swarm.decompose)
- [task.context](./task/context) - Generate execution context for tasks

### System Domain
- [system.health](./system/health) - System health check
- [system.metrics](./system/metrics) - Get metrics
- [system.register](./system/register) - Register instance

### Session Domain
- [session.state.get](./session/state_get) - Retrieve session state and events
- [session.rehydrate](./session/rehydrate) - Rehydrate session for work continuation
- [session.snapshot.create](./session/snapshot_create) - Create recovery snapshots

### Swarm Domain
- [swarm.decompose](./swarm/decompose) - Decompose complex tasks using LLM intelligence
- [swarm.context](./swarm/context) - Generate specialized context for subtasks
- [swarm.assign](./swarm/assign) - Assign subtasks to best available specialists  
- [swarm.resolve](./swarm/resolve) - Resolve conflicts between specialist solutions
- [swarm.synthesize](./swarm/synthesize) - Synthesize completed work into integrated solution
- [swarm.create_project](./swarm/create_project) - Create new projects using swarm intelligence

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