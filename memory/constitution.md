# ClaudeBench Constitution
<!-- Example: Spec Constitution, TaskFlow Constitution, etc. -->

## Core Principles

### I. Event Democracy
<!-- Example: I. Library-First -->
Every interaction is an event. All actors (system, user, tools) are equal citizens with identical access to events. No privileged paths, no special APIs, no class distinctions. If the system needs task.list, users get the exact same task.list with identical types, validation, and behavior. One event, one handler, one truth.
<!-- Example: Every feature starts as a standalone library; Libraries must be self-contained, independently testable, documented; Clear purpose required - no organizational-only libraries -->

### II. Localhost Reality
<!-- Example: II. CLI Interface -->
This system runs on localhost for a single user. Reject distributed systems complexity, multi-tenancy abstractions, and enterprise theater. Maximum 3 events/second is reality. Sequential FIFO processing is correct. Your keyboard is the authentication. Your machine is the boundary. Design for what IS, not imaginary scale.
<!-- Example: Every library exposes functionality via CLI; Text in/out protocol: stdin/args → stdout, errors → stderr; Support JSON + human-readable formats -->

### III. Universal Event Lifecycle
<!-- Example: III. Test-First (NON-NEGOTIABLE) -->
Every event supports the complete lifecycle: send, receive, store, observe, aware, react. Any actor can emit events, observe events, and react to events. Events are the API, the contract, and the documentation. No hidden internals - everything observable, everything debuggable through the event stream.
<!-- Example: TDD mandatory: Tests written → User approved → Tests fail → Then implement; Red-Green-Refactor cycle strictly enforced -->

### IV. Type Uniformity
<!-- Example: IV. Integration Testing -->
One schema per event type, enforced everywhere. Zod validation at boundaries ensures type safety. No divergent schemas between transports. HTTP, MCP, and internal events share identical types. Type errors caught at validation, not runtime. If it validates, it works everywhere.
<!-- Example: Focus areas requiring integration tests: New library contract tests, Contract changes, Inter-service communication, Shared schemas -->

### V. Pragmatic Testing
<!-- Example: V. Observability, VI. Versioning & Breaking Changes, VII. Simplicity -->
Three good tests beat thirty-seven test suites. Test what matters: E2E (does it work?), Integration (does it connect?), Unit (edge cases). Happy path 5:1 error path ratio. Test actual problems (wrong file edits, bad signatures) not imaginary ones (race conditions on localhost).
<!-- Example: Text I/O ensures debuggability; Structured logging required; Or: MAJOR.MINOR.BUILD format; Or: Start simple, YAGNI principles -->

## Complexity Boundaries
<!-- Example: Additional Constraints, Security Requirements, Performance Standards, etc. -->

**Explicitly Forbidden**: Enterprise patterns on localhost (no sagas, circuit breakers, distributed transactions for single-user tools); Premature abstractions (no factories, managers, adapters until proven necessary); Version complexity (forward-only evolution through event replacement); Privileged access (no internal vs external APIs); Phantom problems (no solving for multi-tenancy on single keyboard).

**Explicitly Required**: Event handler simplicity (readable in one screen, <50 lines); Decorator unification (one decorator generates all transport interfaces); Direct dependencies (call Redis/Prisma directly, no wrappers); Explicit persistence (handlers choose what to persist); Observable operations (all operations emit events).
<!-- Example: Technology stack requirements, compliance standards, deployment policies, etc. -->

## Development Workflow
<!-- Example: Development Workflow, Review Process, Quality Gates, etc. -->

**Event-First Development**: Define event type and schemas → Implement single handler with decorator → All transports automatically supported → Test through event emission → Observe events to verify behavior.

**Simplicity Checkpoint**: Before adding any abstraction, document: What actual problem occurred 3+ times? Why can't existing events solve it? How does this serve the single localhost user? Can it be done in <50 lines? If any answer is unclear, abstraction is rejected.

**Performance Reality Check**: Measure actual localhost performance, not theoretical. 50ms latency is fine for human interaction. 100 events/second is 30x more than needed. Memory under 100MB is the only target. Optimization only after measurement proves need.
<!-- Example: Code review requirements, testing gates, deployment approval process, etc. -->

## Governance
<!-- Example: Constitution supersedes all other practices; Amendments require documentation, approval, migration plan -->

This constitution supersedes all architectural documents, patterns, and practices. Any complexity must justify itself against these principles. When in doubt, choose the simpler path that treats all actors equally. All code reviews verify constitutional compliance. "Enterprise pattern" is valid reason for rejection. "Too complex for localhost" ends discussions. Event democracy violations block merges. Simplicity has veto power over cleverness.
<!-- Example: All PRs/reviews must verify compliance; Complexity must be justified; Use [GUIDANCE_FILE] for runtime development guidance -->

**Version**: 1.0.0 | **Ratified**: 2025-01-10 | **Last Amended**: Never - Keep It Simple
<!-- Example: Version: 2.1.1 | Ratified: 2025-06-13 | Last Amended: 2025-07-16 -->