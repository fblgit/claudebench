# WebSocket Events Guide

Real-time event streaming and WebSocket integration guide for ClaudeBench applications.

## Overview

ClaudeBench provides real-time event streaming through WebSocket connections, enabling:

- **Live Dashboard Updates**: Real-time task status changes
- **Event Monitoring**: Live system events and metrics
- **Collaborative Features**: Multi-user real-time interactions
- **System Notifications**: Instant alerts and status updates

## WebSocket Architecture

### Connection Flow

```
Client (Browser/App) 
    ↕ WebSocket Connection
Web Server (Port 3001)
    ↕ Server-Sent Events / WebSocket
API Server (Port 3000)
    ↕ Redis Pub/Sub
Redis Event Streams
```

### Event Flow

1. **Handler Execution** → Publishes event to Redis
2. **Redis Pub/Sub** → Broadcasts to all connected servers
3. **WebSocket Server** → Sends to connected clients
4. **Client Application** → Updates UI in real-time

## Client-Side Integration

### Web Browser (JavaScript)

**Basic WebSocket Connection**:
```javascript
// Connect to WebSocket server
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = function(event) {
  console.log('Connected to ClaudeBench events');
  
  // Subscribe to specific events
  ws.send(JSON.stringify({
    type: 'subscribe',
    events: ['task.*', 'system.health']
  }));
};

ws.onmessage = function(event) {
  const data = JSON.parse(event.data);
  handleRealtimeEvent(data);
};

ws.onclose = function(event) {
  console.log('WebSocket connection closed:', event.code);
  // Implement reconnection logic
  setTimeout(connectWebSocket, 1000);
};

ws.onerror = function(error) {
  console.error('WebSocket error:', error);
};

// Handle incoming events
function handleRealtimeEvent(event) {
  switch (event.type) {
    case 'task.created':
      updateTaskList(event.payload);
      break;
      
    case 'task.completed':
      markTaskCompleted(event.payload.id);
      break;
      
    case 'system.health':
      updateSystemStatus(event.payload);
      break;
      
    default:
      console.log('Unhandled event:', event);
  }
}
```

**React Hook for WebSocket**:
```tsx
// hooks/useWebSocket.ts
import { useEffect, useState, useRef } from 'react';

interface WebSocketEvent {
  type: string;
  payload: any;
  metadata?: {
    timestamp: string;
    instanceId?: string;
  };
}

export function useWebSocket(url: string, subscriptions: string[] = []) {
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<WebSocketEvent | null>(null);
  const ws = useRef<WebSocket | null>(null);
  
  useEffect(() => {
    const connect = () => {
      ws.current = new WebSocket(url);
      
      ws.current.onopen = () => {
        setIsConnected(true);
        
        // Subscribe to events
        if (subscriptions.length > 0) {
          ws.current?.send(JSON.stringify({
            type: 'subscribe',
            events: subscriptions
          }));
        }
      };
      
      ws.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setLastEvent(data);
        setEvents(prev => [...prev.slice(-99), data]); // Keep last 100 events
      };
      
      ws.current.onclose = () => {
        setIsConnected(false);
        // Reconnect after delay
        setTimeout(connect, 1000);
      };
      
      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    };
    
    connect();
    
    return () => {
      ws.current?.close();
    };
  }, [url, subscriptions]);
  
  const sendMessage = (message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  };
  
  return { isConnected, events, lastEvent, sendMessage };
}

// Usage in component
function TaskDashboard() {
  const { isConnected, lastEvent } = useWebSocket('ws://localhost:3000/ws', [
    'task.*',
    'system.health'
  ]);
  
  const [tasks, setTasks] = useState([]);
  
  useEffect(() => {
    if (lastEvent?.type === 'task.created') {
      setTasks(prev => [...prev, lastEvent.payload]);
    } else if (lastEvent?.type === 'task.completed') {
      setTasks(prev => prev.map(task => 
        task.id === lastEvent.payload.id 
          ? { ...task, status: 'completed' }
          : task
      ));
    }
  }, [lastEvent]);
  
  return (
    <div>
      <div className={`status ${isConnected ? 'connected' : 'disconnected'}`}>
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>
      
      <div className="tasks">
        {tasks.map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
    </div>
  );
}
```

