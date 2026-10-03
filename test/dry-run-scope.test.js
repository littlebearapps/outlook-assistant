/**
 * `folders`, `manage-contact` and `mailbox-settings` each preview exactly one
 * action with `dryRun: true` (#274). Every other action refuses the flag and
 * changes nothing, rather than ignoring it and really writing.
 *
 * Each case calls the real tool handler (Graph mocked). A control runs every
 * write action without `dryRun` and expects a write, so the arguments really
 * reach the write path and the refusal is what stops it.
 */
jest.mock('../utils/graph-api');
jest.mock('../auth');

const { folderTools } = require('../folder');
const { contactsTools } = require('../contacts');
const { settingsTools } = require('../settings');
const graph = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

const TOOLS = [...folderTools, ...contactsTools, ...settingsTools];

/** The one action per tool that previews. */
const PREVIEW_ACTION = {
  folders: 'delete',
  'manage-contact': 'delete',
  'mailbox-settings': 'set-auto-replies',
};

/** Minimal valid arguments that reach each action's Graph calls. */
const ARGS = {
  'folders list': {},
  'folders create': { name: 'New folder' },
  'folders move': { emailIds: 'm1', targetFolderId: 'f1' },
  'folders stats': { folderId: 'f1' },
  'folders delete': { folderId: 'f1' },
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

const WRITE_ACTIONS = new Set([
  'folders create',
  'folders move',
  'folders delete',
  'manage-contact create',
  'manage-contact update',
  'manage-contact delete',
  'mailbox-settings set-auto-replies',
  'mailbox-settings set-working-hours',
]);

const cases = Object.keys(ARGS).map((key) => {
  const [name, action] = key.split(' ');
  return [key, name, action];
});

let writes;

function respond(method, path) {
  const m = String(method || 'GET').toUpperCase();
  const p = String(path);
  if (m !== 'GET') {
    writes.push(`${m} ${p}`);
    return { id: 'new', displayName: 'New' };
  }
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
  if (/automaticRepliesSetting/.test(p)) return { status: 'disabled' };
  return { value: [] };
}

beforeEach(() => {
  jest.resetAllMocks();
  writes = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('token');
  graph.callGraphAPI.mockImplementation((_t, method, path) =>
    Promise.resolve(respond(method, path))
  );
  graph.callGraphAPIPaginated.mockImplementation((_t, method, path) =>
    Promise.resolve(respond(method, path))
  );
  graph.callGraphAPIBatch.mockImplementation((_t, requests) => {
    for (const r of requests || []) respond(r.method, r.url);
    return Promise.resolve([]);
  });
});

afterEach(() => {
  console.error.mockRestore();
});

function run(name, args) {
  return TOOLS.find((t) => t.name === name).handler(args);
}

test('the cases cover every action of the three tools', () => {
  for (const name of Object.keys(PREVIEW_ACTION)) {
    const tool = TOOLS.find((t) => t.name === name);
    for (const action of tool.inputSchema.properties.action.enum) {
      expect(ARGS).toHaveProperty([`${name} ${action}`]);
    }
  }
});

describe.each(cases)('%s', (key, name, action) => {
  const previews = PREVIEW_ACTION[name] === action;

  test(`dryRun: true ${previews ? 'previews' : 'is refused'} and never writes`, async () => {
    const result = await run(name, { ...ARGS[key], action, dryRun: true });

    expect({ key, writes }).toEqual({ key, writes: [] });
    const text = result.content[0].text;
    if (previews) {
      expect(result.isError).toBeUndefined();
      expect(result._meta).toMatchObject({ dryRun: true });
      expect(text).toMatch(/^DRY RUN/);
    } else {
      expect(result.isError).toBe(true);
      expect(text).toContain(
        `dryRun is only available for ${name} action=${PREVIEW_ACTION[name]}, not action=${action}; nothing was changed.`
      );
      expect(text).toMatch(/Next step: .*without dryRun/);
      expect(graph.callGraphAPI).not.toHaveBeenCalled();
    }
  });

  if (WRITE_ACTIONS.has(key)) {
    test('control: without dryRun the same arguments write', async () => {
      const result = await run(name, { ...ARGS[key], action });
      expect(result.isError).toBeUndefined();
      expect(writes.length).toBeGreaterThan(0);
    });
  }
});

test('an action left out is refused as the default action', async () => {
  const folders = await run('folders', { dryRun: true });
  expect(folders.isError).toBe(true);
  expect(folders.content[0].text).toContain('not action=list;');

  const settings = await run('mailbox-settings', { dryRun: true });
  expect(settings.isError).toBe(true);
  expect(settings.content[0].text).toContain('not action=get;');
});

test('dryRun: false runs a write action as normal', async () => {
  await run('folders', { action: 'create', name: 'New folder', dryRun: false });
  expect(writes).toEqual([expect.stringMatching(/^POST /)]);
});

describe.each(Object.entries(PREVIEW_ACTION))(
  '%s dryRun description',
  (name, action) => {
    test('names its preview action and says the others refuse it', () => {
      const tool = TOOLS.find((t) => t.name === name);
      const { description } = tool.inputSchema.properties.dryRun;
      expect(description).toMatch(/^Preview only/);
      expect(description).toContain(`action=${action}`);
      expect(description).toContain(
        'Other actions refuse dryRun and change nothing.'
      );
    });
  }
);
