# Deployment Guide

Comprehensive guide to deploying ClaudeBench in production environments, from single-server setups to distributed architectures.

## Deployment Options

### 1. Single Server Deployment (Recommended for Start)
- All components on one server
- Suitable for small to medium workloads
- Easy to manage and monitor

### 2. Containerized Deployment
- Docker containers for easy deployment
- Kubernetes orchestration for scaling
- Isolated and reproducible environments

### 3. Distributed Deployment
- Separate servers for different components
- High availability and scalability
- Complex but powerful setup

## Single Server Deployment

### Prerequisites

```bash
# Server Requirements
- CPU: 4+ cores
- RAM: 8GB+ (16GB recommended)
- Storage: 50GB+ SSD
- OS: Ubuntu 20.04+ or similar
- Network: 1Gbps connection
```

### Installation Steps

#### 1. System Preparation

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install required packages
sudo apt install -y curl git build-essential

# Create application user
sudo useradd -m -s /bin/bash claudebench
sudo usermod -aG sudo claudebench
```

#### 2. Install Dependencies

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Install Redis
sudo apt install -y redis-server
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Configure PostgreSQL
sudo -u postgres createdb claudebench
sudo -u postgres createuser claudebench
sudo -u postgres psql -c "ALTER USER claudebench PASSWORD 'secure_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE claudebench TO claudebench;"
```

#### 3. Application Setup

```bash
# Clone repository
git clone https://github.com/fblgit/claudebench.git /opt/claudebench
cd /opt/claudebench

# Install dependencies
bun install

# Build application
bun build

# Set ownership
sudo chown -R claudebench:claudebench /opt/claudebench
```

#### 4. Environment Configuration

```bash
# Production environment file
sudo -u claudebench tee /opt/claudebench/apps/server/.env.production << EOF
NODE_ENV=production
DATABASE_URL="postgresql://claudebench:secure_password@localhost:5432/claudebench"
REDIS_HOST=localhost
REDIS_PORT=6379
CORS_ORIGIN="https://yourdomain.com"
LOG_LEVEL=warn
API_RATE_LIMIT=1000
CIRCUIT_FAILURE_THRESHOLD=5
CIRCUIT_TIMEOUT=30000
EOF
```

#### 5. Database Setup

```bash
# Run migrations
sudo -u claudebench bun db:migrate

# Verify database
sudo -u claudebench bun db:studio --port 5555
```

#### 6. Process Management with systemd

**Server Service**:
```bash
sudo tee /etc/systemd/system/claudebench-server.service << EOF
[Unit]
Description=ClaudeBench Server
After=network.target postgresql.service redis.service
Wants=postgresql.service redis.service

[Service]
Type=simple
User=claudebench
WorkingDirectory=/opt/claudebench
Environment=NODE_ENV=production
Environment=PATH=/home/claudebench/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/claudebench/.bun/bin/bun run apps/server/src/index.ts
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Resource limits
LimitNOFILE=65536
MemoryMax=4G

[Install]
WantedBy=multi-user.target
EOF
```

**Web Service**:
```bash
sudo tee /etc/systemd/system/claudebench-web.service << EOF
[Unit]
Description=ClaudeBench Web
After=network.target claudebench-server.service
Wants=claudebench-server.service

[Service]
Type=simple
User=claudebench
WorkingDirectory=/opt/claudebench
Environment=NODE_ENV=production
Environment=PATH=/home/claudebench/.bun/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/claudebench/.bun/bin/bun run apps/web/src/main.tsx
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Resource limits
LimitNOFILE=65536
MemoryMax=2G

[Install]
WantedBy=multi-user.target
EOF
```

**Enable and Start Services**:
```bash
sudo systemctl daemon-reload
sudo systemctl enable claudebench-server claudebench-web
sudo systemctl start claudebench-server claudebench-web

# Check status
sudo systemctl status claudebench-server
sudo systemctl status claudebench-web
```

#### 7. Reverse Proxy Setup (Nginx)

```bash
# Install Nginx
sudo apt install -y nginx

# Configure Nginx
sudo tee /etc/nginx/sites-available/claudebench << EOF
server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Web app (main site)
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:3000/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # Rate limiting
        limit_req zone=api burst=20 nodelay;
    }
    
    # WebSocket support
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
    }
    
    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }
}

# Rate limiting
http {
    limit_req_zone \$binary_remote_addr zone=api:10m rate=10r/s;
}
EOF

# Enable site
sudo ln -s /etc/nginx/sites-available/claudebench /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 8. SSL Certificate (Let's Encrypt)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## Docker Deployment

### Docker Compose Setup

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  postgres:
    image: postgres:14
    environment:
      POSTGRES_DB: claudebench
      POSTGRES_USER: claudebench
      POSTGRES_PASSWORD: ${DATABASE_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    networks:
      - claudebench
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U claudebench -d claudebench"]
      interval: 30s
      timeout: 10s
      retries: 5

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    networks:
      - claudebench
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5

  server:
    build:
      context: .
      dockerfile: apps/server/Dockerfile
      target: production
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://claudebench:${DATABASE_PASSWORD}@postgres:5432/claudebench
      REDIS_HOST: redis
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      CORS_ORIGIN: https://yourdomain.com
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - claudebench
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      target: production
    environment:
      VITE_API_URL: https://yourdomain.com/api
    depends_on:
      - server
    networks:
      - claudebench
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
    depends_on:
      - web
      - server
    networks:
      - claudebench
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:

networks:
  claudebench:
    driver: bridge
```

