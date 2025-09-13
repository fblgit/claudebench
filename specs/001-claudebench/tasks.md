# Tasks: ClaudeBench

**Input**: Design documents from `/specs/001-claudebench/`
**Prerequisites**: plan.md (required), research.md, data-model.md, contracts/

## Execution Flow (main)
```
1. Load plan.md from feature directory
   → If not found: ERROR "No implementation plan found"
   → Extract: tech stack, libraries, structure
2. Load optional design documents:
   → data-model.md: Extract entities → model tasks
   → contracts/: Each file → contract test task
   → research.md: Extract decisions → setup tasks
3. Generate tasks by category:
   → Setup: project init, dependencies, linting
   → Tests: contract tests, integration tests
   → Core: models, services, CLI commands
   → Integration: DB, middleware, logging
   → Polish: unit tests, performance, docs
4. Apply task rules:
   → Different files = mark [P] for parallel
   → Same file = sequential (no [P])
   → Tests before implementation (TDD)
5. Number tasks sequentially (T001, T002...)
6. Generate dependency graph
7. Create parallel execution examples
8. Validate task completeness:
   → All contracts have tests?
   → All entities have models?
   → All endpoints implemented?
9. Return: SUCCESS (tasks ready for execution)
```

## Format: `[ID] [P?] Description`
- **[P]**: Can run in parallel (different files, no dependencies)
- Include exact file paths in descriptions

## Path Conventions
- **Server**: `apps/server/src/`, `apps/server/tests/`
- **Web**: `apps/web/src/`, `apps/web/tests/`
- ClaudeBench uses web application structure per plan.md

## Phase 3.1: Setup
- [x] T001 Create Docker Compose configuration for Redis and PostgreSQL in apps/server/docker-compose.yml
- [x] T002 Add Redis and MCP SDK dependencies to apps/server/package.json
- [x] T003 [P] Add Zod and reflect-metadata dependencies to apps/server/package.json
- [x] T004 [P] Configure TypeScript for experimental decorators in apps/server/tsconfig.json
- [x] T005 [P] Create Prisma schema with Task and Instance models in apps/server/prisma/schema.prisma
- [x] T006 Initialize Redis connection module in apps/server/src/core/redis.ts
- [x] T007 Create environment configuration in apps/server/.env and apps/server/src/config.ts

## Phase 3.2: Tests First (TDD) ⚠️ MUST COMPLETE BEFORE 3.3
**CRITICAL: These tests MUST be written and MUST FAIL before ANY implementation**

### Contract Tests (from JSONRPC contract)
- [x] T008 [P] Contract test for task.create event in apps/server/tests/contract/task.create.test.ts
- [x] T009 [P] Contract test for task.update event in apps/server/tests/contract/task.update.test.ts
- [x] T010 [P] Contract test for task.assign event in apps/server/tests/contract/task.assign.test.ts
- [x] T011 [P] Contract test for task.complete event in apps/server/tests/contract/task.complete.test.ts
- [x] T012 [P] Contract test for hook.pre_tool event in apps/server/tests/contract/hook.pre_tool.test.ts
- [x] T013 [P] Contract test for hook.post_tool event in apps/server/tests/contract/hook.post_tool.test.ts
- [x] T014 [P] Contract test for hook.todo_write event in apps/server/tests/contract/hook.todo_write.test.ts
- [x] T015 [P] Contract test for system.health event in apps/server/tests/contract/system.health.test.ts
- [x] T016 [P] Contract test for system.register event in apps/server/tests/contract/system.register.test.ts
- [x] T017 [P] Contract test for system.heartbeat event in apps/server/tests/contract/system.heartbeat.test.ts
- [x] T018 [P] Contract test for system.get_state event in apps/server/tests/contract/system.get_state.test.ts

### Integration Tests (from quickstart scenarios)
- [x] T019 [P] Integration test for TodoWrite event capture flow in apps/server/tests/integration/todowrite.test.ts
- [x] T020 [P] Integration test for task queue assignment in apps/server/tests/integration/task-queue.test.ts
- [x] T021 [P] Integration test for pre-tool hook validation in apps/server/tests/integration/hook-validation.test.ts
- [x] T022 [P] Integration test for circuit breaker triggering in apps/server/tests/integration/circuit-breaker.test.ts
- [x] T023 [P] Integration test for multi-instance event distribution in apps/server/tests/integration/multi-instance.test.ts

## Phase 3.3: Core Implementation (ONLY after tests are failing)

