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

  test('auth', async () => {
    const { authTools } = require('../../auth');
    const tool = authTools.find((t) => t.name === 'auth');
    const result = await tool.handler({ action: 'badaction' });
    expect(result.content[0].text).toMatch(/Unknown action 'badaction'/);
  });
});
