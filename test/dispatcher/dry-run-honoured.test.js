/**
 * `dryRun: true` must never write (#274).
 *
 * Several tools accept `dryRun`, but only some of their actions honour it.
 * The dispatcher refuses a dry run for any other action before the handler
 * runs, so a "preview" can never really send, delete or change anything.
 *
 * For every tool whose schema has a `dryRun` property and every value of its
 * `action` enum (or the single call for a tool without one), this suite calls
 * the real handler through the dispatcher with `dryRun: true`, Graph mocked.
 * The result must be EITHER a labelled preview (`_meta.dryRun === true`) with
 * no Graph write, OR an `isError` refusal with no Graph write at all.
 *
 * A control runs every write-classed case without `dryRun` and expects a
 * write, so the arguments really reach the write path and the suite can't
 * pass just because the arguments were rejected.
 */
jest.mock('../../utils/graph-api');

const fs = require('fs');
const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const {
  DRY_RUN_ACTIONS,
  TOOL_RISK,
  classify,
  supportsDryRun,
} = require('../../utils/risk-classes');
const { DRY_RUN_LABEL } = require('../../utils/safety');
const { tokenStorage } = require('../../auth');
const graph = require('../../utils/graph-api');

const call = createRequestHandler(TOOLS);

/** Graph calls that change nothing even though they are not GETs. */
const READ_POSTS = [/getMailTips$/];

const EVENT = {
  id: 'e1',
  subject: 'Planning',
  isOrganizer: true,
  responseRequested: true,
  organizer: { emailAddress: { address: 'organiser@example.com' } },
  attendees: [
    {
      type: 'required',
      emailAddress: { address: 'b@example.com', name: 'B' },
    },
  ],
  start: { dateTime: '2026-01-01T09:00:00', timeZone: 'UTC' },
  end: { dateTime: '2026-01-01T10:00:00', timeZone: 'UTC' },
};
const RULE = {
  id: 'r1',
  displayName: 'Rule',
  sequence: 1,
  isEnabled: true,
  conditions: { subjectContains: ['x'] },
  actions: { markAsRead: true },
};
const MESSAGE = {
  id: 'm1',
  isDraft: true,
  subject: 'Hi',
  toRecipients: [{ emailAddress: { address: 'a@example.com' } }],
  from: { emailAddress: { address: 'me@example.com' } },
  body: { contentType: 'text', content: 'Hello' },
};

/** Minimal valid arguments that reach each action's write path. */
const ARGS = {
  'create-event': {
    subject: 'Planning',
    start: '2026-01-01T09:00:00',
    end: '2026-01-01T10:00:00',
    attendees: ['b@example.com'],
  },
  'manage-event update': { eventId: 'e1', subject: 'New' },
  'manage-event decline': { eventId: 'e1' },
  'manage-event cancel': { eventId: 'e1' },
  'manage-event delete': { eventId: 'e1' },
  'send-email': { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
  'draft create': { to: 'a@example.com', subject: 'Hi', body: 'Hello' },
  'draft update': { id: 'm1', subject: 'New' },
  'draft send': { id: 'm1' },
  'draft delete': { id: 'm1' },
  'draft reply': { id: 'm1', comment: 'Thanks' },
  'draft reply-all': { id: 'm1', comment: 'Thanks' },
  'draft forward': { id: 'm1', to: 'a@example.com' },
  'folders list': {},
  'folders create': { name: 'New folder' },
  'folders move': { emailIds: 'm1', targetFolderId: 'f1' },
  'folders stats': { folderId: 'f1' },
  'folders delete': { folderId: 'f1' },
  'manage-rules list': {},
  'manage-rules create': {
    name: 'New rule',
    containsSubject: 'x',
    markAsRead: true,
  },
  'manage-rules update': { ruleId: 'r1', isEnabled: false },
  'manage-rules reorder': { ruleName: 'Rule', sequence: 5 },
  'manage-rules delete': { ruleId: 'r1' },
  'manage-contact list': {},
  'manage-contact search': { query: 'Ann' },
  'manage-contact get': { id: 'c1' },
  'manage-contact create': { displayName: 'Ann', email: 'ann@example.com' },
  'manage-contact update': { id: 'c1', jobTitle: 'Chef' },
  'manage-contact delete': { id: 'c1' },
  'mailbox-settings get': {},
  'mailbox-settings set-auto-replies': {
    enabled: true,
    internalReplyMessage: 'Away',
  },
  'mailbox-settings set-working-hours': {
    startTime: '09:00',
    endTime: '17:00',
    daysOfWeek: ['monday'],
  },
};

/** Every tool with a dryRun property, crossed with its actions. */
const dryRunTools = TOOLS.filter((t) => t.inputSchema?.properties?.dryRun);
const cases = [];
for (const tool of dryRunTools) {
  const actions = tool.inputSchema.properties.action?.enum || [undefined];
  for (const action of actions) {
    const key = action ? `${tool.name} ${action}` : tool.name;
    cases.push([key, tool.name, action]);
  }
}

let writes;

function recordGraph(method, path) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET') return false;
  if (m === 'POST' && READ_POSTS.some((re) => re.test(String(path)))) {
    return false;
  }
  writes.push(`${m} ${path}`);
  return true;
}

