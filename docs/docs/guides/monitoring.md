# Monitoring Guide

Comprehensive guide to monitoring ClaudeBench systems with metrics, logging, alerting, and observability tools.

## Overview

ClaudeBench provides multi-layered monitoring capabilities:

- **Real-time Event Stream**: Live system events via the relay
- **Metrics Collection**: Performance and health metrics
- **Structured Logging**: Application and system logs
- **Health Checks**: Automated health monitoring
- **Alerting**: Proactive issue detection

## Real-time Monitoring with the Relay

### Event Stream Monitoring

The event relay is your primary real-time monitoring tool:

```bash
# Monitor all events
bun relay

# Filter by domain
bun relay --filter="task.*"         # All task events
bun relay --filter="system.*"       # All system events
bun relay --filter="*.error"        # All error events

# Filter by log level
bun relay --level=warn              # Warnings and errors only
bun relay --level=error             # Errors only

# Save to file
bun relay > monitoring.log 2>&1

# Monitor with timestamps
bun relay | ts '[%Y-%m-%d %H:%M:%.S]'
```

### Event Pattern Analysis

```bash
# Count events by type
bun relay | grep -o '"type":"[^"]*"' | sort | uniq -c

# Monitor error rates
bun relay --filter="*.error" | wc -l

# Track handler performance
bun relay | grep "duration" | awk '{print $NF}' | sort -n
```

### Custom Relay Filters

Create custom monitoring scripts:

```bash
#!/bin/bash
# scripts/monitor-errors.sh

bun relay --filter="*.error" | while read line; do
  echo "$(date): $line"
  
  # Send alert for critical errors
  if echo "$line" | grep -q "CRITICAL"; then
    curl -X POST "$SLACK_WEBHOOK" \
      -H 'Content-Type: application/json' \
      -d "{\"text\": \"CRITICAL ERROR: $line\"}"
  fi
done
```

## Metrics Collection

### Built-in Metrics

ClaudeBench automatically collects system metrics:

```bash
# Get system metrics via API
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.metrics","params":{"detailed":true},"id":1}'
```

**Example Metrics Response**:
```json
{
  "timestamp": "2025-09-19T10:30:00Z",
  "uptime": 3600000,
  "performance": {
    "requestsPerSecond": 125.5,
    "averageResponseTime": 45.2,
    "p95ResponseTime": 120.0,
    "errorRate": 0.02
  },
  "resources": {
    "memoryUsage": {
      "used": 524288000,
      "total": 2147483648,
      "percentage": 24.4
    },
    "cpuUsage": 15.7,
    "diskUsage": {
      "used": 5368709120,
      "total": 107374182400,
      "percentage": 5.0
    }
  },
  "database": {
    "connections": {
      "active": 8,
      "idle": 12,
      "max": 20
    },
    "queryStats": {
      "totalQueries": 1250,
      "averageQueryTime": 12.5,
      "slowQueries": 3
    }
  },
  "redis": {
    "memory": "15.2MB",
    "connectedClients": 5,
    "operationsPerSecond": 850.3,
    "hitRate": 94.5
  },
  "tasks": {
    "total": 150,
    "pending": 25,
    "inProgress": 8,
    "completed": 117,
    "failed": 0
  },
  "handlers": {
    "registered": 15,
    "active": 15,
    "totalCalls": 2345,
    "errorRate": 0.01
  }
}
```

### Custom Metrics Collection

Add custom metrics to handlers:

```typescript
// In handler implementation
@EventHandler({
  event: "task.create",
  // ... other config
})
export class TaskCreateHandler {
  @Instrumented(0)
  @Resilient({ /* config */ })
  async handle(input: TaskCreateInput, ctx: EventContext) {
    const startTime = performance.now();
    
    try {
      // Handler logic
      const result = await createTask(input);
      
      // Record success metrics
      await ctx.redis.incr("cb:metrics:tasks:created:total");
      await ctx.redis.zadd(
        "cb:metrics:tasks:created:timing", 
        Date.now(), 
        performance.now() - startTime
      );
      
      return result;
    } catch (error) {
      // Record error metrics
      await ctx.redis.incr("cb:metrics:tasks:created:errors");
      await ctx.redis.zadd(
        "cb:metrics:errors:by_handler",
        Date.now(),
        "task.create"
      );
      
      throw error;
    }
  }
}
```