### Node.js Client

```typescript
// Node.js WebSocket client
import WebSocket from 'ws';

class ClaudeBenchClient {
  private ws: WebSocket | null = null;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private subscriptions: Set<string> = new Set();
  
  constructor(private url: string) {}
  
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      
      this.ws.on('open', () => {
        console.log('Connected to ClaudeBench');
        this.subscribeToEvents();
        resolve();
      });
      
      this.ws.on('message', (data: string) => {
        try {
          const event = JSON.parse(data);
          this.handleEvent(event);
        } catch (error) {
          console.error('Failed to parse event:', error);
        }
      });
      
      this.ws.on('close', () => {
        console.log('WebSocket connection closed');
        this.scheduleReconnect();
      });
      
      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });
    });
  }
  
  subscribe(patterns: string[]): void {
    patterns.forEach(pattern => this.subscriptions.add(pattern));
    this.subscribeToEvents();
  }
  
  private subscribeToEvents(): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.subscriptions.size > 0) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        events: Array.from(this.subscriptions)
      }));
    }
  }
  
  private handleEvent(event: any): void {
    // Emit events for different handlers
    this.emit('event', event);
    this.emit(event.type, event.payload, event.metadata);
  }
  
  private scheduleReconnect(): void {
    if (this.reconnectInterval) return;
    
    this.reconnectInterval = setTimeout(() => {
      this.reconnectInterval = null;
      this.connect().catch(console.error);
    }, 1000);
  }
  
  close(): void {
    if (this.reconnectInterval) {
      clearTimeout(this.reconnectInterval);
      this.reconnectInterval = null;
    }
    this.ws?.close();
  }
}

// Usage
const client = new ClaudeBenchClient('ws://localhost:3000/ws');

await client.connect();
client.subscribe(['task.*', 'swarm.*']);

client.on('task.created', (task, metadata) => {
  console.log('New task created:', task);
});

client.on('swarm.decompose', (decomposition, metadata) => {
  console.log('Task decomposed:', decomposition);
});
```

## Server-Side WebSocket Implementation

### WebSocket Server Setup

