---
title: Onboard Repository
sidebar_label: Onboard Repository
description: Connect any repository to ClaudeBench
---

# Onboard Repository to ClaudeBench

This guide walks you through connecting any repository or project to ClaudeBench for enhanced development capabilities.

## Overview

The ClaudeBench repository onboarding process:
- Connects your project to the ClaudeBench server
- Enables tool validation and monitoring through hooks
- Sets up task management integration
- Configures MCP for enhanced AI capabilities
- Creates project-specific documentation

## Prerequisites

Before onboarding your repository:

- **Bun** installed ([installation guide](https://bun.sh/))
- **Python 3** installed (for hooks integration)
- **ClaudeBench** cloned and running
- **Claude Code** or **Claude Desktop** installed

## Step 1: Start ClaudeBench Server

First, ensure ClaudeBench is running:

```bash
# In the ClaudeBench directory
cd /path/to/claudebench
bun dev
```

The server runs on `http://localhost:3000` by default.

## Step 2: Run the Onboarding Script

Navigate to your repository and run the initializer:

```bash
# Go to your repository
cd /path/to/your/repo

# Run the onboarding script
bun /path/to/claudebench/scripts/claudebench-init.ts
```

### Interactive Mode

The script will prompt you for:
- ClaudeBench server URL (default: `http://localhost:3000`)
- Instance ID (default: `worker-1`)
- Enable hooks for Claude Code (default: Yes)

### Non-Interactive Mode

For automated onboarding:

```bash
bun /path/to/claudebench/scripts/claudebench-init.ts --non-interactive
```

With custom options:

```bash
bun /path/to/claudebench/scripts/claudebench-init.ts \
  --non-interactive \
  --server=http://localhost:3000 \
  --instance=my-worker
```

## Step 3: Verify Installation

After successful onboarding, your repository will have:

```
your-repo/
├── .claudebench.json       # Project configuration
├── .claude/
│   └── settings.json      # Claude Code hooks
├── .mcp.json              # MCP server configuration
├── CLAUDE.local.md        # Project instructions
└── .gitignore             # Updated with ClaudeBench entries
```

## Step 4: Restart Claude Code

Restart Claude Code to load the new hooks configuration.

## Using ClaudeBench Features

### Task Management

Use ClaudeBench task tools instead of TodoWrite:

```typescript
// Create a task
mcp__claudebench__task__create({
  text: "Implement feature X",
  priority: 80
})

// Claim tasks
mcp__claudebench__task__claim({
  workerId: "worker-1",
  maxTasks: 1
})

// Complete tasks
mcp__claudebench__task__complete({
  taskId: "t-123",
  workerId: "worker-1",
  result: {
    description: "Implemented feature X",
    files: ["src/feature.ts"]
  }
})
```

### Monitor Events

Run the event relay to see real-time activity:

```bash
# In ClaudeBench directory
bun relay
```

### Auto-Commit with Context

When hooks are enabled, code changes are automatically committed with task context when working on protected branches.

## Configuration Files

### .claudebench.json

Stores project configuration:

```json
{
  "version": "1.0.0",
  "server": "http://localhost:3000",
  "instanceId": "worker-1",
  "projectName": "your-repo",
  "createdAt": "2025-09-21T15:00:00.000Z",
  "hooks": true
}
```

### .claude/settings.json

Contains Claude Code hooks configuration:
- PreToolUse hooks for validation
- PostToolUse hooks for monitoring
- Session hooks for tracking
- All hooks run the Python bridge script with proper environment variables

### .mcp.json

MCP server configuration:

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

### CLAUDE.local.md

Combines:
- Template instructions from ClaudeBench
- Project-specific configuration
- Usage guidelines
- Custom notes

## Multiple Repository Setup

You can onboard multiple repositories, each with its own configuration:

```bash
# Repository A
cd ~/repo-a
bun ~/claudebench/scripts/claudebench-init.ts --non-interactive

# Repository B with custom server
cd ~/repo-b
bun ~/claudebench/scripts/claudebench-init.ts \
  --non-interactive \
  --server=http://localhost:4000
```

## Updating Configuration

To update an existing onboarded repository:

1. Remove existing configuration:
```bash
rm -rf .claudebench.json .claude/ .mcp.json
```

2. Run the onboarding script again with new settings

## Troubleshooting

### Connection Failed

If the script can't connect to ClaudeBench:
- Verify the server is running: `bun dev`
- Check the server URL is correct
- Ensure port 3000 is not blocked

### Hooks Not Working

If hooks aren't triggering:
- Restart Claude Code after onboarding
- Verify Python 3 is available: `python3 --version`
- Check you're working in the onboarded repository
- Verify `.claude/settings.json` exists

### MCP Tools Not Available

If MCP tools aren't accessible:
- Check `.mcp.json` exists in your repository
- Verify the MCP server URL is correct
- Restart Claude Desktop if using it

## Environment Variables

The hooks use these environment variables:
- `CLAUDEBENCH_RPC_URL`: Set from server URL in config
- `CLAUDE_PROJECT_DIR`: Set to repository path
- `CLAUDE_INSTANCE_ID`: Inherited from Claude Code

## Security Notes

- Hook scripts execute with your user permissions
- Configuration files can be committed to version control
- Sensitive data should not be stored in configuration files
- The Python bridge script is executed from ClaudeBench installation

## Examples

### Frontend Project

```bash
cd ~/my-react-app
bun ~/claudebench/scripts/claudebench-init.ts --non-interactive
```

### Backend API

```bash
cd ~/my-api-server
bun ~/claudebench/scripts/claudebench-init.ts \
  --instance=api-worker \
  --non-interactive
```

### Monorepo Package

```bash
cd ~/monorepo/packages/core
bun ~/claudebench/scripts/claudebench-init.ts --non-interactive
```

## Next Steps

After onboarding your repository:

1. Start using ClaudeBench task management tools
2. Monitor events with the relay
3. Customize `CLAUDE.local.md` with project-specific instructions
4. Explore [swarm intelligence](../api/swarm/index.md) for complex tasks
5. Read about the [event-driven architecture](../architecture/event-bus.md)

## Related Documentation

- [CLI Installer Technical Details](cli-installer.md)
- [Hooks Architecture](../architecture/hooks.md)
- [Task Management API](../api/task/index.md)
- [MCP Integration](../architecture/mcp.md)