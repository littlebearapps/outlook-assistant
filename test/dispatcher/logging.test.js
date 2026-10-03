// #278 — stderr logging from the dispatcher. By default each tool call logs
// exactly one line (tool, action, outcome, duration) and never its
// arguments; OUTLOOK_DEBUG adds detail with addresses redacted.
jest.mock('../../auth', () => {
  const actual = jest.requireActual('../../auth');
  return {
    ...actual,
    ensureAuthenticated: jest.fn().mockResolvedValue('test-token'),
  };
});
jest.mock('../../utils/graph-api');

const { createRequestHandler } = require('../../request-handler');
const { log } = require('../../utils/logger');
const { callGraphAPIPaginated } = require('../../utils/graph-api');

const SEARCH_TERM = 'quarterly merger plans';
const ADDRESS = 'jane.doe@example.com';

let errorSpy;
let stderrSpy;
const savedDebug = process.env.OUTLOOK_DEBUG;

/** Everything written to stderr, one entry per line. */
function stderrLines() {
  const viaConsole = errorSpy.mock.calls.map((c) => c.join(' '));
  const viaWrite = stderrSpy.mock.calls.map((c) => String(c[0]));
  return [...viaConsole, ...viaWrite]
    .join('\n')
    .split('\n')
    .filter((l) => l.length > 0);
}

beforeEach(() => {
  delete process.env.OUTLOOK_DEBUG;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  stderrSpy = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
});

afterEach(() => {
  errorSpy.mockRestore();
  stderrSpy.mockRestore();
  if (savedDebug === undefined) delete process.env.OUTLOOK_DEBUG;
  else process.env.OUTLOOK_DEBUG = savedDebug;
});

const call = (handler, name, args, id = 1) =>
  handler({ method: 'tools/call', params: { name, arguments: args }, id });

const fakeTools = () => [
  {
    name: 'fake',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'create'] },
        query: { type: 'string' },
        to: { type: 'string' },
      },
      additionalProperties: false,
    },
    handler: () =>
      Promise.resolve({ content: [{ type: 'text', text: 'done' }] }),
  },
  {
    name: 'fails',
    handler: () =>
      Promise.resolve({
        content: [{ type: 'text', text: `no such mailbox ${ADDRESS}` }],
        isError: true,
      }),
  },
  {
    name: 'throws',
    handler: () =>
      Promise.reject(new TypeError(`cannot read mailbox ${ADDRESS}`)),
  },
  {
    name: 'graphy',
    handler: () => {
      log.note('graph', '403 GET me/messages/{id}');
      log.increment('graphRetries');
      return Promise.resolve({ content: [{ type: 'text', text: 'ok' }] });
    },
  },
];

describe('default level: one line per tool call', () => {
  test('logs tool, action, outcome and duration, and no arguments', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'fake', {
      action: 'list',
      query: SEARCH_TERM,
      to: ADDRESS,
    });

    const lines = stderrLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^tool=fake action=list outcome=ok ms=\d+$/);
    expect(lines.join('\n')).not.toContain(SEARCH_TERM);
    expect(lines.join('\n')).not.toContain(ADDRESS);
  });

  test('omits action when absent', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'fake', {});
    expect(stderrLines()).toEqual([
      expect.stringMatching(/^tool=fake outcome=ok ms=\d+$/),
    ]);
  });

  test('never echoes an action that is not in the schema enum', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'fake', { action: ADDRESS });
    const lines = stderrLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^tool=fake action=\? outcome=isError ms=\d+$/);
  });

  test('reports isError results without their text', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'fails', {});
    const lines = stderrLines();
    expect(lines).toEqual([
      expect.stringMatching(/^tool=fails outcome=isError ms=\d+$/),
    ]);
  });

  test('reports a thrown handler by error class only', async () => {
    const handler = createRequestHandler(fakeTools());
    const result = await call(handler, 'throws', {});
    expect(result.isError).toBe(true);
    const lines = stderrLines();
    expect(lines).toEqual([
      expect.stringMatching(
        /^tool=throws outcome=thrown ms=\d+ error=TypeError$/
      ),
    ]);
    expect(lines.join('\n')).not.toMatch(/jane|cannot read|at .*\.js/);
  });

  test('appends notes collected during the call', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'graphy', {});
    expect(stderrLines()).toEqual([
      expect.stringMatching(
        /^tool=graphy outcome=ok ms=\d+ graph="403 GET me\/messages\/\{id\}" graphRetries=1$/
      ),
    ]);
  });

  test('unknown tools log one line without echoing the name', async () => {
    const handler = createRequestHandler(fakeTools());
    await expect(call(handler, ADDRESS, {})).rejects.toMatchObject({
      code: -32602,
    });
    const lines = stderrLines();
    expect(lines).toEqual([
      expect.stringMatching(/^tool=\? outcome=unknown-tool ms=\d+$/),
    ]);
  });

  test('tools/list logs nothing by default', async () => {
    const handler = createRequestHandler(fakeTools());
    await handler({ method: 'tools/list', id: 1 });
    expect(stderrLines()).toEqual([]);
  });
});

describe('debug level (OUTLOOK_DEBUG)', () => {
  beforeEach(() => {
    process.env.OUTLOOK_DEBUG = 'on';
  });

  test('tools/list logs a count, never the tool names', async () => {
    const handler = createRequestHandler(fakeTools());
    await handler({ method: 'tools/list', id: 1 });
    const text = stderrLines().join('\n');
    expect(text).toMatch(/tools\/list: 4 tools/);
    expect(text).not.toMatch(/graphy|throws/);
  });

  test('a thrown handler logs its detail redacted', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'throws', {});
    const text = stderrLines().join('\n');
    expect(text).toContain('cannot read mailbox <redacted-email>');
    expect(text).not.toContain(ADDRESS);
    // still exactly one call line at the info level
    expect(stderrLines().filter((l) => l.startsWith('tool='))).toHaveLength(1);
  });

  test('logs argument names but not their values', async () => {
    const handler = createRequestHandler(fakeTools());
    await call(handler, 'fake', { query: SEARCH_TERM, to: ADDRESS });
    const text = stderrLines().join('\n');
    expect(text).toMatch(/args: query, to/);
    expect(text).not.toContain(SEARCH_TERM);
    expect(text).not.toContain(ADDRESS);
  });
});

describe('real tool: search-emails', () => {
  const { TOOLS } = require('../../tools');

  beforeEach(() => {
    callGraphAPIPaginated.mockResolvedValue({ value: [] });
  });

  test('default stderr has one line and no search term or address', async () => {
    const handler = createRequestHandler(TOOLS);
    await call(handler, 'search-emails', {
      query: SEARCH_TERM,
      from: ADDRESS,
    });
    const lines = stderrLines();
    expect(lines).toEqual([
      expect.stringMatching(/^tool=search-emails outcome=\w+ ms=\d+/),
    ]);
    expect(lines.join('\n')).not.toContain(SEARCH_TERM);
    expect(lines.join('\n')).not.toContain(ADDRESS);
  });

  test('debug stderr shows search detail with addresses redacted', async () => {
    process.env.OUTLOOK_DEBUG = 'true';
    const handler = createRequestHandler(TOOLS);
    await call(handler, 'search-emails', {
      query: SEARCH_TERM,
      from: ADDRESS,
    });
    const text = stderrLines().join('\n');
    expect(text).toContain('[debug]');
    expect(text).toContain('<redacted-email>');
    expect(text).not.toContain(ADDRESS);
  });
});
