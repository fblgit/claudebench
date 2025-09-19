# Configuration Guide

Comprehensive guide to configuring ClaudeBench for different environments and use cases.

## Environment Variables

ClaudeBench uses environment variables for configuration across three layers:

1. **Root `.env`** - Global project settings
2. **`apps/server/.env`** - Backend configuration
3. **`apps/web/.env`** - Frontend configuration

### Root Configuration (`.env`)

```bash
# Development/Production Mode
NODE_ENV=development  # or 'production'

# Global timeouts (in milliseconds)
DEFAULT_TIMEOUT=30000
REDIS_TIMEOUT=5000
DATABASE_TIMEOUT=10000

# Logging Level
LOG_LEVEL=info  # debug, info, warn, error

# Performance Settings
MAX_CONCURRENT_TASKS=100
RATE_LIMIT_WINDOW=60000  # 1 minute
```

### Server Configuration (`apps/server/.env`)

#### Database Settings

```bash
# PostgreSQL Connection
DATABASE_URL="postgresql://user:password@host:port/database"

# Connection Pool Settings
DATABASE_MAX_CONNECTIONS=20
DATABASE_POOL_TIMEOUT=10000
DATABASE_IDLE_TIMEOUT=30000
```

#### Redis Settings

```bash
# Redis Connection
REDIS_HOST="localhost"
REDIS_PORT="6379"
REDIS_PASSWORD=""  # Optional
REDIS_DB=0         # Database number (0-15)

# Redis Connection Pool
REDIS_MAX_CONNECTIONS=20
REDIS_RETRY_DELAY=100
REDIS_RETRY_ATTEMPTS=3

# Redis Key Prefix (default: 'cb')
REDIS_PREFIX="cb"

# Stream Settings
REDIS_STREAM_MAX_LENGTH=10000
REDIS_STREAM_TRIM_STRATEGY="MAXLEN"
```

#### Security Settings

```bash
# CORS Configuration
CORS_ORIGIN="http://localhost:3001"  # Comma-separated for multiple origins
CORS_CREDENTIALS=true

# API Rate Limiting
API_RATE_LIMIT=1000      # Requests per minute
API_RATE_WINDOW=60000    # Window in milliseconds

# Authentication (if enabled)
BETTER_AUTH_SECRET="your-256-bit-secret"
BETTER_AUTH_URL="http://localhost:3000"
JWT_EXPIRATION="7d"
```

#### Performance Settings

```bash
# Event Processing
EVENT_BATCH_SIZE=100
EVENT_FLUSH_INTERVAL=1000
EVENT_MAX_RETRIES=3

# Circuit Breaker Defaults
CIRCUIT_FAILURE_THRESHOLD=5
CIRCUIT_TIMEOUT=30000
CIRCUIT_RECOVERY_TIMEOUT=60000

# Cache Settings
CACHE_DEFAULT_TTL=300    # 5 minutes
CACHE_MAX_SIZE=1000      # Maximum cached items
```

### Frontend Configuration (`apps/web/.env`)

```bash
# API Endpoints
VITE_API_URL="http://localhost:3000"
VITE_WS_URL="ws://localhost:3000"

# UI Settings
VITE_THEME="system"  # light, dark, system
VITE_AUTO_REFRESH=true
VITE_REFRESH_INTERVAL=5000  # milliseconds

# Feature Flags
VITE_ENABLE_SWARM=true
VITE_ENABLE_METRICS=true
VITE_ENABLE_DEBUG=false  # Show debug info in UI

# Performance
VITE_DEBOUNCE_DELAY=300
VITE_PAGINATION_SIZE=50
```

## Configuration Files

### TypeScript Configuration

