# Debugging Guide

Comprehensive guide to troubleshooting and debugging ClaudeBench issues using the relay, logs, and built-in diagnostic tools.

## Quick Debugging Checklist

When experiencing issues, start here:

```bash
# 1. Check system health
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.health","params":{},"id":1}'

# 2. Start the relay for real-time monitoring
bun relay

# 3. Check Redis connectivity
redis-cli ping

# 4. Check PostgreSQL connectivity  
psql $DATABASE_URL -c "SELECT 1;"

# 5. Verify environment variables
env | grep -E "(DATABASE_URL|REDIS|NODE_ENV)"
```

## The Event Relay

The event relay is your primary debugging tool, providing real-time visibility into system events.

### Starting the Relay

```bash
# Start relay for all events
bun relay

# Filter specific events
bun relay --filter="task.*"

# Filter by log level
bun relay --level=debug

# Save output to file
bun relay > debug.log 2>&1
```

### Reading Relay Output

```bash
[2025-09-19T10:30:15.123Z] INFO  [task.create] Starting handler execution
[2025-09-19T10:30:15.125Z] DEBUG [task.create] Input validation passed: {"text":"Test task","priority":75}
[2025-09-19T10:30:15.130Z] DEBUG [redis] HSET cb:task:t-1726744215125 text "Test task" priority "75"
[2025-09-19T10:30:15.135Z] DEBUG [postgres] INSERT INTO tasks (id,text,priority) VALUES ($1,$2,$3)
[2025-09-19T10:30:15.140Z] INFO  [task.create] Handler completed successfully
[2025-09-19T10:30:15.142Z] EVENT [task.created] {"id":"t-1726744215125","text":"Test task"}
```

### Relay Output Breakdown

- **Timestamp**: Precise timing for performance analysis
- **Level**: `DEBUG`, `INFO`, `WARN`, `ERROR`
- **Handler**: Which event handler is executing
- **Message**: Detailed operation information
- **Data**: Relevant payloads and parameters

## Log Analysis

### Log Levels

```bash
# Debug: Detailed execution flow
LOG_LEVEL=debug bun dev

# Info: Normal operations (default)
LOG_LEVEL=info bun dev

# Warn: Potential issues
LOG_LEVEL=warn bun dev

# Error: Only failures
LOG_LEVEL=error bun dev
```

### Log Files

```bash
# Application logs
tail -f logs/combined.log

# Error logs only
tail -f logs/error.log

# Live log analysis
tail -f logs/combined.log | grep -E "(ERROR|WARN)"

# Search for specific patterns
grep "task.create" logs/combined.log | tail -20
```

### Structured Log Queries

```bash
# Find all task creation events
jq 'select(.event == "task.create")' logs/combined.log

# Find errors in the last hour
jq 'select(.level == "ERROR" and (.timestamp | fromdateiso8601) > (now - 3600))' logs/combined.log

# Performance analysis - slow operations
jq 'select(.duration > 1000)' logs/combined.log
```

## System Diagnostics

### Health Check Endpoints

```bash
# Basic health check
curl http://localhost:3000/health

# Detailed system health
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.health","params":{"verbose":true},"id":1}'

# Get system metrics
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.metrics","params":{"detailed":true},"id":1}'
```

### Health Check Response

```json
{
  "status": "healthy",
  "timestamp": "2025-09-19T10:30:00Z",
  "uptime": 3600000,
  "services": {
    "redis": {
      "status": "connected",
      "latency": 2.5,
      "memory": "1.2MB"
    },
    "postgres": {
      "status": "connected", 
      "activeConnections": 5,
      "maxConnections": 20
    }
  },
  "handlers": {
    "registered": 15,
    "active": 15,
    "failed": 0
  },
  "instances": {
    "registered": 3,
    "active": 3,
    "last_heartbeat": "2025-09-19T10:29:55Z"
  }
}
```

