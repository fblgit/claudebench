# Implementation Plan: ClaudeBench

**Branch**: `001-claudebench` | **Date**: 2025-09-10 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-claudebench/spec.md`

## Execution Flow (/plan command scope)
```
1. Load feature spec from Input path
   → If not found: ERROR "No feature spec at {path}"
2. Fill Technical Context (scan for NEEDS CLARIFICATION)
   → Detect Project Type from context (web=frontend+backend, mobile=app+api)
   → Set Structure Decision based on project type
3. Evaluate Constitution Check section below
   → If violations exist: Document in Complexity Tracking
   → If no justification possible: ERROR "Simplify approach first"
   → Update Progress Tracking: Initial Constitution Check
4. Execute Phase 0 → research.md
   → If NEEDS CLARIFICATION remain: ERROR "Resolve unknowns"
5. Execute Phase 1 → contracts, data-model.md, quickstart.md, agent-specific template file (e.g., `CLAUDE.md` for Claude Code, `.github/copilot-instructions.md` for GitHub Copilot, or `GEMINI.md` for Gemini CLI).
6. Re-evaluate Constitution Check section
   → If new violations: Refactor design, return to Phase 1
   → Update Progress Tracking: Post-Design Constitution Check
7. Plan Phase 2 → Describe task generation approach (DO NOT create tasks.md)
8. STOP - Ready for /tasks command
```

**IMPORTANT**: The /plan command STOPS at step 7. Phases 2-4 are executed by other commands:
- Phase 2: /tasks command creates tasks.md
- Phase 3-4: Implementation execution (manual or via tools)

## Summary
ClaudeBench is a Redis-first event-driven orchestration system that enables developers to customize their Claude Code AI coding sessions through lightweight event handlers, hooks, and workflows. The system follows a decorator pattern where a single handler definition auto-generates HTTP endpoints, MCP tools, and event subscriptions, dramatically reducing code complexity from 5000+ LOC to ~500 LOC while maintaining enterprise features like circuit breakers, rate limiting, and task orchestration.

## Technical Context
**Language/Version**: TypeScript/Bun 1.x  
**Primary Dependencies**: Redis, MCP SDK, Zod, Prisma ORM, Hono  
**Storage**: Redis (hot path) + PostgreSQL via Prisma (cold path)  
**Testing**: Bun test framework with real Redis/PostgreSQL  
**Target Platform**: Localhost development environment (Docker Compose)  
**Project Type**: web (backend server + frontend dashboard)  
**Performance Goals**: 1 event/3s typical, burst 3 events/10s, <50ms latency  
**Constraints**: <100MB memory, localhost-only, single developer  
**Scale/Scope**: ~500 LOC target, 15-20 handlers, 3-5 event domains

## Constitution Check
*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Simplicity**:
- Projects: 2 (server + web dashboard) ✅ (max 3)
- Using framework directly? YES - Direct Hono, Redis, Prisma calls ✅
- Single data model? YES - Event-driven, no DTOs ✅
- Avoiding patterns? YES - No factories, repositories, managers ✅

**Architecture**:
- EVERY feature as library? Handlers as modules, decorator-driven ✅
- Libraries listed: 
  - `@claudebench/core` - Event bus, decorators, registry
  - `@claudebench/handlers` - Event handler implementations
  - `@claudebench/mcp` - MCP server integration
- CLI per library: Event emitter CLI planned ✅
- Library docs: Will generate from decorators ✅

**Testing (NON-NEGOTIABLE)**:
- RED-GREEN-Refactor cycle enforced? YES ✅
- Git commits show tests before implementation? YES ✅
- Order: Contract→Integration→E2E→Unit strictly followed? YES ✅
- Real dependencies used? YES - Real Redis, PostgreSQL ✅
- Integration tests for: new libraries, contract changes, shared schemas? YES ✅
- FORBIDDEN: Implementation before test, skipping RED phase ✅

**Observability**:
- Structured logging included? YES - Event stream is observable ✅
- Frontend logs → backend? YES - Via event emission ✅
- Error context sufficient? YES - Full event context ✅

**Versioning**:
- Version number assigned? 0.1.0 ✅
- BUILD increments on every change? YES ✅
- Breaking changes handled? Forward-only evolution ✅

## Project Structure

### Documentation (this feature)
```
specs/001-claudebench/
├── plan.md              # This file (/plan command output)
├── research.md          # Phase 0 output (/plan command)
├── data-model.md        # Phase 1 output (/plan command)
├── quickstart.md        # Phase 1 output (/plan command)
├── contracts/           # Phase 1 output (/plan command)
└── tasks.md             # Phase 2 output (/tasks command - NOT created by /plan)
```

### Source Code (repository root)
```
# Option 2: Web application (ClaudeBench has backend server + web dashboard)
apps/server/
├── src/
│   ├── core/           # Event bus, decorators, registry (~150 LOC)
│   │   ├── bus.ts      # Redis pub/sub wrapper
│   │   ├── decorator.ts # @EventHandler decorator
│   │   └── registry.ts  # Handler discovery
│   ├── handlers/       # Event handlers (~300 LOC)
│   │   ├── task/       # Task domain handlers
│   │   ├── hook/       # Hook domain handlers
│   │   └── system/     # System domain handlers
│   ├── schemas/        # Zod validation schemas (~50 LOC)
│   └── mcp/           # MCP server setup
└── tests/
    ├── contract/       # JSONRPC contract tests
    ├── integration/    # Redis/Prisma integration
    └── e2e/           # Full flow tests

