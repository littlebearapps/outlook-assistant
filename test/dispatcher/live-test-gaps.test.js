/**
 * Gaps found in the v3.14.0 live test (#307), through the dispatcher.
 */
jest.mock('../../utils/graph-api');

const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const { tokenStorage } = require('../../auth');
const config = require('../../config');
const graph = require('../../utils/graph-api');

const call = createRequestHandler(TOOLS);

function run(name, args) {
  return call({
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });
}

const textOf = (result) => result.content[0].text;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue('token');
  graph.callGraphAPI.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('manage-rules reorder lists the resulting order, sorted', async () => {
  const rules = [
    { id: 'r2', displayName: 'Paperless', sequence: 3 },
    { id: 'r1', displayName: 'Test rule', sequence: 1 },
    { id: 'r3', displayName: 'JMK', sequence: 2 },
  ];
  graph.callGraphAPI.mockImplementation((_t, method) =>
    Promise.resolve(method === 'GET' ? { value: rules } : {})
  );

  const text = textOf(
    await run('manage-rules', {
      action: 'reorder',
      ruleName: 'Test rule',
      sequence: 1,
    })
  );

  expect(text).toMatch(/to 1\./);
  expect(text).toMatch(/1: Test rule\n2: JMK\n3: Paperless/);
  expect(text).toMatch(/No other rule was renumbered/);
});

test('manage-rules reorder names each rule Exchange renumbered, old to new', async () => {
  let reads = 0;
  graph.callGraphAPI.mockImplementation((_t, method) => {
    if (method !== 'GET') return Promise.resolve({});
    reads++;
    return Promise.resolve({
      value:
        reads === 1
          ? [
              { id: 'a', displayName: 'First', sequence: 1 },
              { id: 'b', displayName: 'New', sequence: 5 },
            ]
          : [
              { id: 'b', displayName: 'New', sequence: 1 },
              { id: 'a', displayName: 'First', sequence: 2 },
            ],
    });
  });

  const text = textOf(
    await run('manage-rules', {
      action: 'reorder',
      ruleName: 'New',
      sequence: 1,
    })
  );

  expect(text).toMatch(/Renumbered by Exchange: "First" 1 → 2/);
  expect(text).not.toMatch(/"New" 5/);
});

test('folders stats points folders over 50 items at delta sync', async () => {
  graph.callGraphAPI.mockImplementation((_t, _m, path) =>
    Promise.resolve(
      /messages/.test(path)
        ? { value: [] }
        : {
            id: 'f1',
            displayName: 'Inbox',
            totalItemCount: 80,
            unreadItemCount: 0,
          }
    )
  );
  const text = textOf(
    await run('folders', {
      action: 'stats',
      folder: 'inbox',
      outputVerbosity: 'full',
    })
  );
  expect(text).toMatch(/Medium folder/);
  expect(text).toMatch(/deltaMode: true`, 100 per page; list mode stops at 50/);
  expect(text).not.toMatch(/Small folder/);
});

test('access-shared-mailbox 404 adds the enable hint while the opt-in is off', async () => {
  const saved = config.SHARED_MAILBOX_MODE;
  config.SHARED_MAILBOX_MODE = 'off';
  try {
    graph.callGraphAPI.mockRejectedValue(
      new Error('API call failed with status 404: ErrorItemNotFound')
    );
    const result = await run('access-shared-mailbox', {
      sharedMailbox: 'team@example.com',
      count: 1,
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not found, or you can't access it/);
    expect(textOf(result)).toMatch(/OUTLOOK_SHARED_MAILBOX=read/);
  } finally {
    config.SHARED_MAILBOX_MODE = saved;
  }
});

test('an empty folder-scoped search suggests Junk Email', async () => {
  graph.callGraphAPI.mockResolvedValue({ value: [] });
  const text = textOf(
    await run('search-emails', { from: 'someone@example.com', count: 5 })
  );
  expect(text).toMatch(/including Archive and Junk Email/);
});
