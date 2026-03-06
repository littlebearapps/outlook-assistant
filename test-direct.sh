#!/bin/bash
# Test the modular Outlook Assistant server directly

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Run the server in a background process
node "$SCRIPT_DIR/index.js" > /dev/null 2>&1 &
SERVER_PID=$!

echo "Started modular Outlook Assistant server with PID: $SERVER_PID"
echo "Using the about tool..."

# Send a tools/list request to the server
echo '{"jsonrpc":"2.0","id":"test-1","method":"tools/list"}' | nc localhost 3333

# Send a tool call request to the server
echo '{"jsonrpc":"2.0","id":"test-2","method":"tools/call","params":{"name":"about","arguments":{}}}' | nc localhost 3333

# Kill the server
kill $SERVER_PID
