---
sidebar_position: 1
title: Architecture Overview
---

# Architecture

ClaudeBench follows a Redis-first event-driven architecture that emphasizes simplicity and performance.

## Core Principles

- **Redis as Infrastructure**: Direct use of Redis primitives for all coordination
- **Event-Driven**: All communication through events with `domain.action` pattern
- **Decorator Pattern**: Handlers auto-register via decorators
- **Explicit Persistence**: Handlers choose when to persist to PostgreSQL
- **Forward-Only Evolution**: Replace events instead of versioning

## System Design

```
┌─────────────────────────────────────────────────┐
│                  Web Dashboard                   │
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
```

## Key Components

- [Event Bus](./event-bus) - Central message routing
- [Redis Integration](./redis) - State management and coordination
- [Handler Pattern](./handlers) - Business logic organization
- [MCP Integration](./mcp) - Model Context Protocol support

## Design Goals

1. **Simplicity**: 500 LOC core vs 5000+ LOC enterprise patterns
2. **Performance**: Direct Redis access, minimal abstractions
3. **Flexibility**: Handlers can evolve independently
4. **Observability**: Built-in metrics and telemetry