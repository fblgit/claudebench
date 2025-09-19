# Scaling Guide

Comprehensive guide to scaling ClaudeBench from single-server setups to distributed, high-availability architectures.

## Scaling Overview

ClaudeBench scales through multiple dimensions:

1. **Vertical Scaling**: Increase server resources (CPU, RAM, storage)
2. **Horizontal Scaling**: Add more server instances
3. **Component Scaling**: Scale individual services independently
4. **Geographic Distribution**: Multi-region deployment
5. **Load Distribution**: Intelligent traffic routing

## Scaling Stages

### Stage 1: Single Server Optimization

**Characteristics**:
- Single server deployment
- Local PostgreSQL and Redis
- 1-1000 tasks/day
- 1-10 concurrent users

**Optimizations**:

```bash
# Increase server resources
# CPU: 4-8 cores
# RAM: 16-32GB
# Storage: SSD with 1000+ IOPS

# Optimize database connections
DATABASE_MAX_CONNECTIONS=30
DATABASE_POOL_TIMEOUT=10000

# Optimize Redis configuration
redis.conf:
maxmemory 8gb
maxmemory-policy allkeys-lru
```

**Performance Tuning**:

```typescript
// Production configuration
export const productionConfig = {
  server: {
    cluster: true,          // Use cluster mode
    workers: 4,             // Number of worker processes
    maxRequestsPerWorker: 10000
  },
  
  cache: {
    defaultTtl: 300,        // 5 minutes
    maxSize: 10000,         // Cache size limit
    strategy: 'lru'         // Eviction policy
  },
  
  rateLimits: {
    global: 5000,           // Requests per minute
    perUser: 1000,          // Per user limit
    burst: 100              // Burst capacity
  }
};
```

### Stage 2: Database Scaling

**Characteristics**:
- 1000-10000 tasks/day
- 10-50 concurrent users
- Database becoming bottleneck

**Read Replicas**:

```typescript
// Database connection configuration
const databaseConfig = {
  write: {
    host: 'postgres-primary.example.com',
    port: 5432,
    database: 'claudebench',
    pool: { max: 20, min: 5 }
  },
  read: [
    {
      host: 'postgres-replica-1.example.com',
      port: 5432,
      database: 'claudebench',
      pool: { max: 30, min: 10 }
    },
    {
      host: 'postgres-replica-2.example.com',
      port: 5432,
      database: 'claudebench',
      pool: { max: 30, min: 10 }
    }
  ]
};

// Smart routing
export class DatabaseRouter {
  async executeQuery(sql: string, params: any[], options: { readOnly?: boolean } = {}) {
    if (options.readOnly || sql.toLowerCase().startsWith('select')) {
      // Route to read replica
      const replica = this.selectReadReplica();
      return replica.query(sql, params);
    } else {
      // Route to primary
      return this.primary.query(sql, params);
    }
  }
  
  private selectReadReplica() {
    // Round-robin or health-based selection
    return this.readReplicas[this.currentReplicaIndex++ % this.readReplicas.length];
  }
}
```

**Database Optimization**:

```sql
-- Create indexes for common queries
CREATE INDEX CONCURRENTLY idx_tasks_status_priority ON tasks(status, priority);
CREATE INDEX CONCURRENTLY idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX CONCURRENTLY idx_tasks_created_at_brin ON tasks USING brin(created_at);

-- Partition large tables
CREATE TABLE tasks_y2025 PARTITION OF tasks 
FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');

-- Optimize frequently used queries
EXPLAIN ANALYZE SELECT * FROM tasks 
WHERE status = 'pending' 
ORDER BY priority DESC, created_at ASC 
LIMIT 50;
```

### Stage 3: Application Scaling

**Characteristics**:
- 10000-100000 tasks/day
- 50-200 concurrent users
- Need horizontal application scaling

**Load Balancer Configuration** (Nginx):