## Common Issues and Solutions

### Connection Issues

#### Redis Connection Problems

**Symptoms**:
- `ECONNREFUSED` errors
- Handler timeouts
- Event publishing failures

**Diagnosis**:
```bash
# Check Redis status
redis-cli ping
# Should return "PONG"

# Check Redis configuration
redis-cli CONFIG GET "*"

# Monitor Redis operations
redis-cli MONITOR
```

**Solutions**:
```bash
# Start Redis if not running
redis-server

# Or use Docker
docker run -d --name redis -p 6379:6379 redis:7

# Check connection settings
echo $REDIS_HOST $REDIS_PORT

# Test connection with specific settings
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping
```

#### PostgreSQL Connection Problems

**Symptoms**:
- Database connection timeouts
- Prisma client errors
- Migration failures

**Diagnosis**:
```bash
# Test direct connection
psql $DATABASE_URL -c "SELECT version();"

# Check connection pool
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Verify database exists
psql $DATABASE_URL -c "\l"
```

**Solutions**:
```bash
# Start PostgreSQL service
brew services start postgresql  # macOS
sudo systemctl start postgresql  # Linux

# Or use Docker
bun db:start

# Reset database
bun db:reset
bun db:push

# Check environment variable
echo $DATABASE_URL
```

### Handler Issues

#### Handler Not Registering

**Symptoms**:
- `Method not found` errors
- Handler not appearing in system health

**Diagnosis**:
```bash
# Check registered handlers
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.health","params":{},"id":1}' | jq '.handlers'

# Check for registration errors in logs
grep "handler registration" logs/combined.log
```

**Solutions**:
1. **Verify handler import**:
   ```typescript
   // In src/index.ts
   import { YourHandler } from "@/handlers/your/your.handler";
   server.registerHandler(new YourHandler());
   ```

2. **Check decorator syntax**:
   ```typescript
   @EventHandler({
     event: "domain.action", // Correct format
     inputSchema: schema,    // Valid Zod schema
     outputSchema: schema    // Valid Zod schema
   })
   ```

3. **Verify schema imports**:
   ```typescript
   // Ensure schemas are properly exported
   export const yourSchema = z.object({...});
   ```

#### Rate Limiting Issues

**Symptoms**:
- `Rate limit exceeded` errors
- Handler rejections
- Performance degradation

**Diagnosis**:
```bash
# Check rate limit metrics
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.metrics","params":{},"id":1}' | jq '.rateLimits'

# Monitor rate limit in Redis
redis-cli GET cb:ratelimit:handler:task.create
```

**Solutions**:
1. **Adjust rate limits**:
   ```typescript
   @Resilient({
     rateLimit: { limit: 200, windowMs: 60000 } // Increase limit
   })
   ```

2. **Implement exponential backoff**:
   ```typescript
   const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
   await new Promise(resolve => setTimeout(resolve, delay));
   ```

#### Circuit Breaker Issues

**Symptoms**:
- Fallback responses being returned
- `Circuit breaker open` errors
- Service degradation

**Diagnosis**:
```bash
# Check circuit breaker states
redis-cli HGETALL cb:circuit:task.create

# Monitor circuit breaker events
bun relay --filter="circuit.*"
```

**Solutions**:
1. **Reset circuit breakers**:
   ```bash
   redis-cli DEL cb:circuit:*
   ```

2. **Adjust circuit breaker settings**:
   ```typescript
   @Resilient({
     circuitBreaker: { 
       threshold: 10,     // Increase threshold
       timeout: 60000,    // Longer timeout
       fallback: () => ({ /* better fallback */ })
     }
   })
   ```

### Performance Issues

#### Slow Handler Execution

**Symptoms**:
- High response times
- Handler timeouts
- Performance warnings in logs

**Diagnosis**:
```bash
# Monitor handler performance
bun relay --filter="performance.*"

# Check handler execution times
grep "duration" logs/combined.log | sort -k5 -n | tail -10

# Redis performance monitoring
redis-cli --latency-history
```

