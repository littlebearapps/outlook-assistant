/**
 * Annotation contract tests.
 *
 * Locks in the `openWorldHint` policy from #92: tools whose output can carry
 * content authored by external/untrusted parties (email bodies, attachments,
 * directory data, sent mail) must advertise `openWorldHint: true` so MCP
 * clients apply appropriate caution (e.g. prompt-injection defences). Tools
 * that only touch caller-controlled or structured data stay `false`.
 */
const { emailTools } = require('../email');
const { contactsTools } = require('../contacts');
const { advancedTools } = require('../advanced');

const allTools = [...emailTools, ...contactsTools, ...advancedTools];
const byName = Object.fromEntries(allTools.map((t) => [t.name, t]));

// Expected openWorldHint per tool touched by / relevant to #92.
const OPEN_WORLD_TRUE = [
  'search-emails', // external sender bodies/previews/threads
  'read-email', // full external message body
  'attachments', // action=view returns external attachment content
  'export', // exports full external message/MIME/conversation content
  'send-email', // interacts with external recipients (pre-existing)
  'draft', // send/reply/forward reach external recipients (pre-existing)
  'search-people', // external directory / people data
  'access-shared-mailbox', // external-sender content in a shared mailbox
];

const OPEN_WORLD_FALSE = [
  'get-mail-tips', // structured recipient metadata, not free-form content
  'update-email', // mutates local message state only
  'manage-contact', // caller-controlled personal contact store
  'find-meeting-rooms', // bounded org-configured resource directory
];

describe('openWorldHint annotation contract (#92)', () => {
  test.each(OPEN_WORLD_TRUE)('%s advertises openWorldHint: true', (name) => {
    const tool = byName[name];
    expect(tool).toBeDefined();
    expect(tool.annotations).toBeDefined();
    expect(tool.annotations.openWorldHint).toBe(true);
  });

  test.each(OPEN_WORLD_FALSE)(
    '%s keeps openWorldHint falsy (not true)',
    (name) => {
      const tool = byName[name];
      expect(tool).toBeDefined();
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations.openWorldHint).not.toBe(true);
    }
  );

  test('every tool with an annotations block declares a boolean readOnlyHint', () => {
    for (const tool of allTools) {
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
    }
  });
});
