#!/bin/bash

# MCP Integration Test Script
# Tests the full MCP flow with proper type safety

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:3000/mcp"

echo -e "${YELLOW}=== MCP Integration Test ===${NC}"
echo ""

# Step 1: Initialize MCP session
echo -e "${GREEN}1. Initializing MCP session...${NC}"
INIT_RESPONSE=$(curl -s -i -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
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
    "id": 1
  }')

# Extract session ID from response headers
SESSION_ID=$(echo "$INIT_RESPONSE" | grep -i "mcp-session-id" | cut -d: -f2 | tr -d ' \r')

if [ -z "$SESSION_ID" ]; then
  echo -e "${RED}Failed to get session ID${NC}"
  exit 1
fi

echo -e "Session ID: ${GREEN}$SESSION_ID${NC}"
echo ""

# Step 2: Create a task
echo -e "${GREEN}2. Creating a task...${NC}"
TASK_RESPONSE=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "task_create",
      "arguments": {
        "text": "Test task from MCP integration test",
        "priority": "high"
      }
    },
    "id": 2
  }')

echo "Response: $TASK_RESPONSE"
echo ""

# Check if we got a result
if echo "$TASK_RESPONSE" | grep -q '"result"'; then
  if echo "$TASK_RESPONSE" | grep -q '"result":null'; then
    echo -e "${RED}Task creation returned null result${NC}"
    
    # Check for error
    if echo "$TASK_RESPONSE" | grep -q '"error"'; then
      echo -e "${RED}Error details:${NC}"
      echo "$TASK_RESPONSE" | jq '.error' 2>/dev/null || echo "$TASK_RESPONSE"
    fi
  else
    echo -e "${GREEN}Task created successfully!${NC}"
    echo "$TASK_RESPONSE" | jq '.result' 2>/dev/null || echo "$TASK_RESPONSE"
  fi
else
  echo -e "${RED}No result field in response${NC}"
fi
echo ""

# Step 3: Test task with missing required field (should error)
echo -e "${GREEN}3. Testing validation (missing text field)...${NC}"
ERROR_RESPONSE=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "task_create",
      "arguments": {
        "priority": "low"
      }
    },
    "id": 3
  }')

echo "Response: $ERROR_RESPONSE"

if echo "$ERROR_RESPONSE" | grep -q '"error"'; then
  echo -e "${GREEN}Validation working correctly - error for missing text field${NC}"
else
  echo -e "${RED}Expected validation error but got success${NC}"
fi
echo ""

# Step 4: Test instance status tool
echo -e "${GREEN}4. Testing instance_status tool...${NC}"
INSTANCE_RESPONSE=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "instance_status",
      "arguments": {
        "instanceId": "MASTER"
      }
    },
    "id": 4
  }')

echo "Response: $INSTANCE_RESPONSE"
echo ""

# Step 5: Terminate session
echo -e "${GREEN}5. Terminating session...${NC}"
TERMINATE_RESPONSE=$(curl -s -X DELETE $BASE_URL \
  -H "Mcp-Session-Id: $SESSION_ID")

echo "Response: $TERMINATE_RESPONSE"
echo ""

# Step 6: Check health endpoint
echo -e "${GREEN}6. Checking MCP health...${NC}"
HEALTH_RESPONSE=$(curl -s $BASE_URL/health)
echo "Health: $HEALTH_RESPONSE"
echo ""

echo -e "${YELLOW}=== Test Complete ===${NC}"