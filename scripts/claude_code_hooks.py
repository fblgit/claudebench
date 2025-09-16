#!/usr/bin/env python3
"""
Claude Code Hooks Bridge for ClaudeBench
=========================================

This script acts as a bridge between Claude Code's hook system and ClaudeBench's 
JSONRPC 2.0 endpoint. It receives hook events from Claude Code via stdin, transforms
them to ClaudeBench's expected format, and makes JSONRPC requests to the server.

Environment Variables:
    CLAUDEBENCH_RPC_URL: URL of the ClaudeBench RPC endpoint (default: http://localhost:3000/rpc)
    CLAUDE_SESSION_ID: Current Claude Code session identifier
    CLAUDE_PROJECT_DIR: Current project directory
    CLAUDEBENCH_TIMEOUT: Request timeout in seconds (default: 5)
    CLAUDEBENCH_DEBUG: Enable debug output (default: false)

Exit Codes:
    0: Success - operation allowed/processed
    2: Blocking - operation blocked by hook (for pre_tool and user_prompt)
    1,3+: Non-blocking errors

Hook Types Supported:
    - PreToolUse -> hook.pre_tool
    - PostToolUse -> hook.post_tool (TodoWrite -> hook.todo_write)
    - UserPromptSubmit -> hook.user_prompt
    - SessionStart -> system.register
    - SessionEnd -> system.unregister
    - Stop -> system.agent_stop
    - SubagentStop -> system.agent_stop
    - Notification -> system.notification
    - PreCompact -> system.pre_compact
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, Tuple


class ClaudeBenchHookBridge:
    """Bridge between Claude Code hooks and ClaudeBench JSONRPC endpoint"""
    
    def __init__(self):
        self.rpc_url = os.environ.get('CLAUDEBENCH_RPC_URL', 'http://localhost:3000/rpc')
        self.session_id = os.environ.get('CLAUDE_SESSION_ID', f'claude-{int(time.time() * 1000)}')
        self.project_dir = os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd())
        self.timeout = int(os.environ.get('CLAUDEBENCH_TIMEOUT', '5'))
        # Debug mode can be enabled via environment variable
        self.debug = os.environ.get('CLAUDEBENCH_DEBUG', '').lower() in ('true', '1', 'yes')
        
        # Instance ID for this Claude Code session (will be updated from input data if available)
        # Use CLAUDE_INSTANCE_ID from environment if set, otherwise generate from session
        self.instance_id = os.environ.get('CLAUDE_INSTANCE_ID', f"claude-code-{self.session_id[:8]}")
    
    def debug_print(self, message: str):
        """Print debug message to stderr if debug mode is enabled"""
        if self.debug:
            print(f"[DEBUG] {message}", file=sys.stderr)
    
    def transform_claude_to_claudebench(self, claude_data: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        """
        Transform Claude Code hook format to ClaudeBench JSONRPC format
        
        Returns: (method_name, params_dict)
        """
        # Debug: Log all available data
        self.debug_print(f"Raw input keys: {list(claude_data.keys())}")
        self.debug_print(f"Full input data: {json.dumps(claude_data, indent=2)}")
        
        # Extract event type - Claude Code uses 'hook_event_name' field
        event_type = (
            claude_data.get('hook_event_name') or  # Primary field used by Claude Code
            claude_data.get('event') or 
            claude_data.get('event_type') or 
            claude_data.get('type') or
            claude_data.get('hook_type') or
            ''
        )
        
        # If no event field, check if we have specific hook indicators
        if not event_type:
            # Try to detect from the presence of specific fields
            if 'tool_name' in claude_data and 'tool_input' in claude_data:
                # Check if it's pre or post based on presence of result
                if 'tool_result' in claude_data or 'result' in claude_data:
                    event_type = 'PostToolUse'
                else:
                    event_type = 'PreToolUse'
            elif 'prompt' in claude_data:
                event_type = 'UserPromptSubmit'
            elif 'session_id' in claude_data and 'action' in claude_data:
                # Session events
                action = claude_data.get('action', '')
                if action == 'start':
                    event_type = 'SessionStart'
                elif action == 'end':
                    event_type = 'SessionEnd'
            elif 'notification' in claude_data:
                event_type = 'Notification'
        
        self.debug_print(f"Detected event type: '{event_type}'")
        
        # Extract session_id from Claude Code input (overrides environment variable)
        if 'session_id' in claude_data:
            self.session_id = claude_data['session_id']
            # Only update instance_id if CLAUDE_INSTANCE_ID is not set in environment
            if 'CLAUDE_INSTANCE_ID' not in os.environ:
                self.instance_id = f"claude-code-{self.session_id[:8]}"
        
        # Extract common fields from Claude Code
        tool_name = claude_data.get('tool_name', '')
        tool_input = claude_data.get('tool_input', {})
        tool_result = claude_data.get('tool_result', claude_data.get('tool_response', None))
        cwd = claude_data.get('cwd', self.project_dir)
        transcript_path = claude_data.get('transcript_path', '')
        
        timestamp = int(time.time() * 1000)
        
        # Map Claude Code events to ClaudeBench methods
        if event_type in ['PreToolUse', 'pre_tool']:
            # Pre-tool validation
            method = 'hook.pre_tool'
            params = {
                'tool': tool_name,
                'params': tool_input,
                'sessionId': self.session_id,
                'instanceId': self.instance_id,
                'timestamp': timestamp,
                'metadata': {
                    'projectDir': self.project_dir,
                    'eventType': event_type
                }
            }
            
        elif event_type == 'PostToolUse' or (event_type == 'post_tool'):
            # Special case for TodoWrite tool -> hook.todo_write
            if tool_name == 'TodoWrite':
                method = 'hook.todo_write'
                params = {
                    'todos': tool_input.get('todos', []),
                    'sessionId': self.session_id,
                    'instanceId': self.instance_id,
                    'timestamp': timestamp
                }
                # Add previousTodos if available
                if 'previousTodos' in claude_data:
                    params['previousTodos'] = claude_data['previousTodos']
            else:
                # Regular post-tool processing
                method = 'hook.post_tool'
                params = {
                    'tool': tool_name,
                    'params': tool_input,
                    'result': tool_result,
                    'sessionId': self.session_id,
                    'instanceId': self.instance_id,
                    'timestamp': timestamp,
                    'executionTime': claude_data.get('executionTime', 0),
                    'success': claude_data.get('success', True)
                }
                
        elif event_type in ['UserPromptSubmit', 'user_prompt']:
            # User prompt interception
            method = 'hook.user_prompt'
            prompt_text = claude_data.get('prompt', '')
            if isinstance(prompt_text, dict):
                # Handle structured prompt format
                prompt_text = prompt_text.get('text', str(prompt_text))
            
            params = {
                'prompt': prompt_text,
                'context': claude_data.get('context', {
                    'projectPath': self.project_dir,
                    'conversationId': claude_data.get('conversation_id'),
                    'messageCount': claude_data.get('message_count', 0)
                }),
                'sessionId': self.session_id,
                'instanceId': self.instance_id,
                'timestamp': timestamp
            }
            
        elif event_type in ['SessionStart', 'session_start']:
            # Session start event
            method = 'system.register'
            params = {
                'id': self.instance_id,
                'roles': claude_data.get('roles', ['claude-code']),
                'sessionId': self.session_id,
                'timestamp': timestamp,
                'metadata': {
                    'projectDir': self.project_dir,
                    'resumeFrom': claude_data.get('resume_from')
                }
            }
            
        elif event_type in ['SessionEnd', 'session_end']:
            # Session end event
            method = 'system.unregister'
            params = {
                'instanceId': self.instance_id,
                'sessionId': self.session_id,
                'timestamp': timestamp
            }
            
        elif event_type in ['Stop', 'stop']:
            # Main agent stop event
            method = 'hook.agent_stop'
            params = {
                'instanceId': self.instance_id,
                'sessionId': self.session_id,
                'agentType': 'main',
                'timestamp': timestamp
            }
            
        elif event_type in ['SubagentStop', 'subagent_stop']:
            # Subagent stop event
            method = 'hook.agent_stop'
            params = {
                'instanceId': self.instance_id,
                'sessionId': self.session_id,
                'agentType': claude_data.get('subagent_type', 'unknown'),
                'timestamp': timestamp
            }
            
        elif event_type in ['Notification', 'notification']:
            # Notification event
            method = 'hook.notification'
            params = {
                'message': claude_data.get('message', ''),
                'type': claude_data.get('notification_type', 'info'),
                'sessionId': self.session_id,
                'instanceId': self.instance_id,
                'timestamp': timestamp
            }
            
        elif event_type in ['PreCompact', 'pre_compact']:
            # Pre-compaction event
            method = 'hook.pre_compact'
            params = {
                'sessionId': self.session_id,
                'instanceId': self.instance_id,
                'contextSize': claude_data.get('context_size', 0),
                'timestamp': timestamp
            }
            
        else:
            # Unknown event type - log it but don't fail
            self.debug_print(f"Unknown event type: {event_type}, attempting generic handler")
            method = f'hook.{event_type.lower().replace(" ", "_")}'
            params = {
                'data': claude_data,
                'sessionId': self.session_id,
                'instanceId': self.instance_id,
                'timestamp': timestamp
            }
        
        return method, params
    
    def make_jsonrpc_request(self, method: str, params: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
        """
        Make JSONRPC 2.0 request to ClaudeBench
        
        Returns: (response_data, exit_code)
        """
        # Build JSONRPC request
        request_id = int(time.time() * 1000) % 100000  # Simple ID generation
        jsonrpc_request = {
            'jsonrpc': '2.0',
            'method': method,
            'params': params,
            'id': request_id
        }
        
        self.debug_print(f"JSONRPC Request: {json.dumps(jsonrpc_request, indent=2)}")
        
        # Prepare HTTP request
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'claude-code-hook-bridge/1.0'
        }
        
        json_data = json.dumps(jsonrpc_request).encode('utf-8')
        request = urllib.request.Request(
            self.rpc_url,
            data=json_data,
            headers=headers,
            method='POST'
        )
        
        try:
            # Make the request with timeout
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                response_data = response.read().decode('utf-8')
                result = json.loads(response_data)
                
                self.debug_print(f"JSONRPC Response: {json.dumps(result, indent=2)}")
                
                # Check for JSONRPC error
                if 'error' in result:
                    error_code = result['error'].get('code', -32603)
                    error_msg = result['error'].get('message', 'Unknown error')
                    
                    # Custom error code for hook blocking
                    if error_code == -32003:
                        return result, 2  # Exit code 2 for blocking
                    
                    # Log error and return non-blocking error code
                    print(json.dumps({
                        'error': error_msg,
                        'code': error_code
                    }), file=sys.stderr)
                    return result, 1
                
                # Process successful response
                if 'result' in result:
                    response_result = result['result']
                    
                    # Check for blocking conditions
                    if method == 'hook.pre_tool':
                        if not response_result.get('allow', True):
                            # Tool blocked
                            reason = response_result.get('reason', 'Blocked by hook')
                            print(json.dumps({
                                'blocked': True,
                                'reason': reason,
                                'metadata': response_result.get('metadata')
                            }))
                            return result, 2  # Exit code 2 for blocking
                        
                        # Check for parameter modification
                        if 'modified' in response_result:
                            print(json.dumps({
                                'modified': response_result['modified'],
                                'warnings': response_result.get('warnings', [])
                            }))
                    
                    elif method == 'hook.user_prompt':
                        if not response_result.get('continue', True):
                            # Prompt blocked
                            reason = response_result.get('reason', 'Blocked by hook')
                            print(json.dumps({
                                'blocked': True,
                                'reason': reason
                            }))
                            return result, 2  # Exit code 2 for blocking
                        
                        # Check for prompt modification or added context
                        output = {}
                        if 'modified' in response_result:
                            output['modified'] = response_result['modified']
                        if 'addedContext' in response_result:
                            output['addedContext'] = response_result['addedContext']
                        if output:
                            print(json.dumps(output))
                    
                    elif method == 'hook.post_tool':
                        # Pass through processed result
                        if 'processed' in response_result:
                            print(json.dumps({
                                'processed': response_result['processed'],
                                'notifications': response_result.get('notifications', [])
                            }))
                    
                    elif method == 'hook.todo_write':
                        # Pass through summary
                        if response_result.get('processed'):
                            summary = response_result.get('summary', {})
                            print(json.dumps({
                                'processed': True,
                                'summary': summary
                            }))
                    
                    return result, 0  # Success
                
                # Malformed response
                self.debug_print(f"Malformed JSONRPC response: {result}")
                return result, 1
                
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else ''
            self.debug_print(f"HTTP Error {e.code}: {e.reason}")
            if error_body:
                self.debug_print(f"Response body: {error_body}")
            
            # Network errors are non-blocking
            return {'error': f'HTTP {e.code}: {e.reason}'}, 1
            
        except urllib.error.URLError as e:
            self.debug_print(f"Network Error: {e.reason}")
            # Network errors are non-blocking  
            return {'error': f'Network error: {str(e.reason)}'}, 1
            
        except json.JSONDecodeError as e:
            self.debug_print(f"JSON Parse Error: {e}")
            return {'error': f'Invalid JSON response: {str(e)}'}, 1
            
        except Exception as e:
            self.debug_print(f"Unexpected Error: {e}")
            return {'error': f'Unexpected error: {str(e)}'}, 1
    
    def process_hook(self, input_data: str) -> int:
        """
        Process a hook event from Claude Code
        
        Returns: exit code
        """
        try:
            # Parse input JSON
            claude_data = json.loads(input_data)
            self.debug_print(f"Input data: {json.dumps(claude_data, indent=2)}")
            
            # Transform to ClaudeBench format
            method, params = self.transform_claude_to_claudebench(claude_data)
            
            # Make JSONRPC request
            response, exit_code = self.make_jsonrpc_request(method, params)
            
            return exit_code
            
        except json.JSONDecodeError as e:
            print(json.dumps({
                'error': f'Invalid input JSON: {str(e)}'
            }), file=sys.stderr)
            return 1
            
        except ValueError as e:
            print(json.dumps({
                'error': str(e)
            }), file=sys.stderr)
            return 1
            
        except Exception as e:
            print(json.dumps({
                'error': f'Bridge error: {str(e)}'
            }), file=sys.stderr)
            return 1


def main():
    """Main entry point for the hook bridge"""
    bridge = ClaudeBenchHookBridge()
    
    # Try different input methods based on how Claude Code might send data
    input_data = ""
    
    try:
        # Check if we're in a TTY (interactive mode for testing)
        if sys.stdin.isatty():
            bridge.debug_print("Interactive mode detected (TTY)")
            print("Claude Code Hook Bridge - Interactive Mode", file=sys.stderr)
            print("Enter JSON input (Ctrl+D to end):", file=sys.stderr)
            try:
                # Try using input() first (single line)
                input_data = input()
                bridge.debug_print(f"Read via input(): {input_data[:100]}...")
            except EOFError:
                # Fall back to reading all of stdin
                input_data = sys.stdin.read()
                bridge.debug_print(f"Read via stdin.read(): {input_data[:100]}...")
        else:
            # Non-TTY mode - Claude Code is piping data
            bridge.debug_print("Non-TTY mode - reading from pipe")
            # Try to read all available data
            input_data = sys.stdin.read()
            bridge.debug_print(f"Read {len(input_data)} bytes from stdin")
            
            # If empty, try reading line by line
            if not input_data:
                bridge.debug_print("No data from stdin.read(), trying readline")
                input_data = sys.stdin.readline()
                bridge.debug_print(f"Read line: {input_data[:100]}...")
    except Exception as e:
        bridge.debug_print(f"Error reading input: {e}")
        print(json.dumps({
            'error': f'Failed to read input: {str(e)}'
        }), file=sys.stderr)
        sys.exit(1)
    
    if not input_data.strip():
        bridge.debug_print("No input data received")
        print(json.dumps({
            'error': 'No input provided'
        }), file=sys.stderr)
        sys.exit(1)
    
    # Process the hook
    exit_code = bridge.process_hook(input_data)
    sys.exit(exit_code)


if __name__ == '__main__':
    main()