# ClaudeBench 🚀

ClaudeBench is a Redis-first event-driven AI workbench that provides a powerful development platform for Claude and AI agents. Built with a focus on simplicity and performance, it features swarm intelligence for complex task decomposition.

## Key Features
<img width="2283" height="980" alt="Screenshot 2025-10-02 at 4 59 20 PM" src="https://github.com/user-attachments/assets/9d2f84fd-4d3b-4eee-ab8c-df05c032bdcf" />

- **🔴 Redis-First Architecture**: Direct use of Redis primitives for all coordination
- **🐝 Swarm Intelligence**: Automatic task decomposition and specialist assignment
- **📡 Event-Driven**: JSONRPC 2.0 protocol with real-time WebSocket updates
- **🎨 Modern Web UI**: React dashboard with real-time task visualization
- **🔌 MCP Integration**: Model Context Protocol support for AI tool integration
- **🚀 High Performance**: Built on Bun runtime for maximum speed
- **📊 Real-Time Metrics**: Comprehensive monitoring and telemetry

**Kanban Board for Tasks (Drag and Drop) with automatic TodoWrite integration**

<img width="2518" height="1184" alt="Screenshot 2025-10-02 at 4 49 14 PM" src="https://github.com/user-attachments/assets/91fad587-a12b-4b02-a17c-3f4c7be727c1" />

**Comprehensive Task details and automatic commit tracking**

<img width="2497" height="1272" alt="Screenshot 2025-10-02 at 4 49 30 PM" src="https://github.com/user-attachments/assets/9870ba82-e903-4cf3-83ec-23612fcf7e5f" />
<img width="2295" height="994" alt="Screenshot 2025-10-02 at 4 57 13 PM" src="https://github.com/user-attachments/assets/b7872a12-0428-408c-89e1-c8943a820f25" />

**Refine and generate tasks context for agent execution, or decompose full projects or large tasks**

<img width="760" height="819" alt="Screenshot 2025-10-02 at 4 49 41 PM" src="https://github.com/user-attachments/assets/079e93b4-5ea6-4268-94ee-cdd2c1259798" />
<img width="1598" height="1186" alt="Screenshot 2025-10-02 at 4 56 31 PM" src="https://github.com/user-attachments/assets/950b5814-ae66-4263-8230-f0532dab33ce" />

**Produce robust task implementation and context guidelines**

<img width="2283" height="980" alt="Screenshot 2025-10-02 at 4 59 20 PM" src="https://github.com/user-attachments/assets/a4fc37a1-f923-48a6-9b80-c37351733b4c" />

**Track the Events Stream with details**

<img width="2548" height="1302" alt="Screenshot 2025-10-02 at 4 51 05 PM" src="https://github.com/user-attachments/assets/0c4ce81e-29a6-4bea-a7ea-6186d94919fe" />
<img width="1640" height="1208" alt="Screenshot 2025-10-02 at 4 51 13 PM" src="https://github.com/user-attachments/assets/9d89ee3e-2f3b-4623-ab74-2e833bf32bb7" />

**Comprehensive Metrics**

<img width="1488" height="1276" alt="Screenshot 2025-10-02 at 4 51 35 PM" src="https://github.com/user-attachments/assets/766d6b5d-0447-49c6-9e36-cfddb9320128" />

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
1. Install Claudebench from this repo
2. Go to your project folder and run `bun run {CLAUDEBENCH_FOLDER}/scripts/claudebench-init.ts` to onboard your repository
3. Launch `claude` and say `hi`, he should carry on and you should be good to use tasking system of claudebench

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