### Redis Metrics Patterns

Standard metric key patterns:

```typescript
// Counters
"cb:metrics:{domain}:{action}:total"     // Total operations
"cb:metrics:{domain}:{action}:errors"    // Error count
"cb:metrics:{domain}:{action}:success"   // Success count

// Timing (sorted sets with timestamps)
"cb:metrics:{domain}:{action}:timing"    // Response times
"cb:metrics:{domain}:{action}:duration"  // Processing duration

// Gauges (current values)
"cb:metrics:system:memory:used"          // Current memory usage
"cb:metrics:database:connections:active" // Active connections
"cb:metrics:redis:clients:connected"     // Connected clients

// Histograms (time-based buckets)
"cb:metrics:requests:hourly:{hour}"      // Requests per hour
"cb:metrics:errors:daily:{date}"         // Errors per day
```

## Health Monitoring

### Health Check Endpoints

Multiple health check levels:

```bash
# Basic health (lightweight)
curl http://localhost:3000/health

# Detailed health check
curl -X POST http://localhost:3000/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"system.health","params":{"verbose":true},"id":1}'

# Component-specific health
curl http://localhost:3000/health/redis
curl http://localhost:3000/health/database
curl http://localhost:3000/health/handlers
```

### Health Check Responses

**Basic Health Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-19T10:30:00Z",
  "uptime": 3600000
}
```

**Detailed Health Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-09-19T10:30:00Z",
  "uptime": 3600000,
  "components": {
    "redis": {
      "status": "healthy",
      "latency": 2.5,
      "memory": "15.2MB",
      "version": "7.0.11"
    },
    "database": {
      "status": "healthy",
      "connectionPool": {
        "active": 8,
        "idle": 12,
        "max": 20
      },
      "version": "14.9"
    },
    "handlers": {
      "status": "healthy",
      "registered": 15,
      "active": 15,
      "failing": []
    }
  },
  "metrics": {
    "requestsPerSecond": 125.5,
    "errorRate": 0.02,
    "averageResponseTime": 45.2
  }
}
```

### Automated Health Monitoring

Set up automated health checks:

```bash
#!/bin/bash
# scripts/health-monitor.sh

HEALTH_URL="http://localhost:3000/health"
ALERT_WEBHOOK="$SLACK_WEBHOOK_URL"
HEALTH_LOG="/var/log/claudebench-health.log"

while true; do
  timestamp=$(date -Iseconds)
  
  # Perform health check
  response=$(curl -s -w "%{http_code}" "$HEALTH_URL" -o /tmp/health.json)
  http_code=$(echo "$response" | tail -c 4)
  
  if [ "$http_code" = "200" ]; then
    status=$(cat /tmp/health.json | jq -r '.status')
    uptime=$(cat /tmp/health.json | jq -r '.uptime')
    
    echo "$timestamp: HEALTHY - Status: $status, Uptime: ${uptime}ms" >> "$HEALTH_LOG"
  else
    echo "$timestamp: UNHEALTHY - HTTP $http_code" >> "$HEALTH_LOG"
    
    # Send alert
    curl -X POST "$ALERT_WEBHOOK" \
      -H 'Content-Type: application/json' \
      -d "{
        \"text\": \"🚨 ClaudeBench Health Check Failed\",
        \"attachments\": [{
          \"color\": \"danger\",
          \"fields\": [
            {\"title\": \"Status\", \"value\": \"HTTP $http_code\", \"short\": true},
            {\"title\": \"Timestamp\", \"value\": \"$timestamp\", \"short\": true}
          ]
        }]
      }"
  fi
  
  sleep 30
done
```

