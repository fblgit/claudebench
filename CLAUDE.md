# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClaudeBench is a modern TypeScript monorepo implementing a Redis-first event-driven architecture. The project uses Turborepo for orchestration, Bun as runtime, and follows a clean separation between backend (Hono) and frontend (React + TanStack Router).

## Critical Commands

### Development
```bash
bun dev                  # Start all apps (server on :3000, web on :3001)
bun dev:server          # Start only server (hot reload)
bun dev:web             # Start only web app
```

### Database Operations
```bash
bun db:start            # Start PostgreSQL via Docker Compose
bun db:push             # Push Prisma schema to database
bun db:generate         # Generate Prisma client
bun db:migrate          # Run database migrations
bun db:studio           # Open Prisma Studio GUI
bun db:stop             # Stop PostgreSQL container
bun db:down             # Remove PostgreSQL container
```

### Build & Type Checking
```bash
bun build               # Build all apps
bun check-types         # TypeScript validation across monorepo
bun check               # Run OxLint on all code
```

## Architecture Context

### ClaudeBench v2.0 Design (from CLAUDEBENCH.md)

The system is designed to evolve from 5000+ LOC enterprise patterns to a 500 LOC Redis-first architecture:

**Core Principles:**
1. **Redis as Infrastructure**: Direct use of Redis primitives (pub/sub, streams, sorted sets)
2. **Decorator Pattern**: Single handler generates HTTP, MCP, and event interfaces
3. **Explicit Persistence**: Handlers choose when to persist to PostgreSQL
4. **Forward-Only Evolution**: Replace events instead of versioning
5. **Flat Event Hierarchy**: `domain.action` pattern (e.g., `task.create`)

**Event Flow:**
- JSONRPC 2.0 protocol for all communication
- Redis pub/sub for event distribution
- Optional PostgreSQL persistence per handler
- Zod runtime validation at boundaries

**Target Structure (500 LOC):**
```
/src
  /core (150 LOC)         # Redis bus, registry, server setup
  /handlers (300 LOC)     # Business logic with decorator pattern
  /schemas (50 LOC)       # Zod validation schemas
```

### Current Boilerplate Structure

```
claudebench/
├── apps/
│   ├── server/         # Hono backend
│   │   ├── src/
│   │   │   ├── db/     # Prisma client
│   │   │   ├── routers/# API routes (currently empty)
│   │   │   └── index.ts# Server entry
│   │   ├── prisma/
│   │   │   └── schema/ # Database schema
│   │   └── docker-compose.yml
│   └── web/            # React frontend
│       └── src/
│           ├── components/ui/  # shadcn components
│           ├── routes/         # TanStack Router pages
│           └── main.tsx        # App entry
├── memory/             # Constitution docs
├── scripts/            # Build scripts
└── templates/          # Project templates
```

## Technical Stack Details

### Backend (apps/server)
- **Runtime**: Bun with hot reload (`--hot`)
- **Framework**: Hono with CORS and logger middleware
- **Database**: PostgreSQL via Docker + Prisma ORM
- **Prisma Config**: Custom output to `generated/` with ESM format
- **Build**: tsdown for compilation, optional Bun compile for binary

### Frontend (apps/web)
- **Framework**: React 19 with TanStack Router
- **Routing**: File-based with type-safe navigation
- **Styling**: TailwindCSS v4 (via Vite plugin) + shadcn/ui
- **State**: TanStack Query for server state
- **Build**: Vite with React plugin

### Tooling
- **Monorepo**: Turborepo with task orchestration
- **Package Manager**: Bun workspaces
- **Formatting**: Biome with tab indentation, double quotes
- **Linting**: OxLint + Biome rules
- **Git Hooks**: Husky with lint-staged

## Key Configuration Files

- `turbo.json`: Task pipeline configuration
- `biome.json`: Formatting rules (tabs, double quotes)
- `.oxlintrc.json`: Additional linting rules
- `apps/server/prisma.config.ts`: Prisma schema location
- `apps/*/tsconfig.json`: TypeScript configs with path aliases (`@/*`)

## Environment Variables

Server requires (`.env` in apps/server):
- `DATABASE_URL`: PostgreSQL connection string
- `CORS_ORIGIN`: Allowed origins for CORS
- `BETTER_AUTH_SECRET`: Auth secret (if using Better Auth)
- `BETTER_AUTH_URL`: Auth URL (if using Better Auth)

## Implementation Notes

When implementing the ClaudeBench architecture:
1. Redis must be added as a dependency and infrastructure
2. The decorator pattern should auto-generate transport interfaces
3. Handlers should explicitly call Prisma when persistence is needed
4. Use Zod for all runtime validation
5. Follow `domain.action` event naming (e.g., `task.create`, `hook.pre_tool`)
6. Redis keys should follow `cb:{type}:{id}` pattern

## ClaudeBench Event Handler Pattern

### Creating Event Handlers
Use the `@EventHandler` decorator to auto-generate all transport interfaces:

```typescript
import { EventHandler } from '@/core/decorator';
import { z } from 'zod';

@EventHandler({
  event: 'domain.action',           // Event type (flat hierarchy)
  inputSchema: z.object({ ... }),   // Zod validation
  outputSchema: z.object({ ... }),  // Response validation
  persist: false,                   // Explicit persistence flag
  roles: ['worker'],               // Optional role requirements
  rateLimit: 100                   // Events/sec (default 100)
})
export class DomainActionHandler {
  async handle(input: InputType, context: EventContext) {
    // Direct Redis/Prisma calls - no wrappers
    await this.redis.hset(`cb:entity:${id}`, data);
    
    // Explicit persistence when needed
    if (this.persist) {
      await this.prisma.entity.create({ data });
    }
    
    return output; // Validated by outputSchema
  }
}
```

This single decorator creates:
- HTTP endpoint: `POST /domain/action`
- MCP tool: `domain__action`
- Event subscription: `domain.action`

### Event Naming Conventions
- Always use `domain.action` format
- Domains: `task`, `hook`, `system`, `mcp`
- Actions: `create`, `update`, `complete`, `pre_tool`, `health`
- Examples: `task.create`, `hook.pre_tool`, `system.health`

### Redis Key Patterns
All keys follow `cb:{type}:{id}`:
- `cb:stream:task.create` - Event streams
- `cb:task:t-123` - Task data
- `cb:queue:tasks` - Task queue
- `cb:instance:worker-1` - Instance registry
- `cb:circuit:handler` - Circuit breaker state

### Testing Approach
Follow RED-GREEN-Refactor strictly:
1. Write failing contract test first
2. Implement handler to pass test
3. Add integration tests for Redis/Prisma
4. E2E test through event emission

### Recent Changes (2025-09-10)
- Switched from SSE to Streamable HTTP transport for MCP
- Added support for multiple concurrent Claude Code instances
- Implemented sliding window rate limiting with Redis sorted sets
- Chose Redis Streams over pub/sub for event persistence

## MCP SDK Reference

The MCP_SDK.md file contains the TypeScript SDK documentation for implementing MCP (Model Context Protocol) servers, which will be crucial for the ClaudeBench event-driven architecture.
- Modifying the existing file is a better practice - it preserves the import paths, maintains git history, and follows the principle of evolving code rather than replacing it. This approach also ensures that any existing references continue to work.