# claudebench

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
- `bun check-types`: Check TypeScript types across all apps
- `bun db:push` `bun db:generate`: Prisma commands 
- `bun check`: Run Biome formatting and linting
- `bun relay`: Run the Claudebench event relay 

@CLAUDEBENCH.md
@specs/001-claudebench/spec.md

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
- docs/FRONTEND_SERVICES.md (For Frontend services and related frontend tasks)

Be sure to always have visited and readed these documents when working in any task.