## Prometheus Integration

### Metrics Export

Export metrics to Prometheus format:

```typescript
// src/monitoring/prometheus.ts
import { register, Counter, Histogram, Gauge } from 'prom-client';
import { redis } from '@/core/redis';

// Request metrics
export const requestCounter = new Counter({
  name: 'claudebench_requests_total',
  help: 'Total number of requests',
  labelNames: ['method', 'handler', 'status']
});

export const requestDuration = new Histogram({
  name: 'claudebench_request_duration_seconds',
  help: 'Request duration in seconds',
  labelNames: ['method', 'handler'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
});

// Task metrics
export const taskCounter = new Counter({
  name: 'claudebench_tasks_total',
  help: 'Total number of tasks',
  labelNames: ['status', 'priority']
});

export const activeTasksGauge = new Gauge({
  name: 'claudebench_tasks_active',
  help: 'Number of active tasks'
});

// System metrics
export const memoryUsage = new Gauge({
  name: 'claudebench_memory_usage_bytes',
  help: 'Memory usage in bytes'
});

export const redisConnections = new Gauge({
  name: 'claudebench_redis_connections',
  help: 'Number of Redis connections'
});

// Metrics endpoint
export async function getMetrics(): Promise<string> {
  // Update dynamic metrics
  const memStats = process.memoryUsage();
  memoryUsage.set(memStats.heapUsed);
  
  const redisInfo = await redis.info();
  redisConnections.set(parseInt(redisInfo.connected_clients));
  
  const activeTasks = await redis.zcard('cb:queue:tasks');
  activeTasksGauge.set(activeTasks);
  
  return register.metrics();
}
```

### Prometheus Configuration

**prometheus.yml**:
```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'claudebench'
    static_configs:
      - targets: ['localhost:3000']
    scrape_interval: 15s
    metrics_path: /metrics
    
  - job_name: 'claudebench-redis'
    static_configs:
      - targets: ['localhost:9121']
    scrape_interval: 15s
    
  - job_name: 'claudebench-postgres'
    static_configs:
      - targets: ['localhost:9187']
    scrape_interval: 15s
```

## Grafana Dashboards

### ClaudeBench System Dashboard

```json
{
  "dashboard": {
    "title": "ClaudeBench System Overview",
    "panels": [
      {
        "title": "Request Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(claudebench_requests_total[5m])",
            "legendFormat": "{{handler}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, rate(claudebench_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          },
          {
            "expr": "histogram_quantile(0.50, rate(claudebench_request_duration_seconds_bucket[5m]))",
            "legendFormat": "50th percentile"
          }
        ]
      },
      {
        "title": "Active Tasks",
        "type": "stat",
        "targets": [
          {
            "expr": "claudebench_tasks_active",
            "legendFormat": "Active Tasks"
          }
        ]
      },
      {
        "title": "Error Rate",
        "type": "stat",
        "targets": [
          {
            "expr": "rate(claudebench_requests_total{status=\"error\"}[5m]) / rate(claudebench_requests_total[5m]) * 100",
            "legendFormat": "Error Rate %"
          }
        ]
      },
      {
        "title": "Memory Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "claudebench_memory_usage_bytes",
            "legendFormat": "Heap Used"
          }
        ]
      },
      {
        "title": "Redis Connections",
        "type": "stat",
        "targets": [
          {
            "expr": "claudebench_redis_connections",
            "legendFormat": "Connected Clients"
          }
        ]
      }
    ]
  }
}
```

### Task Management Dashboard