```nginx
upstream claudebench_backend {
    least_conn;
    server 10.0.1.10:3000 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.1.11:3000 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.1.12:3000 weight=3 max_fails=3 fail_timeout=30s;
    server 10.0.1.13:3000 weight=1 max_fails=3 fail_timeout=30s backup;
}

server {
    listen 443 ssl http2;
    server_name api.claudebench.com;
    
    location / {
        proxy_pass http://claudebench_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Connection pooling
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        
        # Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
        
        # Health checks
        proxy_next_upstream error timeout http_502 http_503 http_504;
        proxy_next_upstream_tries 3;
    }
    
    # Sticky sessions for WebSocket
    location /ws {
        proxy_pass http://claudebench_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Session affinity
        ip_hash;
    }
}
```

**Session Management**:

```typescript
// Redis-based session store
import session from 'express-session';
import RedisStore from 'connect-redis';

const sessionStore = new RedisStore({
  client: redis,
  prefix: 'cb:session:',
  ttl: 86400 // 24 hours
});

app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: 86400000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production'
  }
}));
```

### Stage 4: Redis Scaling

**Characteristics**:
- High cache hit rates required
- Large event streams
- Need Redis high availability

**Redis Cluster Setup**:

```bash
# Redis cluster configuration (6 nodes: 3 masters, 3 replicas)
# redis-7000.conf (master)
port 7000
cluster-enabled yes
cluster-config-file nodes-7000.conf
cluster-node-timeout 15000
appendonly yes
appendfilename "appendonly-7000.aof"

# Start cluster
redis-cli --cluster create \
  127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
  127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 \
  --cluster-replicas 1
```

**Redis Cluster Client**:

```typescript
import { Cluster } from 'ioredis';

const redis = new Cluster([
  { host: 'redis-1.example.com', port: 7000 },
  { host: 'redis-2.example.com', port: 7001 },
  { host: 'redis-3.example.com', port: 7002 }
], {
  redisOptions: {
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100
  },
  enableOfflineQueue: false,
  maxRetriesPerRequest: null,
  scaleReads: 'slave' // Read from replicas
});

// Handle cluster events
redis.on('ready', () => {
  console.log('Redis cluster ready');
});

redis.on('error', (error) => {
  console.error('Redis cluster error:', error);
});

redis.on('node error', (error, node) => {
  console.error(`Redis node error ${node}:`, error);
});
```

**Data Sharding Strategy**:

```typescript
// Consistent hashing for data distribution
export class RedisSharding {
  private readonly shards: Map<string, RedisCluster> = new Map();
  
  constructor(shardConfigs: ShardConfig[]) {
    shardConfigs.forEach((config, index) => {
      this.shards.set(`shard-${index}`, new Cluster(config.nodes));
    });
  }
  
  private getShard(key: string): RedisCluster {
    // Consistent hashing
    const hash = this.hashKey(key);
    const shardIndex = hash % this.shards.size;
    return this.shards.get(`shard-${shardIndex}`)!;
  }
  
  async set(key: string, value: string, ttl?: number): Promise<void> {
    const shard = this.getShard(key);
    if (ttl) {
      await shard.setex(key, ttl, value);
    } else {
      await shard.set(key, value);
    }
  }
  
  async get(key: string): Promise<string | null> {
    const shard = this.getShard(key);
    return shard.get(key);
  }
  
  private hashKey(key: string): number {
    // CRC32 or similar hash function
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      const char = key.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }
}
```

### Stage 5: Microservices Architecture

**Characteristics**:
- 100000+ tasks/day
- 200+ concurrent users
- Complex business requirements
- Need independent scaling

**Service Decomposition**:

```
claudebench-monolith/
├── claudebench-task-service/      # Task management
├── claudebench-swarm-service/     # Swarm intelligence
├── claudebench-system-service/    # System operations
├── claudebench-hook-service/      # Hook processing
├── claudebench-notification-service/ # Alerts & notifications
├── claudebench-analytics-service/ # Metrics & reporting
└── claudebench-gateway/           # API gateway
```

**API Gateway (Kong/Ambassador)**:

```yaml
# kong.yml
_format_version: "3.0"

services:
  - name: task-service
    url: http://task-service:3000
    routes:
      - name: tasks
        paths:
          - /api/tasks

  - name: swarm-service
    url: http://swarm-service:3000
    routes:
      - name: swarm
        paths:
          - /api/swarm

  - name: system-service
    url: http://system-service:3000
    routes:
      - name: system
        paths:
          - /api/system

plugins:
  - name: rate-limiting
    config:
      minute: 1000
      hour: 10000
      
  - name: prometheus
    config:
      per_consumer: true
      
  - name: jwt
    config:
      secret_is_base64: false
```

**Service Communication**:

```typescript
// Event-driven communication
export class ServiceCommunicator {
  private readonly eventBus: EventBus;
  
  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }
  
  // Publish domain events
  async publishTaskCreated(task: Task): Promise<void> {
    await this.eventBus.publish('task.created', {
      taskId: task.id,
      priority: task.priority,
      assignedTo: task.assignedTo
    });
  }
  
  // Subscribe to events from other services
  async subscribeToSwarmEvents(): Promise<void> {
    await this.eventBus.subscribe('swarm.decompose.completed', async (event) => {
      // Handle swarm decomposition completion
      const { taskId, subtasks } = event.payload;
      await this.createSubtasks(taskId, subtasks);
    });
  }
  
  // Synchronous communication for immediate responses
  async getTaskDetails(taskId: string): Promise<Task> {
    const response = await this.httpClient.get(`/task-service/tasks/${taskId}`);
    return response.data;
  }
}
```

### Stage 6: Global Distribution

**Characteristics**:
- Global user base
- Low latency requirements
- Multi-region deployment
- Disaster recovery needs

**Multi-Region Architecture**:

```
Region: US-East-1 (Primary)
├── Application Load Balancer
├── ClaudeBench Servers (3 instances)
├── PostgreSQL Primary
├── Redis Cluster (3 masters, 3 replicas)
└── ElastiCache for session store

Region: EU-West-1 (Secondary)
├── Application Load Balancer  
├── ClaudeBench Servers (2 instances)
├── PostgreSQL Read Replica
├── Redis Replica Cluster
└── CloudFront Distribution

Region: Asia-Pacific-1 (Read-only)
├── Application Load Balancer
├── ClaudeBench Servers (2 instances, read-only)
├── PostgreSQL Read Replica
└── Redis Read-only Replica
```

**Global Load Balancing** (AWS Route 53):

```json
{
  "Type": "A",
  "Name": "api.claudebench.com",
  "SetIdentifier": "us-east-1",
  "GeolocationContinentCode": "NA",
  "AliasTarget": {
    "DNSName": "us-east-1-alb.amazonaws.com",
    "EvaluateTargetHealth": true
  }
}
```

**Cross-Region Replication**:

```typescript
// Database replication monitoring
export class ReplicationMonitor {
  async checkReplicationLag(): Promise<Map<string, number>> {
    const lags = new Map<string, number>();
    
    for (const replica of this.replicas) {
      const lag = await this.getReplicationLag(replica);
      lags.set(replica.name, lag);
      
      // Alert if lag is too high
      if (lag > 1000) { // 1 second
        await this.sendAlert(`High replication lag: ${replica.name} (${lag}ms)`);
      }
    }
    
    return lags;
  }
  
  private async getReplicationLag(replica: DatabaseReplica): Promise<number> {
    const result = await replica.query(`
      SELECT EXTRACT(EPOCH FROM (now() - pg_last_xact_replay_timestamp())) * 1000 as lag_ms
    `);
    return result.rows[0].lag_ms;
  }
}
```

## Auto-scaling Strategies

### Kubernetes Horizontal Pod Autoscaler

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: claudebench-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: claudebench-server
  minReplicas: 3
  maxReplicas: 50
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: active_tasks_per_pod
      target:
        type: AverageValue
        averageValue: "100"
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
      - type: Pods
        value: 4
        periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 10
        periodSeconds: 60
```

### Vertical Pod Autoscaler

```yaml
# vpa.yaml
apiVersion: autoscaling.k8s.io/v1
kind: VerticalPodAutoscaler
metadata:
  name: claudebench-vpa
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: claudebench-server
  updatePolicy:
    updateMode: "Auto"
  resourcePolicy:
    containerPolicies:
    - containerName: claudebench-server
      maxAllowed:
        cpu: "4"
        memory: "8Gi"
      minAllowed:
        cpu: "100m"
        memory: "128Mi"
      controlledResources: ["cpu", "memory"]
