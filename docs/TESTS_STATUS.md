# ClaudeBench Tests Status

## Overview
This document tracks the status of all tests in the ClaudeBench project, their dependencies, and when they should pass according to the implementation phases defined in `specs/001-claudebench/tasks.md`.

## Test Execution Status

### Contract Tests (Phase 3.2 - TDD)
These tests MUST be written first and MUST FAIL before implementation begins.

| Test File | Task ID | Domain | Status | Prerequisites | Should Pass After | Notes |
|-----------|---------|--------|--------|---------------|-------------------|-------|
| ☐ `task.create.test.ts` | T008 | Task | ❓ | T001-T007 (Setup) | T034 (TaskCreateHandler) | Tests task creation event |
| ☐ `task.update.test.ts` | T009 | Task | ❓ | T001-T007 (Setup) | T035 (TaskUpdateHandler) | Tests task update event |
| ☐ `task.assign.test.ts` | T010 | Task | ❓ | T001-T007 (Setup) | T036 (TaskAssignHandler) | Tests task assignment |
| ☐ `task.complete.test.ts` | T011 | Task | ❓ | T001-T007 (Setup) | T037 (TaskCompleteHandler) | Tests task completion |
| ☐ `hook.pre_tool.test.ts` | T012 | Hook | ❓ | T001-T007 (Setup) | T038 (PreToolHookHandler) | Tests pre-tool hook |
| ☐ `hook.post_tool.test.ts` | T013 | Hook | ❓ | T001-T007 (Setup) | T039 (PostToolHookHandler) | Tests post-tool hook |
| ☐ `hook.todo_write.test.ts` | T014 | Hook | ❓ | T001-T007 (Setup) | T041 (TodoWriteHookHandler) | Tests TodoWrite hook |
| ☐ `system.health.test.ts` | T015 | System | ❓ | T001-T007 (Setup) | T042 (SystemHealthHandler) | Tests health check |
| ☐ `system.register.test.ts` | T016 | System | ❓ | T001-T007 (Setup) | T043 (SystemRegisterHandler) | Tests instance registration |
| ☐ `system.heartbeat.test.ts` | T017 | System | ❓ | T001-T007 (Setup) | T044 (SystemHeartbeatHandler) | Tests heartbeat |
| ☐ `system.get_state.test.ts` | T018 | System | ❓ | T001-T007 (Setup) | T045 (SystemGetStateHandler) | Tests state retrieval |

### Integration Tests (Phase 3.2)
These test end-to-end scenarios and event flows.

| Test File | Task ID | Scenario | Status | Prerequisites | Should Pass After | Notes |
|-----------|---------|----------|--------|---------------|-------------------|-------|
| ☐ `todowrite.test.ts` | T019 | TodoWrite Flow | ❓ | T001-T007 + Core (T024-T029) | T041 (TodoWriteHookHandler) | Tests TodoWrite event capture |
| ☐ `task-queue.test.ts` | T020 | Task Queue | ❓ | T001-T007 + Core (T024-T029) | T036 (TaskAssignHandler) | Tests queue assignment |
| ☐ `hook-validation.test.ts` | T021 | Hook Validation | ❓ | T001-T007 + Core (T024-T029) | T038 (PreToolHookHandler) | Tests pre-tool validation |
| ☐ `circuit-breaker.test.ts` | T022 | Circuit Breaker | ❓ | T001-T007 + T029 | T029 (circuit-breaker.ts) | Tests failure handling |
| ☐ `multi-instance.test.ts` | T023 | Multi-Instance | ❓ | T001-T007 + Core (T024-T029) | T043-T044 (Register/Heartbeat) | Tests event distribution |

## Dependency Phases

### Phase Dependencies
```
Phase 3.1 (Setup: T001-T007) 
    ↓
Phase 3.2 (Tests: T008-T023) - MUST FAIL FIRST
    ↓
Phase 3.3 (Core: T024-T029) - Core Infrastructure
    ↓
Phase 3.3 (Schemas: T030-T033) - Domain Schemas
    ↓
Phase 3.3 (Handlers: T034-T046) - Event Handlers
    ↓
Phase 3.4 (Transport: T047-T054) - HTTP/MCP/WebSocket
    ↓
Phase 3.5 (Dashboard: T055-T066) - Web UI
    ↓
Phase 3.6 (CLI: T067-T071) - CLI Tools
    ↓
Phase 3.7 (Polish: T072-T080) - Unit Tests & Docs
```