apps/web/
├── src/
│   ├── components/     # React components
│   ├── routes/        # TanStack Router pages
│   └── services/      # Event client
└── tests/
```

**Structure Decision**: Option 2 - Web application (backend server + frontend dashboard)

## Phase 0: Outline & Research
1. **Extract unknowns from Technical Context**:
   - Redis pub/sub patterns for TypeScript/Bun
   - MCP SDK Streamable HTTP transport implementation
   - Decorator metadata reflection in TypeScript
   - Zod schema to OpenAPI generation
   - Redis Streams vs pub/sub for event sourcing
   - Circuit breaker implementation with Redis
   - Rate limiting with Redis sliding windows

2. **Generate and dispatch research agents**:
   ```
   Task: "Research Redis pub/sub patterns for event-driven TypeScript"
   Task: "Find best practices for MCP Streamable HTTP server"
   Task: "Research TypeScript decorator metadata for auto-generation"
   Task: "Evaluate Zod to OpenAPI schema generation approaches"
   Task: "Compare Redis Streams vs pub/sub for localhost event bus"
   Task: "Research simple circuit breaker with Redis INCR"
   Task: "Find Redis rate limiting patterns for single-user"
   ```

3. **Consolidate findings** in `research.md`

**Output**: research.md with all technical decisions documented

## Phase 1: Design & Contracts
*Prerequisites: research.md complete*

1. **Extract entities from feature spec** → `data-model.md`:
   - Event: type, payload, metadata, timestamp
   - Task: id, text, status, priority, assignedTo
   - Instance: id, roles[], health, lastSeen
   - Handler: event, inputSchema, outputSchema, config
   - Session: Optional metadata in JSONRPC

2. **Generate API contracts** from functional requirements:
   - JSONRPC 2.0 contract for all event types
   - HTTP endpoints auto-generated from handlers
   - MCP tool definitions from handlers
   - WebSocket/SSE for event subscriptions

3. **Generate contract tests** from contracts:
   - One test per event type (task.create, hook.pre_tool, etc.)
   - Schema validation tests
   - Transport consistency tests

4. **Extract test scenarios** from user stories:
   - TodoWrite event capture and processing
   - Task queue assignment flow
   - Pre-tool hook validation
   - Circuit breaker triggering
   - Multi-instance event distribution

5. **Update CLAUDE.md incrementally**:
   - Add ClaudeBench architecture overview
   - Document decorator pattern
   - Event naming conventions
   - Redis key patterns

**Output**: data-model.md, /contracts/*, failing tests, quickstart.md, CLAUDE.md

## Phase 2: Task Planning Approach
*This section describes what the /tasks command will do - DO NOT execute during /plan*

**Task Generation Strategy**:
- Load `/templates/tasks-template.md` as base
- Generate tasks from Phase 1 design docs (contracts, data model, quickstart)
- Each event type → handler implementation task
- Each domain → schema definition task
- Core infrastructure tasks (bus, decorator, registry)
- Transport setup tasks (HTTP, MCP, WebSocket)
- Docker Compose configuration task

**Ordering Strategy**:
- Docker/Redis setup first
- Core infrastructure (bus, decorator, registry)
- Schemas and validation
- Event handlers by domain
- Transport layers
- Integration tests
- Dashboard UI

**Estimated Output**: 30-35 numbered, ordered tasks in tasks.md

**IMPORTANT**: This phase is executed by the /tasks command, NOT by /plan

## Phase 3+: Future Implementation
*These phases are beyond the scope of the /plan command*

**Phase 3**: Task execution (/tasks command creates tasks.md)  
**Phase 4**: Implementation (execute tasks.md following constitutional principles)  
**Phase 5**: Validation (run tests, execute quickstart.md, performance validation)

## Complexity Tracking
*No violations - ClaudeBench aligns with constitutional principles*

## Progress Tracking
*This checklist is updated during execution flow*

**Phase Status**:
- [x] Phase 0: Research complete (/plan command)
- [x] Phase 1: Design complete (/plan command)
- [x] Phase 2: Task planning complete (/plan command - describe approach only)
- [ ] Phase 3: Tasks generated (/tasks command)
- [ ] Phase 4: Implementation complete
- [ ] Phase 5: Validation passed

**Gate Status**:
- [x] Initial Constitution Check: PASS
- [x] Post-Design Constitution Check: PASS
- [x] All NEEDS CLARIFICATION resolved
- [x] Complexity deviations documented (none)

---
*Based on Constitution v1.0.0 - See `/memory/constitution.md`*