### Core Infrastructure (~150 LOC)
- [x] T024 Create event bus with Redis Streams in apps/server/src/core/bus.ts
- [x] T025 Implement EventHandler decorator with metadata reflection in apps/server/src/core/decorator.ts
- [x] T026 Create handler registry and discovery system in apps/server/src/core/registry.ts
- [x] T027 Implement event context with Redis/Prisma access in apps/server/src/core/context.ts
- [x] T028 Create rate limiter with Redis sorted sets in apps/server/src/core/rate-limiter.ts
- [x] T029 Implement circuit breaker with Redis INCR in apps/server/src/core/circuit-breaker.ts

### Schemas - Your domain schemas must align with the contracts json file
- [x] T030 [P] Define task domain schemas in apps/server/src/schemas/task.schema.ts
- [x] T031 [P] Define hook domain schemas in apps/server/src/schemas/hook.schema.ts
- [x] T032 [P] Define system domain schemas in apps/server/src/schemas/system.schema.ts
- [x] T033 [P] Create common/shared schemas in apps/server/src/schemas/common.schema.ts

### Event Handlers Domains - Your implementation must align with the contract and schema
### Event Handlers - Task Domain
- [x] T034 [P] Implement TaskCreateHandler in apps/server/src/handlers/task/task.create.handler.ts
- [x] T035 [P] Implement TaskUpdateHandler in apps/server/src/handlers/task/task.update.handler.ts
- [x] T036 [P] Implement TaskAssignHandler in apps/server/src/handlers/task/task.assign.handler.ts
- [x] T037 [P] Implement TaskCompleteHandler in apps/server/src/handlers/task/task.complete.handler.ts

### Event Handlers - Hook Domain
- [x] T038 [P] Implement PreToolHookHandler in apps/server/src/handlers/hook/hook.pre_tool.handler.ts
- [x] T039 [P] Implement PostToolHookHandler in apps/server/src/handlers/hook/hook.post_tool.handler.ts
- [x] T040 [P] Implement UserPromptHookHandler in apps/server/src/handlers/hook/hook.user_prompt.handler.ts
- [x] T041 [P] Implement TodoWriteHookHandler in apps/server/src/handlers/hook/hook.todo_write.handler.ts

### Event Handlers - System Domain
- [x] T042 [P] Implement SystemHealthHandler in apps/server/src/handlers/system/system.health.handler.ts
- [x] T043 [P] Implement SystemRegisterHandler in apps/server/src/handlers/system/system.register.handler.ts
- [x] T044 [P] Implement SystemHeartbeatHandler in apps/server/src/handlers/system/system.heartbeat.handler.ts
- [x] T045 [P] Implement SystemGetStateHandler in apps/server/src/handlers/system/system.get_state.handler.ts
- [x] T046 [P] Implement SystemMetricsHandler in apps/server/src/handlers/system/system.metrics.handler.ts

### Checkpoint - All your contract schemas tests must be passing.

## Phase 3.4: Transport Integration

### HTTP Server (Hono)
- [x] T047 Create JSONRPC request handler in apps/server/src/transports/http.ts
- [x] T048 Set up Hono server with CORS and logging in apps/server/src/server.ts
- [x] T049 Auto-generate HTTP routes from handler registry in apps/server/src/transports/http-routes.ts

### Checkpoint - 245 Passed Tests & 9 Failing (advanced features)

### MCP Server
- [ ] T050 Initialize MCP server with Streamable HTTP transport in apps/server/src/mcp/server.ts
- [ ] T051 Auto-generate MCP tools from handler registry in apps/server/src/mcp/tools.ts
- [ ] T052 Implement MCP session management in apps/server/src/mcp/session.ts

### WebSocket/SSE
- [ ] T053 [P] Create WebSocket event subscription handler in apps/server/src/transports/websocket.ts
- [ ] T054 [P] Implement SSE event streaming in apps/server/src/transports/sse.ts

### Checkpoint - A vast part of the integration tests must be passing

## Phase 3.5: Dashboard UI

### Setup
- [ ] T055 [P] Configure TanStack Router in apps/web/src/router.tsx
- [ ] T056 [P] Create event client service in apps/web/src/services/event-client.ts
- [ ] T057 [P] Set up TanStack Query for server state in apps/web/src/services/query-client.ts

