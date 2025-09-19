# Scripts Directory

This directory contains utility scripts for ClaudeBench development and operations.

## Core Scripts

### Database Management
- **`db-backup.ts`** - Backup PostgreSQL database with compression and rotation
- **`db-restore.ts`** - Restore database from backup files
- **`clear-rate-limits.ts`** - Clear Redis rate limit keys (maintenance utility)

### Event System
- **`relay.ts`** - Event relay for monitoring ClaudeBench events in real-time
  ```bash
  bun relay  # Start the event relay
  ```

### Development Tools
- **`create-new-feature.sh`** - Scaffold new features with proper structure
- **`check-task-prerequisites.sh`** - Verify task dependencies and prerequisites
- **`update-agent-context.sh`** - Update agent context files
- **`setup-plan.sh`** - Setup development plans
- **`get-feature-paths.sh`** - Get feature directory paths
- **`common.sh`** - Shared bash functions for other scripts

### Claude Code Integration
- **`claude_code_hooks.py`** - Python hooks for Claude Code integration
- **`claude_code_hooks.json`** - Hook configuration for Claude Code
- **`CLAUDE_CODE_HOOKS_SETUP.md`** - Setup guide for Claude Code hooks
- **`claude_event_relay.py`** - Python event relay for Claude Code
- **`mcp_bridge.sh`** - Bridge script for MCP (Model Context Protocol)

## Tests Directory

The `tests/` subdirectory contains test scripts:
- `test_hooks.py` - Test hook functionality
- `test_hooks_jsonrpc.py` - Test JSONRPC hook integration
- `test_mcp.py` - Test MCP integration
- `test_mcp.sh` - Shell tests for MCP
- `test-todo-transitions.js` - Test todo state transitions

## Usage Examples

### Database Backup
```bash
bun scripts/db-backup.ts
```

### Start Event Relay
```bash
bun relay
```

### Create New Feature
```bash
./scripts/create-new-feature.sh "Add user authentication"
```

### Clear Rate Limits
```bash
bun scripts/clear-rate-limits.ts
```

## Notes

- Most scripts require the ClaudeBench server to be running
- Database scripts require PostgreSQL to be accessible
- Event scripts require Redis to be running
- Test scripts are for development and debugging purposes