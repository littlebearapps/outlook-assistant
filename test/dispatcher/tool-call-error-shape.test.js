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

  test('unknown tool yields visible isError content, not empty { error }', async () => {
    const handler = createRequestHandler([]);

    const result = await handler({
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
      id: 2,
    });

    expect(result.error).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Tool not found: nope/);
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