### Components
- [ ] T058 [P] Create event stream viewer component in apps/web/src/components/EventStream.tsx
- [ ] T059 [P] Build task queue display in apps/web/src/components/TaskQueue.tsx
- [ ] T060 [P] Create instance health monitor in apps/web/src/components/InstanceHealth.tsx
- [ ] T061 [P] Build metrics dashboard in apps/web/src/components/Metrics.tsx
- [ ] T062 [P] Create handler manager UI in apps/web/src/components/HandlerManager.tsx

### Routes
- [ ] T063 Create dashboard home route in apps/web/src/routes/index.tsx
- [x] T064 [P] Create events route in apps/web/src/routes/events.tsx
- [x] T065 [P] Create tasks route in apps/web/src/routes/tasks.tsx
- [x] T066 [P] Create system route in apps/web/src/routes/system.tsx

## Phase 3.6: CLI Tools
- [ ] T067 Create CLI entry point in apps/server/src/cli/index.ts
- [ ] T068 [P] Implement events:watch command in apps/server/src/cli/events.ts
- [ ] T069 [P] Implement tasks:list command in apps/server/src/cli/tasks.ts
- [ ] T070 [P] Implement handlers:list command in apps/server/src/cli/handlers.ts
- [ ] T071 [P] Implement metrics command in apps/server/src/cli/metrics.ts

## Phase 3.7: Polish & Documentation
- [ ] T072 [P] Add unit tests for decorator metadata in apps/server/tests/unit/decorator.test.ts
- [ ] T073 [P] Add unit tests for rate limiter logic in apps/server/tests/unit/rate-limiter.test.ts
- [ ] T074 [P] Add unit tests for circuit breaker in apps/server/tests/unit/circuit-breaker.test.ts
- [ ] T075 Performance test: Verify <50ms event latency
- [ ] T076 Performance test: Verify <100MB memory usage
- [ ] T077 [P] Generate API documentation from decorators in docs/api.md
- [ ] T078 [P] Create architecture diagram in docs/architecture.md
- [ ] T079 Run quickstart.md validation tests
- [ ] T080 Final cleanup: Remove code duplication, optimize imports

## Dependencies
- Setup (T001-T007) must complete first
- Tests (T008-T023) MUST complete before implementation (T024-T046)
- Core infrastructure (T024-T029) blocks handlers (T034-T046)
- Schemas (T030-T033) must exist before handlers
- Handlers must exist before transport integration (T047-T054)
- Server must work before dashboard (T055-T066)
- Everything before polish (T072-T080)

## Parallel Execution Examples

### Setup Phase
```bash
# Launch T003-T005 together (different files):
Task: "Add Zod and reflect-metadata dependencies to apps/server/package.json"
Task: "Configure TypeScript for experimental decorators in apps/server/tsconfig.json"
Task: "Create Prisma schema with Task and Instance models in apps/server/prisma/schema.prisma"
```

### Contract Tests Phase
```bash
# Launch T008-T018 together (all contract tests, different files):
Task: "Contract test for task.create event in apps/server/tests/contract/task.create.test.ts"
Task: "Contract test for task.update event in apps/server/tests/contract/task.update.test.ts"
Task: "Contract test for task.assign event in apps/server/tests/contract/task.assign.test.ts"
# ... continue for all contract tests
```

### Handlers Phase
```bash
# Launch T034-T046 together (all handlers, different files):
Task: "Implement TaskCreateHandler in apps/server/src/handlers/task/task.create.handler.ts"
Task: "Implement TaskUpdateHandler in apps/server/src/handlers/task/task.update.handler.ts"
# ... continue for all handlers
```

### Dashboard Components Phase
```bash
# Launch T058-T062 together (all components, different files):
Task: "Create event stream viewer component in apps/web/src/components/EventStream.tsx"
Task: "Build task queue display in apps/web/src/components/TaskQueue.tsx"
# ... continue for all components
```

## Notes
- **Critical**: Tests MUST fail before implementation (TDD)
- [P] tasks can run simultaneously as they modify different files
- Commit after each task completion
- Use real Redis and PostgreSQL for all tests
- Total estimated LOC: ~500 (per architecture target)

## Validation Checklist
*GATE: Checked by main() before returning*

- [x] All contracts have corresponding tests (T008-T018)
- [x] All entities have model/handler tasks (Event→handlers, Task→T034-T037, Instance→T043-T044)
- [x] All tests come before implementation (Phase 3.2 before 3.3)
- [x] Parallel tasks truly independent (different files)
- [x] Each task specifies exact file path
- [x] No task modifies same file as another [P] task in same phase