```typescript
// src/websocket/server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { parse } from 'url';
import { redis } from '@/core/redis';

interface SubscriptionClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  id: string;
}

export class EventWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<string, SubscriptionClient> = new Map();
  private redisSubscriber: typeof redis;
  
  constructor(private port: number) {
    const server = createServer();
    
    this.wss = new WebSocketServer({
      server,
      path: '/ws'
    });
    
    this.redisSubscriber = redis.duplicate();
    this.setupWebSocketHandlers();
    this.setupRedisSubscription();
    
    server.listen(port, () => {
      console.log(`WebSocket server listening on port ${port}`);
    });
  }
  
  private setupWebSocketHandlers(): void {
    this.wss.on('connection', (ws, request) => {
      const clientId = this.generateClientId();
      const client: SubscriptionClient = {
        ws,
        subscriptions: new Set(),
        id: clientId
      };
      
      this.clients.set(clientId, client);
      
      ws.on('message', (data) => {
        this.handleClientMessage(client, data.toString());
      });
      
      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`Client ${clientId} disconnected`);
      });
      
      ws.on('error', (error) => {
        console.error(`Client ${clientId} error:`, error);
        this.clients.delete(clientId);
      });
      
      // Send welcome message
      this.sendToClient(client, {
        type: 'connection.established',
        payload: { clientId },
        metadata: { timestamp: new Date().toISOString() }
      });
      
      console.log(`Client ${clientId} connected`);
    });
  }
  
  private setupRedisSubscription(): void {
    // Subscribe to all ClaudeBench events
    this.redisSubscriber.psubscribe('cb:events:*');
    
    this.redisSubscriber.on('pmessage', (pattern, channel, message) => {
      try {
        const event = JSON.parse(message);
        this.broadcastEvent(event);
      } catch (error) {
        console.error('Failed to parse Redis event:', error);
      }
    });
  }
  
  private handleClientMessage(client: SubscriptionClient, message: string): void {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'subscribe':
          this.handleSubscription(client, data.events || []);
          break;
          
        case 'unsubscribe':
          this.handleUnsubscription(client, data.events || []);
          break;
          
        case 'ping':
          this.sendToClient(client, { type: 'pong', payload: {}, metadata: {} });
          break;
          
        default:
          console.warn(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Failed to parse client message:', error);
    }
  }
  
  private handleSubscription(client: SubscriptionClient, events: string[]): void {
    events.forEach(event => client.subscriptions.add(event));
    
    this.sendToClient(client, {
      type: 'subscription.confirmed',
      payload: { 
        subscriptions: Array.from(client.subscriptions),
        count: client.subscriptions.size
      },
      metadata: { timestamp: new Date().toISOString() }
    });
    
    console.log(`Client ${client.id} subscribed to:`, events);
  }
  
  private handleUnsubscription(client: SubscriptionClient, events: string[]): void {
    events.forEach(event => client.subscriptions.delete(event));
    
    this.sendToClient(client, {
      type: 'subscription.updated',
      payload: { 
        subscriptions: Array.from(client.subscriptions),
        count: client.subscriptions.size
      },
      metadata: { timestamp: new Date().toISOString() }
    });
  }
  
  private broadcastEvent(event: any): void {
    for (const client of this.clients.values()) {
      if (this.shouldReceiveEvent(client, event.type)) {
        this.sendToClient(client, event);
      }
    }
  }
  
  private shouldReceiveEvent(client: SubscriptionClient, eventType: string): boolean {
    for (const subscription of client.subscriptions) {
      if (this.matchesPattern(eventType, subscription)) {
        return true;
      }
    }
    return false;
  }
  
  private matchesPattern(eventType: string, pattern: string): boolean {
    // Simple glob pattern matching
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return eventType.startsWith(prefix);
    }
    return eventType === pattern;
  }
  
  private sendToClient(client: SubscriptionClient, message: any): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
  
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  getConnectedClients(): number {
    return this.clients.size;
  }
  
  getClientSubscriptions(): Map<string, string[]> {
    const subscriptions = new Map<string, string[]>();
    for (const [id, client] of this.clients) {
      subscriptions.set(id, Array.from(client.subscriptions));
    }
    return subscriptions;
  }
}
```

### Integration with Handler Events

```typescript
// Automatic event broadcasting from handlers
@EventHandler({
  event: "task.create",
  inputSchema: taskCreateInput,
  outputSchema: taskCreateOutput,
  // ... other config
})
export class TaskCreateHandler {
  async handle(input: TaskCreateInput, ctx: EventContext): Promise<TaskCreateOutput> {
    // Handler logic
    const task = await this.createTask(input);
    
    // This automatically broadcasts via WebSocket
    await ctx.publish({
      type: "task.created",
      payload: {
        id: task.id,
        text: task.text,
        status: task.status,
        priority: task.priority,
        createdAt: task.createdAt
      },
      metadata: {
        timestamp: new Date().toISOString(),
        instanceId: ctx.instanceId
      }
    });
    
    return task;
  }
}

// Manual event broadcasting
export class CustomEventBroadcaster {
  constructor(private redis: RedisClient) {}
  
  async broadcastCustomEvent(event: any): Promise<void> {
    // Publish to Redis (will be picked up by WebSocket server)
    await this.redis.publish('cb:events:custom', JSON.stringify({
      type: event.type,
      payload: event.payload,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'custom-broadcaster'
      }
    }));
  }
}
```

## Event Filtering and Subscriptions

### Pattern-Based Subscriptions

