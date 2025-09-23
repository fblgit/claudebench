# ClaudeBench 🚀

ClaudeBench is a Redis-first event-driven AI workbench that provides a powerful development platform for Claude and AI agents. Built with a focus on simplicity and performance, it features swarm intelligence for complex task decomposition.

## Key Features

- **🔴 Redis-First Architecture**: Direct use of Redis primitives for all coordination
- **🐝 Swarm Intelligence**: Automatic task decomposition and specialist assignment
- **📡 Event-Driven**: JSONRPC 2.0 protocol with real-time WebSocket updates
- **🎨 Modern Web UI**: React dashboard with real-time task visualization
- **🔌 MCP Integration**: Model Context Protocol support for AI tool integration
- **🚀 High Performance**: Built on Bun runtime for maximum speed
- **📊 Real-Time Metrics**: Comprehensive monitoring and telemetry

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                  Web Dashboard                  │
│         (React + TanStack + Tailwind)           │
└────────────────────┬────────────────────────────┘
                     │ WebSocket + HTTP
┌────────────────────▼────────────────────────────┐
│              Event Bus (Hono)                   │
│            JSONRPC 2.0 Protocol                 │
└────────┬─────────────────────────┬──────────────┘
         │                         │
┌────────▼──────────┐     ┌───────▼──────────┐
│   Redis Streams   │     │   PostgreSQL     │
│  Pub/Sub + State  │     │  (Persistence)   │
└───────────────────┘     └──────────────────┘
         │
┌────────▼──────────────────────────────────────┐
│         Swarm Intelligence Layer              │
│   (Decomposition, Assignment, Synthesis)      │
└───────────────────────────────────────────────┘
```

## 🚀 Quick Start
### What can be done so far?
- [x] TodoWrite goes into ClaudeBench and is accessible thru tasks
- [x] Tasks domain (list, create, claim, update, attachments, etc)
- [x] Hooks domain (preTool, postTool, preCompaction, agentStop, userPrompt, notification, todoWrite)
- [x] Swarm domain (assign, context, decompose, resolve, synthetise,  createProject)
- [x] Docs domain (list, get)
- [x] System domain (register, discover, getState, metrics, heartbeat, quorum, redis & postgres tools)
- [x] MCP to Handler (access handlers via MCP: task, swarm, docs, system, etc)
- [x] RPC to Handler (access handlers via `/rpc` endpoint)
- [x] Swarm Project Creation (Tasks and Subtasks with LLM Context & Prompt generation)
- [x] Circuit Breaker, RateLimit, Timeout, Metrics (decorators EventHandler, Instrumented, Resilient)
- [x] Migrate task metadata to task attachments
- [x] State session rehydration (persist hook events, labeling and processing, fetch optimised worker state MCP resource)
- [x] Consolidate better Prisma schemas and persisted data quality
- [x] AutoCommit for hooks write with context commit message
- [x] Rich view of Attachments in the tasks (context and commit types)
- [x] Task.context generation from Kanban
- [x] Install CLI (setup hooks, agents, mcp, config, etc)
- [x] Projects page at `/projects` for project creation
- [x] Multi Project tenancy (including context/decompose workdir propagation)
- [ ] Improve processing and rehydration rich/efficient context
- [ ] MCP reconnect session-resume mechanism (messy, low priority)

### Prerequisites

- **Bun** >= 1.2.0 ([Install Bun](https://bun.sh/))
- **Redis** >= 6.0 (Local or Docker)
- **PostgreSQL** >= 14 (Local or Docker)
- **Node.js** >= 18 (for some tooling)

### Installation

```bash
# Clone the repository
git clone https://github.com/fblgit/claudebench.git
cd claudebench

# Install dependencies
bun install

# Copy environment variables
cp .env.example .env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env

# Update .env files with your configuration
```

### Database Setup

```bash
# Start PostgreSQL with Docker
bun db:start

# Run database migrations
bun db:push

# (Optional) Open Prisma Studio to view data
bun db:studio
```

### Running the Application

```bash
# Start all services (server on :3000, web on :3001)
bun dev

# Or run services individually:
bun dev:server  # Backend server only
bun dev:web     # Frontend only

