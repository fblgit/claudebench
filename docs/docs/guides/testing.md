# Testing Guide

Comprehensive guide to running and writing tests in ClaudeBench, following the Contract-First Development approach.

## Testing Philosophy

ClaudeBench follows **Contract-Test Driven Development (CTDD)**:

1. **Write contract tests first** - Define what the handler should do
2. **Run tests to see them fail** - Verify tests are correctly written
3. **Implement handlers** - Write minimal code to pass tests
4. **Write integration tests** - Test Redis/PostgreSQL interactions
5. **Refactor with confidence** - Tests provide safety net

## Test Structure

### Test Organization

```
apps/server/tests/
├── contract/           # Contract tests (handler interfaces)
│   ├── task.create.test.ts
│   ├── system.health.test.ts
│   └── ...
├── integration/        # Integration tests (Redis, DB interactions)
│   ├── task-queue.test.ts
│   ├── circuit-breaker.test.ts
│   └── ...
├── helpers/           # Test utilities
│   ├── test-client.ts
│   ├── cleanup.ts
│   └── fixtures.ts
└── setup.ts          # Global test configuration
```

### Test Categories

| Test Type | Purpose | Location | Run Command |
|-----------|---------|----------|-------------|
| **Contract** | Handler interface validation | `/contract/` | `bun test:contract` |
| **Integration** | System component interaction | `/integration/` | `bun test:integration` |
| **Unit** | Individual function testing | `/unit/` | `bun test:unit` |
| **E2E** | Full system workflows | `/e2e/` | `bun test:e2e` |

## Running Tests

### Basic Commands

```bash
# Run all tests
bun test

# Run specific test suites
bun test:contract     # Contract tests only
bun test:integration  # Integration tests only
bun test:unit        # Unit tests only
bun test:e2e         # End-to-end tests only

# Run tests in watch mode
bun test:watch

# Run tests with coverage
bun test:coverage

# Run specific test file
bun test contract/task.create.test.ts

# Run tests matching pattern
bun test --grep "task creation"
```

### Test Configuration

```bash
# Run with specific timeout
bun test --timeout 10000

# Run with verbose output
bun test --verbose

# Run with reporter
bun test --reporter=junit

# Run parallel tests
bun test --parallel

# Run with specific environment
NODE_ENV=test bun test
```

## Contract Tests

Contract tests validate handler interfaces and behavior without testing implementation details.

### Basic Contract Test

```typescript
// tests/contract/task.create.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { testClient } from "../helpers/test-client";
import { cleanupRedis } from "../helpers/cleanup";

describe("task.create Contract", () => {
  beforeEach(async () => {
    await cleanupRedis();
  });

  afterEach(async () => {
    await cleanupRedis();
  });

  it("should create task with valid input", async () => {
    const input = {
      text: "Review documentation",
      priority: 75,
      metadata: { type: "review" }
    };

    const result = await testClient.call("task.create", input);

    // Verify response structure
    expect(result.id).toMatch(/^t-\d+$/);
    expect(result.text).toBe(input.text);
    expect(result.status).toBe("pending");
    expect(result.priority).toBe(75);
    expect(result.createdAt).toBeDefined();
  });

  it("should reject invalid input parameters", async () => {
    const invalidInput = {
      text: "", // Empty text should fail
      priority: 150 // Priority > 100 should fail
    };

    await expect(testClient.call("task.create", invalidInput)).rejects.toThrow();
  });

  it("should handle optional parameters", async () => {
    const minimalInput = {
      text: "Minimal task"
      // No priority or metadata
    };

    const result = await testClient.call("task.create", minimalInput);

    expect(result.priority).toBe(50); // Default priority
    expect(result.status).toBe("pending");
  });

  it("should publish task.created event", async () => {
    const input = { text: "Test task", priority: 60 };
    
    // Subscribe to events before creating task
    const events = await testClient.subscribeToEvents("task.created");
    
    await testClient.call("task.create", input);
    
    // Verify event was published
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("task.created");
    expect(events[0].payload.text).toBe(input.text);
  });
});
```

### Advanced Contract Tests

