#!/usr/bin/env python3
"""
Test script for hook handlers using JSONRPC 2.0 protocol at /rpc endpoint
Tests the ClaudeBench event-driven architecture with hook handlers
"""

import json
import os
import sys
import urllib.request
import urllib.error
from typing import Dict, Any, Tuple, Optional

# Configuration
RPC_URL = os.environ.get('CLAUDEBENCH_RPC_URL', 'http://localhost:3000/rpc')
API_TOKEN = os.environ.get('CLAUDEBENCH_API_TOKEN', '')

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
NC = '\033[0m'  # No Color

def make_jsonrpc_request(method: str, params: Dict[str, Any], request_id: Optional[int] = None) -> Tuple[Dict[str, Any], int]:
    """
    Make JSONRPC 2.0 request to ClaudeBench /rpc endpoint
    Returns (response_data, exit_code)
    
    Exit codes:
    - 0: Success (allowed/processed)
    - 1: Blocked by hook
    - 2: Error
    """
    # Build JSONRPC 2.0 request
    jsonrpc_request = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params
    }
    
    # Add ID if provided (makes it a request expecting response)
    if request_id is not None:
        jsonrpc_request["id"] = request_id
    
    # Prepare HTTP headers
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
    
    # Add authentication token if provided
    if API_TOKEN:
        headers['Authorization'] = f'Bearer {API_TOKEN}'
    
    # Encode request as JSON
    json_data = json.dumps(jsonrpc_request).encode('utf-8')
    
    # Create HTTP request
    request = urllib.request.Request(
        RPC_URL,
        data=json_data,
        headers=headers,
        method='POST'
    )
    
    try:
        # Make the request
        with urllib.request.urlopen(request, timeout=10) as response:
            response_data = response.read().decode('utf-8')
            result = json.loads(response_data)
            
            # Check for JSONRPC error response
            if 'error' in result:
                error_code = result['error'].get('code', -32603)
                error_msg = result['error'].get('message', 'Unknown error')
                
                # Hook blocked is a special case - exit code 1
                if error_code == -32003:  # HOOK_BLOCKED custom error code
                    return result, 1
                else:
                    print(f"  JSONRPC Error {error_code}: {error_msg}")
                    return result, 2
            
            # Success response with result
            if 'result' in result:
                response_result = result.get('result', {})
                
                # Check hook-specific blocking conditions
                if isinstance(response_result, dict):
                    # For hook.pre_tool: check 'allow' field
                    if method == 'hook.pre_tool' and not response_result.get('allow', True):
                        return result, 1  # Blocked
                    
                    # For hook.user_prompt: check 'continue' field  
                    if method == 'hook.user_prompt' and not response_result.get('continue', True):
                        return result, 1  # Blocked
                
                return result, 0  # Success
            
            # Neither error nor result - malformed response
            print(f"  Malformed JSONRPC response: {result}")
            return result, 2
    
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.fp else ''
        print(f"  HTTP Error {e.code}: {e.reason}")
        if error_body:
            print(f"  Response: {error_body}")
        return {
            'error': {
                'code': -32603,
                'message': f'HTTP {e.code}: {e.reason}'
            }
        }, 2
    
    except urllib.error.URLError as e:
        print(f"  Network Error: {e.reason}")
        return {
            'error': {
                'code': -32603,
                'message': f'Network error: {str(e.reason)}'
            }
        }, 2
    
    except json.JSONDecodeError as e:
        print(f"  JSON Parse Error: {e}")
        return {
            'error': {
                'code': -32700,
                'message': f'Invalid JSON response: {str(e)}'
            }
        }, 2
    
    except Exception as e:
        print(f"  Unexpected Error: {e}")
        return {
            'error': {
                'code': -32603,
                'message': f'Unexpected error: {str(e)}'
            }
        }, 2

