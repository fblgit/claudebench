# Contract-Driven Development Guide for ClaudeBench

## Overview

This guide outlines the process for implementing event handlers that are fully compliant with the JSONRPC contract specification. Following this process ensures that all handlers align perfectly with the contract, preventing the schema mismatches we discovered during development.

**Important:** At the end of this document, there is a Contract Alignment Progress Table that tracks the status of all event handlers. Please update this table after completing each contract alignment and **only work on the specific task scope being instructed** - do not attempt to fix all contracts at once.

## The Contract-First Process

### Step 1: Read and Understand the Specifications

**Always start by thoroughly reading:**
1. `specs/001-claudebench/contracts/jsonrpc-contract.json` - The source of truth for all event schemas
2. `specs/001-claudebench/data-model.md` - The data model definitions and Redis key patterns

**Key things to extract:**
- Field names and types
- Value ranges and defaults
- Required vs optional fields
- Enum values and their casing
- ID formats and patterns
- Redis key structures

### Step 2: Create the Schema (Aligned with Contract)

Based on the contract specification, create your Zod schema that matches EXACTLY.

**Example: task.create schema**

From the contract (`jsonrpc-contract.json`):
```json
"task.create": {
  "request": {
    "params": {
      "properties": {
        "text": { "type": "string", "minLength": 1, "maxLength": 500 },
        "priority": { "type": "number", "minimum": 0, "maximum": 100, "default": 50 }
      }
    }
  },
  "response": {
    "result": {
      "properties": {
        "id": { "type": "string", "pattern": "^t-\\d+$" },
        "text": { "type": "string" },
        "status": { "enum": ["pending", "in_progress", "completed", "failed"] },
        "priority": { "type": "number" },
        "createdAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

Your Zod schema (`schemas/task.schema.ts`) should be:
```typescript
export const taskCreateInput = z.object({
  text: z.string().min(1).max(500),        // NOT "title", use "text"!
  priority: z.number().int().min(0).max(100).default(50), // 0-100, default 50
  metadata: z.record(z.string(), z.any()).optional(),
});

export const taskCreateOutput = z.object({
  id: z.string(),                          // Will match pattern t-{timestamp}
  text: z.string(),                        // NOT "title"
  status: z.enum(["pending", "in_progress", "completed", "failed"]), // lowercase!
  priority: z.number(),
  createdAt: z.string().datetime(),
  // ... other fields
});
```

### Step 3: Create the Contract Test

Before implementing the handler, create a contract test that validates schema alignment.

**Template for contract test:**

```typescript
import { describe, it, expect, beforeAll } from "bun:test";
import { taskCreateInput, taskCreateOutput } from "@/schemas/task.schema";
import { registry } from "@/core/registry";
import contractSpec from "../../../../specs/001-claudebench/contracts/jsonrpc-contract.json";
import "@/handlers"; // Import to register handlers

describe("Contract Validation: task.create", () => {
  const contractEvent = contractSpec.events["task.create"];
  const contractParams = contractEvent.request.properties.params.properties;
  const contractResult = contractEvent.response.properties.result;

  describe("Schema validation against contract", () => {
    it("should match input schema with contract params", () => {
      // Test valid inputs from contract
      const validInput = {
        text: "Test task",
        priority: 50
      };
      expect(taskCreateInput.safeParse(validInput).success).toBe(true);

      // Test contract violations
      const invalidInputs = [
        { text: "", priority: 50 },              // Empty text
        { text: "a".repeat(501), priority: 50 }, // Too long
        { text: "Test", priority: -1 },          // Below minimum
        { text: "Test", priority: 101 },         // Above maximum
      ];

      for (const input of invalidInputs) {
        expect(taskCreateInput.safeParse(input).success).toBe(false);
      }
    });

    it("should validate required output fields", () => {
      const requiredFields = contractResult.required;
      expect(requiredFields).toContain("id");
      expect(requiredFields).toContain("text");
      expect(requiredFields).toContain("status");
      // ... verify all required fields
    });

    it("should validate enum values", () => {
      const contractStatus = contractResult.properties.status.enum;
      expect(contractStatus).toEqual(["pending", "in_progress", "completed", "failed"]);
      
      // Test our schema accepts these values
      for (const status of contractStatus) {
        const output = { id: "t-123", text: "Test", status, priority: 50, createdAt: new Date().toISOString() };
        expect(taskCreateOutput.safeParse(output).success).toBe(true);
      }
    });
  });

  describe("Handler execution with contract data", () => {
    it("should create task with contract-compliant input", async () => {
      const input = { text: "Contract test", priority: 75 };
      const result = await registry.executeHandler("task.create", input);
      
      // Verify output matches contract
      expect(result.id).toMatch(/^t-\d+$/);
      expect(result.text).toBe(input.text);
      expect(result.status).toBe("pending");
      expect(result.priority).toBe(input.priority);
    });
  });
});
```

### Step 4: Implement the Handler

Only after the contract test is in place, implement the handler.

**Example handler implementation:**

```typescript
@EventHandler({
  event: "task.create",
  inputSchema: taskCreateInput,
  outputSchema: taskCreateOutput,
  persist: true,
})
export class TaskCreateHandler {
  async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
    // Use contract-compliant ID format
    const taskId = `t-${Date.now()}`; // NOT "task-{random}"
    
