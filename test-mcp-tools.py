#!/usr/bin/env python3

import requests
import json

# Initialize session
print("1. Initializing MCP session...")
init_response = requests.post('http://localhost:3000/mcp', 
    headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream'},
    json={'jsonrpc': '2.0', 'method': 'initialize', 'params': {'protocolVersion': '0.1.0'}, 'id': 1})

session_id = init_response.headers.get('Mcp-Session-Id')
print(f"   Session ID: {session_id}")
print(f"   Init response: {json.dumps(init_response.json(), indent=2)}")

# Send initialized notification
print("\n1.5. Sending initialized notification...")
initialized_response = requests.post('http://localhost:3000/mcp',
    headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': session_id},
    json={'jsonrpc': '2.0', 'method': 'notifications/initialized', 'params': {}, 'id': None})
print(f"   Initialized response: {initialized_response.status_code}")

# List tools
print("\n2. Requesting tools/list...")
tools_response = requests.post('http://localhost:3000/mcp',
    headers={'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', 'Mcp-Session-Id': session_id},
    json={'jsonrpc': '2.0', 'method': 'tools/list', 'params': {}, 'id': 2})

tools_data = tools_response.json()
print(f"   Raw response: {json.dumps(tools_data, indent=2)}")

# Check if tools have inputSchema
if 'result' in tools_data and 'tools' in tools_data['result']:
    tools = tools_data['result']['tools']
    print(f"\n3. Found {len(tools)} tools")
    
    # Check first tool
    if tools:
        first_tool = tools[0]
        print(f"\n   First tool details:")
        print(f"   - Name: {first_tool.get('name')}")
        print(f"   - Description: {first_tool.get('description')}")
        print(f"   - Has inputSchema: {'inputSchema' in first_tool}")
        if 'inputSchema' in first_tool:
            print(f"   - Input schema: {json.dumps(first_tool['inputSchema'], indent=6)}")
        else:
            print(f"   - Available keys: {list(first_tool.keys())}")