### Dockerfile Examples

**Server Dockerfile**:
```dockerfile
# apps/server/Dockerfile
FROM oven/bun:1.2 AS base
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json bun.lockb ./
COPY apps/server/package.json ./apps/server/
RUN bun install --frozen-lockfile

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production
FROM base AS production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 bun
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER bun
EXPOSE 3000
CMD ["bun", "run", "dist/index.js"]
```

**Web Dockerfile**:
```dockerfile
# apps/web/Dockerfile  
FROM node:18-alpine AS base
WORKDIR /app

# Dependencies
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
RUN npm ci --only=production

# Build
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production
FROM nginx:alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Docker Deployment

```bash
# Create environment file
tee .env.prod << EOF
DATABASE_PASSWORD=secure_db_password
REDIS_PASSWORD=secure_redis_password
DOMAIN=yourdomain.com
EOF

# Deploy
docker-compose -f docker-compose.prod.yml up -d

# Run migrations
docker-compose -f docker-compose.prod.yml exec server bun db:migrate

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Kubernetes Deployment

### Namespace and ConfigMap

```yaml
# k8s/namespace.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: claudebench

---
# k8s/configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: claudebench-config
  namespace: claudebench
data:
  NODE_ENV: "production"
  LOG_LEVEL: "warn"
  REDIS_HOST: "redis-service"
  CORS_ORIGIN: "https://yourdomain.com"
```

### Database Deployment

```yaml
# k8s/postgres.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: claudebench
spec:
  serviceName: postgres-service
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:14
        env:
        - name: POSTGRES_DB
          value: claudebench
        - name: POSTGRES_USER
          value: claudebench
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: claudebench-secrets
              key: database-password
        ports:
        - containerPort: 5432
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 10Gi

---
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: claudebench
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

### Redis Deployment

```yaml
# k8s/redis.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: claudebench
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        command: ["redis-server"]
        args: ["--requirepass", "$(REDIS_PASSWORD)", "--appendonly", "yes"]
        env:
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: claudebench-secrets
              key: redis-password
        ports:
        - containerPort: 6379
        volumeMounts:
        - name: redis-data
          mountPath: /data
      volumes:
      - name: redis-data
        persistentVolumeClaim:
          claimName: redis-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: redis-service
  namespace: claudebench
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
```

### Application Deployment

```yaml
# k8s/server.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: claudebench-server
  namespace: claudebench
spec:
  replicas: 3
  selector:
    matchLabels:
      app: claudebench-server
  template:
    metadata:
      labels:
        app: claudebench-server
    spec:
      containers:
      - name: server
        image: claudebench/server:latest
        ports:
        - containerPort: 3000
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: claudebench-secrets
              key: database-url
        envFrom:
        - configMapRef:
            name: claudebench-config
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"

---
apiVersion: v1
kind: Service
metadata:
  name: claudebench-server-service
  namespace: claudebench
spec:
  selector:
    app: claudebench-server
  ports:
  - port: 80
    targetPort: 3000
  type: ClusterIP
```

### Ingress Configuration

```yaml
# k8s/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: claudebench-ingress
  namespace: claudebench
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/rate-limit-window: "1m"
spec:
  tls:
  - hosts:
    - yourdomain.com
    secretName: claudebench-tls
  rules:
  - host: yourdomain.com
    http:
      paths:
      - path: /api
        pathType: Prefix
        backend:
          service:
            name: claudebench-server-service
            port:
              number: 80
      - path: /
        pathType: Prefix
        backend:
          service:
            name: claudebench-web-service
            port:
              number: 80
```

## Monitoring and Logging

### Prometheus Monitoring

```yaml
# k8s/monitoring.yaml
apiVersion: v1
kind: ServiceMonitor
metadata:
  name: claudebench-metrics
  namespace: claudebench
spec:
  selector:
    matchLabels:
      app: claudebench-server
  endpoints:
  - port: metrics
    interval: 30s
    path: /metrics
