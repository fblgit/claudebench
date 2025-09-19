# ClaudeBench Quickstart Guide

Get ClaudeBench running in under 5 minutes!

## Prerequisites

- Docker & Docker Compose installed
- Bun runtime (latest version)
- Claude Code with MCP support
- 100MB free memory
- Port 3000 (server) and 3001 (dashboard) available

## Quick Setup

### 1. Start Infrastructure (30 seconds)

```bash
# Start Redis and PostgreSQL
cd apps/server
docker-compose up -d

# Verify services are running
docker ps | grep -E "redis|postgres"
```

### 2. Install Dependencies (1 minute)

```bash
# From repository root
bun install

# Initialize database
cd apps/server
bun db:push
```

### 3. Start ClaudeBench Server (30 seconds)

```bash
# Terminal 1: Start the server
cd apps/server
bun dev
# Server starts on http://localhost:3000
```

### 4. Start Dashboard (Optional) (30 seconds)

```bash
# Terminal 2: Start the web dashboard
cd apps/web
bun dev
# Dashboard opens at http://localhost:3001
```

### 5. Connect Claude Code (1 minute)

Add to your Claude Code MCP settings:

```json
{
  "mcpServers": {
    "claudebench": {
      "command": "curl",
      "args": ["-X", "POST", "http://localhost:3000/mcp"],
      "transport": "streamableHttp"
    }
  }
}
```

Restart Claude Code to connect.

## Verify Installation

### Test 1: Health Check
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.health","params":{},"id":1}'

# Expected: {"jsonrpc":"2.0","result":{"status":"healthy","services":{"redis":true,"postgres":true,"mcp":true}},"id":1}
```

### Test 2: Create a Task
```bash
curl -X POST http://localhost:3000 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"task.create","params":{"text":"Test task"},"id":2}'

# Expected: {"jsonrpc":"2.0","result":{"id":"t-...","text":"Test task","status":"pending",...},"id":2}
```

### Test 3: Claude Code Integration
In Claude Code, use TodoWrite:
```
Create a test todo item
```

Check the dashboard at http://localhost:3001 - you should see the todo captured as an event.

## Basic Usage

### Creating Custom Event Handlers

1. Create a new handler file:

```typescript
// apps/server/src/handlers/custom/my.handler.ts
import { EventHandler } from '@/core/decorator';
import { z } from 'zod';

@EventHandler({
  event: 'custom.process',
  inputSchema: z.object({ data: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  persist: false
})
export class CustomProcessHandler {
  async handle(input: { data: string }) {
    // Your logic here
    return { result: `Processed: ${input.data}` };
  }
}
```

2. Handler is automatically:
   - Available at `POST /custom/process`
   - Exposed as MCP tool `custom__process`
   - Subscribable via WebSocket

### Setting Up Hooks

Configure a pre-tool validation hook:

```typescript
// apps/server/src/handlers/hook/validator.ts
@EventHandler({
  event: 'hook.pre_tool',
  inputSchema: z.object({ 
    tool: z.string(), 
    params: z.any() 
  }),
  outputSchema: z.object({ 
    allow: z.boolean(), 
    reason: z.string().optional() 
  })
})
export class PreToolValidator {
  async handle({ tool, params }) {
    // Example: Block dangerous file operations
    if (tool === 'Write' && params.file_path?.includes('/etc')) {
      return { allow: false, reason: 'System files protected' };
    }
    return { allow: true };
  }
}
```

### Monitoring Events

Watch the event stream in real-time:

```bash
# Subscribe to all events
bun run cli events:watch

# Filter specific event types
bun run cli events:watch --type task.create

# View event history
bun run cli events:list --last 100
```

### Dashboard Features

Access http://localhost:3001 to:
- View real-time event stream
- Monitor task queue
- See instance health
- Track metrics (events/sec, latency)
- Manage handlers (enable/disable)

## Common Workflows

### 1. TodoWrite Integration
When you use TodoWrite in Claude Code:
1. `hook.todo_write` event is emitted
2. ClaudeBench captures the todos
3. Tasks are created from action items
4. Workers process tasks automatically

### 2. Tool Validation
Before Claude Code executes tools:
1. `hook.pre_tool` event is emitted
2. Validators check the operation
3. Execution allowed or blocked
4. `hook.post_tool` processes results

### 3. Multi-Instance Coordination
With multiple Claude Code windows:
1. Each registers via `system.register`
2. Heartbeats keep instances alive
3. Tasks distributed based on roles
4. Events broadcast to all subscribers

## Configuration

### Environment Variables
```bash
# apps/server/.env
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://user:pass@localhost:5432/claudebench
MCP_PORT=3000
RATE_LIMIT=100  # Events per second
HEARTBEAT_TIMEOUT=30000  # ms
```

### Docker Compose Options
```yaml
# apps/server/docker-compose.yml
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: claudebench
      POSTGRES_USER: claudebench
      POSTGRES_PASSWORD: claudebench
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
```

## Troubleshooting

### Redis Connection Failed
```bash
# Check Redis is running
docker ps | grep redis

# Test connection
redis-cli ping
# Should return: PONG
```

### PostgreSQL Connection Failed
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Test connection
psql -h localhost -U claudebench -d claudebench -c "SELECT 1"
```

### Claude Code Not Connecting
1. Check server is running on port 3000
2. Verify MCP settings in Claude Code
3. Check for CORS errors in browser console
4. Restart Claude Code after config changes

### High Memory Usage
```bash
# Check Redis memory
redis-cli INFO memory

# Clear old events (older than 24h)
bun run cli events:cleanup

# Reduce event TTL in config
```

### Events Not Processing
```bash
# Check handler registration
bun run cli handlers:list

# Verify Redis pub/sub
redis-cli PUBSUB CHANNELS

# Check for errors
bun run cli logs:tail --error
```

## Next Steps

1. **Explore Examples**: Check `/examples` for handler patterns
2. **Read Architecture**: See `/docs/architecture.md` for deep dive
3. **Join Community**: Discord link for questions
4. **Contribute**: Add your own handlers and share!

## Quick Commands Reference

```bash
# Development
bun dev           # Start all services
bun dev:server    # Server only
bun dev:web       # Dashboard only

# Database
bun db:push       # Update schema
bun db:studio     # Prisma Studio GUI

# Testing
bun test          # Run all tests
bun test:e2e      # End-to-end tests

# CLI Tools
bun cli events:watch      # Monitor events
bun cli tasks:list        # View task queue
bun cli handlers:list     # Show registered handlers
bun cli metrics           # Performance stats
```

## Performance Expectations

On a typical developer machine:
- **Startup**: < 2 seconds
- **Event latency**: < 50ms
- **Memory usage**: < 100MB
- **Throughput**: 100+ events/sec capability (but typically 1 event/3s)

Remember: ClaudeBench is designed for localhost development, not production scale!

---

**Need help?** Check the full documentation or run `bun cli help`