```

### Custom Scaling Metrics

```typescript
// Custom metrics for scaling decisions
export class ScalingMetricsCollector {
  async collectMetrics(): Promise<ScalingMetrics> {
    const [
      queueSize,
      avgResponseTime,
      errorRate,
      activeConnections
    ] = await Promise.all([
      this.getTaskQueueSize(),
      this.getAverageResponseTime(),
      this.getErrorRate(),
      this.getActiveConnections()
    ]);
    
    return {
      queueSize,
      avgResponseTime,
      errorRate,
      activeConnections,
      scalingRecommendation: this.calculateScalingRecommendation({
        queueSize,
        avgResponseTime,
        errorRate
      })
    };
  }
  
  private calculateScalingRecommendation(metrics: BaseMetrics): ScalingAction {
    // Scale up conditions
    if (metrics.queueSize > 1000 || metrics.avgResponseTime > 2000) {
      return { action: 'scale_up', factor: 2 };
    }
    
    // Scale down conditions
    if (metrics.queueSize < 50 && metrics.avgResponseTime < 100) {
      return { action: 'scale_down', factor: 0.5 };
    }
    
    return { action: 'maintain', factor: 1 };
  }
  
  async getTaskQueueSize(): Promise<number> {
    return this.redis.zcard('cb:queue:tasks');
  }
  
  async getAverageResponseTime(): Promise<number> {
    const times = await this.redis.zrevrange('cb:metrics:response_times', 0, 99);
    return times.reduce((sum, time) => sum + parseFloat(time), 0) / times.length;
  }
  
  async getErrorRate(): Promise<number> {
    const [errors, total] = await Promise.all([
      this.redis.get('cb:metrics:errors:5min'),
      this.redis.get('cb:metrics:requests:5min')
    ]);
    
    return total ? (parseFloat(errors || '0') / parseFloat(total)) * 100 : 0;
  }
}
```

## Performance Optimization

### Connection Pooling

```typescript
// Database connection pool optimization
export const databaseConfig = {
  production: {
    pool: {
      max: 50,           // Maximum connections
      min: 10,           // Minimum connections
      acquire: 30000,    // Maximum time to get connection (ms)
      idle: 10000,       // Maximum idle time before release (ms)
      evict: 1000,       // How often to check for idle connections (ms)
      handleDisconnects: true
    },
    logging: false,      // Disable query logging in production
    benchmark: true      // Enable query benchmarking
  }
};

// Redis connection pool
const redis = new Redis({
  port: 6379,
  host: 'redis.example.com',
  family: 4,
  keepAlive: 30000,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  connectTimeout: 10000,
  commandTimeout: 5000,
  lazyConnect: true,
  maxmemoryPolicy: 'allkeys-lru'
});
```

### Caching Strategies

```typescript
// Multi-layer caching
export class CacheManager {
  private l1Cache: Map<string, CacheEntry> = new Map(); // In-memory
  private l2Cache: Redis; // Redis cache
  private l3Cache: Redis; // Persistent cache
  
  async get(key: string): Promise<any> {
    // L1: In-memory cache (fastest)
    const l1Entry = this.l1Cache.get(key);
    if (l1Entry && !this.isExpired(l1Entry)) {
      return l1Entry.value;
    }
    
    // L2: Redis cache (fast)
    const l2Value = await this.l2Cache.get(key);
    if (l2Value) {
      this.l1Cache.set(key, { value: JSON.parse(l2Value), expires: Date.now() + 30000 });
      return JSON.parse(l2Value);
    }
    
    // L3: Persistent cache (slower)
    const l3Value = await this.l3Cache.get(key);
    if (l3Value) {
      const parsed = JSON.parse(l3Value);
      await this.l2Cache.setex(key, 300, l3Value); // 5 minutes
      this.l1Cache.set(key, { value: parsed, expires: Date.now() + 30000 });
      return parsed;
    }
    
    return null;
  }
  