```typescript
// Subscription patterns
const subscriptions = [
  'task.*',           // All task events
  'system.health',    // Specific system health events
  'swarm.decompose',  // Specific swarm events
  '*.error',          // All error events
  '*'                 // All events (use carefully)
];

// Advanced filtering
class EventFilter {
  static tasksByPriority(minPriority: number) {
    return (event: any) => {
      return event.type.startsWith('task.') && 
             event.payload.priority >= minPriority;
    };
  }
  
  static systemCritical() {
    return (event: any) => {
      return event.type.startsWith('system.') && 
             event.metadata?.severity === 'critical';
    };
  }
  
  static userSpecific(userId: string) {
    return (event: any) => {
      return event.payload.userId === userId ||
             event.metadata?.userId === userId;
    };
  }
}

// Client-side filtering
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  // Apply client-side filters
  if (EventFilter.tasksByPriority(80)(data)) {
    handleHighPriorityTask(data);
  }
  
  if (EventFilter.systemCritical()(data)) {
    showCriticalAlert(data);
  }
};
```

### Subscription Management

```typescript
// Dynamic subscription management
class SubscriptionManager {
  private subscriptions: Set<string> = new Set();
  
  constructor(private ws: WebSocket) {}
  
  subscribe(patterns: string[]): void {
    const newPatterns = patterns.filter(p => !this.subscriptions.has(p));
    
    if (newPatterns.length > 0) {
      newPatterns.forEach(p => this.subscriptions.add(p));
      
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        events: newPatterns
      }));
    }
  }
  
  unsubscribe(patterns: string[]): void {
    const existingPatterns = patterns.filter(p => this.subscriptions.has(p));
    
    if (existingPatterns.length > 0) {
      existingPatterns.forEach(p => this.subscriptions.delete(p));
      
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        events: existingPatterns
      }));
    }
  }
  
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }
  
  clear(): void {
    if (this.subscriptions.size > 0) {
      this.unsubscribe(Array.from(this.subscriptions));
    }
  }
}
```

## Real-time Dashboard Implementation

### Task Dashboard with Live Updates

```tsx
// components/TaskDashboard.tsx
import React, { useState, useEffect } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';

interface Task {
  id: string;
  text: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: number;
  createdAt: string;
  assignedTo?: string;
}

export function TaskDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<string>('all');
  
  const { isConnected, lastEvent } = useWebSocket('ws://localhost:3000/ws', [
    'task.*'
  ]);
  
  // Handle real-time events
  useEffect(() => {
    if (!lastEvent) return;
    
    switch (lastEvent.type) {
      case 'task.created':
        setTasks(prev => [lastEvent.payload, ...prev]);
        break;
        
      case 'task.updated':
        setTasks(prev => prev.map(task => 
          task.id === lastEvent.payload.id 
            ? { ...task, ...lastEvent.payload }
            : task
        ));
        break;
        
      case 'task.assigned':
        setTasks(prev => prev.map(task => 
          task.id === lastEvent.payload.taskId
            ? { ...task, status: 'in_progress', assignedTo: lastEvent.payload.assignedTo }
            : task
        ));
        break;
        
      case 'task.completed':
        setTasks(prev => prev.map(task => 
          task.id === lastEvent.payload.taskId
            ? { ...task, status: 'completed' }
            : task
        ));
        break;
    }
  }, [lastEvent]);
  
  const filteredTasks = tasks.filter(task => {
    if (filter === 'all') return true;
    return task.status === filter;
  });
  
  return (
    <div className="task-dashboard">
      <header>
        <h1>Task Dashboard</h1>
        <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
          {isConnected ? '🟢 Live' : '🔴 Offline'}
        </div>
      </header>
      
      <div className="filters">
        {['all', 'pending', 'in_progress', 'completed'].map(status => (
          <button
            key={status}
            className={filter === status ? 'active' : ''}
            onClick={() => setFilter(status)}
          >
            {status.replace('_', ' ').toUpperCase()}
          </button>
        ))}
      </div>
      
      <div className="task-list">
        {filteredTasks.map(task => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>
      
      {filteredTasks.length === 0 && (
        <div className="empty-state">
          No tasks found for filter: {filter}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <div className={`task-card status-${task.status}`}>
      <div className="task-header">
        <span className="task-id">{task.id}</span>
        <span className={`priority priority-${task.priority >= 80 ? 'high' : task.priority >= 50 ? 'medium' : 'low'}`}>
          P{task.priority}
        </span>
      </div>
      
      <div className="task-content">
        <p>{task.text}</p>
      </div>
      
      <div className="task-meta">
        <span className="status">{task.status.replace('_', ' ')}</span>
        {task.assignedTo && <span className="assignee">{task.assignedTo}</span>}
        <span className="created">{new Date(task.createdAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
```

