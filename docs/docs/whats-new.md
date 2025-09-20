---
sidebar_position: 1
title: What's New
description: Latest features and updates in ClaudeBench
---

# What's New in ClaudeBench

## Latest Updates (January 2025)

### 🎯 Major Features

#### 📎 Attachments System (PR #4)
**Migration from metadata.data to dedicated attachment system**

The task system now features a powerful key-value attachment mechanism that replaces the legacy `metadata.data` field:

- **Type-Safe Storage**: Five distinct types (JSON, Markdown, Text, URL, Binary)
- **Better Performance**: Batch operations for retrieving multiple attachments
- **Git Integration**: Auto-commits automatically create attachments with diffs
- **Migration Required**: See [Migration Guide](/api/attachments#migration-from-metadata)

```typescript
// Before (deprecated)
await task.create({
  metadata: { data: {...} } // ❌ Old approach
});

// After (current)
await task.create_attachment({
  taskId: "t-123",
  key: "analysis",
  type: "json",
  value: {...} // ✅ New approach
});
```

#### 🔄 Git Integration (PR #5)
**Automatic commit tracking with rich context**

ClaudeBench now integrates deeply with Git workflows:

- **Auto-Commit System**: Git hooks trigger automatic commits with task context
- **Rich Commit Messages**: JSON-structured messages with task references
- **Branch Protection**: Main/master branches protected from auto-commits
- **Task Context Preservation**: Every commit linked to active tasks via attachments

Key handlers:
- `git.auto_commit.notify` - Receives notifications from git hooks
- `git.context.get` - Provides task context for commits

Example auto-commit message:
```json
{
  "task": "Implement dark mode toggle",
  "files": ["src/components/ThemeToggle.tsx"],
  "taskIds": ["t-123", "t-124"]
}
```

#### 💾 Session State Management
**Event sourcing with snapshots and recovery**

New session management system for tracking and recovering work:

- **Event Sourcing**: Complete audit trail of all session events
- **Snapshots**: Create recovery points at critical moments
- **Rehydration**: Resume interrupted work seamlessly
- **Condensed Views**: Quick session summaries without full event replay

Key handlers:
- `session.state.get` - Retrieve session state and events
- `session.rehydrate` - Restore session from snapshot or events
- `session.snapshot.create` - Create recovery points

### 🔧 API Enhancements

#### Task System Updates
- **Batch Attachment Retrieval**: `task.get_attachments_batch` for efficient multi-attachment queries
- **Attachment Indexing**: Sorted set index for fast attachment discovery
- **Performance Caching**: 60-second TTL on attachment reads

#### Swarm Intelligence Improvements
- **Project Creation**: `swarm.create_project` for complete project generation
- **Enhanced Context**: Better specialist context generation
- **Conflict Resolution**: Improved merge conflict handling

### 📚 Documentation Improvements

#### New Architecture Guides
- [Git Integration Architecture](/architecture/git-integration)
- [Session State Management](/architecture/session-state)
- [Attachments System Architecture](/architecture/attachments)

#### Enhanced API Documentation
- Complete API reference for all new handlers
- Migration guides for breaking changes
- Practical examples with real code
- Mermaid diagrams for visual understanding

### 🚨 Breaking Changes

#### Metadata.data Deprecation
The `metadata.data` field on tasks is deprecated. Migrate to the attachments system:

- **Impact**: Direct access to `task.metadata.data` will return undefined
- **Migration**: Use `task.create_attachment` and `task.get_attachment`
- **Timeline**: Legacy support will be removed in next major version

### 🐛 Bug Fixes
- Fixed Mermaid diagram parsing errors in documentation
- Corrected sidebar navigation labels for API sections
- Resolved attachment key uniqueness constraints
- Fixed session event compaction edge cases

### 🔜 Coming Soon
- **Attachment Encryption**: Client-side encryption for sensitive data
- **Session Branching**: Create alternate timelines from snapshots
- **Git Workflow Automation**: Enhanced PR creation and review
- **Swarm Visualization**: Real-time specialist collaboration view

## Migration Guides

### From metadata.data to Attachments

If you're currently using `metadata.data`:

1. **Identify Usage**: Search for `metadata.data` in your codebase
2. **Create Attachments**: Replace with `task.create_attachment` calls
3. **Update Retrieval**: Use `task.get_attachment` instead of direct access
4. **Test Thoroughly**: Ensure attachment keys are unique per task

See the full [Attachment Migration Guide](/api/attachments#migration-from-metadata) for detailed instructions.

### Git Hook Installation

To enable automatic commit tracking:

1. **Install Hook Script**: Run `bun hooks:install`
2. **Configure Protection**: Set protected branches in `.git/config`
3. **Test Integration**: Make a change and verify auto-commit
4. **Monitor Events**: Check relay output for `git.auto_commit.notify` events

See the [Git Integration Guide](/architecture/git-integration#setup) for complete setup.

## Support & Feedback

### Getting Help
- **Documentation**: Check the updated guides and API reference
- **Issues**: Report bugs at [GitHub Issues](https://github.com/fblgit/claudebench/issues)
- **Community**: Join discussions in GitHub Discussions

### Providing Feedback
We'd love to hear about your experience with these new features:
- What's working well?
- What could be improved?
- What features would you like to see next?

---

*Last updated: January 2025 | ClaudeBench v2.0*