def test_hook(test_name: str, method: str, params: Dict[str, Any], expected_exit_code: int = 0, request_id: int = 1) -> bool:
    """Test a specific hook via JSONRPC"""
    print(f"{BLUE}[TEST]{NC} {test_name}")
    print(f"  Method: {method}")
    
    response, exit_code = make_jsonrpc_request(method, params, request_id)
    
    if exit_code == expected_exit_code:
        print(f"{GREEN}  [✓]{NC} Passed (exit_code={exit_code})")
        
        # Print useful response details
        if 'result' in response:
            result = response['result']
            if isinstance(result, dict):
                if 'allow' in result and not result['allow']:
                    print(f"    Blocked: {result.get('reason', 'No reason provided')}")
                elif 'continue' in result and not result['continue']:
                    print(f"    Blocked: {result.get('reason', 'No reason provided')}")
                elif 'processed' in result:
                    print(f"    Processed: {result['processed']}")
        
        return True
    else:
        print(f"{RED}  [✗]{NC} Failed (expected={expected_exit_code}, actual={exit_code})")
        
        # Print error details
        if 'error' in response:
            error = response['error']
            print(f"    Error: {error.get('message', 'Unknown error')}")
            if 'data' in error:
                print(f"    Details: {json.dumps(error['data'], indent=6)}")
        
        return False

