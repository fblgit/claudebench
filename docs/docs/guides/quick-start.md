# Quick Start Guide

Get ClaudeBench running in 5 minutes with minimal setup.

## Prerequisites

- **Bun** >= 1.2.0 ([Install Bun](https://bun.sh/))
- **Docker** (for PostgreSQL - easiest setup)

## 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/fblgit/claudebench.git
cd claudebench

# Install dependencies
bun install
```

## 2. Environment Setup

```bash
# Copy environment variables
cp .env.example .env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

The default configuration works out of the box - no editing required.

## 3. Start Services

```bash
# Start PostgreSQL with Docker
bun db:start

# Run database migrations
bun db:push

# Start all services (server on :3000, web on :3001)
bun dev
```

## 4. Open the Dashboard

Visit [http://localhost:3001](http://localhost:3001) to access the web dashboard.

## 5. Test the System

```bash
# In a separate terminal, start the event relay
bun relay

# Create a test task
curl -X POST http://localhost:3000/task/create \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello ClaudeBench", "priority": 75}'
```

You'll see the task appear in the dashboard and events flow through the relay.

## Next Steps

- **Create Handlers**: [Creating Handlers Guide](creating-handlers)
- **MCP Integration**: [MCP Integration Guide](mcp-integration)
- **Advanced Configuration**: [Configuration Guide](configuration)

## Troubleshooting

### Common Issues

**Port 3000/3001 already in use**:
```bash
# Check what's using the port
lsof -i :3000
# Kill the process or change the port in package.json
```

**Database connection error**:
```bash
# Ensure PostgreSQL is running
bun db:start
# Check container status
docker ps
```

**Redis connection error**:
```bash
# Start Redis (if not using Docker)
redis-server
# Or check if Redis is available
redis-cli ping
```

For detailed troubleshooting, see the [Debugging Guide](debugging).