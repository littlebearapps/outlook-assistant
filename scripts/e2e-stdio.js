#!/usr/bin/env node
/**
 * Drive a FRESHLY SPAWNED outlook-assistant over stdio.
 *
 * A running MCP server holds the code it started with, so in-session tool calls
 * cannot verify a working-tree change. This spawns `index.js` per run and does a
 * full `initialize` -> `notifications/initialized` -> `tools/call` handshake.
 *
 * Usage: node scripts/e2e-stdio.js '<toolName>' '<argsJson>'
 * Credentials come from the environment (see .mcp.json).
 */
const { spawn } = require('child_process');
const path = require('path');

const toolName = process.argv[2];
const toolArgs = JSON.parse(process.argv[3] || '{}');

if (!toolName) {
  console.error("usage: e2e-stdio.js '<toolName>' '<argsJson>'");
  process.exit(2);
}

const child = spawn('node', [path.join(__dirname, '..', 'index.js')], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'e2e', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: toolName, arguments: toolArgs },
  },
];
child.stdin.write(`${requests.map((r) => JSON.stringify(r)).join('\n')}\n`);

let buffer = '';
let done = false;

function finish(code) {
  if (done) return;
  done = true;
  // index.js keeps itself alive through SIGTERM on purpose.
  child.kill('SIGKILL');
  process.exit(code);
}

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === 1) {
      console.error(
        `[serverInfo] ${JSON.stringify(message.result?.serverInfo || {})}`
      );
    }
    if (message.id === 2) {
      // Emit the full envelope so callers can assert on _meta as well as text.
      console.log(JSON.stringify(message.result ?? { error: message.error }));
      finish(0);
    }
  }
});

child.stderr.on('data', (chunk) => {
  if (process.env.E2E_VERBOSE) process.stderr.write(chunk);
});

setTimeout(() => {
  console.error('TIMEOUT waiting for tool result');
  finish(1);
}, 120000);
