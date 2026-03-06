#!/bin/bash
# Test the modular Outlook Assistant server using MCP Inspector

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Testing modular Outlook Assistant server..."

# Use the MCP Inspector to test the server
npx @modelcontextprotocol/inspector node "$SCRIPT_DIR/index.js"
