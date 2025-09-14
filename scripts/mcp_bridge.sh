#!/bin/bash
# MCP Bridge for Claude Code
# This script acts as a bridge between Claude Code and the ClaudeBench MCP server
# It ensures the correct headers are sent

# The MCP server URL
MCP_URL="http://localhost:3000/mcp"

# Use curl with the correct headers
exec curl -X POST "$MCP_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  --data-binary @- \
  --no-buffer \
  --silent