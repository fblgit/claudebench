# ClaudeBench Guides

Comprehensive documentation for getting started with, developing, and operating ClaudeBench systems.

## Quick Navigation

### 🚀 Getting Started
- **[Quick Start](quick-start.md)** - Get running in 5 minutes
- **[Installation](installation.md)** - Detailed setup guide
- **[Configuration](configuration.md)** - Environment variables and settings

### 🛠 Development
- **[Creating Handlers](creating-handlers.md)** - Build new event handlers
- **[Testing](testing.md)** - Contract-driven testing approach
- **[Event Naming](event-naming.md)** - Event naming conventions

### 🔍 Operations
- **[Debugging](debugging.md)** - Troubleshooting with relay and logs
- **[Monitoring](monitoring.md)** - Metrics and observability
- **[Deployment](deployment.md)** - Production deployment guide
- **[Scaling](scaling.md)** - Distributed deployment patterns

### 🔌 Integrations
- **[MCP Integration](mcp-integration.md)** - Using with Claude Code/Desktop
- **[WebSocket Events](websocket-events.md)** - Real-time event streaming
- **[Claude Hooks](claude-hooks.md)** - Hook system for Claude Code

## Guide Categories

### Essential Guides (Start Here)
1. **[Quick Start](quick-start.md)** - Essential for all users
2. **[Installation](installation.md)** - Detailed setup for developers
3. **[Configuration](configuration.md)** - Environment setup

### Development Guides
1. **[Creating Handlers](creating-handlers.md)** - Core development skill
2. **[Testing](testing.md)** - Quality assurance approach
3. **[Event Naming](event-naming.md)** - Architecture understanding

### Operational Guides  
1. **[Debugging](debugging.md)** - Troubleshooting skills
2. **[Deployment](deployment.md)** - Production deployment
3. **[Monitoring](monitoring.md)** - System observability
4. **[Scaling](scaling.md)** - Growth and performance

### Integration Guides
1. **[MCP Integration](mcp-integration.md)** - Claude AI integration
2. **[WebSocket Events](websocket-events.md)** - Real-time features
3. **[Claude Hooks](claude-hooks.md)** - Advanced AI workflows

## Learning Paths

### Path 1: New Developer
```
Quick Start → Installation → Configuration → Creating Handlers → Testing → Debugging
```

### Path 2: System Administrator  
```
Installation → Configuration → Deployment → Monitoring → Debugging → Scaling
```

### Path 3: AI Integration Developer
```
Quick Start → MCP Integration → Claude Hooks → Event Naming → WebSocket Events
```

### Path 4: DevOps Engineer
```
Installation → Deployment → Monitoring → Scaling → Debugging
```

## Quick Reference

### Common Commands
```bash
# Development
bun dev                    # Start all services
bun relay                  # Monitor events
bun test                   # Run tests
bun db:push               # Update database

# Production
bun build                  # Build for production  
bun db:migrate            # Run migrations
bun db:backup             # Create backup
```

### Key Configuration Files
- `.env` - Global environment variables
- `apps/server/.env` - Backend configuration
- `apps/web/.env` - Frontend configuration
- `turbo.json` - Build pipeline
- `biome.json` - Code formatting

### Important URLs
- **Web Dashboard**: http://localhost:3001
- **API Server**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **Metrics**: http://localhost:3000/metrics

## Architecture Overview

### Core Components
- **Event Handlers**: Business logic with `@EventHandler` decorator
- **Redis**: Event streams, caching, and queuing
- **PostgreSQL**: Persistent data storage
- **Web Dashboard**: React-based real-time interface
- **Event Relay**: Real-time monitoring and debugging

### Key Patterns
- **Decorator Pattern**: `@EventHandler`, `@Instrumented`, `@Resilient`
- **Event-Driven**: Flat `domain.action` hierarchy
- **Redis-First**: Direct use of Redis primitives
- **Contract-First**: Test-driven development approach

## Contributing to Guides

### Guide Standards
- **Action-Oriented**: Focus on practical steps
- **Example-Rich**: Include code samples and commands
- **Cross-Referenced**: Link to related guides
- **Up-to-Date**: Keep examples current with codebase

### Adding New Guides
1. Create markdown file in `/docs/guides/`
2. Follow existing structure and formatting
3. Add to this README navigation
4. Include practical examples
5. Test all code samples

### Guide Template
```markdown
# Guide Title

Brief description of what this guide covers.

## Overview
What you'll learn and why it's important.

## Prerequisites
What you need before starting.

## Step-by-Step Instructions
1. Clear, actionable steps
2. Include code examples
3. Show expected outputs
4. Handle common issues

## Best Practices
Guidelines and recommendations.

## Troubleshooting
Common problems and solutions.

## Next Steps
Links to related guides.
```

## Support and Community

### Getting Help
- **GitHub Issues**: Bug reports and feature requests
- **Documentation**: These guides and API docs
- **Code Examples**: In `/examples` directory
- **Test Cases**: In `/tests` for real-world patterns

### Community Resources
- **Contributing Guide**: [CONTRIBUTING.md](../../CONTRIBUTING.md)
- **Architecture Docs**: [CLAUDEBENCH.md](../../CLAUDEBENCH.md)
- **API Reference**: [API.md](../API.md)

## Feedback

These guides are continuously improved based on user feedback. Please:

- **Report Issues**: If something doesn't work as described
- **Suggest Improvements**: Better explanations or missing topics
- **Share Use Cases**: How you're using ClaudeBench
- **Contribute Examples**: Real-world implementation patterns

---

*Last updated: 2025-09-19*
*Guide coverage: 13 comprehensive guides covering development, operations, and integrations*