# Installation Guide

Detailed setup instructions for ClaudeBench development and production environments.

## System Requirements

### Minimum Requirements
- **CPU**: 2 cores
- **RAM**: 4GB
- **Storage**: 2GB free space
- **OS**: macOS, Linux, or Windows (WSL2)

### Recommended Requirements
- **CPU**: 4+ cores
- **RAM**: 8GB+
- **Storage**: 10GB+ free space (for logs and backups)

## Dependencies Installation

### 1. Bun Runtime

**macOS/Linux**:
```bash
curl -fsSL https://bun.sh/install | bash
```

**Windows** (PowerShell):
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

**Verify Installation**:
```bash
bun --version  # Should be >= 1.2.0
```

### 2. Redis Setup

**Option A: Docker (Recommended)**
```bash
# Redis will be automatically started with bun dev
# No separate installation needed
```

**Option B: Native Installation**

**macOS**:
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server
```

**Windows**:
```bash
# Use WSL2 or Docker Desktop
```

### 3. PostgreSQL Setup

**Option A: Docker (Recommended)**
```bash
# PostgreSQL will be managed by the project
# No separate installation needed
```

**Option B: Native Installation**

**macOS**:
```bash
brew install postgresql@14
brew services start postgresql@14
createdb claudebench
```

**Ubuntu/Debian**:
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
sudo -u postgres createdb claudebench
```

## Project Setup

### 1. Clone Repository

```bash
git clone https://github.com/fblgit/claudebench.git
cd claudebench
```

### 2. Install Dependencies

```bash
# Install all project dependencies
bun install

# Verify installation
bun check-types  # Should complete without errors
```

### 3. Environment Configuration

```bash
# Copy environment templates
cp .env.example .env
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

### 4. Configure Environment Variables

**apps/server/.env**:
```bash
# Database Configuration
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/claudebench"

# Redis Configuration (optional, uses defaults if not set)
REDIS_HOST="localhost"
REDIS_PORT="6379"

# CORS Configuration
CORS_ORIGIN="http://localhost:3001"

# Auth Configuration (if using authentication)
BETTER_AUTH_SECRET="your-secret-here"
BETTER_AUTH_URL="http://localhost:3000"
```

**apps/web/.env**:
```bash
# API Endpoint
VITE_API_URL="http://localhost:3000"

# WebSocket Endpoint
VITE_WS_URL="ws://localhost:3000"
```

### 5. Database Setup

```bash
# Start PostgreSQL (Docker)
bun db:start

# Generate Prisma client
bun db:generate

# Run database migrations
bun db:push

# (Optional) Seed with test data
bun db:seed
```

### 6. Verify Installation

```bash
# Run all services
bun dev

# In another terminal, run tests
bun test

# Check the relay (optional)
bun relay
```

## Production Installation

### 1. Environment Variables

Set production values for:

```bash
# apps/server/.env
DATABASE_URL="postgresql://user:password@prod-host:5432/claudebench"
REDIS_HOST="prod-redis-host"
REDIS_PORT="6379"
CORS_ORIGIN="https://yourdomain.com"
BETTER_AUTH_SECRET="strong-random-secret"
NODE_ENV="production"
```

### 2. Build for Production

```bash
# Build all applications
bun build

# Optionally compile to binary (faster startup)
bun compile
```

### 3. Database Setup

```bash
# Run migrations in production
bun db:migrate

# Create production user (PostgreSQL)
psql -c "CREATE USER claudebench WITH PASSWORD 'secure-password';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE claudebench TO claudebench;"
```

### 4. Process Management

**Option A: systemd (Linux)**
```bash
# Create service files
sudo cp deployment/claudebench-server.service /etc/systemd/system/
sudo cp deployment/claudebench-web.service /etc/systemd/system/

# Enable and start services
sudo systemctl enable claudebench-server claudebench-web
sudo systemctl start claudebench-server claudebench-web
```

**Option B: PM2**
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

**Option C: Docker**
```bash
# Build and run with Docker
docker-compose -f docker-compose.prod.yml up -d
```

## Security Considerations

### 1. Database Security
```bash
# Change default PostgreSQL passwords
ALTER USER postgres PASSWORD 'strong-password';

# Create dedicated user for ClaudeBench
CREATE USER claudebench_app WITH PASSWORD 'app-password';
GRANT CONNECT ON DATABASE claudebench TO claudebench_app;
```

### 2. Redis Security
```bash
# Set Redis password in redis.conf
requirepass your-strong-redis-password

# Disable dangerous commands
rename-command FLUSHDB ""
rename-command FLUSHALL ""
```

### 3. Network Security
```bash
# Firewall rules (ufw example)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw deny 3000/tcp   # Block direct API access
sudo ufw deny 5432/tcp   # Block direct DB access
sudo ufw deny 6379/tcp   # Block direct Redis access
```

## Monitoring Setup

### 1. Health Checks
```bash
# Add to crontab for monitoring
*/5 * * * * curl -f http://localhost:3000/health || echo "ClaudeBench down" | mail admin@company.com
```

### 2. Log Management
```bash
# Configure log rotation in /etc/logrotate.d/claudebench
/var/log/claudebench/*.log {
    daily
    rotate 30
    compress
    missingok
    notifempty
    create 644 claudebench claudebench
}
```

## Backup Setup

```bash
# Automated daily backups
echo "0 2 * * * cd /opt/claudebench && bun db:backup daily-$(date +%Y%m%d).tar.gz" | crontab -
```

## Troubleshooting Installation

### Common Issues

**Bun installation fails**:
```bash
# Try alternative installation method
npm install -g bun
# Or download binary manually from https://github.com/oven-sh/bun/releases
```

**Permission errors**:
```bash
# Fix npm/bun permissions
sudo chown -R $(whoami) ~/.bun
sudo chown -R $(whoami) ~/.npm
```

**Port conflicts**:
```bash
# Check what's using the port
netstat -tulpn | grep :3000
# Kill the process or configure different ports
```

**Database connection issues**:
```bash
# Test PostgreSQL connection
psql -h localhost -U postgres -d claudebench -c "SELECT version();"

# Test Redis connection
redis-cli ping
```

**Memory issues during build**:
```bash
# Increase Node.js memory limit
export NODE_OPTIONS="--max-old-space-size=4096"
bun build
```

## Next Steps

- **Configuration**: [Configuration Guide](configuration.md)
- **Creating Handlers**: [Creating Handlers Guide](creating-handlers.md)
- **Testing**: [Testing Guide](testing.md)
- **Deployment**: [Deployment Guide](deployment.md)