# Redis Test Pattern for ClaudeBench

## The Problem
- Redis connections keep Node.js event loop alive (tests hang without quit())
- Multiple test files share the same Redis singleton
- Calling quit() in one test affects others running in parallel
- Cleanup code in afterAll fails if Redis is already quit

## The Solution: Don't Call quit()

### RECOMMENDED Pattern: No quit(), Try-Catch Cleanup
```typescript
afterAll(async () => {
  // Try to clean up test data, but don't fail if Redis has issues
  try {
    const keys = await redis.stream.keys("cb:test:*");
    if (keys.length > 0) {
      await redis.stream.del(...keys);
    }
  } catch {
    // Ignore cleanup errors
  }
  
  // Don't quit Redis - let the process handle cleanup on exit
  // This prevents interference between parallel test files
});
```

### For beforeEach/beforeAll Cleanup
```typescript
beforeEach(async () => {
  // Wrap any cleanup in try-catch
  try {
    const keys = await redis.stream.keys("cb:test:*");
    if (keys.length > 0) {
      await redis.stream.del(...keys);
    }
  } catch {
    // Ignore cleanup errors
  }
});
```

## Why This Happens
1. The RedisConnection is a singleton shared across all tests
2. When tests run in parallel, they share the same Redis clients
3. One test's afterAll() can quit Redis while another test is still running
4. The quit() is necessary to let the Node.js process exit

## Recommendations
1. **Never call redis.quit() or redis.disconnect()** in test files
2. **Always wrap cleanup in try-catch** to prevent test failures
3. **Use unique key prefixes** when possible (e.g., `cb:test:taskAssign:*`)
4. **Accept that tests will hang** after completion - use timeout in CI/scripts
5. **For local development**, use Ctrl+C to exit after tests complete