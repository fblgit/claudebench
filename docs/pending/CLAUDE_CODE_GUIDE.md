# Claude Code Complete Guide: Hooks & Headless Mode

## Table of Contents
- [Hooks System](#hooks-system)
  - [Hook Types & Events](#hook-types--events)
  - [Exit Codes](#exit-codes)
  - [Configuration](#configuration)
  - [Examples](#examples)
- [Headless Mode](#headless-mode)
  - [Basic Usage](#basic-usage)
  - [Multi-Turn Conversations](#multi-turn-conversations)
  - [Output Formats](#output-formats)
  - [Best Practices](#best-practices)

---

## Hooks System

Hooks allow you to automatically execute custom commands at specific points during Claude Code's execution. They enable workflow automation, code formatting, security checks, and custom validations.

### Hook Types & Events

| Event | Description | Use Cases |
|-------|-------------|-----------|
| **PreToolUse** | Before tool processing | Validation, blocking dangerous operations |
| **PostToolUse** | After tool completion | Auto-formatting, notifications |
| **UserPromptSubmit** | When user submits prompt | Prompt enhancement, logging |
| **Notification** | System notifications | Desktop alerts, logging |
| **Stop** | Main agent finishes | Cleanup, final checks |
| **SubagentStop** | Subagent completes | Subagent-specific cleanup |
| **PreCompact** | Before context compaction | Context preservation |
| **SessionStart** | Session initialization | Setup, environment prep |
| **SessionEnd** | Session termination | Cleanup, session archiving |

### Exit Codes

| Code | Behavior | Effect |
|------|----------|--------|
| **0** | Success | Continues normal execution |
| **2** | Blocking Error | **STOPS** the operation with error message |
| Other | Non-blocking Error | Logs error but continues |

### Configuration

Hooks are configured in `~/.claude/settings.json`:

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern|Regex",
        "hooks": [
          {
            "type": "command",
            "command": "your-command-here"
          }
        ]
      }
    ]
  }
}
```

### Examples

#### 1. Bash Command Logger
Log all bash commands with descriptions:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '\"[$(date +%Y-%m-%d\\ %H:%M:%S)] \\(.tool_input.command) - \\(.tool_input.description // \"No description\")\"' >> ~/.claude/bash-command-log.txt"
          }
        ]
      }
    ]
  }
}
```

#### 2. TypeScript Auto-Formatter
Automatically format TypeScript files after editing:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.file_path' | { read file_path; if [[ \"$file_path\" == *.ts ]]; then npx prettier --write \"$file_path\" 2>/dev/null; fi; }"
          }
        ]
      }
    ]
  }
}
```

#### 3. File Protection Hook
Block edits to sensitive files:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|MultiEdit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 -c \"import json, sys; data=json.load(sys.stdin); path=data.get('tool_input',{}).get('file_path',''); protected=['.env', 'package-lock.json', '.git']; sys.exit(2 if any(p in path for p in protected) else 0)\""
          }
        ]
      }
    ]
  }
}
```

#### 4. Desktop Notifications
Get notified when Claude needs input:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude needs your input\" with title \"Claude Code\"'"
          }
        ]
      }
    ]
  }
}
```

#### 5. Git Commit Validator
Ensure commit messages follow conventional format:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "jq -r '.tool_input.command' | grep -q '^git commit' && { jq -r '.tool_input.command' | grep -qE 'feat:|fix:|docs:|style:|refactor:|test:|chore:' || exit 2; } || exit 0"
          }
        ]
      }
    ]
  }
}
```

#### 6. Python Script Hook with JSON Response
Advanced hook returning structured data:

```python
#!/usr/bin/env python3
# save as ~/.claude/hooks/validate_imports.py
import json
import sys

data = json.load(sys.stdin)
file_path = data.get('tool_input', {}).get('file_path', '')

if file_path.endswith('.py'):
    # Check for dangerous imports
    content = data.get('tool_input', {}).get('content', '')
    if 'eval(' in content or 'exec(' in content:
        response = {
            "message": "⚠️ Dangerous Python functions detected",
            "blocking": True,
            "details": "eval() and exec() are security risks"
        }
        print(json.dumps(response))
        sys.exit(2)

sys.exit(0)
```