### Platform Dependencies

| Component | Required For | Status | Notes |
|-----------|--------------|--------|-------|
| Redis | All tests (T008+) | ❓ | Docker Compose (T001) |
| PostgreSQL | Persistence tests | ❓ | Docker Compose (T001) |
| Prisma Client | Data models | ❓ | Schema (T005) + Generate |
| TypeScript Decorators | EventHandler | ❓ | tsconfig.json (T004) |
| Zod | Validation | ❓ | Package.json (T003) |
| MCP SDK | MCP Server | ❓ | Package.json (T002) |

## Core Infrastructure Status

| Component | Task ID | File | Status | Required By Tests | Notes |
|-----------|---------|------|--------|-------------------|-------|
| Event Bus | T024 | `core/bus.ts` | ✅ | All tests | Redis Streams |
| EventHandler Decorator | T025 | `core/decorator.ts` | ✅ | All handler tests | Metadata reflection |
| Handler Registry | T026 | `core/registry.ts` | ✅ | All handler tests | Discovery system |
| Event Context | T027 | `core/context.ts` | ✅ | All handler tests | Redis/Prisma access |
| Rate Limiter | T028 | `core/rate-limiter.ts` | ✅ | Integration tests | Redis sorted sets |
| Circuit Breaker | T029 | `core/circuit-breaker.ts` | ✅ | T022 test | Redis INCR |

## Handler Implementation Status

| Handler | Task ID | Event | Contract Test | Status | Notes |
|---------|---------|-------|---------------|--------|-------|
| TaskCreateHandler | T034 | `task.create` | T008 | ✅ | Needs fixing |
| TaskUpdateHandler | T035 | `task.update` | T009 | ✅ | |
| TaskAssignHandler | T036 | `task.assign` | T010 | ✅ | |
| TaskCompleteHandler | T037 | `task.complete` | T011 | ✅ | Minor Redis issue |
| PreToolHookHandler | T038 | `hook.pre_tool` | T012 | ✅ | |
| PostToolHookHandler | T039 | `hook.post_tool` | T013 | ✅ | |
| UserPromptHookHandler | T040 | `hook.user_prompt` | - | ✅ | No contract test |
| TodoWriteHookHandler | T041 | `hook.todo_write` | T014 | ✅ | |
| SystemHealthHandler | T042 | `system.health` | T015 | ✅ | |
| SystemRegisterHandler | T043 | `system.register` | T016 | ✅ | |
| SystemHeartbeatHandler | T044 | `system.heartbeat` | T017 | ✅ | |
| SystemGetStateHandler | T045 | `system.get_state` | T018 | ✅ | |
| SystemMetricsHandler | T046 | `system.metrics` | - | ✅ | No contract test |

## Test Execution Commands

```bash
# Run all tests
cd apps/server && bun test

# Run contract tests only
cd apps/server && bun test tests/contract/

# Run integration tests only  
cd apps/server && bun test tests/integration/

# Run specific test file
cd apps/server && bun test tests/contract/task.create.test.ts

# Watch mode
cd apps/server && bun test --watch
```

## Current Status Summary

Based on commit `2758bbc` (T037 Checkpoint):
- **Passing**: 94 tests
- **Failing**: 270 tests
- **Total**: 364 tests

### Key Issues to Address
1. Redis connection/configuration issues
2. Handler registration and discovery
3. Event bus subscription setup
4. JSONRPC request/response format validation
5. Schema validation mismatches

## Legend

- ☐ Test not passing
- ☑ Test passing
- ❓ Status unknown/needs verification
- ✅ Implementation complete (may need fixes)
- ❌ Not implemented
- 🚧 In progress

## Notes

1. **TDD Requirement**: All contract tests (T008-T018) must be written and failing before implementing handlers (T034-T046)
2. **Parallel Execution**: Tests marked [P] in tasks.md can run in parallel as they modify different files
3. **Integration Tests**: Require core infrastructure (T024-T029) to be implemented first
4. **Transport Layer**: Tests for HTTP/MCP/WebSocket will be added in Phase 3.4 (T047-T054)