```typescript
describe("task.assign Contract", () => {
  it("should verify task exists before assignment", async () => {
    const input = {
      taskId: "non-existent-task",
      instanceId: "test-instance"
    };

    await expect(testClient.call("task.assign", input)).rejects.toThrow(
      "Task not found"
    );
  });

  it("should prevent double assignment without force flag", async () => {
    // Create and assign task
    const task = await testClient.call("task.create", { text: "Test task" });
    await testClient.call("task.assign", { taskId: task.id, instanceId: "instance-1" });

    // Try to reassign without force
    await expect(
      testClient.call("task.assign", { 
        taskId: task.id, 
        instanceId: "instance-2" 
      })
    ).rejects.toThrow("Task already assigned");
  });

  it("should allow reassignment with force flag", async () => {
    const task = await testClient.call("task.create", { text: "Test task" });
    await testClient.call("task.assign", { taskId: task.id, instanceId: "instance-1" });

    // Reassign with force flag
    const result = await testClient.call("task.assign", { 
      taskId: task.id, 
      instanceId: "instance-2",
      force: true
    });

    expect(result.assignedTo).toBe("instance-2");
  });
});
```

## Integration Tests

Integration tests verify how components work together with actual Redis and PostgreSQL databases.

### Redis Integration Test

```typescript
// tests/integration/task-queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { redis } from "@/core/redis";
import { testClient } from "../helpers/test-client";
import { cleanupRedis } from "../helpers/cleanup";

describe("Task Queue Integration", () => {
  beforeEach(async () => {
    await cleanupRedis();
  });

  afterEach(async () => {
    await cleanupRedis();
  });

  it("should add task to Redis queue when created", async () => {
    const taskData = { text: "Integration test task", priority: 80 };
    
    const task = await testClient.call("task.create", taskData);
    
    // Verify task exists in Redis hash
    const storedTask = await redis.hgetall(`cb:task:${task.id}`);
    expect(storedTask.text).toBe(taskData.text);
    expect(storedTask.priority).toBe("80");
    expect(storedTask.status).toBe("pending");
    
    // Verify task was added to queue
    const queueSize = await redis.zcard("cb:queue:tasks");
    expect(queueSize).toBe(1);
    
    // Verify task is in queue with correct priority
    const tasksInQueue = await redis.zrevrange("cb:queue:tasks", 0, -1, "WITHSCORES");
    expect(tasksInQueue).toEqual([task.id, "80"]);
  });

  it("should update task metrics when task is completed", async () => {
    // Create and assign task
    const task = await testClient.call("task.create", { text: "Metric test" });
    await testClient.call("task.assign", { taskId: task.id, instanceId: "test-instance" });
    
    // Complete task
    await testClient.call("task.complete", { 
      taskId: task.id, 
      workerId: "test-instance",
      result: { success: true }
    });
    
    // Verify metrics were updated
    const completedCount = await redis.get("cb:metrics:tasks:completed");
    expect(completedCount).toBe("1");
    
    // Verify task removed from queue
    const queueSize = await redis.zcard("cb:queue:tasks");
    expect(queueSize).toBe(0);
  });
});
```

### Database Integration Test

```typescript
// tests/integration/database-persistence.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { prisma } from "@/core/database";
import { testClient } from "../helpers/test-client";
import { cleanupDatabase } from "../helpers/cleanup";

describe("Database Persistence Integration", () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  afterEach(async () => {
    await cleanupDatabase();
  });

  it("should persist task to PostgreSQL when persistence enabled", async () => {
    const taskData = {
      text: "Persistent task",
      priority: 90,
      metadata: { persistent: true }
    };
    
    const task = await testClient.call("task.create", taskData);
    
    // Verify task was saved to database
    const dbTask = await prisma.task.findUnique({
      where: { id: task.id }
    });
    
    expect(dbTask).toBeTruthy();
    expect(dbTask?.text).toBe(taskData.text);
    expect(dbTask?.priority).toBe(90);
    expect(dbTask?.status).toBe("pending");
  });

  it("should handle database transaction rollback on error", async () => {
    // Create task that will cause database error
    const invalidTaskData = {
      text: "x".repeat(1000), // Exceeds database column limit
      priority: 50
    };
    
    // Should fail without leaving partial data
    await expect(
      testClient.call("task.create", invalidTaskData)
    ).rejects.toThrow();
    
    // Verify no tasks in database
    const taskCount = await prisma.task.count();
    expect(taskCount).toBe(0);
  });
});
```

## Circuit Breaker Testing