**Solutions**:
1. **Add caching**:
   ```typescript
   @Instrumented(300) // 5 minute cache
   ```

2. **Optimize Redis operations**:
   ```typescript
   // Use pipelines for multiple operations
   const pipeline = redis.pipeline();
   pipeline.hset('key1', data1);
   pipeline.hset('key2', data2);
   await pipeline.exec();
   ```

3. **Use Lua scripts for atomic operations**:
   ```typescript
   await redisScripts.atomicOperation(param1, param2);
   ```

#### Memory Issues

**Symptoms**:
- High memory usage
- Out of memory errors
- Garbage collection warnings

**Diagnosis**:
```bash
# Monitor memory usage
node --expose-gc --max-old-space-size=4096 server.js

# Check Redis memory usage
redis-cli INFO memory

# Monitor memory in relay
bun relay --filter="memory.*"
```

**Solutions**:
1. **Increase Node.js memory**:
   ```bash
   export NODE_OPTIONS="--max-old-space-size=4096"
   ```

2. **Implement memory limits**:
   ```typescript
   @Instrumented(60, { maxCacheSize: 1000 })
   ```

3. **Clean up resources**:
   ```typescript
   // Proper resource cleanup in handlers
   try {
     // handler logic
   } finally {
     await cleanup();
   }
   ```

### Event System Issues

#### Events Not Publishing

**Symptoms**:
- Missing events in relay
- Event subscribers not receiving events
- Empty event streams

**Diagnosis**:
```bash
# Check Redis pub/sub
redis-cli PUBSUB CHANNELS cb:*

# Monitor event streams
redis-cli XINFO STREAM cb:stream:events

# Check event publishing in logs
grep "publish" logs/combined.log
```

**Solutions**:
1. **Verify event publishing code**:
   ```typescript
   await ctx.publish({
     type: "domain.action.completed",
     payload: { /* data */ }
   });
   ```

2. **Check Redis streams configuration**:
   ```bash
   # Verify stream exists
   redis-cli XLEN cb:stream:events
   ```

#### Event Processing Delays

**Symptoms**:
- Delayed event delivery
- Event backlog building up
- Processing timeouts

**Diagnosis**:
```bash
# Check event queue sizes
redis-cli XLEN cb:stream:events

# Monitor event processing rates
bun relay --filter="event.*" | grep "processed"
```

**Solutions**:
1. **Increase event workers**:
   ```bash
   EVENT_WORKER_COUNT=4 bun dev
   ```

2. **Optimize event processing**:
   ```typescript
   // Process events in batches
   const batch = await redis.xread('BLOCK', 1000, 'COUNT', 10, 'STREAMS', stream, lastId);
   ```

## Advanced Debugging

### Using Node.js Inspector

```bash
# Start server with inspector
bun --inspect dev

# Or debug specific tests
bun --inspect test contract/task.create.test.ts
```

### Redis Debugging Commands

```bash
# Monitor all Redis commands
redis-cli MONITOR

# Check key patterns
redis-cli KEYS "cb:*" | head -20

# Analyze memory usage by key pattern
redis-cli --bigkeys

# Check slow operations
redis-cli SLOWLOG GET 10

# Monitor client connections
redis-cli CLIENT LIST
```

### Database Debugging

```bash
# Check active connections
psql $DATABASE_URL -c "SELECT pid, usename, application_name, client_addr, state FROM pg_stat_activity;"

# Monitor query performance
psql $DATABASE_URL -c "SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"

# Check locks
psql $DATABASE_URL -c "SELECT * FROM pg_locks WHERE NOT granted;"

# Analyze table sizes
psql $DATABASE_URL -c "SELECT schemaname,tablename,attname,n_distinct,correlation FROM pg_stats;"
```

### Application Profiling