```

### Logging with Fluentd

```yaml
# k8s/fluentd-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
  namespace: claudebench
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/containers/claudebench*.log
      pos_file /var/log/fluentd-containers.log.pos
      tag kubernetes.*
      format json
    </source>
    
    <match kubernetes.**>
      @type elasticsearch
      host elasticsearch-service
      port 9200
      index_name claudebench
    </match>
```

## Security Hardening

### Network Security

```bash
# Firewall rules (ufw)
sudo ufw deny incoming
sudo ufw allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Block direct access to services
sudo ufw deny 3000/tcp  # API server
sudo ufw deny 3001/tcp  # Web server  
sudo ufw deny 5432/tcp  # PostgreSQL
sudo ufw deny 6379/tcp  # Redis
```

### Application Security

```bash
# apps/server/.env.production
# Use strong, random secrets
BETTER_AUTH_SECRET="$(openssl rand -base64 64)"
JWT_SECRET="$(openssl rand -base64 32)"

# Database security
DATABASE_URL="postgresql://limited_user:strong_password@localhost:5432/claudebench"

# Redis security
REDIS_PASSWORD="$(openssl rand -base64 32)"
```

### Container Security

```dockerfile
# Use non-root user
USER 1001

# Read-only filesystem
COPY --chown=1001:1001 . .

# Drop capabilities
SECURITY_OPT:
  - no-new-privileges:true
  - seccomp:unconfined
```

## Backup and Recovery

### Automated Backups

```bash
#!/bin/bash
# scripts/backup.sh

BACKUP_DIR="/opt/claudebench/backups"
DATE=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="claudebench-backup-$DATE.tar.gz"

# Create backup
cd /opt/claudebench
bun db:backup "$BACKUP_FILE"

# Upload to cloud storage (example with AWS S3)
aws s3 cp "backups/$BACKUP_FILE" "s3://your-backup-bucket/claudebench/"

# Cleanup old local backups (keep last 7 days)
find "$BACKUP_DIR" -name "claudebench-backup-*.tar.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE"
```

### Cron Schedule

```bash
# Add to crontab
0 2 * * * /opt/claudebench/scripts/backup.sh >> /var/log/claudebench-backup.log 2>&1
```

## Performance Optimization

### Database Optimization

```sql
-- PostgreSQL performance tuning
ALTER SYSTEM SET shared_buffers = '2GB';
ALTER SYSTEM SET effective_cache_size = '6GB';
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET maintenance_work_mem = '512MB';
SELECT pg_reload_conf();

-- Create indexes
CREATE INDEX CONCURRENTLY idx_tasks_status ON tasks(status);
CREATE INDEX CONCURRENTLY idx_tasks_priority ON tasks(priority);
CREATE INDEX CONCURRENTLY idx_tasks_created_at ON tasks(created_at);
```

### Redis Optimization

```bash
# Redis configuration
echo "maxmemory 4gb" >> /etc/redis/redis.conf
echo "maxmemory-policy allkeys-lru" >> /etc/redis/redis.conf
echo "save 900 1" >> /etc/redis/redis.conf
echo "save 300 10" >> /etc/redis/redis.conf
echo "save 60 10000" >> /etc/redis/redis.conf

sudo systemctl restart redis-server
```

### Application Optimization

```typescript
// Production configuration
export const productionConfig = {
  // Connection pools
  database: {
    pool: {
      max: 30,
      min: 5,
      idle: 10000
    }
  },
  
  redis: {
    maxConnectionPool: 20,
    retryDelayOnFailover: 100
  },
  
  // Caching
  cache: {
    defaultTtl: 300,
    maxSize: 10000
  },
  
  // Rate limiting
  rateLimits: {
    global: 5000,
    perHandler: 1000
  }
};
```

## Scaling Strategies

### Horizontal Scaling

1. **Load Balancer**: Distribute traffic across multiple server instances
2. **Database Replication**: Read replicas for scaling reads
3. **Redis Clustering**: Distribute cache and queues
4. **Microservices**: Split into domain-specific services

### Auto-scaling with Kubernetes

```yaml
# k8s/hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: claudebench-server-hpa
  namespace: claudebench
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: claudebench-server
  minReplicas: 3
  maxReplicas: 20
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
```

## Health Checks and Monitoring

### Health Check Endpoints

```bash
# Basic health
curl https://yourdomain.com/api/health

# Detailed health with authentication
curl -H "Authorization: Bearer $TOKEN" https://yourdomain.com/api/health/detailed

# Metrics endpoint
curl https://yourdomain.com/api/metrics
```

### Monitoring Dashboard

Set up Grafana dashboards to monitor:
- Request rates and response times
- Error rates and types
- Database connections and query performance
- Redis memory usage and hit rates
- System resource utilization

For detailed monitoring setup, see the [Monitoring Guide](monitoring.md).