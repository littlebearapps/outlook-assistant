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
const { serverInstructions } = require('../utils/server-instructions');

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

  // #271
  test('sends the server instructions', async () => {
    const res = await initialize();
    expect(res.result.instructions).toBe(
      serverInstructions({ readOnly: false })
    );
  });

  test('says so in the instructions when read-only mode is on', async () => {
    const original = config.READ_ONLY;
    config.READ_ONLY = true;
    try {
      await client.close();
      await connect();
      const res = await initialize();
      expect(res.result.instructions).toBe(
        serverInstructions({ readOnly: true })
      );
    } finally {
      config.READ_ONLY = original;
    }
  });
});

// #271: the instructions and the dispatcher gate read the same config value,
// so the text can never claim read-only mode while writes still run (or the
// reverse).
describe('instructions match the read-only gate', () => {
  const sendArgs = { to: 'a@example.com', subject: 'Hi', body: 'Hello' };
  let original;
  let tokenSpy;

  beforeEach(() => {
    original = config.READ_ONLY;
    const { tokenStorage } = require('../auth');
    tokenSpy = jest
      .spyOn(tokenStorage, 'getValidAccessToken')
      .mockResolvedValue(null);
  });

  afterEach(() => {
    config.READ_ONLY = original;
    tokenSpy.mockRestore();
  });

  test.each([true, false])('READ_ONLY=%p', async (readOnly) => {
    config.READ_ONLY = readOnly;
    await client.close();
    await connect();
    const init = await initialize();
    const res = await rpc('tools/call', {
      name: 'send-email',
      arguments: sendArgs,
    });
    const claimsReadOnly = /Read-only mode is on/.test(
      init.result.instructions
    );
    const refusedByGate = /read-only mode \(OUTLOOK_READ_ONLY\)/.test(
      res.result.content[0].text
    );
    expect(res.result.isError).toBe(true);
    expect({ claimsReadOnly, refusedByGate }).toEqual({
      claimsReadOnly: readOnly,
      refusedByGate: readOnly,
    });
  });
});

describe('tools/list _meta (#271)', () => {
  beforeEach(async () => {
    await initialize();
  });

  test('only send-email and create-event require user interaction', async () => {
    const res = await rpc('tools/list', {});
    const flagged = res.result.tools
      .filter((t) => t._meta?.['anthropic/requiresUserInteraction'] === true)
      .map((t) => t.name)
      .sort();
    expect(flagged).toEqual(['create-event', 'send-email']);
  });

  test('no other tool carries _meta', async () => {
    const res = await rpc('tools/list', {});
    const withMeta = res.result.tools
      .filter((t) => t._meta !== undefined)
      .map((t) => t.name)
      .sort();
    expect(withMeta).toEqual(['create-event', 'send-email']);
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