    const task = {
      id: taskId,
      text: input.text,              // NOT "title"
      status: "pending" as const,    // lowercase, NOT "PENDING"
      priority: input.priority || 50, // Default 50 from contract
      createdAt: new Date().toISOString(),
      // ... other fields
    };

    // Store in Redis with correct key pattern
    const taskKey = redisKey("task", taskId); // Creates "cb:task:t-123..."
    await ctx.redis.stream.hset(taskKey, task);

    return task;
  }
}
```

### Step 5: Update Database Schema

Ensure your Prisma schema matches the contract:

```prisma
model Task {
  id         String   @id // Format: t-{timestamp}
  text       String   // NOT "title"
  status     TaskStatus @default(pending) // lowercase
  priority   Int      @default(50) // Default 50, not 0
  // ... other fields
}

enum TaskStatus {
  pending     // NOT PENDING
  in_progress // NOT IN_PROGRESS
  completed   // NOT COMPLETED
  failed      // NOT FAILED
}
```

## Common Pitfalls and Lessons Learned

### 1. Field Name Mismatches

**❌ Wrong:**
```typescript
// Using "title" instead of "text"
const task = {
  title: input.title,  // Contract says "text"!
  ...
};
```

**✅ Correct:**
```typescript
const task = {
  text: input.text,    // Matches contract
  ...
};
```

### 2. Value Range Mismatches

**❌ Wrong:**
```typescript
// Priority 0-10 instead of 0-100
priority: z.number().int().min(0).max(10).default(0)
```

**✅ Correct:**
```typescript
// Priority 0-100 with default 50
priority: z.number().int().min(0).max(100).default(50)
```

### 3. Enum Casing Mismatches

**❌ Wrong:**
```typescript
// Uppercase status values
status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED", "FAILED"])
```

**✅ Correct:**
```typescript
// Lowercase as per contract
status: z.enum(["pending", "in_progress", "completed", "failed"])
```

### 4. ID Format Mismatches

**❌ Wrong:**
```typescript
// Wrong ID format
const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2)}`;
```

**✅ Correct:**
```typescript
// Contract specifies t-{timestamp}
const taskId = `t-${Date.now()}`;
```

### 5. Testing Against Wrong Schema

**❌ Wrong (old contract tests):**
```typescript
// Defining schema in test instead of importing
const taskCreateInputSchema = z.object({
  title: z.string(),  // Wrong field name
  priority: z.number().max(10) // Wrong range
});
```

**✅ Correct:**
```typescript
// Import actual schemas and compare with contract
import { taskCreateInput } from "@/schemas/task.schema";
import contractSpec from ".../jsonrpc-contract.json";

// Validate our schema matches contract
const contractParams = contractSpec.events["task.create"].request.properties.params;
```

## Checklist for New Handler Implementation

- [ ] Read the JSONRPC contract for your event
- [ ] Read the data model for entity definitions
- [ ] Create schema that matches contract EXACTLY
- [ ] Write contract validation test
- [ ] Verify test fails (RED phase of TDD)
- [ ] Implement handler to pass test (GREEN phase)
- [ ] Update Prisma schema if needed
- [ ] Run `bun run db:generate` after schema changes
- [ ] Verify all TypeScript types pass
- [ ] Run contract test to ensure compliance

## Example: Full Implementation Flow

Let's implement a hypothetical `task.archive` event:

### 1. Check Contract
```json
// In jsonrpc-contract.json
"task.archive": {
  "request": {
    "params": {
      "properties": {
        "id": { "type": "string", "pattern": "^t-\\d+$" },
        "reason": { "type": "string", "maxLength": 200 }
      },
      "required": ["id"]
    }
  },
  "response": {
    "result": {
      "properties": {
        "id": { "type": "string" },
        "archived": { "type": "boolean" },
        "archivedAt": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

### 2. Create Schema
```typescript
// schemas/task.schema.ts
export const taskArchiveInput = z.object({
  id: z.string().regex(/^t-\d+$/),
  reason: z.string().max(200).optional(),
});

