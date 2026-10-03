/**
 * Read-only mode (OUTLOOK_READ_ONLY, #271).
 *
 * The dispatcher refuses every tool call whose risk class
 * (utils/risk-classes.js) isn't `read`, after argument validation and before
 * the handler runs, so nothing reaches Graph. Dry runs are refused too. The
 * `auth` tool is exempt: signing in only writes the local token file, and
 * without it no read tool can work.
 */
jest.mock('../../utils/graph-api');

const config = require('../../config');
const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const { TOOL_RISK, classify } = require('../../utils/risk-classes');
const { tokenStorage } = require('../../auth');
const { callGraphAPI } = require('../../utils/graph-api');

/** The real registry, with every handler replaced by a spy. */
function spiedTools() {
  return TOOLS.map((tool) => ({
    ...tool,
    handler: jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ran' }],
    }),
  }));
}

/** A valid value for a schema property. */
function sampleValue(schema) {
  if (schema.enum) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1;
  if (type === 'array') return [sampleValue(schema.items || {})];
  if (type === 'object') return {};
  return 'x';
}

/** Arguments that pass schema validation: every required property. */
function validArgs(name, action) {
  const schema = TOOLS.find((t) => t.name === name).inputSchema || {};
  const args = {};
  for (const prop of schema.required || []) {
    args[prop] = sampleValue(schema.properties[prop]);
  }
  if (action) args.action = action;
  return args;
}

function call(tools, name, args) {
  return createRequestHandler(tools)({
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });
}

/** Every tool/action pair in the map, with its class. */
const pairs = [];
for (const [name, entry] of Object.entries(TOOL_RISK)) {
  if (entry.actions) {
    for (const [action, cls] of Object.entries(entry.actions)) {
      pairs.push([name, action, cls]);
    }
  } else {
    pairs.push([name, undefined, entry.default]);
  }
}
const label = ([name, action, cls]) =>
  `${name}${action ? ` action=${action}` : ''} (${cls})`;

const writes = pairs.filter(
  ([name, , cls]) => cls !== 'read' && name !== 'auth'
);
const reads = pairs.filter(
  ([name, , cls]) => cls === 'read' || name === 'auth'
);

let original;
beforeEach(() => {
  original = config.READ_ONLY;
  config.READ_ONLY = true;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue('token');
  callGraphAPI.mockReset();
  callGraphAPI.mockResolvedValue({});
});

afterEach(() => {
  config.READ_ONLY = original;
  jest.restoreAllMocks();
});

describe('read-only mode on', () => {
  test('covers every non-read class', () => {
    const classes = new Set(writes.map(([, , cls]) => cls));
    expect([...classes].sort()).toEqual([
      'destructive',
      'outward',
      'persistent',
      'reversible',
    ]);
  });

  test.each(writes.map((p) => [label(p), ...p]))(
    'refuses %s before the handler runs',
    async (_label, name, action, cls) => {
      const tools = spiedTools();
      const result = await call(tools, name, validArgs(name, action));
      const text = result.content[0].text;

      expect(result.isError).toBe(true);
      expect(text).toMatch(
        /^Outlook Assistant is in read-only mode \(OUTLOOK_READ_ONLY\)\./
      );
      expect(text).toContain(action ? `${name} action=${action}` : name);
      expect(text).toMatch(/nothing was changed/);
      expect(text).toMatch(/Next step: .*OUTLOOK_READ_ONLY.*restart/);
      expect(classify(name, action)).toBe(cls);
      expect(tools.find((t) => t.name === name).handler).not.toHaveBeenCalled();
    }
  );

  test.each(reads.map((p) => [label(p), ...p]))(
    'runs %s',
    async (_label, name, action) => {
      const tools = spiedTools();
      const result = await call(tools, name, validArgs(name, action));
      expect(result.isError).toBeUndefined();
      expect(tools.find((t) => t.name === name).handler).toHaveBeenCalled();
    }
  );

  test('signing in still works (auth is exempt)', async () => {
    const tools = spiedTools();
    const result = await call(tools, 'auth', { action: 'authenticate' });
    expect(result.isError).toBeUndefined();
    expect(tools.find((t) => t.name === 'auth').handler).toHaveBeenCalled();
  });

  test('a call that leaves action out is classified by the default action', async () => {
    const tools = spiedTools();
    // folders defaults to list (read); apply-category defaults to set.
    expect((await call(tools, 'folders', {})).isError).toBeUndefined();
    const refused = await call(tools, 'apply-category', {
      messageId: 'm1',
      categories: ['Red'],
    });
    expect(refused.isError).toBe(true);
    expect(refused.content[0].text).toContain('apply-category action=set');
  });

  test('action: null runs the default action, as the handler does', async () => {
    const tools = spiedTools();
    expect((await call(tools, 'folders', { action: null })).isError).toBe(
      undefined
    );
    const refused = await call(tools, 'apply-category', {
      action: null,
      messageId: 'm1',
      categories: ['Red'],
    });
    expect(refused.isError).toBe(true);
  });

  test('the auth exemption covers sign-in only, not any future auth action', () => {
    const { readOnlyRefusal } = require('../../utils/read-only');
    for (const action of [
      undefined,
      'status',
      'about',
      'authenticate',
      'device-code-complete',
    ]) {
      expect(readOnlyRefusal('auth', { action })).toBeNull();
    }
    expect(readOnlyRefusal('auth', { action: 'revoke-all' }).isError).toBe(
      true
    );
  });

  test('dry runs are refused too', async () => {
    const tools = spiedTools();
    const result = await call(tools, 'send-email', {
      to: 'a@example.com',
      subject: 'Hi',
      body: 'Hello',
      dryRun: true,
    });
    expect(result.isError).toBe(true);
    expect(
      tools.find((t) => t.name === 'send-email').handler
    ).not.toHaveBeenCalled();
  });

  test('a tool with no risk class is refused (fails closed)', async () => {
    const handler = jest.fn();
    const result = await call([{ name: 'mystery', handler }], 'mystery', {});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/read-only mode/);
    expect(handler).not.toHaveBeenCalled();
  });

  test('invalid arguments are still reported as invalid first', async () => {
    const result = await call(spiedTools(), 'send-email', { notAParam: 1 });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Invalid arguments/);
  });

  test('the real send-email handler never reaches Graph', async () => {
    const result = await call(TOOLS, 'send-email', {
      to: 'a@example.com',
      subject: 'Hi',
      body: 'Hello',
    });
    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('the real manage-rules create handler never reaches Graph', async () => {
    const result = await call(TOOLS, 'manage-rules', {
      action: 'create',
      displayName: 'Forward all',
      forwardTo: ['a@example.com'],
    });
    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});

describe('read-only mode off', () => {
  test('write calls reach the handler', async () => {
    config.READ_ONLY = false;
    const tools = spiedTools();
    const result = await call(tools, 'send-email', {
      to: 'a@example.com',
      subject: 'Hi',
      body: 'Hello',
    });
    expect(result.isError).toBeUndefined();
    expect(
      tools.find((t) => t.name === 'send-email').handler
    ).toHaveBeenCalled();
  });
});
