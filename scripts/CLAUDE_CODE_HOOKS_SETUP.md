# Claude Code Hooks Integration Setup

Quick setup guide for integrating Claude Code with ClaudeBench using hooks.

## Quick Start

1. **Start ClaudeBench server**
   ```bash
   cd apps/server
   bun dev
   ```

2. **Copy hooks configuration to Claude Code settings**
   
   Edit `~/.claude/settings.json` and add the hooks section from `scripts/claude_code_hooks.json`:
   
   ```json
   {
     "hooks": {
       "PreToolUse": [
         {
           "matcher": ".*",
           "hooks": [
             {
               "type": "command",
               "command": "python3 /Users/mrv/Desktop/GIT/cb3/claudebench/scripts/claude_code_hooks.py"
             }
           ]
         }
       ],
       "PostToolUse": [
         {
           "matcher": ".*",
           "hooks": [
             {
               "type": "command",
               "command": "python3 /Users/mrv/Desktop/GIT/cb3/claudebench/scripts/claude_code_hooks.py"
             }
           ]
         },
         {
           "matcher": "TodoWrite",
           "hooks": [
             {
               "type": "command",
               "command": "python3 /Users/mrv/Desktop/GIT/cb3/claudebench/scripts/claude_code_hooks.py"
             }
           ]
         }
       ],
       "UserPromptSubmit": [
         {
           "matcher": "",
           "hooks": [
             {
               "type": "command",
               "command": "python3 /Users/mrv/Desktop/GIT/cb3/claudebench/scripts/claude_code_hooks.py"
             }
           ]
         }
       ]
     }
   }
   ```
   
   **Important**: Update the script paths to match your ClaudeBench installation directory.

3. **Set environment variables** (optional)
   ```bash
   export CLAUDEBENCH_RPC_URL=http://localhost:3000/rpc
   export CLAUDE_SESSION_ID=my-session
   export CLAUDEBENCH_DEBUG=true  # For debugging
   ```

4. **Restart Claude Code** to load the new hooks configuration

## Testing

Test that hooks are working:

```bash
# Test PreToolUse (should allow)
echo '{"event":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"/tmp/test.txt"}}' | \
  python3 scripts/claude_code_hooks.py

# Test dangerous command blocking (should block with exit code 2)
echo '{"event":"PreToolUse","tool_name":"Bash","tool_input":{"command":"rm -rf /"}}' | \
  python3 scripts/claude_code_hooks.py

# Test TodoWrite handling
echo '{"event":"PostToolUse","tool_name":"TodoWrite","tool_input":{"todos":[{"content":"Test","status":"pending"}]}}' | \
  python3 scripts/claude_code_hooks.py
```

## How It Works

1. Claude Code triggers hooks on events (PreToolUse, PostToolUse, UserPromptSubmit)
2. The hook calls `claude_code_hooks.py` with JSON via stdin
3. The script transforms Claude's format to ClaudeBench JSONRPC format
4. Makes HTTP POST to ClaudeBench at `/rpc` endpoint
5. Returns appropriate exit codes:
   - 0 = Success/Allow
   - 2 = Block operation (for PreToolUse and UserPromptSubmit)
   - Others = Non-blocking errors

## Features

- **Tool validation**: Block dangerous operations before execution
- **TodoWrite capture**: Automatically capture task updates from Claude Code
- **User prompt enhancement**: Add context or modify prompts before processing
- **Post-tool processing**: Log results, trigger workflows, send notifications

## Troubleshooting

- **Hooks not firing**: Check script path is absolute and correct
- **Permission denied**: Make script executable: `chmod +x scripts/claude_code_hooks.py`
- **Connection refused**: Ensure ClaudeBench server is running on port 3000
- **Debug mode**: Set `CLAUDEBENCH_DEBUG=true` to see detailed logs