### System Metrics Dashboard

```tsx
// components/MetricsDashboard.tsx
import React, { useState, useEffect } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';

export function MetricsDashboard() {
  const [metrics, setMetrics] = useState({
    tasksPerSecond: 0,
    activeConnections: 0,
    memoryUsage: 0,
    errorRate: 0
  });
  
  const { isConnected, lastEvent } = useWebSocket('ws://localhost:3000/ws', [
    'system.metrics',
    'system.health',
    'task.created',
    'task.completed'
  ]);
  
  useEffect(() => {
    if (!lastEvent) return;
    
    switch (lastEvent.type) {
      case 'system.metrics':
        setMetrics(lastEvent.payload);
        break;
        
      case 'system.health':
        setMetrics(prev => ({
          ...prev,
          memoryUsage: lastEvent.payload.memoryUsage,
          activeConnections: lastEvent.payload.activeConnections
        }));
        break;
    }
  }, [lastEvent]);
  
  return (
    <div className="metrics-dashboard">
      <div className="metric-card">
        <h3>Tasks/sec</h3>
        <div className="metric-value">{metrics.tasksPerSecond.toFixed(1)}</div>
      </div>
      
      <div className="metric-card">
        <h3>Active Connections</h3>
        <div className="metric-value">{metrics.activeConnections}</div>
      </div>
      
      <div className="metric-card">
        <h3>Memory Usage</h3>
        <div className="metric-value">{(metrics.memoryUsage / 1024 / 1024).toFixed(1)}MB</div>
      </div>
      
      <div className="metric-card">
        <h3>Error Rate</h3>
        <div className="metric-value">{(metrics.errorRate * 100).toFixed(2)}%</div>
      </div>
    </div>
  );
}
```

## Security and Authentication

### WebSocket Authentication

```typescript
// Server-side authentication
import jwt from 'jsonwebtoken';

class AuthenticatedWebSocketServer extends EventWebSocketServer {
  protected setupWebSocketHandlers(): void {
    this.wss.on('connection', async (ws, request) => {
      try {
        // Extract token from query params or headers
        const token = this.extractToken(request);
        const user = await this.verifyToken(token);
        
        // Create authenticated client
        const client: AuthenticatedClient = {
          ...this.createClient(ws),
          user,
          permissions: user.permissions || []
        };
        
        this.clients.set(client.id, client);
        
        // Send authenticated welcome
        this.sendToClient(client, {
          type: 'connection.authenticated',
          payload: { user: user.id, permissions: user.permissions }
        });
        
      } catch (error) {
        ws.close(1008, 'Authentication failed');
        return;
      }
    });
  }
  
  private extractToken(request: any): string {
    const url = parse(request.url, true);
    const token = url.query.token || request.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      throw new Error('No authentication token provided');
    }
    
    return token as string;
  }
  
  private async verifyToken(token: string): Promise<any> {
    try {
      return jwt.verify(token, process.env.JWT_SECRET!);
    } catch (error) {
      throw new Error('Invalid authentication token');
    }
  }
  
  protected shouldReceiveEvent(client: AuthenticatedClient, eventType: string): boolean {
    // Check permissions in addition to subscriptions
    if (!this.hasPermission(client, eventType)) {
      return false;
    }
    
    return super.shouldReceiveEvent(client, eventType);
  }
  
  private hasPermission(client: AuthenticatedClient, eventType: string): boolean {
    // Implement your permission logic
    if (eventType.startsWith('system.') && !client.permissions.includes('system:read')) {
      return false;
    }
    
    return true;
  }
}
```

### Rate Limiting

