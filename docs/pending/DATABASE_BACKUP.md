# ClaudeBench Database Backup & Restore

## Overview

ClaudeBench provides integrated backup and restore functionality for both PostgreSQL and Redis databases. This ensures you can preserve your swarm intelligence data, task queues, and system state.

## Usage

### Creating a Backup

```bash
# Create backup with automatic timestamp
bun db:backup

# Create backup with custom filename  
bun db:backup my-backup.tar.gz
```

Backups are stored in the `backups/` directory and include:
- PostgreSQL data (all tables including swarm models)
- Redis data (all `cb:*` keys with TTL preservation)
- Metadata (timestamp, version, platform info)

### Restoring from Backup

```bash
# Restore from a specific backup
bun db:restore backups/backup-2025-09-17.tar.gz
```

**⚠️ WARNING**: Restore will replace ALL existing data in both databases.

## Backup Contents

### PostgreSQL Data
- Task records
- Instance registrations  
- Swarm decompositions and subtasks
- Swarm assignments and progress
- Conflict resolutions
- Integration records

### Redis Data
- Event streams (`cb:stream:*`)
- Task queues (`cb:queue:*`)
- Instance health (`cb:health:*`)
- Metrics (`cb:metrics:*`)
- Circuit breaker states (`cb:circuit:*`)
- Swarm coordination data (`cb:decomposition:*`, `cb:subtask:*`)
- Rate limiting counters
- All TTL values preserved

## Technical Details

### Archive Format
- Format: Compressed TAR archive (`.tar.gz`)
- Structure:
  ```
  backup.tar.gz
  ├── metadata.json     # Backup metadata
  ├── postgres.sql      # PostgreSQL dump
  └── redis.json        # Redis data export
  ```

### Redis Data Types Support
- ✅ Strings
- ✅ Hashes  
- ✅ Lists
- ✅ Sets
- ✅ Sorted Sets (ZSets)
- ⚠️ Streams (converted to hash for storage)

### Connection Modes
- **PostgreSQL**: Auto-detects Docker container or direct connection
- **Redis**: Direct connection via ioredis

## Environment Variables

```bash
# PostgreSQL (default: postgresql://postgres:postgres@localhost:5432/claudebench)
DATABASE_URL=postgresql://user:pass@host:port/database

# Redis (defaults: localhost:6379)
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Examples

### Daily Backup Script
```bash
#!/bin/bash
# Create daily backup with timestamp
bun db:backup "daily-$(date +%Y%m%d).tar.gz"
```

### Backup Before Major Changes
```bash
# Before implementing new swarm features
bun db:backup pre-swarm-update.tar.gz

# Make changes...

# If something goes wrong
bun db:restore backups/pre-swarm-update.tar.gz
```

### Transfer Between Environments
```bash
# On development machine
bun db:backup export.tar.gz

# Copy to another machine
scp backups/export.tar.gz user@host:~/

# On target machine  
bun db:restore ~/export.tar.gz
```

## Error Handling

### Common Issues

1. **Docker not running**: Ensure Docker Desktop is running if using containerized PostgreSQL
2. **Permissions**: Scripts need read/write access to `backups/` directory
3. **Disk space**: Ensure sufficient space for backup archives
4. **Redis connection**: Verify Redis is running and accessible

### Recovery

If a restore fails midway:
1. PostgreSQL: Database is recreated fresh before restore
2. Redis: Existing ClaudeBench keys are cleared before restore
3. Both databases remain functional even if restore partially fails

## Best Practices

1. **Regular Backups**: Schedule automated backups for important data
2. **Test Restores**: Periodically verify backups can be restored
3. **Version Control**: Don't commit backup files (already in `.gitignore`)
4. **Naming Convention**: Use descriptive names like `pre-feature-X.tar.gz`
5. **Retention Policy**: Keep recent backups, archive older ones

## Integration with Swarm Intelligence

The backup system preserves all swarm intelligence state:
- Task decompositions and dependency graphs
- Specialist assignments and workload
- Conflict resolutions and synthesis progress
- Context generation data
- Complete event history in Redis streams

This enables:
- Saving swarm experiment states
- Debugging complex swarm behaviors
- Sharing swarm configurations
- Disaster recovery with full state preservation