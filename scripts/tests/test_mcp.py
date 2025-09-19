#!/usr/bin/env python3
"""
MCP (Model Context Protocol) Integration Test Script
Tests the MCP server implementation with proper session management
"""

import json
import sys
import urllib.request
import urllib.error
import uuid
from typing import Dict, Any, Tuple, Optional

# Configuration
BASE_URL = "http://localhost:3000/mcp"
HEALTH_URL = f"{BASE_URL}/health"

# ANSI color codes
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
CYAN = '\033[0;36m'
NC = '\033[0m'  # No Color

class MCPClient:
    """Simple MCP client for testing"""
    
    def __init__(self, base_url: str = BASE_URL):
        self.base_url = base_url
        self.session_id: Optional[str] = None
        self.request_id = 0
    
    def _next_id(self) -> int:
        """Get next request ID"""
        self.request_id += 1
        return self.request_id
    
    def _make_request(self, method: str, url: str, data: Optional[Dict] = None, 
                     headers: Optional[Dict] = None) -> Tuple[Dict, int, Dict]:
        """
        Make HTTP request and return (body, status_code, headers)
        """
        if headers is None:
            headers = {}
        
        # Add default headers
        headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream'
        })
        
        # Add session ID if we have one
        if self.session_id:
            headers['Mcp-Session-Id'] = self.session_id
        
        # Prepare request
        request_data = None
        if data:
            request_data = json.dumps(data).encode('utf-8')
        
        request = urllib.request.Request(
            url,
            data=request_data,
            headers=headers,
            method=method
        )
        
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                # Get response headers
                response_headers = dict(response.headers)
                
                # Read response body
                response_body = response.read().decode('utf-8')
                
                # Check if it's SSE format (contains "event:" and "data:")
                if 'event:' in response_body and 'data:' in response_body:
                    # Extract JSON from SSE format
                    # SSE format is: event: message\ndata: {json}\n\n
                    lines = response_body.strip().split('\n')
                    for line in lines:
                        if line.startswith('data: '):
                            sse_data = line[6:].strip()  # Remove "data: " prefix
                            try:
                                body_data = json.loads(sse_data) if sse_data else {}
                                break
                            except json.JSONDecodeError:
                                continue
                    else:
                        body_data = {"raw": response_body}
                elif response_body.startswith('data: '):
                    # Simple SSE format with just data line
                    sse_data = response_body[6:].strip()
                    try:
                        body_data = json.loads(sse_data) if sse_data else {}
                    except json.JSONDecodeError:
                        body_data = {"raw": response_body}
                else:
                    # Try to parse as JSON
                    try:
                        body_data = json.loads(response_body) if response_body else {}
                    except json.JSONDecodeError:
                        body_data = {"raw": response_body}
                
                return body_data, response.status, response_headers
                
        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8') if e.fp else ''
            try:
                body_data = json.loads(error_body) if error_body else {}
            except:
                body_data = {"error": error_body}
            return body_data, e.code, dict(e.headers)
            
        except urllib.error.URLError as e:
            return {"error": f"Network error: {e.reason}"}, 0, {}
            
        except Exception as e:
            return {"error": f"Unexpected error: {e}"}, 0, {}
    
    def initialize(self) -> bool:
        """Initialize MCP session"""
        print(f"{CYAN}Initializing MCP session...{NC}")
        
        request_data = {
            "jsonrpc": "2.0",
            "method": "initialize",
            "params": {
                "protocolVersion": "0.1.0",
                "capabilities": {
                    "tools": {}
                },
                "clientInfo": {
                    "name": "test-client",
                    "version": "1.0.0"
                }
            },
            "id": self._next_id()
        }
        
        body, status, headers = self._make_request("POST", self.base_url, request_data)
        
        # Extract session ID from headers
        session_id = headers.get('mcp-session-id') or headers.get('Mcp-Session-Id')
        if session_id:
            self.session_id = session_id
            print(f"  Session ID: {GREEN}{session_id}{NC}")
            
            # Debug: print what we got
            # print(f"  Debug body: {json.dumps(body, indent=2)}")
            
            # Check response
            if 'result' in body:
                result = body['result']
                print(f"  Server: {result.get('serverInfo', {}).get('name', 'unknown')}")
                print(f"  Version: {result.get('serverInfo', {}).get('version', 'unknown')}")
                
                # Check capabilities
                caps = result.get('capabilities', {})
                if caps:
                    print(f"  Capabilities: {', '.join(caps.keys())}")
                
                return True
            elif 'error' in body:
                print(f"  {RED}Error: {body['error']}{NC}")
                return False
            else:
                # Maybe successful even without explicit result field
                print(f"  {YELLOW}Warning: No result field but session created{NC}")
                return True
        else:
            print(f"  {RED}No session ID in response{NC}")
            return False
    
    def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Tuple[bool, Any]:
        """Call an MCP tool"""
        if not self.session_id:
            print(f"{RED}No active session{NC}")
            return False, None
        
        request_data = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": tool_name,
                "arguments": arguments
            },
            "id": self._next_id()
        }
        
        body, status, headers = self._make_request("POST", self.base_url, request_data)
        
        if 'result' in body:
            # Check if result is null
            if body['result'] is None:
                return False, "Result is null"
            return True, body['result']
        elif 'error' in body:
            return False, body['error']
        else:
            return False, body
    
    def list_tools(self) -> Tuple[bool, Any]:
        """List available MCP tools"""
        if not self.session_id:
            print(f"{RED}No active session{NC}")
            return False, None
        
        request_data = {
            "jsonrpc": "2.0",
            "method": "tools/list",
            "params": {},
            "id": self._next_id()
        }
        
        body, status, headers = self._make_request("POST", self.base_url, request_data)
        
        if 'result' in body:
            return True, body['result']
        elif 'error' in body:
            return False, body['error']
        else:
            return False, body
    
    def terminate(self) -> bool:
        """Terminate MCP session"""
        if not self.session_id:
            return True
        
        print(f"{CYAN}Terminating session {self.session_id}...{NC}")
        
        body, status, headers = self._make_request("DELETE", self.base_url)
        
        if status == 200 or status == 204:
            print(f"  {GREEN}Session terminated{NC}")
            self.session_id = None
            return True
        else:
            print(f"  {RED}Failed to terminate: {body}{NC}")
            return False
    
    def check_health(self) -> bool:
        """Check MCP health endpoint"""
        body, status, headers = self._make_request("GET", HEALTH_URL)
        
        if status == 200:
            return True, body
        else:
            return False, body