Hook configuration:
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ~/.claude/hooks/validate_imports.py"
          }
        ]
      }
    ]
  }
}
```

### Hook Environment Variables

Hooks receive these environment variables:
- `CLAUDE_PROJECT_DIR`: Current project directory
- `CLAUDE_SESSION_ID`: Current session identifier
- `CLAUDE_USER`: Current user

### Debugging Hooks

Enable debug mode to see hook execution:
```bash
claude --debug
```

Common issues:
- **Hook not firing**: Check matcher pattern and event name
- **Exit code 127**: Command not found
- **Permission denied**: Make scripts executable with `chmod +x`
- **JSON parsing errors**: Validate JSON syntax

---

## Headless Mode

Headless mode enables programmatic, non-interactive use of Claude Code for automation, CI/CD, and scripting.

### Basic Usage

#### Simple Command
```bash
# Direct prompt
claude -p "Explain the code in main.py"

# With specific output format
claude -p "Review this code" --output-format json

# Pipe input
cat main.py | claude -p "Find security issues"

# Save output
claude -p "Generate unit tests for user.py" > tests.py
```

#### Flags & Options

| Flag | Description | Example |
|------|-------------|---------|
| `-p, --print` | Non-interactive mode | `claude -p "prompt"` |
| `--output-format` | Output type: text, json, stream-json | `--output-format json` |
| `--allowedTools` | Restrict tools | `--allowedTools "Read,Bash"` |
| `--permission-mode` | Edit permissions | `--permission-mode read-only` |
| `--resume` | Continue conversation | `--resume session-id` |
| `--continue` | Resume last session | `--continue "new prompt"` |
| `--no-interactive` | Force non-interactive | `--no-interactive` |

### Multi-Turn Conversations

#### Method 1: Session Resumption
```bash
# Start conversation
claude -p "Create a Python web server" > session1.txt

# Continue with context
claude --continue "Add authentication to the server"

# Resume specific session
claude --resume 550e8400-e29b-41d4-a716-446655440000 "Add tests"
```

#### Method 2: Streaming JSON Input
```bash
# Multi-turn via JSONL
cat <<EOF | claude -p --output-format=stream-json --input-format=stream-json
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Create a REST API"}]}}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Add authentication"}]}}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Write tests"}]}}
EOF
```

#### Method 3: Script Automation
```bash
#!/bin/bash
# automated_review.sh

SESSION_ID=$(uuidgen)

# Initial analysis
claude -p "Analyze the codebase structure" --session-id $SESSION_ID

# Follow-up questions based on context
claude --resume $SESSION_ID "Identify performance bottlenecks"
claude --resume $SESSION_ID "Suggest refactoring opportunities"
claude --resume $SESSION_ID "Generate improvement report" > report.md
```

### Output Formats

#### 1. Text Format (Default)
```bash
claude -p "Explain quicksort"
# Returns plain text response
```

#### 2. JSON Format
```bash
claude -p "Review code" --output-format json
```
Output structure:
```json
{
  "response": "...",
  "metadata": {
    "session_id": "...",
    "timestamp": "...",
    "tokens_used": 1234
  }
}
```

#### 3. Stream JSON Format
```bash
claude -p "Generate large codebase" --output-format stream-json
```
Outputs newline-delimited JSON:
```json
{"type":"start","session_id":"..."}
{"type":"chunk","content":"..."}
{"type":"tool_use","tool":"Bash","input":{...}}
{"type":"end","summary":{...}}
```

### Best Practices

#### 1. CI/CD Integration
```yaml
# .github/workflows/code-review.yml
name: AI Code Review
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: AI Review
        run: |
          git diff origin/main...HEAD | \
          claude -p "Review this diff for bugs, security issues, and improvements" \
          --output-format json > review.json
      - name: Post Comments
        run: python post_review.py review.json
```

#### 2. Pre-commit Hook
```bash
#!/bin/bash
# .git/hooks/pre-commit

# Check staged files
STAGED=$(git diff --cached --name-only)

