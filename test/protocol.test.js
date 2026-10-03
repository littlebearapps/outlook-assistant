/**
 * JSON-RPC / MCP protocol conformance for the real server (#276).
 *
 * Drives `createServer()` over the SDK's in-memory transport with raw
 * JSON-RPC messages, so these assertions hold for what clients actually see
 * on the wire: version negotiation, capabilities, and real JSON-RPC errors
 * (not `{ result: { error } }`) for unknown methods and unknown tools.
 */
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const {
  LATEST_PROTOCOL_VERSION,
} = require('@modelcontextprotocol/sdk/types.js');
const config = require('../config');
const { createServer } = require('../server');

let client;
let nextId;
let pending;

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  pending = new Map();
  nextId = 1;
  clientSide.onmessage = (msg) => {
    const resolve = pending.get(msg.id);
    if (resolve) {
      pending.delete(msg.id);
      resolve(msg);
    }
  };
  await createServer().connect(serverSide);
  await clientSide.start();
  client = clientSide;
}

function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    client.send({ jsonrpc: '2.0', id, method, params });
  });
}

function initialize(protocolVersion = LATEST_PROTOCOL_VERSION) {
  return rpc('initialize', {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: 'protocol-test', version: '0.0.0' },
  });
}

beforeEach(async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await connect();
});

afterEach(async () => {
  await client.close();
  console.error.mockRestore();
});

describe('initialize', () => {
  test('agrees the latest protocol version', async () => {
    const res = await initialize();
    expect(res.error).toBeUndefined();
    expect(res.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  test('agrees an older supported version the client asks for', async () => {
    const res = await initialize('2024-11-05');
    expect(res.result.protocolVersion).toBe('2024-11-05');
  });

  test('offers the latest version when the client asks for an unknown one', async () => {
    const res = await initialize('1999-01-01');
    expect(res.result.protocolVersion).toBe(LATEST_PROTOCOL_VERSION);
  });

  test('declares tools with the spec shape, and nothing undeclared', async () => {
    const res = await initialize();
    expect(res.result.capabilities).toEqual({
      tools: { listChanged: false },
    });
  });

  test('reports the server name and version', async () => {
    const res = await initialize();
    expect(res.result.serverInfo).toEqual({
      name: config.SERVER_NAME,
      version: config.SERVER_VERSION,
    });
  });
});

describe('JSON-RPC errors', () => {
  beforeEach(async () => {
    await initialize();
  });

  test.each([
    'server/discover',
    'resources/list',
    'prompts/list',
    'completion/complete',
    'no/such-method',
  ])('%s returns a -32601 error, not a result', async (method) => {
    const res = await rpc(method, {});
    expect(res.result).toBeUndefined();
    expect(res.error.code).toBe(-32601);
  });

  test('an unknown tool returns a -32602 error', async () => {
    const res = await rpc('tools/call', { name: 'no-such-tool' });
    expect(res.result).toBeUndefined();
    expect(res.error.code).toBe(-32602);
    expect(res.error.message).toMatch(/no-such-tool/);
  });

  test('tools/list still succeeds', async () => {
    const res = await rpc('tools/list', {});
    expect(res.error).toBeUndefined();
    expect(res.result.tools.length).toBeGreaterThan(0);
  });

  test('invalid tool arguments stay a visible tool error the model can fix', async () => {
    const res = await rpc('tools/call', {
      name: 'search-emails',
      arguments: { notAParam: true },
    });
    expect(res.error).toBeUndefined();
    expect(res.result.isError).toBe(true);
  });
});
