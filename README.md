# claudebench

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Router, Hono, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Router** - File-based routing with full type safety
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **shadcn/ui** - Reusable UI components
- **Hono** - Lightweight, performant server framework
- **Bun** - Runtime environment
- **Prisma** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Biome** - Linting and formatting
- **Husky** - Git hooks for code quality
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```
## Database Setup

This project uses PostgreSQL with Prisma.

1. Make sure you have a PostgreSQL database set up.
2. Update your `apps/server/.env` file with your PostgreSQL connection details.

3. Generate the Prisma client and push the schema:
```bash
bun db:push
```


Then, run the development server:

```bash
bun dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3000](http://localhost:3000).





## Project Structure

```
claudebench/
├── apps/
│   ├── web/         # Frontend application (React + TanStack Router)
│   └── server/      # Backend API (Hono)
```

## Available Scripts

- `bun dev`: Start all applications in development mode
- `bun build`: Build all applications
- `bun dev:web`: Start only the web application
- `bun dev:server`: Start only the server
- `bun check-types`: Check TypeScript types across all apps
- `bun db:push`: Push schema changes to database
- `bun db:studio`: Open database studio UI
- `bun check`: Run Biome formatting and linting

@specs/001-claudebench/spec.md
@specs/001-claudebench/data-model.md
@specs/001-claudebench/quickstart.md

# **IMPORTANT CRUCIAL READINGS**: Read these always when u start a conversation or after compaction / resuming:
- CLAUDEBENCH.md (What is ClaudeBench and how it Works)
- specs/001-claudebench/spec.md (Specifications of ClaudeBench)
- specs/001-claudebench/research.md (Research)
- specs/001-claudebench/plan.md (Roadmap Plan)
- specs/001-claudebench/quickstart.md (Behaviour and usage)

## Read these when the scenario requires it (coding tasks):
- specs/001-claudebench/data-model.md (Data Modeling FUNDAMENTAL ADHERENCE)
- specs/001-claudebench/contracts/jsonrpc-contract.json (FULL ADHERENCE)
- specs/001-claudebench/CONTRACT-DRIVEN-DEVELOPMENT.md
- specs/001-claudebench/contracts/hook-transport-contract.json (FULL ADHERENCE)
- CLAUDE_CODE_GUIDE.md (Claude Code with ClaudeBench)
- specs/001-claudebench/contracts/claudecode-contract.json (FULL ADHERENCE)
- MCP_SDK.md (When working with MCP)
- src/core/decorator.ts (Our decorator-FIRST approach: metrics, audit log, cache, rate limit, circuit breaker)
- docs/HOWTO_INSTRUMENTED_RESILIENT.md (How to use the Decorators)

Be sure to always have visited and readed these documents when working in any task.