**`tsconfig.json`** (shared configuration):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "lib": ["ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

### Database Configuration

**`prisma.config.ts`**:
```typescript
import { defineConfig } from '@prisma/cli'

export default defineConfig({
  schema: 'apps/server/prisma/schema',
  output: 'apps/server/src/db/generated',
  engineType: 'library',
  generator: {
    provider: 'prisma-client-js',
    output: '../src/db/generated',
    engineType: 'library'
  }
})
```

### Build Configuration

**`turbo.json`**:
```json
{
  "pipeline": {
    "dev": {
      "cache": false,
      "persistent": true
    },
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

### Code Quality Configuration

**`biome.json`**:
```json
{
  "formatter": {
    "enabled": true,
    "indentStyle": "tab",
    "indentWidth": 2
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true
    }
  },
  "organizeImports": {
    "enabled": true
  }
}
```

## Environment-Specific Configuration

### Development Environment

**Features**:
- Hot reload enabled
- Verbose logging
- Debug tools enabled
- Relaxed rate limits

```bash
NODE_ENV=development
LOG_LEVEL=debug
API_RATE_LIMIT=10000
CACHE_DEFAULT_TTL=30
VITE_ENABLE_DEBUG=true
```

### Testing Environment

**Features**:
- Isolated test database
- Higher rate limits
- Shorter timeouts
- No caching

```bash
NODE_ENV=test
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/claudebench_test"
REDIS_DB=1
API_RATE_LIMIT=50000
CACHE_DEFAULT_TTL=0
DEFAULT_TIMEOUT=5000
```

### Production Environment

**Features**:
- Optimized performance
- Security hardening
- Monitoring enabled
- Rate limiting active

```bash
NODE_ENV=production
LOG_LEVEL=warn
API_RATE_LIMIT=1000
CACHE_DEFAULT_TTL=300
CORS_ORIGIN="https://yourdomain.com"
REDIS_MAX_CONNECTIONS=50
DATABASE_MAX_CONNECTIONS=30
```

## Handler Configuration

### Rate Limiting Configuration

```typescript
// Global rate limit defaults in environment
API_RATE_LIMIT=1000          # API endpoint limit
HOOK_RATE_LIMIT=2000         # Hook operations
SYSTEM_RATE_LIMIT=500        # System operations
TASK_RATE_LIMIT=200          # Task operations
```

### Circuit Breaker Configuration

```typescript
// Global circuit breaker settings
CIRCUIT_FAILURE_THRESHOLD=5      # Failures before opening
CIRCUIT_TIMEOUT=30000           # Time before retry (ms)
CIRCUIT_RECOVERY_TIMEOUT=60000   # Time to wait in open state
```

### Cache Configuration

```typescript
// Per-handler cache TTL overrides
CACHE_HOOK_VALIDATION_TTL=300    # 5 minutes
CACHE_SYSTEM_HEALTH_TTL=30       # 30 seconds  
CACHE_USER_PROMPT_TTL=120        # 2 minutes
CACHE_TASK_READ_TTL=60           # 1 minute
```

## Logging Configuration

### Log Levels

```bash
LOG_LEVEL=debug   # All messages
LOG_LEVEL=info    # Info, warn, error
LOG_LEVEL=warn    # Warnings and errors only
LOG_LEVEL=error   # Errors only
```

### Log Outputs

```typescript
// Configure in apps/server/src/lib/logger.ts
export const logger = {
  transports: [
    new Console({
      level: process.env.LOG_LEVEL || 'info',
      format: combine(timestamp(), colorize(), simple())
    }),
    new File({
      filename: 'logs/combined.log',
      level: 'info',
      format: combine(timestamp(), json())
    }),
    new File({
      filename: 'logs/error.log',
      level: 'error',
      format: combine(timestamp(), json())
    })
  ]
}
```

## Monitoring Configuration

### Health Check Configuration

```bash
# Health check intervals
HEALTH_CHECK_INTERVAL=30000      # 30 seconds
HEALTH_CHECK_TIMEOUT=5000        # 5 seconds
HEALTH_CHECK_RETRIES=3