def test_tool_call(client: MCPClient, tool_name: str, arguments: Dict, 
                  test_name: str, should_succeed: bool = True) -> bool:
    """Helper to test a tool call"""
    print(f"\n{BLUE}Testing: {test_name}{NC}")
    print(f"  Tool: {tool_name}")
    print(f"  Arguments: {json.dumps(arguments, indent=4)}")
    
    success, result = client.call_tool(tool_name, arguments)
    
    if should_succeed:
        if success:
            print(f"  {GREEN}✓ Success{NC}")
            if isinstance(result, dict) and 'content' in result:
                # MCP format with content array
                for content in result.get('content', []):
                    if content.get('type') == 'text':
                        try:
                            parsed = json.loads(content.get('text', '{}'))
                            print(f"  Result: {json.dumps(parsed, indent=4)}")
                        except:
                            print(f"  Result: {content.get('text', 'N/A')}")
            else:
                print(f"  Result: {json.dumps(result, indent=4)}")
            return True
        else:
            print(f"  {RED}✗ Failed: {result}{NC}")
            return False
    else:
        # We expect this to fail
        if not success:
            print(f"  {GREEN}✓ Failed as expected{NC}")
            print(f"  Error: {result}")
            return True
        else:
            print(f"  {RED}✗ Should have failed but succeeded{NC}")
            return False