```typescript
// Rate limiting for WebSocket connections
class RateLimitedWebSocketServer extends EventWebSocketServer {
  private rateLimits = new Map<string, { count: number; resetTime: number }>();
  
  private checkRateLimit(clientId: string): boolean {
    const now = Date.now();
    const limit = this.rateLimits.get(clientId);
    
    if (!limit || now > limit.resetTime) {
      // Reset or create new limit
      this.rateLimits.set(clientId, {
        count: 1,
        resetTime: now + 60000 // 1 minute window
      });
      return true;
    }
    
    if (limit.count >= 100) { // 100 messages per minute
      return false;
    }
    
    limit.count++;
    return true;
  }
  
  protected handleClientMessage(client: SubscriptionClient, message: string): void {
    if (!this.checkRateLimit(client.id)) {
      this.sendToClient(client, {
        type: 'error',
        payload: { message: 'Rate limit exceeded' }
      });
      return;
    }
    
    super.handleClientMessage(client, message);
  }
}
```

## Performance Optimization

### Connection Pooling

```typescript
// Efficient connection management
class OptimizedWebSocketServer extends EventWebSocketServer {
  private connectionPool = {
    maxConnections: 10000,
    currentConnections: 0,
    connectionQueue: new Set<WebSocket>()
  };
  
  protected setupWebSocketHandlers(): void {
    this.wss.on('connection', (ws, request) => {
      // Check connection limits
      if (this.connectionPool.currentConnections >= this.connectionPool.maxConnections) {
        ws.close(1008, 'Server at capacity');
        return;
      }
      
      this.connectionPool.currentConnections++;
      
      // Standard connection handling
      super.setupWebSocketHandlers();
      
      ws.on('close', () => {
        this.connectionPool.currentConnections--;
      });
    });
  }
}
```

### Event Batching

```typescript
// Batch events for better performance
class BatchedEventServer extends EventWebSocketServer {
  private eventBatch = new Map<string, any[]>();
  private batchTimeout: NodeJS.Timeout | null = null;
  
  protected broadcastEvent(event: any): void {
    // Add to batch instead of immediate broadcast
    for (const [clientId, client] of this.clients) {
      if (this.shouldReceiveEvent(client, event.type)) {
        if (!this.eventBatch.has(clientId)) {
          this.eventBatch.set(clientId, []);
        }
        this.eventBatch.get(clientId)!.push(event);
      }
    }
    
    // Schedule batch send
    if (!this.batchTimeout) {
      this.batchTimeout = setTimeout(() => {
        this.flushEventBatch();
      }, 50); // 50ms batching window
    }
  }
  
  private flushEventBatch(): void {
    for (const [clientId, events] of this.eventBatch) {
      const client = this.clients.get(clientId);
      if (client && events.length > 0) {
        this.sendToClient(client, {
          type: 'event.batch',
          payload: { events, count: events.length }
        });
      }
    }
    
    this.eventBatch.clear();
    this.batchTimeout = null;
  }
}
```

## Best Practices

### 1. Connection Management
- **Implement Reconnection Logic**: Handle network interruptions gracefully
- **Use Heartbeat/Ping**: Detect dead connections early
- **Limit Connections**: Prevent resource exhaustion
- **Clean Up Resources**: Properly close connections and clear subscriptions

### 2. Event Design
- **Keep Events Small**: Minimize payload size for performance
- **Use Specific Subscriptions**: Avoid wildcard subscriptions where possible
- **Batch Related Events**: Group related updates together
- **Include Timestamps**: Help with event ordering and debugging

### 3. Security
- **Authenticate Connections**: Verify user identity before establishing connections
- **Implement Rate Limiting**: Prevent abuse and DoS attacks
- **Validate Permissions**: Check user permissions for event types
- **Sanitize Data**: Clean all data before broadcasting

### 4. Performance
- **Use Event Batching**: Reduce message overhead
- **Implement Backpressure**: Handle slow clients gracefully
- **Monitor Memory Usage**: Track client connections and event queues
- **Optimize Subscriptions**: Use efficient pattern matching

For advanced integration patterns, see the [MCP Integration Guide](mcp-integration.md) and [Monitoring Guide](monitoring.md).