export const taskArchiveOutput = z.object({
  id: z.string(),
  archived: z.boolean(),
  archivedAt: z.string().datetime(),
});
```

### 3. Write Contract Test
```typescript
// tests/contract/task.archive.contract.test.ts
describe("Contract Validation: task.archive", () => {
  it("should accept valid task ID format", () => {
    const valid = { id: "t-1234567890", reason: "No longer needed" };
    expect(taskArchiveInput.safeParse(valid).success).toBe(true);
    
    const invalid = { id: "task-123" }; // Wrong format
    expect(taskArchiveInput.safeParse(invalid).success).toBe(false);
  });
});
```

### 4. Implement Handler
```typescript
// handlers/task/task.archive.handler.ts
@EventHandler({
  event: "task.archive",
  inputSchema: taskArchiveInput,
  outputSchema: taskArchiveOutput,
})
export class TaskArchiveHandler {
  async handle(input: TaskArchiveInput, ctx: EventContext): Promise<TaskArchiveOutput> {
    const taskKey = redisKey("task", input.id);
    
    // Update task status
    await ctx.redis.stream.hset(taskKey, {
      archived: "true",
      archivedAt: new Date().toISOString(),
      archivedReason: input.reason || "",
    });
    
    return {
      id: input.id,
      archived: true,
      archivedAt: new Date().toISOString(),
    };
  }
}
```

## Benefits of Contract-First Development

1. **Consistency**: All handlers follow the same patterns
2. **Reliability**: Contract tests catch mismatches early
3. **Documentation**: Contract serves as living documentation
4. **Type Safety**: TypeScript catches implementation errors
5. **Maintainability**: Clear process for adding new events

## Conclusion

By following this contract-first approach:
- We ensure our implementation matches the specification exactly
- We catch mismatches during development, not in production
- We maintain consistency across all handlers
- We have confidence that our API behaves as documented

Remember: **The contract is the source of truth!** Always start there, create tests that validate against it, and only then implement the handler.

---

## Contract Alignment Progress Table

**Last Updated:** 2025-01-11

This table tracks the alignment status of all event handlers with their JSONRPC contract specifications. Update this table after completing each contract alignment task.

| Event | Schema Aligned | Contract Test Created | Handler Fixed | Prisma Updated | Status | Notes |
|-------|---------------|----------------------|---------------|----------------|---------|-------|
| **Task Domain** |
| `task.create` | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Fixed: title→text, priority 0-100, lowercase status, ID format t-{timestamp} |
| `task.update` | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Aligned: id/updates object, returns full task, lowercase status, priority 0-100 |
| `task.assign` | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Aligned: taskId/instanceId, returns assignment info, prevents double assignment |
| `task.complete` | ✅ | ✅ | ✅ | ✅ | **COMPLETE** | Aligned: id/optional result, status based on result presence, tracks duration |
| **Hook Domain** |
| `hook.pre_tool` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Aligned: tool/params→allow/reason/modified, validates dangerous commands |
| `hook.post_tool` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Aligned: tool/result→processed (any type), tracks metrics and errors |
| `hook.user_prompt` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Aligned: prompt/context→modified (optional string), enhances prompts |
| `hook.todo_write` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Aligned: todos array→processed (boolean), content not text, lowercase status |
| **System Domain** |
| `system.health` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Simplified: empty input → status + service booleans |
| `system.register` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Simplified: id/roles → registered boolean |
| `system.heartbeat` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Simplified: instanceId → alive boolean only |
| `system.get_state` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Simplified: empty input → optional arrays |
| `system.metrics` | ✅ | ✅ | ✅ | N/A | **COMPLETE** | Simplified: empty input → optional numeric metrics |
| **MCP Domain** |
| `mcp.tool.execute` | ❌ | ❌ | ❌ | N/A | NOT STARTED | |
| `mcp.tool.list` | ❌ | ❌ | ❌ | N/A | NOT STARTED | |

### Status Definitions

- **COMPLETE**: All components aligned and tested
- **PARTIAL**: Some components aligned but work remains
- **NOT STARTED**: No alignment work done yet

### How to Update This Table

1. **Only work on assigned tasks** - Do not attempt to fix all contracts at once
2. **Check each component**:
   - Schema Aligned: Does the Zod schema match the contract exactly?
   - Contract Test: Does a test exist that loads and validates against the contract JSON?
   - Handler Fixed: Does the handler use correct field names, values, and formats?
   - Prisma Updated: Is the database schema consistent (if applicable)?
3. **Update Status**:
   - Mark ✅ for completed items
   - Mark ❌ for pending items
   - Update overall status (COMPLETE/PARTIAL/NOT STARTED)
4. **Add Notes**: Document what was changed for future reference

### Priority Order (Suggested)

1. Complete partially done items first (PARTIAL status)
2. Focus on one domain at a time
3. Task domain → System domain → Hook domain → MCP domain

**Remember:** Always create the contract test BEFORE fixing the implementation!