```json
{
  "dashboard": {
    "title": "ClaudeBench Task Management",
    "panels": [
      {
        "title": "Task Creation Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(claudebench_tasks_total{status=\"created\"}[5m])",
            "legendFormat": "Tasks/sec"
          }
        ]
      },
      {
        "title": "Task Completion Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(claudebench_tasks_total{status=\"completed\"}[5m])",
            "legendFormat": "Completions/sec"
          }
        ]
      },
      {
        "title": "Task Queue Size",
        "type": "stat",
        "targets": [
          {
            "expr": "claudebench_tasks_active",
            "legendFormat": "Pending Tasks"
          }
        ]
      },
      {
        "title": "Task Status Distribution",
        "type": "piechart",
        "targets": [
          {
            "expr": "claudebench_tasks_total",
            "legendFormat": "{{status}}"
          }
        ]
      }
    ]
  }
}
```

## Alerting

### Prometheus Alerting Rules

```yaml
# alerts.yml
groups:
  - name: claudebench.rules
    rules:
      # High error rate
      - alert: HighErrorRate
        expr: rate(claudebench_requests_total{status="error"}[5m]) / rate(claudebench_requests_total[5m]) > 0.05
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} over the last 5 minutes"
      
      # High response time
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(claudebench_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time detected"
          description: "95th percentile response time is {{ $value }}s"
      
      # Service down
      - alert: ServiceDown
        expr: up{job="claudebench"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "ClaudeBench service is down"
          description: "ClaudeBench service has been down for more than 1 minute"
      
      # High memory usage
      - alert: HighMemoryUsage
        expr: claudebench_memory_usage_bytes / (1024*1024*1024) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage detected"
          description: "Memory usage is {{ $value | humanize }}GB"
      
      # Redis connection issues
      - alert: RedisConnectionsHigh
        expr: claudebench_redis_connections > 100
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High number of Redis connections"
          description: "Redis has {{ $value }} connections"
      
      # Task queue backlog
      - alert: TaskQueueBacklog
        expr: claudebench_tasks_active > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Large task queue backlog"
          description: "Task queue has {{ $value }} pending tasks"
```

### Slack/Discord Alerting

```bash
#!/bin/bash
# scripts/alert-handler.sh

WEBHOOK_URL="$SLACK_WEBHOOK_URL"

# Function to send Slack alert
send_alert() {
  local severity=$1
  local title=$2
  local message=$3
  
  color="good"
  if [ "$severity" = "warning" ]; then
    color="warning"
  elif [ "$severity" = "critical" ]; then
    color="danger"
  fi
  
  curl -X POST "$WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{
      \"text\": \"🚨 ClaudeBench Alert\",
      \"attachments\": [{
        \"color\": \"$color\",
        \"title\": \"$title\",
        \"text\": \"$message\",
        \"fields\": [
          {\"title\": \"Severity\", \"value\": \"$severity\", \"short\": true},
          {\"title\": \"Time\", \"value\": \"$(date -Iseconds)\", \"short\": true}
        ]
      }]
    }"
}

# Example usage
send_alert "critical" "Service Down" "ClaudeBench API is not responding"
```

## Log Aggregation

### Structured Logging

Configure structured JSON logging:

```typescript
// src/lib/logger.ts
import { createLogger, format, transports } from 'winston';

export const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp(),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: {
    service: 'claudebench',
    environment: process.env.NODE_ENV
  },
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple()
      )
    }),
    new transports.File({
      filename: 'logs/error.log',
      level: 'error'
    }),
    new transports.File({
      filename: 'logs/combined.log'
    })
  ]
});

// Add request correlation IDs
logger.add(new transports.File({
  filename: 'logs/access.log',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message, correlationId, ...meta }) => {
      return JSON.stringify({
        timestamp,
        level,
        message,
        correlationId,
        ...meta
      });
    })
  )
}));
```

### ELK Stack Integration

**Logstash Configuration**:
```ruby
# logstash.conf
input {
  file {
    path => "/opt/claudebench/logs/combined.log"
    start_position => "beginning"
    codec => "json"
    type => "claudebench"
  }
}

filter {
  if [type] == "claudebench" {
    # Parse correlation IDs
    if [correlationId] {
      mutate {
        add_field => { "trace_id" => "%{correlationId}" }
      }
    }
    
    # Extract handler information
    if [handler] {
      mutate {
        add_field => { "handler_name" => "%{handler}" }
      }
    }
    
    # Add environment tags
    mutate {
      add_tag => [ "claudebench", "%{environment}" ]
    }
  }
}

output {
  elasticsearch {
    hosts => ["localhost:9200"]
    index => "claudebench-%{+YYYY.MM.dd}"
  }
}
```