/** A plausible Graph response for a path. */
function respond(method, path) {
  const p = String(path);
  if (recordGraph(method, path)) return { ...MESSAGE, id: 'new' };
  if (/getMailTips$/.test(p)) return { value: [] };
  if (/messageRules\/r1/.test(p)) return RULE;
  if (/messageRules/.test(p)) return { value: [RULE] };
  if (/events\//.test(p)) return EVENT;
  if (/contacts\//.test(p)) {
    return { id: 'c1', displayName: 'Ann', emailAddresses: [] };
  }
  if (/mailFolders\/f1$/.test(p)) {
    return {
      id: 'f1',
      displayName: 'Target',
      totalItemCount: 0,
      unreadItemCount: 0,
      childFolderCount: 0,
    };
  }
  if (/messages\//.test(p)) return MESSAGE;
  if (/automaticRepliesSetting/.test(p)) return { status: 'disabled' };
  return { value: [] };
}

beforeEach(() => {
  writes = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue('token');
  graph.callGraphAPI.mockImplementation((_t, method, path) =>
    Promise.resolve(respond(method, path))
  );
  graph.callGraphAPIPaginated.mockImplementation((_t, method, path) =>
    Promise.resolve(respond(method, path))
  );
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
});

afterEach(() => {
  jest.restoreAllMocks();
});

function run(name, args) {
  return call({
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });
}

function argsFor(key, action, extra = {}) {
  return { ...ARGS[key], ...(action ? { action } : {}), ...extra };
}

test('every tool with a dryRun property has cases and arguments', () => {
  expect(dryRunTools.map((t) => t.name).sort()).toEqual(
    Object.keys(DRY_RUN_ACTIONS).sort()
  );
  for (const [key] of cases) expect(ARGS).toHaveProperty([key]);
});

describe.each(cases)('%s with dryRun: true', (key, name, action) => {
  test('previews or refuses, and never writes', async () => {
    const result = await run(name, argsFor(key, action, { dryRun: true }));
    expect({ key, writes }).toEqual({ key, writes: [] });
    const text = result.content?.[0]?.text || '';
    if (supportsDryRun(name, action)) {
      expect({ key, isError: result.isError }).toEqual({
        key,
        isError: undefined,
      });
      expect(result._meta?.dryRun).toBe(true);
      expect(text.startsWith('DRY RUN')).toBe(true);
    } else {
      expect(result.isError).toBe(true);
      expect(text).toMatch(/dryRun is not supported for .*nothing was changed/);
    }
  });

  if (classify(name, action) !== 'read') {
    test('control: without dryRun the same arguments write', async () => {
      await run(name, argsFor(key, action));
      expect(writes.length).toBeGreaterThan(0);
    });
  }
});

test('an unsupported dryRun is refused before the handler runs', async () => {
  const handler = jest.fn();
  const tools = TOOLS.map((t) => (t.name === 'draft' ? { ...t, handler } : t));
  const result = await createRequestHandler(tools)({
    method: 'tools/call',
    params: {
      name: 'draft',
      arguments: { action: 'send', id: 'm1', dryRun: true },
    },
    id: 1,
  });
  expect(handler).not.toHaveBeenCalled();
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toBe(
    'dryRun is not supported for draft action=send; nothing was changed.\n\n' +
      'Next step: Describe the change to the user and ask for confirmation, then call it without dryRun.'
  );
});

test('dryRun: false runs the action as normal', async () => {
  await run('draft', { action: 'send', id: 'm1', dryRun: false });
  expect(writes).toEqual([expect.stringMatching(/^POST .*m1\/send/)]);
});

test('a refused default action is named in the message', async () => {
  const result = await run('folders', { dryRun: true });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(
    /^dryRun is not supported for folders action=list;/
  );
});

test('a supported preview starts with the dry-run label', async () => {
  const result = await run('send-email', {
    ...ARGS['send-email'],
    dryRun: true,
  });
  expect(result.content[0].text.split('\n')[0]).toBe(DRY_RUN_LABEL);
});

describe('DRY_RUN_ACTIONS', () => {
  test('lists only tools whose schema has dryRun, and only real actions', () => {
    for (const [name, actions] of Object.entries(DRY_RUN_ACTIONS)) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool?.inputSchema?.properties?.dryRun).toBeDefined();
      const actionEnum = tool.inputSchema.properties.action?.enum;
      if (actions === true) {
        expect({ name, actionEnum }).toEqual({ name, actionEnum: undefined });
      } else {
        expect(actionEnum).toEqual(expect.arrayContaining(actions));
        for (const action of actions) {
          expect(TOOL_RISK[name].actions).toHaveProperty([action]);
        }
      }
    }
  });

  test('supportsDryRun resolves the default action like classify', () => {
    expect(supportsDryRun('send-email')).toBe(true);
    expect(supportsDryRun('draft', 'create')).toBe(true);
    expect(supportsDryRun('draft', 'send')).toBe(false);
    expect(supportsDryRun('folders')).toBe(false);
    expect(supportsDryRun('folders', null)).toBe(false);
    expect(supportsDryRun('read-email')).toBe(false);
    expect(supportsDryRun('nope', 'x')).toBe(false);
  });

  test('every dryRun description names the actions it applies to', () => {
    for (const tool of dryRunTools) {
      const actions = DRY_RUN_ACTIONS[tool.name];
      const desc = tool.inputSchema.properties.dryRun.description;
      if (actions === true) continue;
      for (const action of actions) expect(desc).toContain(action);
      // Tools where it isn't every action say so.
      const all = tool.inputSchema.properties.action.enum;
      if (actions.length < all.length) {
        expect({ name: tool.name, desc }).toEqual({
          name: tool.name,
          desc: expect.stringMatching(/refused|not supported|only/i),
        });
      }
    }
  });
});
