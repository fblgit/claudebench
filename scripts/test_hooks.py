#!/usr/bin/env python3
"""
Test script for hook endpoints - mimics hook-client.py behavior
This ensures the server endpoints match the exact signatures expected by the client
"""

import json
import os
import sys
import urllib.request
import urllib.error
import urllib.parse
from typing import Dict, Any, Tuple

# Configuration
API_URL = os.environ.get('CLAUDEBENCH_API_URL', 'http://localhost:3000')
API_TOKEN = os.environ.get('CLAUDEBENCH_API_TOKEN', '')

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
NC = '\033[0m'  # No Color

# Map hook names to API endpoints (Hono routes)
HOOK_ENDPOINTS = {
    'pre-tool-use': '/hooks/pre_tool',
    'post-tool-use': '/hooks/post_tool',
    'user-prompt-submit': '/hooks/user_prompt',
    'todo-write': '/hooks/todo_write'
}

def make_request(endpoint: str, data: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    """
    Make HTTP POST request to ClaudeBench API
    Returns (response_data, exit_code)
    """
    url = f"{API_URL}{endpoint}"
    
    # Prepare the request (same as hook-client.py)
    headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
    
    # Add authentication token if provided
    if API_TOKEN:
        headers['Authorization'] = f'Bearer {API_TOKEN}'
    
    # Direct JSON payload for Hono routes
    json_data = json.dumps(data).encode('utf-8')
    
    # Create the request
    request = urllib.request.Request(
        url,
        data=json_data,
        headers=headers,
        method='POST'
    )
    
    try:
        # Make the request
        with urllib.request.urlopen(request, timeout=10) as response:
            response_data = response.read().decode('utf-8')
            result = json.loads(response_data)
            
            # Determine exit code based on response
            # Handle both success:true,allow:false AND success:false,blocked:true patterns
            if result.get('success', False):
                if result.get('allow', True):
                    return result, 0  # Success, allow operation
                else:
                    return result, 1  # Success, but block operation
            elif result.get('blocked', False):
                # Also treat blocked:true as exit code 1 (blocked but handled)
                return result, 1  # Blocked operation
            else:
                return result, 2  # Error
    
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8') if e.read() else ''
        return {
            'error': f'HTTP {e.code}: {e.reason}',
            'details': error_body,
            'success': False
        }, 2
    
    except urllib.error.URLError as e:
        return {
            'error': f'Network error: {str(e.reason)}',
            'success': False
        }, 2
    
    except json.JSONDecodeError as e:
        return {
            'error': f'Invalid JSON response: {str(e)}',
            'success': False
        }, 2
    
    except Exception as e:
        return {
            'error': f'Unexpected error: {str(e)}',
            'success': False
        }, 2

def test_hook(hook_name: str, payload: Dict[str, Any], expected_exit_code: int = 0) -> bool:
    """Test a specific hook endpoint"""
    if hook_name not in HOOK_ENDPOINTS:
        # For invalid hooks, we expect them to fail
        if expected_exit_code == 2:
            print(f"{GREEN}[✓]{NC} Unknown hook correctly rejected: {hook_name}")
            return True
        else:
            print(f"{RED}[✗]{NC} Unknown hook: {hook_name}")
            return False
    
    endpoint = HOOK_ENDPOINTS[hook_name]
    print(f"{BLUE}[TEST]{NC} Testing {hook_name} ({endpoint})...")
    
    response, exit_code = make_request(endpoint, payload)
    
    if exit_code == expected_exit_code:
        print(f"{GREEN}[✓]{NC} {hook_name} passed (exit_code={exit_code})")
        if 'reason' in response and response.get('blocked'):
            print(f"  Blocked reason: {response['reason']}")
        return True
    else:
        print(f"{RED}[✗]{NC} {hook_name} failed (expected={expected_exit_code}, actual={exit_code})")
        if 'error' in response:
            print(f"  Error: {response['error']}")
        if 'reason' in response:
            print(f"  Reason: {response['reason']}")
        return False

def main():
    """Run all hook endpoint tests"""
    print(f"\n{BLUE}Hook Endpoint Test Suite{NC}")
    print("=" * 50)
    print(f"API URL: {API_URL}")
    print()
    
    # Skip healthCheck since ORPC doesn't support GET requests
    # The server logs show it's running, so we'll test directly
    print(f"{BLUE}[INFO]{NC} Testing server at {API_URL}")
    print(f"{YELLOW}[NOTE]{NC} ORPC doesn't support GET requests, testing POST endpoints directly")
    
    print()
    tests_passed = 0
    tests_total = 0
    
    # Test 1: Pre-tool-use with safe tool (should allow)
    tests_total += 1
    if test_hook('pre-tool-use', {
        'tool': 'Read',
        'parameters': {'file_path': '/tmp/test.txt'},
        'instanceId': 'MASTER',
        'correlationId': '550e8400-e29b-41d4-a716-446655440001',
        'timestamp': '2024-01-01T00:00:00Z'
    }, expected_exit_code=0):
        tests_passed += 1
    
    print()
    
    # Test 2: Pre-tool-use with dangerous tool (should block)
    tests_total += 1
    if test_hook('pre-tool-use', {
        'tool': 'rm',
        'parameters': {'path': '/important/file'},
        'instanceId': 'WORKER1',
        'correlationId': '550e8400-e29b-41d4-a716-446655440002',
        'timestamp': '2024-01-01T00:00:01Z'
    }, expected_exit_code=1):  # Expect exit code 1 (blocked)
        tests_passed += 1
    
    print()
    
    # Test 3: Post-tool-use (should always allow)
    tests_total += 1
    if test_hook('post-tool-use', {
        'tool': 'Write',
        'parameters': {'file_path': '/tmp/output.txt', 'content': 'Test'},
        'result': {'success': True, 'bytesWritten': 4},
        'duration': 45,
        'instanceId': 'MASTER',
        'correlationId': '550e8400-e29b-41d4-a716-446655440003',
        'timestamp': '2024-01-01T00:00:02Z'
    }, expected_exit_code=0):
        tests_passed += 1
    
    print()
    
    # Test 4: Post-tool-use with error (should still allow)
    tests_total += 1
    if test_hook('post-tool-use', {
        'tool': 'Bash',
        'parameters': {'command': 'ls /nonexistent'},
        'result': {'error': 'Directory not found', 'exitCode': 1},
        'duration': 12,
        'instanceId': 'WORKER2',
        'correlationId': '550e8400-e29b-41d4-a716-446655440004',
        'timestamp': '2024-01-01T00:00:03Z'
    }, expected_exit_code=0):  # Post hooks don't block
        tests_passed += 1
    
    print()
    
    # Test 5: User-prompt-submit with clean prompt
    tests_total += 1
    if test_hook('user-prompt-submit', {
        'prompt': 'Help me refactor this function',
        'context': {'currentFile': 'app.ts'},
        'instanceId': 'MASTER',
        'correlationId': '550e8400-e29b-41d4-a716-446655440005',
        'timestamp': '2024-01-01T00:00:04Z'
    }, expected_exit_code=0):
        tests_passed += 1
    
    print()
    
    # Test 6: User-prompt-submit with extremely long prompt (should block)
    tests_total += 1
    if test_hook('user-prompt-submit', {
        'prompt': 'x' * 10001,  # Over 10000 chars
        'context': {},
        'instanceId': 'WORKER1',
        'correlationId': '550e8400-e29b-41d4-a716-446655440006',
        'timestamp': '2024-01-01T00:00:05Z'
    }, expected_exit_code=1):  # Should block due to length
        tests_passed += 1
    
    print()
    
    # Test 7: Todo-write create operation
    tests_total += 1
    if test_hook('todo-write', {
        'todos': [
            {'content': 'Implement feature', 'status': 'pending'},
            {'content': 'Add tests', 'status': 'in_progress', 'activeForm': 'Writing tests'}
        ],
        'operation': 'create',
        'instanceId': 'MASTER',
        'correlationId': '550e8400-e29b-41d4-a716-446655440007',
        'timestamp': '2024-01-01T00:00:06Z'
    }, expected_exit_code=0):
        tests_passed += 1
    
    print()
    
    # Test 8: Todo-write update operation
    tests_total += 1
    if test_hook('todo-write', {
        'todos': [
            {'content': 'Implement feature', 'status': 'completed', 'activeForm': 'Done'}
        ],
        'operation': 'update',
        'instanceId': 'WORKER1',
        'correlationId': '550e8400-e29b-41d4-a716-446655440008',
        'timestamp': '2024-01-01T00:00:07Z'
    }, expected_exit_code=0):
        tests_passed += 1
    
    print()
    
    # Test 9: Invalid hook name (should fail)
    tests_total += 1
    if test_hook('invalid-hook', {}, expected_exit_code=2):
        tests_passed += 1
    
    print()
    
    # Test 10: Missing required fields (validation error)
    tests_total += 1
    endpoint = HOOK_ENDPOINTS['pre-tool-use']
    print(f"{BLUE}[TEST]{NC} Testing validation error handling...")
    response, exit_code = make_request(endpoint, {'tool': 'Read'})  # Missing 'parameters'
    if exit_code == 2:
        print(f"{GREEN}[✓]{NC} Validation error correctly returned exit_code=2")
        tests_passed += 1
    else:
        print(f"{RED}[✗]{NC} Expected validation error")
    
    # Summary
    print()
    print("=" * 50)
    if tests_passed == tests_total:
        print(f"{GREEN}[✓] All tests passed! ({tests_passed}/{tests_total}){NC}")
        sys.exit(0)
    else:
        print(f"{YELLOW}[!] {tests_passed}/{tests_total} tests passed{NC}")
        sys.exit(1)

if __name__ == '__main__':
    main()