# Health check endpoints
HEALTH_CHECK_REDIS=true
HEALTH_CHECK_DATABASE=true
HEALTH_CHECK_EXTERNAL_APIS=false
```

### Metrics Configuration

```bash
# Metrics collection
METRICS_ENABLED=true
METRICS_INTERVAL=10000           # 10 seconds
METRICS_RETENTION=86400000       # 24 hours in ms
METRICS_BATCH_SIZE=100

# Prometheus metrics (if enabled)
PROMETHEUS_PORT=9090
PROMETHEUS_ENDPOINT="/metrics"
```

## Security Configuration

### Authentication Configuration

```bash
# JWT Settings
JWT_SECRET="your-jwt-secret"
JWT_EXPIRATION="7d"
JWT_REFRESH_EXPIRATION="30d"

# Session Settings  
SESSION_SECRET="your-session-secret"
SESSION_MAX_AGE=86400000         # 24 hours
SESSION_SECURE=false             # Set to true in production with HTTPS
```

### CORS Configuration

```bash
# Single origin
CORS_ORIGIN="https://yourdomain.com"

# Multiple origins (comma-separated)
CORS_ORIGIN="https://app.com,https://admin.com"

# Development (allow all)
CORS_ORIGIN="*"
```

### Rate Limiting Configuration

```bash
# Global API rate limiting
API_RATE_LIMIT=1000              # Requests per minute
API_RATE_WINDOW=60000            # Window in milliseconds

# Per-endpoint overrides
RATE_LIMIT_TASK_CREATE=100
RATE_LIMIT_SYSTEM_HEALTH=500
RATE_LIMIT_HOOK_VALIDATE=2000
```

## Advanced Configuration

### Redis Clustering

```bash
# Redis Cluster Configuration
REDIS_CLUSTER=true
REDIS_CLUSTER_NODES="127.0.0.1:7000,127.0.0.1:7001,127.0.0.1:7002"
REDIS_CLUSTER_MAX_REDIRECTIONS=16
REDIS_CLUSTER_RETRY_DELAY=100
```

### Database Sharding

```bash
# Multiple database connections
DATABASE_WRITE_URL="postgresql://..."
DATABASE_READ_URL="postgresql://..."
DATABASE_SHARD_COUNT=4
```

### Event Processing

```bash
# Event stream configuration
EVENT_STREAM_BUFFER_SIZE=1000
EVENT_STREAM_CONSUMER_COUNT=4
EVENT_STREAM_BATCH_SIZE=50
EVENT_STREAM_TIMEOUT=5000
```

## Configuration Validation

ClaudeBench validates configuration at startup:

```typescript
// Configuration schema validation
const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.string().url(),
  REDIS_HOST: z.string(),
  REDIS_PORT: z.coerce.number().min(1).max(65535),
  API_RATE_LIMIT: z.coerce.number().min(1),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error'])
})
```

## Configuration Best Practices

### 1. Environment Separation
- Use different configuration files for each environment
- Never commit sensitive values to version control
- Use environment variable injection in production

### 2. Security
- Rotate secrets regularly
- Use strong, random values for secrets
- Implement proper CORS policies
- Enable rate limiting in production

### 3. Performance
- Tune connection pools based on load
- Configure appropriate cache TTLs
- Set reasonable timeouts
- Monitor and adjust rate limits

### 4. Monitoring
- Enable health checks in production
- Configure log retention policies  
- Set up alerting thresholds
- Track key performance metrics

## Troubleshooting Configuration

### Common Issues

**Environment variables not loading**:
```bash
# Check file locations
ls -la .env apps/server/.env apps/web/.env

# Verify variable names (case-sensitive)
env | grep REDIS
```

**Database connection issues**:
```bash
# Test connection string
psql "$DATABASE_URL" -c "SELECT 1;"

# Check encoding
echo $DATABASE_URL | base64 -d  # if encoded
```

**Redis connection problems**:
```bash
# Test Redis connection
redis-cli -h $REDIS_HOST -p $REDIS_PORT ping

# Check Redis configuration
redis-cli CONFIG GET "*"
```

For more troubleshooting help, see the [Debugging Guide](debugging.md).