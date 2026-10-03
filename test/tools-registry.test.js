/**
 * The tool registry (`tools.js`) is the one list of tools the server exposes.
 * Tests that need "every tool" import it rather than rebuilding the list, so a
 * new module can't be added to the server and silently skipped by the
 * contract suites.
 */
const { TOOLS } = require('../tools');

describe('tool registry', () => {
  test('exposes all 22 tools', () => {
    expect(TOOLS).toHaveLength(22);
  });

  test('tool names are unique', () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every tool has a handler, description and inputSchema', () => {
    for (const tool of TOOLS) {
      expect(typeof tool.handler).toBe('function');
      expect(typeof tool.description).toBe('string');
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

// #274: every action that emails people or deletes data has a dryRun
// preview, described key fact first. Tools that gained one stay within the
// 1,024-character description limit VS Code truncates at.
describe.each([
  'create-event',
  'manage-event',
  'mailbox-settings',
  'folders',
  'manage-contact',
])('%s dryRun', (name) => {
  const tool = TOOLS.find((t) => t.name === name);

  test('is an optional boolean described as a preview', () => {
    const { dryRun } = tool.inputSchema.properties;
    expect(dryRun.type).toBe('boolean');
    expect(dryRun.description).toMatch(/^Preview only/);
    expect(tool.inputSchema.required || []).not.toContain('dryRun');
  });

  test('the tool description mentions dryRun and fits 1,024 characters', () => {
    expect(tool.description).toMatch(/dryRun: true/);
    expect(tool.description.length).toBeLessThanOrEqual(1024);
  });
});