# Start documentation site (optional, on :3002)
cd docs && bun dev
```

### Running the Event Relay

The event relay provides real-time monitoring of system events:

```bash
# Start the relay for monitoring
bun relay
```

## 📖 Core Concepts

### Event-Driven Architecture

ClaudeBench uses a flat event hierarchy with the pattern `domain.action`:

```typescript
// Example events
"task.create"      // Create a new task
"task.complete"    // Mark task as completed
"swarm.decompose"  // Decompose complex task
"system.health"    // System health check
```

### Task States

Tasks progress through these states:
- `pending` - Awaiting assignment
- `in_progress` - Currently being worked on
- `completed` - Successfully finished
- `failed` - Encountered an error

### Swarm Intelligence

Complex tasks are automatically decomposed into subtasks and assigned to specialized workers:

```typescript
// Create a swarm project
await client.call("swarm.create_project", {
  project: "Build a dashboard with real-time charts",
  constraints: ["Use React", "Include WebSocket updates"],
  priority: 85
});
```

## 🔧 API Reference

### Task Operations

```typescript
// Create a task
const task = await client.call("task.create", {
  text: "Process data batch",
  priority: 75,
  metadata: { type: "batch_job" }
});

// Claim a task
const claimed = await client.call("task.claim", {
  workerId: "worker-1",
  maxTasks: 5
});

// Complete a task
await client.call("task.complete", {
  taskId: "t-123",
  workerId: "worker-1",
  result: { processed: 100 }
});
```

### System Operations

```typescript
// Check system health
const health = await client.call("system.health");

// Get metrics
const metrics = await client.call("system.metrics", {
  detailed: true
});

// Register instance
await client.call("system.register", {
  id: "worker-1",
  roles: ["worker", "observer"]
});
```

## 🧪 Testing

```bash
# Run all tests
bun test

# Run specific test suites
bun test:contract     # Contract tests
bun test:integration  # Integration tests
bun test:web         # Frontend tests

# Watch mode for development
bun test:watch
```

## 📊 Monitoring

ClaudeBench provides comprehensive monitoring capabilities:

- **Real-time Dashboard**: Visual task tracking at `http://localhost:3001`
- **Event Stream**: Live event monitoring via the relay
- **Metrics Endpoint**: System metrics available via API
- **Health Checks**: Automatic instance health monitoring

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:
- Development setup
- Code style and standards
- Testing requirements
- Pull request process

## 📚 Documentation

### Accessing Documentation

ClaudeBench provides comprehensive documentation through multiple channels:

#### 🌐 Docusaurus Documentation Site
```bash
# Start the documentation server
cd docs && bun dev
# Access at http://localhost:3002
```

#### 🖥️ Integrated Documentation Viewer
The web application includes an embedded documentation viewer:
1. Start the main application: `bun dev`
2. Navigate to the **Docs** tab in the sidebar
3. Browse documentation within the ClaudeBench interface

#### 📡 API Documentation Access
Programmatic access to documentation via handlers:
- `docs.list` - List all documentation with metadata
- `docs.get` - Retrieve specific document content

### Documentation Structure

The documentation source files are located in [`docs/docs/`](docs/docs/) and organized as follows:

- **[Getting Started](docs/docs/intro.md)** - Quick introduction and setup
- **[Architecture](docs/docs/architecture/)** - System design and patterns
  - [Event Bus & Redis integration](docs/docs/architecture/event-bus.md)
  - [Handler patterns and decorators](docs/docs/architecture/handlers.md)
  - [MCP (Model Context Protocol) integration](docs/docs/architecture/mcp.md)
  - [Circuit breakers and resilience](docs/docs/architecture/circuit-breaker.md)
- **[API Reference](docs/docs/api/)** - Complete API documentation
  - [Task operations](docs/docs/api/task/)
  - [System management](docs/docs/api/system/)
  - [Swarm intelligence](docs/docs/api/swarm/)
- **[Guides](docs/docs/guides/)** - Practical tutorials and examples
- **[Handlers](docs/docs/handlers/)** - Handler implementation details

You can browse the documentation directly in the [`docs/docs/`](docs/docs/) directory or view them through the Docusaurus interface.

## 🛠️ Technology Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Backend**: [Hono](https://hono.dev/) - Lightweight web framework
- **Frontend**: [React](https://react.dev/) + [TanStack Router](https://tanstack.com/router)
- **Database**: [PostgreSQL](https://www.postgresql.org/) + [Prisma](https://www.prisma.io/)
- **Cache/Queue**: [Redis](https://redis.io/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
- **Testing**: [Bun Test](https://bun.sh/docs/cli/test) + [Vitest](https://vitest.dev/)

## 📄 License

ClaudeBench is MIT licensed. See [LICENSE](LICENSE) for details.