for file in $STAGED; do
  if [[ $file == *.py ]]; then
    claude -p "Check $file for Python best practices and PEP8" \
      --allowedTools "Read" \
      --no-interactive || exit 1
  fi
done
```

#### 3. Automated Documentation
```bash
#!/bin/bash
# generate_docs.sh

# Generate API documentation
find ./src -name "*.ts" -type f | while read file; do
  claude -p "Generate JSDoc comments for $file" \
    --allowedTools "Read,Edit" \
    --permission-mode write
done

# Create summary
claude -p "Create API documentation index from JSDoc comments" > docs/API.md
```

#### 4. Security Scanning
```bash
#!/bin/bash
# security_scan.sh

# Scan for vulnerabilities
claude -p "Perform security audit" \
  --allowedTools "Read,Grep" \
  --output-format json | \
  jq '.vulnerabilities[] | select(.severity == "high")'
```

#### 5. Test Generation
```python
#!/usr/bin/env python3
# generate_tests.py

import subprocess
import json
import glob

def generate_tests(source_file):
    cmd = [
        'claude', '-p',
        f'Generate comprehensive unit tests for {source_file}',
        '--output-format', 'json',
        '--allowedTools', 'Read,Write'
    ]
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    return json.loads(result.stdout)

# Process all source files
for file in glob.glob('src/**/*.py', recursive=True):
    test_file = file.replace('src/', 'tests/').replace('.py', '_test.py')
    result = generate_tests(file)
    print(f"Generated tests for {file} -> {test_file}")
```

### Advanced Patterns

#### 1. Parallel Processing
```bash
#!/bin/bash
# parallel_analysis.sh

# Analyze multiple files in parallel
find . -name "*.js" | parallel -j 4 \
  'claude -p "Analyze {} for performance issues" --output-format json > {}.analysis.json'
```

#### 2. Context Window Management
```bash
# Clear context between unrelated tasks
claude --clear
claude -p "New unrelated task"

# Or use sessions for isolation
claude -p "Task 1" --session-id task1
claude -p "Task 2" --session-id task2  # Different context
```

#### 3. Error Handling
```bash
#!/bin/bash
set -e  # Exit on error

claude -p "Risky operation" || {
  echo "Claude failed, falling back to manual process"
  exit 1
}
```

#### 4. Rate Limiting
```python
import time
import subprocess

def claude_with_retry(prompt, max_retries=3):
    for attempt in range(max_retries):
        try:
            result = subprocess.run(
                ['claude', '-p', prompt, '--output-format', 'json'],
                capture_output=True, text=True, check=True
            )
            return json.loads(result.stdout)
        except subprocess.CalledProcessError:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| **"Session not found"** | Check session ID or use `--continue` for last session |
| **Timeout errors** | Add `--timeout 300` for long operations |
| **Rate limiting** | Implement exponential backoff |
| **Context overflow** | Use `--clear` or separate sessions |
| **Permission denied** | Check `--permission-mode` settings |

### Performance Tips

1. **Use specific tool restrictions**: `--allowedTools "Read,Grep"` reduces overhead
2. **Stream for large outputs**: `--output-format stream-json` for real-time processing
3. **Batch related tasks**: Keep context with session resumption
4. **Clear context regularly**: Prevent context window bloat
5. **Use JSON for parsing**: Structured output for automation

---

## Quick Reference Card

### Essential Commands
```bash
# Headless execution
claude -p "prompt"                          # Basic
claude -p "prompt" --output-format json     # JSON output
claude --continue "follow-up"               # Continue last
claude --resume SESSION_ID "prompt"         # Resume specific

# Hook debugging
claude --debug                               # Show hook execution
claude --no-hooks                           # Disable all hooks
```

### Common Hook Patterns
```json
// Block dangerous operations
{"matcher": "Bash", "command": "exit 2"}

// Auto-format on save
{"matcher": "Write|Edit", "command": "prettier"}

// Notify on completion
{"matcher": "", "command": "notify-send"}
```

### Environment Variables
```bash
export CLAUDE_PROJECT_DIR=/path/to/project
export CLAUDE_DEBUG=1
export CLAUDE_NO_HOOKS=1
```

---

*Last updated: 2025-09-10 | Based on official Claude Code documentation*