def main():
    """Run all hook tests via JSONRPC"""
    print(f"\n{BLUE}ClaudeBench Hook Tests (JSONRPC 2.0){NC}")
    print("=" * 50)
    print(f"RPC Endpoint: {RPC_URL}")
    print()
    
    # Test server connectivity first
    print(f"{BLUE}[INFO]{NC} Testing JSONRPC endpoint...")
    response, exit_code = make_jsonrpc_request("system.health", {}, 999)
    if exit_code == 0:
        print(f"{GREEN}[✓]{NC} Server is responding")
    else:
        print(f"{RED}[✗]{NC} Server not responding properly")
        sys.exit(1)
    
    print()
    tests_passed = 0
    tests_total = 0
    
    # Test 1: hook.pre_tool with safe tool (should allow)
    tests_total += 1
    if test_hook(
        "Pre-tool validation with safe tool",
        "hook.pre_tool",
        {
            "tool": "Read",
            "params": {"file_path": "/tmp/test.txt"},
            "sessionId": "test-session-001",
            "timestamp": 1234567890
        },
        expected_exit_code=0,
        request_id=1
    ):
        tests_passed += 1
    
    print()
    
    # Test 2: hook.pre_tool with dangerous command (should block)
    tests_total += 1
    if test_hook(
        "Pre-tool validation with dangerous command",
        "hook.pre_tool",
        {
            "tool": "Bash",
            "params": {"command": "rm -rf /", "description": "Remove all files"},
            "sessionId": "test-session-002",
            "timestamp": 1234567891
        },
        expected_exit_code=1,  # Expect blocking
        request_id=2
    ):
        tests_passed += 1
    
    print()
    
    # Test 3: hook.post_tool (should always allow)
    tests_total += 1
    if test_hook(
        "Post-tool processing",
        "hook.post_tool",
        {
            "tool": "Write",
            "params": {"file_path": "/tmp/output.txt", "content": "Test"},
            "result": {"success": True, "bytesWritten": 4},
            "sessionId": "test-session-003",
            "timestamp": 1234567892,
            "executionTime": 45,
            "success": True
        },
        expected_exit_code=0,
        request_id=3
    ):
        tests_passed += 1
    
    print()
    
    # Test 4: hook.post_tool with error result
    tests_total += 1
    if test_hook(
        "Post-tool with error result",
        "hook.post_tool",
        {
            "tool": "Bash",
            "params": {"command": "ls /nonexistent"},
            "result": {"error": "Directory not found", "exitCode": 1},
            "sessionId": "test-session-004",
            "timestamp": 1234567893,
            "executionTime": 12,
            "success": False
        },
        expected_exit_code=0,  # Post hooks don't block
        request_id=4
    ):
        tests_passed += 1
    
    print()
    
    # Test 5: hook.user_prompt with clean prompt
    tests_total += 1
    if test_hook(
        "User prompt validation - clean",
        "hook.user_prompt",
        {
            "prompt": "Help me refactor this function",
            "context": {"currentFile": "app.ts", "messageCount": 5},
            "sessionId": "test-session-005",
            "timestamp": 1234567894
        },
        expected_exit_code=0,
        request_id=5
    ):
        tests_passed += 1
    
    print()
    
    # Test 6: hook.user_prompt with extremely long prompt
    tests_total += 1
    if test_hook(
        "User prompt validation - too long",
        "hook.user_prompt",
        {
            "prompt": "x" * 10001,  # Over 10000 chars
            "context": {},
            "sessionId": "test-session-006",
            "timestamp": 1234567895
        },
        expected_exit_code=1,  # Should block due to length
        request_id=6
    ):
        tests_passed += 1
    
    print()
    
    # Test 7: hook.todo_write
    tests_total += 1
    if test_hook(
        "Todo write hook",
        "hook.todo_write",
        {
            "todos": [
                {"content": "Implement feature", "status": "pending"},
                {"content": "Add tests", "status": "in_progress", "activeForm": "Writing tests"},
                {"content": "Deploy", "status": "completed"}
            ],
            "sessionId": "test-session-007",
            "timestamp": 1234567896
        },
        expected_exit_code=0,
        request_id=7
    ):
        tests_passed += 1
    
    print()
    
    # Test 8: Invalid method (should error)
    tests_total += 1
    print(f"{BLUE}[TEST]{NC} Invalid method handling")
    print(f"  Method: invalid.method")
    response, exit_code = make_jsonrpc_request("invalid.method", {}, 8)
    if exit_code == 2:  # Should return error
        print(f"{GREEN}  [✓]{NC} Correctly rejected invalid method")
        tests_passed += 1
    else:
        print(f"{RED}  [✗]{NC} Should have rejected invalid method")
    
    print()
    
    # Test 9: Missing required params
    tests_total += 1
    print(f"{BLUE}[TEST]{NC} Missing required parameters")
    print(f"  Method: hook.pre_tool (missing params)")
    response, exit_code = make_jsonrpc_request(
        "hook.pre_tool",
        {"tool": "Read"},  # Missing required params, sessionId, timestamp
        9
    )
    if exit_code == 2:  # Should return validation error
        print(f"{GREEN}  [✓]{NC} Validation error correctly returned")
        tests_passed += 1
    else:
        print(f"{RED}  [✗]{NC} Should have returned validation error")
    
    print()
    
    # Test 10: Notification (no ID, no response expected)
    tests_total += 1
    print(f"{BLUE}[TEST]{NC} JSONRPC Notification (no response expected)")
    print(f"  Method: hook.post_tool (as notification)")
    
    # For notifications, we don't expect a response
    # This tests fire-and-forget pattern
    response, exit_code = make_jsonrpc_request(
        "hook.post_tool",
        {
            "tool": "Bash",
            "params": {"command": "echo test"},
            "result": {"output": "test"},
            "sessionId": "test-session-010",
            "timestamp": 1234567899,
            "executionTime": 5,
            "success": True
        },
        request_id=None  # No ID = notification
    )
    # Since it's a notification, we might not get a response
    # but the server should accept it
    print(f"{GREEN}  [✓]{NC} Notification sent")
    tests_passed += 1
    
    # Summary
    print()
    print("=" * 50)
    if tests_passed == tests_total:
        print(f"{GREEN}[✓] All tests passed! ({tests_passed}/{tests_total}){NC}")
        sys.exit(0)
    else:
        print(f"{YELLOW}[!] {tests_passed}/{tests_total} tests passed{NC}")
        print(f"{RED}[✗] {tests_total - tests_passed} tests failed{NC}")
        sys.exit(1)

if __name__ == '__main__':
    main()