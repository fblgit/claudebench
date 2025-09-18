#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

BASE_URL="http://localhost:8000"

echo -e "${BLUE}=== ClaudeBench Inference Server Test Suite ===${NC}\n"

# Check if server is running
echo -e "${BLUE}1. Testing Health Endpoint...${NC}"
HEALTH=$(curl -s "$BASE_URL/health" | python -m json.tool 2>/dev/null)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Health check passed${NC}"
    echo "$HEALTH" | head -5
else
    echo -e "${RED}✗ Server not responding${NC}"
    exit 1
fi

echo -e "\n${BLUE}2. Testing Decomposition Endpoint...${NC}"
echo "   Sending complex task for decomposition (this may take 30-60 seconds)..."
DECOMPOSE_RESULT=$(curl -X POST "$BASE_URL/api/v1/decompose" \
    -H "Content-Type: application/json" \
    -d @test_decomposition.json \
    --max-time 120 \
    -s -w "\nTime: %{time_total}s")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Decomposition completed${NC}"
    echo "$DECOMPOSE_RESULT" | tail -1
    SUBTASK_COUNT=$(echo "$DECOMPOSE_RESULT" | python -c "import sys, json; data = json.loads(sys.stdin.read().split('\\nTime:')[0]); print(len(data['subtasks']))" 2>/dev/null)
    echo "   Created $SUBTASK_COUNT subtasks"
else
    echo -e "${RED}✗ Decomposition failed${NC}"
fi

echo -e "\n${BLUE}3. Testing Context Generation Endpoint...${NC}"
echo "   Generating context for backend specialist..."
CONTEXT_RESULT=$(curl -X POST "$BASE_URL/api/v1/context" \
    -H "Content-Type: application/json" \
    -d @test_context.json \
    --max-time 60 \
    -s -w "\nTime: %{time_total}s")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Context generation completed${NC}"
    echo "$CONTEXT_RESULT" | tail -1
    # Extract some info
    SUCCESS_CRITERIA=$(echo "$CONTEXT_RESULT" | python -c "import sys, json; data = json.loads(sys.stdin.read().split('\\nTime:')[0]); print(f'   Success criteria: {len(data[\"successCriteria\"])} items')" 2>/dev/null)
    echo "$SUCCESS_CRITERIA"
else
    echo -e "${RED}✗ Context generation failed${NC}"
fi

echo -e "\n${BLUE}4. Testing Conflict Resolution Endpoint...${NC}"
echo "   Resolving conflict between 3 state management solutions..."
CONFLICT_RESULT=$(curl -X POST "$BASE_URL/api/v1/resolve" \
    -H "Content-Type: application/json" \
    -d @test_conflict.json \
    --max-time 60 \
    -s -w "\nTime: %{time_total}s")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Conflict resolution completed${NC}"
    echo "$CONFLICT_RESULT" | tail -1
    CHOSEN=$(echo "$CONFLICT_RESULT" | python -c "import sys, json; data = json.loads(sys.stdin.read().split('\\nTime:')[0]); print(f'   Chosen: {data[\"instanceId\"]}')" 2>/dev/null)
    echo "$CHOSEN"
else
    echo -e "${RED}✗ Conflict resolution failed${NC}"
fi

echo -e "\n${BLUE}5. Testing Synthesis Endpoint...${NC}"
echo "   Synthesizing 6 completed subtasks..."
SYNTHESIS_RESULT=$(curl -X POST "$BASE_URL/api/v1/synthesize" \
    -H "Content-Type: application/json" \
    -d @test_synthesis.json \
    --max-time 60 \
    -s -w "\nTime: %{time_total}s")

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Synthesis completed${NC}"
    echo "$SYNTHESIS_RESULT" | tail -1
    STATUS=$(echo "$SYNTHESIS_RESULT" | python -c "import sys, json; data = json.loads(sys.stdin.read().split('\\nTime:')[0]); print(f'   Status: {data[\"status\"]}')" 2>/dev/null)
    echo "$STATUS"
else
    echo -e "${RED}✗ Synthesis failed${NC}"
fi

echo -e "\n${BLUE}6. Testing Statistics Endpoint...${NC}"
STATS=$(curl -s "$BASE_URL/api/v1/stats" | python -m json.tool 2>/dev/null)
if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Stats retrieved${NC}"
    echo "$STATS"
else
    echo -e "${RED}✗ Stats retrieval failed${NC}"
fi

echo -e "\n${BLUE}=== Test Suite Complete ===${NC}"