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

// #279: descriptions state facts and boundaries ("for X, use `search-emails`"),
// never steer a model between tools, and fit the 1,024 characters VS Code
// shows before truncating.
describe('description hygiene', () => {
  /** Every `description` in a schema, with where it was found. */
  function schemaDescriptions(node, where, found = []) {
    if (Array.isArray(node)) {
      node.forEach((child, i) =>
        schemaDescriptions(child, `${where}[${i}]`, found)
      );
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'description' && typeof value === 'string') {
          found.push([where, value]);
        } else {
          schemaDescriptions(value, `${where}.${key}`, found);
        }
      }
    }
    return found;
  }

  const allDescriptions = TOOLS.flatMap((tool) => [
    [tool.name, tool.description],
    ...schemaDescriptions(tool.inputSchema, tool.name),
  ]);

  // `Prefer:` is the HTTP header name, not advice.
  const STEERING = [
    /\binstead of\b/i,
    /\brather than\b/i,
    /\bprefer\b(?!:)/i,
    /\buse this\b/i,
    /\bideal for\b/i,
  ];

  // These two descriptions are rewritten on the fix/v314-hardening branch
  // (draft 1,023 and export 938 characters there). Once that lands, the
  // second test below fails until this list is emptied.
  const PENDING_REWRITE = ['draft', 'export'];

  test.each(TOOLS.map((t) => [t.name, t]))(
    '%s description fits 1,024 characters',
    (name, tool) => {
      if (PENDING_REWRITE.includes(name)) return;
      expect(tool.description.length).toBeLessThanOrEqual(1024);
    }
  );

  test('the pending-rewrite list holds only descriptions still too long', () => {
    for (const name of PENDING_REWRITE) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool.description.length).toBeGreaterThan(1024);
    }
  });

  test('no tool or parameter description steers between tools', () => {
    const steering = allDescriptions.filter(([, text]) =>
      STEERING.some((pattern) => pattern.test(text))
    );
    expect(steering).toEqual([]);
  });

  test('every export.searchQuery property is described', () => {
    const tool = TOOLS.find((t) => t.name === 'export');
    const { properties } = tool.inputSchema.properties.searchQuery;
    expect(Object.keys(properties).sort()).toEqual(
      [
        'folder',
        'from',
        'maxResults',
        'receivedAfter',
        'receivedBefore',
        'subject',
      ].sort()
    );
    for (const [name, schema] of Object.entries(properties)) {
      expect([name, typeof schema.description]).toEqual([name, 'string']);
      expect(schema.description.length).toBeGreaterThan(10);
    }
  });

  test('export states the 100-message batch limit', () => {
    const tool = TOOLS.find((t) => t.name === 'export');
    expect(tool.description).toMatch(/100 messages per call/);
    expect(tool.inputSchema.properties.emailIds.description).toMatch(
      /100 per call/
    );
  });
});