### Log Analysis Queries

**Elasticsearch queries for common issues**:

```bash
# High error rates
GET claudebench-*/_search
{
  "query": {
    "bool": {
      "must": [
        {"term": {"level": "error"}},
        {"range": {"@timestamp": {"gte": "now-1h"}}}
      ]
    }
  },
  "aggs": {
    "errors_by_handler": {
      "terms": {"field": "handler.keyword"}
    }
  }
}

# Slow operations
GET claudebench-*/_search
{
  "query": {
    "bool": {
      "must": [
        {"exists": {"field": "duration"}},
        {"range": {"duration": {"gte": 1000}}}
      ]
    }
  },
  "sort": [{"duration": {"order": "desc"}}]
}

# Error patterns
GET claudebench-*/_search
{
  "query": {
    "bool": {
      "must": [
        {"term": {"level": "error"}},
        {"range": {"@timestamp": {"gte": "now-24h"}}}
      ]
    }
  },
  "aggs": {
    "error_messages": {
      "terms": {"field": "message.keyword", "size": 10}
    }
  }
}
```

## Performance Monitoring

### Application Performance Monitoring (APM)

Integrate with APM tools for detailed performance insights:

```typescript
// src/monitoring/apm.ts
import { init } from '@elastic/apm-node';

// Initialize APM
const apm = init({
  serviceName: 'claudebench',
  serviceVersion: process.env.APP_VERSION,
  environment: process.env.NODE_ENV
});

// Custom transaction tracking
export function trackOperation(name: string, type: string = 'request') {
  const transaction = apm.startTransaction(name, type);
  
  return {
    end: (result?: string) => {
      if (result) {
        transaction.result = result;
      }
      transaction.end();
    },
    setLabel: (key: string, value: string | number | boolean) => {
      transaction.setLabel(key, value);
    },
    addError: (error: Error) => {
      apm.captureError(error);
    }
  };
}

// Handler instrumentation
export function instrumentHandler(handler: Function, handlerName: string) {
  return async function instrumentedHandler(...args: any[]) {
    const transaction = trackOperation(`handler.${handlerName}`, 'handler');
    
    try {
      const result = await handler.apply(this, args);
      transaction.end('success');
      return result;
    } catch (error) {
      transaction.addError(error as Error);
      transaction.end('error');
      throw error;
    }
  };
}
```

## Best Practices

### 1. Monitoring Strategy
- **Start Simple**: Begin with basic health checks and metrics
- **Layer Monitoring**: Combine real-time, metrics, and logs
- **Focus on Business Metrics**: Track task completion rates, not just system metrics
- **Set Meaningful Alerts**: Avoid alert fatigue with targeted thresholds

### 2. Metrics Collection
- **Use Standard Patterns**: Follow RED (Rate, Errors, Duration) methodology
- **Instrument at Boundaries**: Handler entry/exit points
- **Tag Appropriately**: Add relevant labels for filtering
- **Consider Cardinality**: Avoid high-cardinality metrics

### 3. Alerting
- **Alert on Symptoms**: What users experience, not just causes
- **Set Appropriate Thresholds**: Based on historical data
- **Include Context**: Meaningful alert messages with debugging info
- **Test Alert Channels**: Ensure alerts reach the right people

### 4. Observability
- **Correlation IDs**: Track requests across components
- **Structured Logging**: Machine-readable log formats
- **Distributed Tracing**: For complex request flows
- **Documentation**: Keep runbooks for common issues

For production deployment and scaling considerations, see the [Deployment Guide](deployment.md) and [Scaling Guide](scaling.md).