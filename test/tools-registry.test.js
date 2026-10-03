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
