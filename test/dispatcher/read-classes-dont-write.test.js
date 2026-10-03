/**
 * Read-only mode lets `read` calls through (#271), so a call the risk map
 * classes as `read` must never change anything.
 *
 * For every tool, every value of its `action` enum, and a call that leaves
 * `action` out or sets it to null, this suite runs the real handler (read-only
 * mode off, Graph mocked) with several argument shapes: required parameters
 * only, every parameter with booleans off, and every parameter with booleans
 * on (which reaches branches such as groupByConversation, headersMode and
 * deltaMode). Whenever the gate would class the call as `read`, the handler
 * must make no Graph write (POST/PATCH/PUT/DELETE, except the read-only
 * getMailTips POST) and write no local file.
 *
 * `auth` is left out: it never touches the mailbox, and its sign-in actions
 * are exempt from read-only mode by design (see utils/read-only.js).
 */
jest.mock('../../utils/graph-api');

const fs = require('fs');
const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const { classify } = require('../../utils/risk-classes');
const { tokenStorage } = require('../../auth');
const graph = require('../../utils/graph-api');

const call = createRequestHandler(TOOLS);

/** Graph calls that change nothing even though they are not GETs. */
const READ_POSTS = [/getMailTips$/];

let writes;

function recordGraph(method, path) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET') return;
  if (m === 'POST' && READ_POSTS.some((re) => re.test(String(path)))) return;
  writes.push(`${m} ${path}`);
}

/** A plausible value for a schema property. */
function sampleValue(name, schema, booleans) {
  if (schema.enum) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'boolean') return booleans;
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1;
  if (type === 'array') {
    return [sampleValue(name, schema.items || { type: 'string' }, booleans)];
  }
  if (type === 'object') return {};
  if (/mail|recipient|^to$|^cc$|^bcc$/i.test(name)) return 'a@example.com';
  if (/date|time|start|end|after|before/i.test(name)) {
    return '2026-01-01T09:00:00';
  }
  return 'x';
}

function argShapes(tool, action) {
  const props = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  const fill = (names, booleans) => {
    const args = {};
    for (const name of names) {
      if (name === 'action') continue;
      args[name] = sampleValue(name, props[name], booleans);
    }
    if (action !== undefined) args.action = action;
    return args;
  };
  // Mailbox targeting and aliases have their own suites and validation.
  const all = Object.keys(props).filter(
    (n) => !['email', 'sharedMailbox', 'kqlQuery'].includes(n)
  );
  return [fill(required, false), fill(all, false), fill(all, true)];
}

const cases = [];
for (const tool of TOOLS) {
  if (tool.name === 'auth') continue;
  const actionEnum = tool.inputSchema?.properties?.action?.enum;
  const actions = actionEnum ? [...actionEnum, undefined, null] : [undefined];
  for (const action of actions) {
    if (classify(tool.name, action) !== 'read') continue;
    argShapes(tool, action).forEach((args, i) => {
      const label = `${tool.name}${action === undefined ? '' : ` action=${action}`} #${i + 1}`;
      cases.push([label, tool.name, args]);
    });
  }
}

beforeEach(() => {
  writes = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue('token');
  graph.callGraphAPI.mockImplementation((_t, method, path) => {
    recordGraph(method, path);
    return Promise.resolve({ value: [] });
  });
  graph.callGraphAPIPaginated.mockImplementation((_t, method, path) => {
    recordGraph(method, path);
    return Promise.resolve({ value: [] });
  });
  graph.callGraphAPIBatch.mockImplementation((_t, requests) => {
    for (const r of requests || []) recordGraph(r.method, r.url);
    return Promise.resolve([]);
  });
  graph.callGraphAPIRaw.mockResolvedValue('');
  for (const fn of ['writeFileSync', 'mkdirSync', 'openSync', 'renameSync']) {
    jest.spyOn(fs, fn).mockImplementation((p) => {
      writes.push(`fs.${fn} ${p}`);
    });
  }
  jest.spyOn(fs.promises, 'writeFile').mockImplementation((p) => {
    writes.push(`fs.promises.writeFile ${p}`);
    return Promise.resolve();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('there are read cases to check', () => {
  expect(cases.length).toBeGreaterThan(40);
});

test.each(cases)('%s writes nothing', async (_label, name, args) => {
  await call({
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });
  expect({ name, args, writes }).toEqual({ name, args, writes: [] });
});

// The recorder itself must catch writes, or the suite proves nothing.
test('a write-classed call is caught by the recorder', async () => {
  await call({
    method: 'tools/call',
    params: {
      name: 'update-email',
      arguments: { action: 'mark-read', id: 'm1' },
    },
    id: 1,
  });
  expect(writes).toEqual([expect.stringMatching(/^PATCH .*messages\/m1/)]);
});

test('a local file write is caught by the recorder', async () => {
  graph.callGraphAPI.mockResolvedValue({
    id: 'm1',
    subject: 'Hi',
    from: { emailAddress: { address: 'a@example.com' } },
    toRecipients: [],
    body: { contentType: 'text', content: 'Hello' },
  });
  await call({
    method: 'tools/call',
    params: {
      name: 'export',
      arguments: {
        target: 'message',
        id: 'm1',
        format: 'json',
        savePath: '/tmp/never-written.json',
      },
    },
    id: 1,
  });
  expect(writes).toEqual(
    expect.arrayContaining([expect.stringMatching(/^fs\.writeFileSync /)])
  );
});
