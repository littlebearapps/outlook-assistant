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
  expect(text).toMatch(/Other rules may have been renumbered/);
  expect(text).toMatch(/1: Test rule\n2: JMK\n3: Paperless/);
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