```typescript
// tests/integration/circuit-breaker.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { testClient } from "../helpers/test-client";
import { simulateFailure } from "../helpers/simulation";

describe("Circuit Breaker Integration", () => {
  beforeEach(async () => {
    await testClient.call("system.reset_circuit_breakers");
  });

  it("should open circuit after threshold failures", async () => {
    // Simulate 5 consecutive failures (threshold)
    for (let i = 0; i < 5; i++) {
      await simulateFailure("task.create", { 
        text: "Failing task", 
        priority: 50 
      });
    }
    
    // Next call should get fallback response
    const result = await testClient.call("task.create", { 
      text: "Should get fallback", 
      priority: 50 
    });
    
    expect(result.id).toBe("t-fallback");
    expect(result.text).toBe("Service temporarily unavailable");
  });

  it("should transition to half-open state after timeout", async () => {
    // Open the circuit
    for (let i = 0; i < 5; i++) {
      await simulateFailure("task.create", { text: "Fail", priority: 50 });
    }
    
    // Wait for circuit timeout (shortened for testing)
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Next call should attempt real operation (half-open)
    const result = await testClient.call("task.create", { 
      text: "Recovery test", 
      priority: 50 
    });
    
    // Should succeed and close circuit
    expect(result.id).toMatch(/^t-\d+$/);
    expect(result.text).toBe("Recovery test");
  });
});
```

## Test Utilities

### Test Client Helper

```typescript
// tests/helpers/test-client.ts
import type { JSONRPCClient } from "@/core/jsonrpc";
import { createRedisClient } from "@/core/redis";
import { EventEmitter } from "events";

export class TestClient {
  private redis = createRedisClient();
  private eventEmitter = new EventEmitter();
  private subscriptions = new Map<string, any[]>();

  async call(method: string, params: any): Promise<any> {
    // Implementation of JSONRPC call for testing
    const response = await fetch("http://localhost:3000/jsonrpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: Date.now()
      })
    });
    
    const result = await response.json();
    
    if (result.error) {
      throw new Error(result.error.message);
    }
    
    return result.result;
  }

  async subscribeToEvents(eventType: string): Promise<any[]> {
    const events: any[] = [];
    this.subscriptions.set(eventType, events);
    
    // Set up Redis subscription
    await this.redis.subscribe(`cb:events:${eventType}`);
    
    return events;
  }

  async cleanup(): Promise<void> {
    await this.redis.quit();
  }
}

export const testClient = new TestClient();
```

### Cleanup Utilities

```typescript
// tests/helpers/cleanup.ts
import { redis } from "@/core/redis";
import { prisma } from "@/core/database";

export async function cleanupRedis(): Promise<void> {
  const keys = await redis.keys("cb:*");
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

export async function cleanupDatabase(): Promise<void> {
  // Clean up in reverse dependency order
  await prisma.taskAttachment.deleteMany();
  await prisma.task.deleteMany();
  await prisma.instance.deleteMany();
}

export async function cleanupAll(): Promise<void> {
  await Promise.all([
    cleanupRedis(),
    cleanupDatabase()
  ]);
}
```

### Test Fixtures

```typescript
// tests/helpers/fixtures.ts
export const taskFixtures = {
  basic: {
    text: "Basic test task",
    priority: 50
  },
  
  highPriority: {
    text: "High priority task",
    priority: 95,
    metadata: { urgent: true }
  },
  
  withMetadata: {
    text: "Task with metadata",
    priority: 70,
    metadata: {
      assignee: "test@example.com",
      sprint: "sprint-1",
      tags: ["frontend", "bug"]
    }
  }
};

export const instanceFixtures = {
  worker: {
    id: "test-worker-1",
    roles: ["worker"],
    capabilities: ["task-processing"]
  },
  
  specialist: {
    id: "test-specialist-1", 
    roles: ["specialist"],
    capabilities: ["frontend", "react", "typescript"]
  }
};
```

## Performance Testing

### Load Testing