```typescript
// Add performance monitoring to handlers
@EventHandler({ /* config */ })
export class ProfiledHandler {
  @Instrumented(0)
  @Resilient({ /* config */ })
  async handle(input: any, ctx: EventContext) {
    const startTime = performance.now();
    
    try {
      const result = await this.processRequest(input);
      
      const duration = performance.now() - startTime;
      ctx.logger.info(`Handler completed in ${duration.toFixed(2)}ms`);
      
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      ctx.logger.error(`Handler failed after ${duration.toFixed(2)}ms:`, error);
      throw error;
    }
  }
}
```

## Debugging Tools and Scripts

### Custom Debugging Script

```typescript
// scripts/debug.ts
import { redis } from "@/core/redis";
import { prisma } from "@/core/database";

async function debugSystemState() {
  console.log("=== System Debug Report ===");
  
  // Redis info
  const redisInfo = await redis.info();
  console.log("Redis:", {
    version: redisInfo.redis_version,
    memory: redisInfo.used_memory_human,
    connections: redisInfo.connected_clients
  });
  
  // Database info
  const taskCount = await prisma.task.count();
  const instanceCount = await prisma.instance.count();
  console.log("Database:", { taskCount, instanceCount });
  
  // Redis keys
  const keys = await redis.keys("cb:*");
  console.log(`Redis keys: ${keys.length}`);
  
  // Recent events
  const events = await redis.xrevrange("cb:stream:events", "+", "-", "COUNT", 5);
  console.log("Recent events:", events.length);
}

debugSystemState().catch(console.error);
```

### Load Testing for Debugging

```typescript
// scripts/load-test.ts
import { testClient } from "../tests/helpers/test-client";

async function loadTest() {
  const startTime = Date.now();
  const promises = [];
  
  // Create 100 concurrent tasks
  for (let i = 0; i < 100; i++) {
    promises.push(
      testClient.call("task.create", {
        text: `Load test task ${i}`,
        priority: Math.floor(Math.random() * 100)
      })
    );
  }
  
  try {
    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;
    
    console.log(`Created ${results.length} tasks in ${duration}ms`);
    console.log(`Rate: ${(results.length / duration * 1000).toFixed(2)} tasks/sec`);
  } catch (error) {
    console.error("Load test failed:", error);
  }
}
```

## Monitoring and Alerting

### Health Check Monitoring

```bash
#!/bin/bash
# scripts/health-monitor.sh

while true; do
  response=$(curl -s -w "%{http_code}" http://localhost:3000/health -o /dev/null)
  
  if [ $response -ne 200 ]; then
    echo "$(date): Health check failed with status $response" >> health.log
    # Send alert (email, Slack, etc.)
  fi
  
  sleep 30
done
```

### Performance Monitoring

```typescript
// Monitor key metrics
const metrics = {
  taskCreateRate: await redis.get("cb:metrics:tasks:created:rate"),
  averageResponseTime: await redis.get("cb:metrics:response:avg"),
  errorRate: await redis.get("cb:metrics:errors:rate"),
  circuitBreakerOpen: await redis.get("cb:circuit:open:count")
};

console.log("System Metrics:", metrics);
```

## Best Practices

### 1. Debugging Strategy
- Start with the relay for real-time visibility
- Check system health before diving deep
- Use structured logging for better analysis
- Monitor key metrics continuously

### 2. Performance Debugging
- Profile handlers under realistic load
- Use Redis monitoring tools
- Track database query performance
- Monitor memory usage patterns

### 3. Error Handling
- Implement proper error boundaries
- Use structured error logging
- Provide meaningful error messages
- Test error scenarios regularly

### 4. Monitoring
- Set up automated health checks
- Monitor key performance indicators
- Alert on critical failures
- Track trends over time

For production deployment and monitoring strategies, see the [Deployment Guide](deployment.md) and [Monitoring Guide](monitoring.md).