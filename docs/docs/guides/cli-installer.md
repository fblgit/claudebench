---
title: ClaudeBench CLI Installer
sidebar_label: CLI Installer
description: Bootstrap any project with ClaudeBench integration
---

# ClaudeBench CLI Installer

The ClaudeBench CLI installer (`claudebench-init`) is a tool that bootstraps any project directory with ClaudeBench integration. It sets up hooks, MCP configuration, and documentation to connect your project with the ClaudeBench ecosystem.

## Overview

The installer creates project-local configuration files that:
- Enable tool validation and monitoring through hooks
- Configure MCP server connection for enhanced AI capabilities
- Set up task management integration with ClaudeBench
- Provide project-specific documentation and instructions

## Installation & Usage

### Running the Installer

From any project directory, run:

```bash
# Interactive mode (with prompts)
cd /path/to/your/project
bun /path/to/claudebench/scripts/claudebench-init.ts

# Non-interactive mode (with defaults)
bun /path/to/claudebench/scripts/claudebench-init.ts --non-interactive

# With custom options
bun /path/to/claudebench/scripts/claudebench-init.ts \
  --non-interactive \
  --server=http://localhost:3000 \
  --instance=worker-1
```

### Command Line Options

| Option | Description | Default |
|--------|-------------|---------|
| `--non-interactive`, `-n` | Run without prompts | `false` |
| `--server=<url>` | ClaudeBench server URL | `http://localhost:3000` |
| `--instance=<id>` | Instance identifier | `worker-1` |

## What Gets Created

The installer creates the following files in your project:

### 1. `.claudebench.json`

Project configuration file containing:

```json
{
  "version": "1.0.0",
  "server": "http://localhost:3000",
  "instanceId": "worker-1",
  "projectName": "your-project",
  "createdAt": "2025-09-21T15:00:00.000Z",
  "hooks": true
}
```

### 2. `.claude/settings.json`

Local Claude Code settings with hooks configuration. This file:
- Uses the template from `scripts/claude_code_hooks.json`
- Configures hooks for tool validation and monitoring
- Sets up environment variables for the ClaudeBench connection
- Includes all hook types (PreToolUse, PostToolUse, SessionStart, etc.)

Example structure:
```json
{
  "project": "your-project",
  "claudebench": {
    "server": "http://localhost:3000",
    "instanceId": "worker-1",
    "version": "1.0.0"
  },
  "hooks": {
    "PreToolUse": [...],
    "PostToolUse": [...],
    "UserPromptSubmit": [...]
  }
}
```

### 3. `.mcp.json`

MCP (Model Context Protocol) configuration:

```json
{
  "mcpServers": {
    "claudebench": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

### 4. `CLAUDE.local.md`

Project-specific instructions that combine:
- Template content from `scripts/CLAUDE.local.md`
- Project configuration details
- Usage instructions
- Task management guidelines

### 5. `.gitignore` Updates

Adds ClaudeBench-related entries:
```gitignore
# ClaudeBench
.claudebench.log
*.claudebench.tmp
```

## How It Works

### Hook Integration

The hooks work by:
1. Claude Code triggers hooks on various events (tool use, prompts, sessions)
2. Hooks execute the Python bridge script (`claude_code_hooks.py`)
3. The bridge script communicates with ClaudeBench server via JSONRPC
4. ClaudeBench validates, monitors, and tracks all activities

Environment variables passed to hooks:
- `CLAUDEBENCH_RPC_URL`: Server RPC endpoint
- `CLAUDE_PROJECT_DIR`: Project directory path
- `CLAUDE_INSTANCE_ID`: Inherited from Claude Code environment

### MCP Integration

The MCP configuration enables:
- Direct access to ClaudeBench tools in Claude Desktop
- Task management capabilities
- System monitoring and metrics
- Event-driven architecture integration

## Prerequisites

Before running the installer, ensure:

1. **ClaudeBench is running**:
   ```bash
   cd /path/to/claudebench
   bun dev
   ```

2. **Python 3 is installed** (for hooks):
   ```bash
   python3 --version
   ```

3. **Bun is installed** (for running the installer):
   ```bash
   bun --version
   ```

## Post-Installation Steps

After successful initialization:

1. **Restart Claude Code** to load the new hooks configuration
2. **Start ClaudeBench server** if not already running
3. **Open your project** in Claude Code
4. **Verify integration** by checking the relay output when using tools

## Task Management

Once initialized, use ClaudeBench task tools instead of TodoWrite:

- `mcp__claudebench__task__create` - Create new tasks
- `mcp__claudebench__task__claim` - Claim tasks for work
- `mcp__claudebench__task__complete` - Complete tasks with metadata
- `mcp__claudebench__task__list` - List available tasks

## Troubleshooting

### Connection Issues

If the installer can't connect to ClaudeBench:
1. Verify the server is running: `bun dev`
2. Check the server URL is correct
3. Ensure no firewall is blocking port 3000

### Hook Issues

If hooks aren't firing:
1. Restart Claude Code after installation
2. Verify Python 3 is in your PATH
3. Check `.claude/settings.json` exists in your project
4. Ensure you're working in the initialized project directory

### MCP Issues

If MCP tools aren't available:
1. Check `.mcp.json` exists in your project
2. Verify the MCP server URL is correct
3. Restart Claude Desktop if using it

## Advanced Usage

### Customizing the Template

You can modify `scripts/CLAUDE.local.md` to change the default instructions that get added to every project.

### Multiple Projects

Each project maintains its own configuration. You can initialize multiple projects, each with different settings:

```bash
# Project A with default server
cd /path/to/projectA
bun claudebench-init --non-interactive

# Project B with custom server
cd /path/to/projectB
bun claudebench-init --non-interactive --server=http://localhost:4000
```

### Updating Configuration

To update an existing project's configuration:
1. Delete the configuration files (`.claudebench.json`, `.claude/`, `.mcp.json`)
2. Run the installer again with new settings

## Security Considerations

- Hook commands are executed with your user permissions
- Environment variables may contain sensitive information
- Store `.claudebench.json` in version control for team sharing
- Consider adding `.claude/settings.json` to `.gitignore` if it contains sensitive data

## Related Documentation

- [Hooks Setup Guide](../architecture/hooks.md)
- [MCP Integration](../architecture/mcp.md)
- [Task Management](../api/task/index.md)
- [Event-Driven Architecture](../architecture/event-bus.md)