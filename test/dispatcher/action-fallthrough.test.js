// Action fallthrough audit (#162). Each multi-action tool's switch
// statement now returns an explicit "Unknown action" error instead of
// silently routing typos to the list/get handler. The chokepoint catches
// invalid actions earlier (via inputSchema enum validation) for normal
// MCP traffic, but tests/direct callers still need the defensive arm.
//
// One test per dispatcher confirms the default arm fires correctly.

jest.mock('../../auth', () => {
  const actual = jest.requireActual('../../auth');
  return {
    ...actual,
    ensureAuthenticated: jest.fn().mockResolvedValue('test-token'),
  };
});
jest.mock('../../utils/graph-api');

describe('action fallthrough → explicit unknown-action error', () => {
  test('manage-rules', async () => {
    const { rulesTools } = require('../../rules');
    const tool = rulesTools.find((t) => t.name === 'manage-rules');
    const result = await tool.handler({ action: 'lst' });
    expect(result.content[0].text).toMatch(/Unknown action 'lst'/);
    expect(result.content[0].text).toMatch(
      /list, create, update, reorder, delete/
    );
  });

  test('manage-category', async () => {
    const { categoriesTools } = require('../../categories');
    const tool = categoriesTools.find((t) => t.name === 'manage-category');
    const result = await tool.handler({ action: 'create-it' });
    expect(result.content[0].text).toMatch(/Unknown action 'create-it'/);
  });

  test("manage-category accepts 'set' as deprecated alias for 'update'", async () => {
    const { categoriesTools } = require('../../categories');
    const tool = categoriesTools.find((t) => t.name === 'manage-category');
    // No id → handleUpdateCategory's own validation kicks in
    const result = await tool.handler({ action: 'set' });
    expect(result.content[0].text).toMatch(/Category ID is required/);
  });

  test('manage-focused-inbox', async () => {
    const { categoriesTools } = require('../../categories');
    const tool = categoriesTools.find((t) => t.name === 'manage-focused-inbox');
    const result = await tool.handler({ action: 'unknown' });
    expect(result.content[0].text).toMatch(/Unknown action 'unknown'/);
  });

  test('mailbox-settings', async () => {
    const { settingsTools } = require('../../settings');
    const tool = settingsTools.find((t) => t.name === 'mailbox-settings');
    const result = await tool.handler({ action: 'set-auto-reply' });
    expect(result.content[0].text).toMatch(/Unknown action 'set-auto-reply'/);
    expect(result.content[0].text).toMatch(
      /get, set-auto-replies, set-working-hours/
    );
  });

  test('folders', async () => {
    const { folderTools } = require('../../folder');
    const tool = folderTools.find((t) => t.name === 'folders');
    const result = await tool.handler({ action: 'foo' });
    expect(result.content[0].text).toMatch(/Unknown action 'foo'/);
  });

  test('attachments', async () => {
    const { emailTools } = require('../../email');
    const tool = emailTools.find((t) => t.name === 'attachments');
    const result = await tool.handler({ action: 'preview', messageId: 'm1' });
    expect(result.content[0].text).toMatch(/Unknown action 'preview'/);
  });

  test('export', async () => {
    const { emailTools } = require('../../email');
    const tool = emailTools.find((t) => t.name === 'export');
    const result = await tool.handler({ target: 'archive' });
    expect(result.content[0].text).toMatch(/Unknown export target 'archive'/);
  });

  test('manage-contact', async () => {
    const { contactsTools } = require('../../contacts');
    const tool = contactsTools.find((t) => t.name === 'manage-contact');
    const result = await tool.handler({ action: 'foo' });
    expect(result.content[0].text).toMatch(/Unknown action 'foo'/);
  });

  test('manage-tasks', async () => {
    const { tasksTools } = require('../../tasks');
    const tool = tasksTools.find((t) => t.name === 'manage-tasks');
    const result = await tool.handler({ action: 'foo' });
    expect(result.content[0].text).toMatch(/Unknown action 'foo'/);
    expect(result.content[0].text).toMatch(/list-lists, list, create/);
  });

  test('auth', async () => {
    const { authTools } = require('../../auth');
    const tool = authTools.find((t) => t.name === 'auth');
    const result = await tool.handler({ action: 'badaction' });
    expect(result.content[0].text).toMatch(/Unknown action 'badaction'/);
  });
});

// Param alias bundle (#163)
describe('param-name aliases', () => {
  test('manage-event accepts `id` as alias for `eventId` (F-37)', async () => {
    const { calendarTools } = require('../../calendar');
    const tool = calendarTools.find((t) => t.name === 'manage-event');

    // Without `id` or `eventId` should error
    const noId = await tool.handler({ action: 'cancel' });
    expect(noId.content[0].text).toMatch(/eventId.*missing/);

    // With `id` alias the dispatcher should not error on missing eventId
    // (the actual cancel will fail due to mocked auth, but we just check
    // the alias passes the dispatcher gate).
    const { callGraphAPI } = require('../../utils/graph-api');
    callGraphAPI.mockResolvedValueOnce({});
    const withId = await tool.handler({ action: 'cancel', id: 'event-123' });
    expect(withId.content[0].text).not.toMatch(/missing/);
  });

  test('manage-rules accepts `displayName` as alias for `name` (F-41)', async () => {
    const { rulesTools } = require('../../rules');
    const tool = rulesTools.find((t) => t.name === 'manage-rules');
    const { callGraphAPI } = require('../../utils/graph-api');
    callGraphAPI.mockResolvedValueOnce({ value: [] });

    // displayName instead of name should be accepted; the create
    // handler will error for other reasons (no conditions/actions)
    // but not for "Rule name is required".
    const result = await tool.handler({
      action: 'create',
      displayName: 'aliased-rule',
      containsSubject: 'foo',
      markAsRead: true,
    });
    expect(result.content[0].text).not.toMatch(/Rule name is required/);
  });

  test('access-shared-mailbox accepts `email` as alias for `sharedMailbox` (F-46)', async () => {
    const { advancedTools } = require('../../advanced');
    const tool = advancedTools.find((t) => t.name === 'access-shared-mailbox');
    const { callGraphAPI } = require('../../utils/graph-api');

    // Without either should error
    const missing = await tool.handler({});
    expect(missing.content[0].text).toMatch(/Shared mailbox email/);

    // With `email` alias should not error on missing param
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    const withEmail = await tool.handler({ email: 'shared@example.com' });
    expect(withEmail.content[0].text).not.toMatch(/Shared mailbox email/);
  });

  test('search-emails accepts `searchQuery` and legacy `kqlQuery` raw search params', async () => {
    const { emailTools } = require('../../email');
    const { coerceArgsAgainstSchema } = require('../../utils/schema-coerce');
    const tool = emailTools.find((t) => t.name === 'search-emails');

    expect(
      coerceArgsAgainstSchema({ searchQuery: 'subject:PR' }, tool.inputSchema)
        .error
    ).toBeUndefined();
    expect(
      coerceArgsAgainstSchema({ kqlQuery: 'subject:PR' }, tool.inputSchema)
        .error
    ).toBeUndefined();
  });
});
