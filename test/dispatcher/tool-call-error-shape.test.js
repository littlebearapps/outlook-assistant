// #213 — tools/call errors must be returned as visible MCP tool-error
// content ({ content: [...], isError: true }), NOT as a content-less
// { error: {...} } object. The MCP SDK coerces a result missing `content`
// into `{ content: [] }`, which the client renders as EMPTY OUTPUT — the
// exact symptom reported for device-code auth in a remote connector session.
//
// The dispatch/error-shaping logic lives in `createRequestHandler` (extracted
// from index.js so it is unit-testable without starting the stdio server).
const { createRequestHandler } = require('../../request-handler');

describe('createRequestHandler — tools/call error shaping (#213)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('a throwing tool handler yields visible isError content, not empty { error }', async () => {
    const TOOLS = [
      {
        name: 'boom',
        handler: async () => {
          throw new Error('kaboom');
        },
      },
    ];
    const handler = createRequestHandler(TOOLS);

    const result = await handler({
      method: 'tools/call',
      params: { name: 'boom', arguments: {} },
      id: 1,
    });

    // Must NOT be a content-less error object (which renders as empty output)
    expect(result.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.content[0].text).toMatch(
      /Error processing tool call.*kaboom/
    );
  });

  // #276: an unknown tool is a protocol error (-32602), not a tool result.
  // The SDK turns the thrown McpError into a JSON-RPC error response.
  test('unknown tool throws a -32602 protocol error', async () => {
    const handler = createRequestHandler([]);

    await expect(
      handler({
        method: 'tools/call',
        params: { name: 'nope', arguments: {} },
        id: 2,
      })
    ).rejects.toMatchObject({
      code: -32602,
      message: expect.stringMatching(/nope/),
    });
  });

  test('an internal dispatcher failure throws a -32603 protocol error', async () => {
    const broken = {
      get name() {
        throw new Error('registry broke');
      },
    };
    const handler = createRequestHandler([broken]);

    await expect(
      handler({ method: 'tools/list', id: 4 })
    ).rejects.toMatchObject({
      code: -32603,
      message: expect.stringMatching(/registry broke/),
    });
  });

  test('an unknown method throws a -32601 protocol error', async () => {
    const handler = createRequestHandler([]);

    await expect(
      handler({ method: 'server/discover', id: 5 })
    ).rejects.toMatchObject({
      code: -32601,
    });
  });

  test('a successful tool handler result is passed through unchanged', async () => {
    const TOOLS = [
      {
        name: 'ok',
        handler: async () => ({
          content: [{ type: 'text', text: 'all good' }],
        }),
      },
    ];
    const handler = createRequestHandler(TOOLS);

    const result = await handler({
      method: 'tools/call',
      params: { name: 'ok', arguments: {} },
      id: 3,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toBe('all good');
  });
});