def main():
    """Run MCP integration tests"""
    print(f"\n{YELLOW}{'='*50}{NC}")
    print(f"{YELLOW}MCP Integration Test Suite{NC}")
    print(f"{YELLOW}{'='*50}{NC}\n")
    
    # Create client
    client = MCPClient()
    
    # Track test results
    tests_passed = 0
    tests_total = 0
    
    # Test 1: Health check
    print(f"{GREEN}1. Checking MCP health endpoint...{NC}")
    tests_total += 1
    success, health = client.check_health()
    if success:
        print(f"  {GREEN}✓ MCP is healthy{NC}")
        print(f"  Status: {json.dumps(health, indent=4)}")
        tests_passed += 1
    else:
        print(f"  {RED}✗ MCP health check failed{NC}")
    
    # Test 2: Initialize session
    print(f"\n{GREEN}2. Initialize MCP session...{NC}")
    tests_total += 1
    if client.initialize():
        print(f"  {GREEN}✓ Session initialized{NC}")
        tests_passed += 1
    else:
        print(f"  {RED}✗ Failed to initialize session{NC}")
        sys.exit(1)
    
    # Test 3: List available tools
    print(f"\n{GREEN}3. List available tools...{NC}")
    tests_total += 1
    success, tools = client.list_tools()
    if success:
        tool_list = tools.get('tools', [])
        print(f"  {GREEN}✓ Found {len(tool_list)} tools{NC}")
        
        # Show first few tools
        for i, tool in enumerate(tool_list[:5]):
            print(f"    - {tool.get('name', 'unknown')}: {tool.get('description', 'N/A')}")
        if len(tool_list) > 5:
            print(f"    ... and {len(tool_list) - 5} more")
        
        tests_passed += 1
    else:
        print(f"  {RED}✗ Failed to list tools: {tools}{NC}")
    
    # Test 4: Create a task
    tests_total += 1
    if test_tool_call(
        client,
        "task__create",
        {
            "text": "Test task from MCP integration test",
            "priority": 2
        },
        "Create a task",
        should_succeed=True
    ):
        tests_passed += 1
    
    # Test 5: Create task with missing required field (should fail)
    tests_total += 1
    if test_tool_call(
        client,
        "task__create",
        {
            "priority": 1
        },
        "Create task with missing 'text' field",
        should_succeed=False
    ):
        tests_passed += 1
    
    # Test 6: System health check
    tests_total += 1
    if test_tool_call(
        client,
        "system__health",
        {},
        "Check system health",
        should_succeed=True
    ):
        tests_passed += 1
    
    # Test 7: Get system metrics
    tests_total += 1
    if test_tool_call(
        client,
        "system__metrics",
        {},
        "Get system metrics",
        should_succeed=True
    ):
        tests_passed += 1
    
    # Test 8: Invalid tool name
    tests_total += 1
    if test_tool_call(
        client,
        "invalid__tool",
        {"test": "data"},
        "Call invalid tool",
        should_succeed=False
    ):
        tests_passed += 1
    
    # Test 9: Pre-tool hook via MCP
    tests_total += 1
    if test_tool_call(
        client,
        "hook__pre_tool",
        {
            "tool": "Read",
            "params": {"file_path": "/tmp/test.txt"},
            "sessionId": client.session_id or "test",
            "timestamp": 1234567890
        },
        "Pre-tool hook validation",
        should_succeed=True
    ):
        tests_passed += 1
    
    # Test 10: Create another session (test multi-session)
    print(f"\n{GREEN}10. Testing multi-session support...{NC}")
    tests_total += 1
    
    # Save current session
    first_session = client.session_id
    
    # Create new client for second session
    client2 = MCPClient()
    if client2.initialize():
        if client2.session_id != first_session:
            print(f"  {GREEN}✓ Second session created: {client2.session_id}{NC}")
            tests_passed += 1
            
            # Clean up second session
            client2.terminate()
        else:
            print(f"  {RED}✗ Sessions have same ID{NC}")
    else:
        print(f"  {RED}✗ Failed to create second session{NC}")
    
    # Test 11: Terminate session
    print(f"\n{GREEN}11. Terminate session...{NC}")
    tests_total += 1
    if client.terminate():
        print(f"  {GREEN}✓ Session terminated{NC}")
        tests_passed += 1
    else:
        print(f"  {RED}✗ Failed to terminate session{NC}")
    
    # Summary
    print(f"\n{YELLOW}{'='*50}{NC}")
    print(f"{YELLOW}Test Results{NC}")
    print(f"{YELLOW}{'='*50}{NC}")
    
    if tests_passed == tests_total:
        print(f"{GREEN}✓ All tests passed! ({tests_passed}/{tests_total}){NC}")
        sys.exit(0)
    else:
        print(f"{YELLOW}⚠ {tests_passed}/{tests_total} tests passed{NC}")
        print(f"{RED}✗ {tests_total - tests_passed} tests failed{NC}")
        sys.exit(1)

if __name__ == '__main__':
    main()