  async set(key: string, value: any, ttl: number = 300): Promise<void> {
    const serialized = JSON.stringify(value);
    
    // Set in all cache layers
    this.l1Cache.set(key, { value, expires: Date.now() + Math.min(ttl, 30) * 1000 });
    await this.l2Cache.setex(key, ttl, serialized);
    await this.l3Cache.setex(key, ttl * 4, serialized); // Longer TTL for L3
  }
}
```

### Query Optimization

```sql
-- Optimize frequently used queries
-- Task queue query with covering index
CREATE INDEX CONCURRENTLY idx_tasks_queue_covering 
ON tasks (status, priority DESC, created_at ASC) 
INCLUDE (id, text, assigned_to);

-- Partial index for active tasks only
CREATE INDEX CONCURRENTLY idx_tasks_active 
ON tasks (priority DESC, created_at ASC) 
WHERE status IN ('pending', 'in_progress');

-- Materialized view for dashboard metrics
CREATE MATERIALIZED VIEW task_metrics AS
SELECT 
    DATE(created_at) as date,
    status,
    COUNT(*) as count,
    AVG(priority) as avg_priority,
    MIN(created_at) as first_created,
    MAX(created_at) as last_created
FROM tasks 
GROUP BY DATE(created_at), status;

-- Refresh materialized view periodically
SELECT cron.schedule('refresh-task-metrics', '*/15 * * * *', 'REFRESH MATERIALIZED VIEW task_metrics;');
```

## Monitoring Scaled Systems

### Distributed Tracing

```typescript
// OpenTelemetry setup for distributed tracing
import { NodeSDK } from '@opentelemetry/sdk-node';
import { jaegerExporter } from '@opentelemetry/exporter-jaeger';

const sdk = new NodeSDK({
  serviceName: 'claudebench',
  traceExporter: new jaegerExporter({
    endpoint: 'http://jaeger-collector:14268/api/traces',
  }),
  instrumentations: [
    // Auto-instrumentation for common libraries
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
    new RedisInstrumentation(),
    new PgInstrumentation()
  ]
});

sdk.start();

// Manual span creation for business logic
import { trace, context } from '@opentelemetry/api';

export async function processTask(taskId: string): Promise<void> {
  const tracer = trace.getTracer('claudebench');
  
  const span = tracer.startSpan('process_task');
  span.setAttributes({
    'task.id': taskId,
    'service.name': 'claudebench'
  });
  
  try {
    await context.with(trace.setSpan(context.active(), span), async () => {
      const task = await this.getTask(taskId);
      await this.validateTask(task);
      await this.executeTask(task);
      await this.completeTask(taskId);
    });
    
    span.setStatus({ code: trace.SpanStatusCode.OK });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({ 
      code: trace.SpanStatusCode.ERROR, 
      message: (error as Error).message 
    });
    throw error;
  } finally {
    span.end();
  }
}
```

## Best Practices

### 1. Scaling Strategy
- **Plan for Growth**: Design for 10x current load
- **Monitor Leading Indicators**: Queue sizes, response times
- **Scale Components Independently**: Don't scale everything together
- **Use Circuit Breakers**: Prevent cascade failures

### 2. Data Strategy
- **Partition Data**: By tenant, time, or geography
- **Cache Strategically**: Hot data in memory, warm in Redis
- **Archive Old Data**: Keep active dataset manageable
- **Monitor Query Performance**: Identify slow queries early

### 3. Deployment Strategy
- **Blue-Green Deployments**: Zero-downtime updates
- **Canary Releases**: Gradual rollout of changes
- **Feature Flags**: Control feature availability
- **Rollback Plans**: Quick recovery procedures

### 4. Operational Excellence
- **Automate Everything**: Scaling, deployments, monitoring
- **Document Runbooks**: Standard operating procedures
- **Practice Disaster Recovery**: Regular failure drills
- **Capacity Planning**: Forecast growth and requirements

For specific deployment patterns and infrastructure automation, see the [Deployment Guide](deployment.md) and [Monitoring Guide](monitoring.md).