```typescript
// tests/performance/load.test.ts
import { describe, it, expect } from "bun:test";
import { testClient } from "../helpers/test-client";

describe("Load Testing", () => {
  it("should handle concurrent task creation", async () => {
    const concurrency = 50;
    const tasksPerWorker = 10;
    
    const startTime = Date.now();
    
    // Create concurrent workers
    const workers = Array(concurrency).fill(0).map(async (_, i) => {
      const tasks = [];
      for (let j = 0; j < tasksPerWorker; j++) {
        tasks.push(testClient.call("task.create", {
          text: `Task ${i}-${j}`,
          priority: Math.floor(Math.random() * 100)
        }));
      }
      return Promise.all(tasks);
    });
    
    const results = await Promise.all(workers);
    const endTime = Date.now();
    
    // Verify all tasks created successfully
    const totalTasks = results.flat();
    expect(totalTasks).toHaveLength(concurrency * tasksPerWorker);
    
    // Performance assertion
    const duration = endTime - startTime;
    const tasksPerSecond = totalTasks.length / (duration / 1000);
    
    console.log(`Created ${totalTasks.length} tasks in ${duration}ms (${tasksPerSecond.toFixed(2)} tasks/sec)`);
    
    // Should handle at least 100 tasks per second
    expect(tasksPerSecond).toBeGreaterThan(100);
  });
});
```

### Memory Testing

```typescript
// tests/performance/memory.test.ts
import { describe, it, expect } from "bun:test";
import { testClient } from "../helpers/test-client";

describe("Memory Usage", () => {
  it("should not leak memory during task operations", async () => {
    const initialMemory = process.memoryUsage();
    
    // Create and complete many tasks
    for (let i = 0; i < 1000; i++) {
      const task = await testClient.call("task.create", { text: `Task ${i}` });
      await testClient.call("task.complete", { 
        taskId: task.id, 
        workerId: "test-worker" 
      });
    }
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = process.memoryUsage();
    const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
    
    // Memory growth should be reasonable (less than 50MB)
    expect(memoryGrowth).toBeLessThan(50 * 1024 * 1024);
  });
});
```

## Test Configuration

### Global Test Setup

```typescript
// tests/setup.ts
import { beforeAll, afterAll } from "bun:test";
import { startTestServer } from "./helpers/test-server";
import { cleanupAll } from "./helpers/cleanup";

beforeAll(async () => {
  // Start test server
  await startTestServer();
  
  // Initialize test environment
  process.env.NODE_ENV = "test";
  process.env.LOG_LEVEL = "error"; // Reduce log noise during tests
});

afterAll(async () => {
  // Clean up all test data
  await cleanupAll();
});
```

### Test Environment Variables

```bash
# tests/.env.test
NODE_ENV=test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/claudebench_test"
REDIS_DB=1
LOG_LEVEL=error
CACHE_DEFAULT_TTL=0
CIRCUIT_FAILURE_THRESHOLD=3
CIRCUIT_TIMEOUT=1000
API_RATE_LIMIT=10000
```

## Best Practices

### 1. Test Organization
- Keep contract and integration tests separate
- Use descriptive test names
- Group related tests with `describe` blocks
- Clean up after each test

### 2. Test Data
- Use fixtures for consistent test data
- Clean up data between tests
- Use unique identifiers to avoid conflicts
- Test with both valid and invalid data

### 3. Async Testing
- Always await async operations
- Use proper timeout handling
- Test concurrent scenarios
- Handle promise rejections properly

### 4. Performance
- Run tests in parallel when possible
- Use test database for isolation
- Monitor test execution time
- Clean up resources promptly

### 5. Reliability
- Make tests deterministic
- Avoid timing-dependent tests
- Use proper setup/teardown
- Test error conditions

## Debugging Tests

### Common Issues

**Tests timing out**:
```bash
# Increase timeout
bun test --timeout 30000

# Check for hanging promises
bun test --verbose
```

**Redis connection errors**:
```bash
# Verify Redis is running
redis-cli ping

# Check connection configuration
echo $REDIS_HOST $REDIS_PORT
```

**Database connection issues**:
```bash
# Check test database exists
psql $DATABASE_URL -c "SELECT 1;"

# Run migrations on test database
NODE_ENV=test bun db:push
```

**Flaky tests**:
```bash
# Run specific test multiple times
bun test --repeat 10 contract/task.create.test.ts

# Run with debugging output
DEBUG=* bun test
```

### Test Debugging Tools

```typescript
// Add debugging output in tests
console.log("Debug info:", { taskId, status, timestamp: Date.now() });

// Use test-specific logging
import { createLogger } from "@/lib/logger";
const logger = createLogger("test");

// Capture and analyze events
const events = await testClient.subscribeToEvents("*");
console.log("Events captured:", events);
```

## Continuous Integration

### GitHub Actions

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
          
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - name: Install dependencies
        run: bun install
        
      - name: Setup database
        run: bun db:push
        
      - name: Run tests
        run: bun test
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

For more testing strategies and debugging techniques, see the [Debugging Guide](debugging.md).