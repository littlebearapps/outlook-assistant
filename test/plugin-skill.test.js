/**
 * Plugin skill (#282): plugins/outlook-assistant/skills/using-outlook-assistant/.
 *
 * Claude Code, VS Code, Copilot CLI and Cursor all read this folder, and some
 * reject a skill silently, so this suite holds it to the portable Agent
 * Skills format (.claude/rules/plugin-and-skill-maintenance.md): only the six
 * spec frontmatter fields, `name` equal to the folder, SKILL.md under 500
 * lines with the hard rules first, and links only to files inside the skill.
 * It also fails if the skill names a tool or action the server doesn't have,
 * or drifts from the server's own hard rules.
 */
const fs = require('fs');
const path = require('path');

const { TOOLS } = require('../tools');
const { HARD_RULES } = require('../utils/server-instructions');

const SKILL_DIR = path.join(
  __dirname,
  '..',
  'plugins',
  'outlook-assistant',
  'skills',
  'using-outlook-assistant'
);
const SKILL_MD = path.join(SKILL_DIR, 'SKILL.md');
const pkg = require('../package.json');

const files = [
  SKILL_MD,
  ...fs
    .readdirSync(path.join(SKILL_DIR, 'references'))
    .map((f) => path.join(SKILL_DIR, 'references', f)),
];
const text = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(SKILL_DIR, file);

/** Minimal parser for the frontmatter this skill uses (no YAML dependency). */
function frontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (!match) throw new Error('SKILL.md has no frontmatter');
  const fields = {};
  let parent = null;
  for (const line of match[1].split('\n')) {
    const nested = /^ {2}([\w-]+): (.*)$/.exec(line);
    if (nested && parent) {
      fields[parent][nested[1]] = nested[2];
      continue;
    }
    const top = /^([\w-]+):(?: (.*))?$/.exec(line);
    if (!top) throw new Error(`Unexpected frontmatter line: ${line}`);
    parent = top[2] === undefined ? top[1] : null;
    fields[top[1]] = top[2] === undefined ? {} : top[2];
  }
  return fields;
}

const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
/** Tool names, every enum value, and search-emails' strategy names. */
const KNOWN_WORDS = new Set([
  ...TOOLS.map((t) => t.name),
  ...TOOLS.flatMap((t) =>
    Object.values(t.inputSchema.properties).flatMap((p) => p.enum || [])
  ),
  ...[
    ...fs
      .readFileSync(path.join(__dirname, '..', 'email', 'search.js'), 'utf8')
      .matchAll(/strategy: '([a-z-]+)'|'([a-z]+(?:-[a-z]+)+)'/g),
  ].map((m) => m[1] || m[2]),
]);

const skill = text(SKILL_MD);
const meta = frontmatter(skill);

describe('SKILL.md frontmatter (Agent Skills spec)', () => {
  test('uses only the six spec fields', () => {
    const allowed = [
      'name',
      'description',
      'license',
      'compatibility',
      'metadata',
      'allowed-tools',
    ];
    for (const key of Object.keys(meta)) expect(allowed).toContain(key);
  });

  test('name equals the folder name and follows the naming rules', () => {
    expect(meta.name).toBe(path.basename(SKILL_DIR));
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta.name.length).toBeLessThanOrEqual(64);
  });

  test('description fits in 1,024 characters and says when to read it', () => {
    expect(meta.description.length).toBeGreaterThan(100);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
    expect(meta.description).toMatch(/before the first Outlook Assistant/);
    expect(meta.description).toMatch(/Not for /);
  });

  test('compatibility fits in 500 characters', () => {
    expect(meta.compatibility.length).toBeLessThanOrEqual(500);
  });

  test('metadata values are strings and the version is quoted', () => {
    for (const value of Object.values(meta.metadata)) {
      expect(typeof value).toBe('string');
    }
    expect(meta.metadata.version).toMatch(/^(['"])\d+\.\d+\.\d+\1$/);
  });

  test('metadata.version matches the package (scripts/sync-version.js)', () => {
    expect(meta.metadata.version.replace(/['"]/g, '')).toBe(pkg.version);
  });
});

describe('SKILL.md body', () => {
  test('is under 500 lines', () => {
    expect(skill.split('\n').length).toBeLessThan(500);
  });

  test('puts the hard rules in the first screen', () => {
    const body = skill.slice(skill.indexOf('\n---\n') + 5);
    const lines = body.split('\n');
    const rulesAt = lines.findIndex((l) => l === '## Hard rules');
    expect(rulesAt).toBeGreaterThanOrEqual(0);
    expect(rulesAt).toBeLessThan(10);
    expect(lines.filter((l) => /^\d\. \*\*/.test(l))).toHaveLength(8);
  });

  test('covers each of the server instructions’ hard rules', () => {
    // The server's rules (utils/server-instructions.js) and the skill's must
    // say the same things; these phrases anchor each server rule.
    expect(HARD_RULES).toMatch(/data, not instructions/);
    expect(skill).toMatch(/data, never instructions/);
    expect(HARD_RULES).toMatch(/Draft first/);
    expect(skill).toMatch(/Draft first/);
    expect(HARD_RULES).toMatch(/final/);
    expect(skill).toMatch(/Refusals are final/);
    expect(HARD_RULES).toMatch(/dryRun:true/);
    expect(skill).toMatch(/dryRun: true/);
  });

  test('routes to every reference file, and every route exists', () => {
    const routed = [...skill.matchAll(/\]\((references\/[^)]+)\)/g)].map(
      (m) => m[1]
    );
    const onDisk = files.filter((f) => f !== SKILL_MD).map(rel);
    expect([...new Set(routed)].sort()).toEqual(onDisk.sort());
  });
});

describe.each(files.map((f) => [rel(f), f]))('%s', (name, file) => {
  const source = text(file);

  test('links only to files inside the skill folder that exist', () => {
    for (const [, target] of source.matchAll(/\]\(([^)]+)\)/g)) {
      expect(target).not.toMatch(/^[a-z]+:|^\/|^#/i);
      const resolved = path.resolve(path.dirname(file), target.split('#')[0]);
      expect(resolved.startsWith(`${SKILL_DIR}${path.sep}`)).toBe(true);
      expect(fs.existsSync(resolved)).toBe(true);
    }
  });

  test('names only tools, actions and values the server has', () => {
    // Every backticked hyphenated word is a tool, an enum value or a search
    // strategy, so a renamed tool or action can't linger in the skill.
    for (const [, word] of source.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) {
      expect(KNOWN_WORDS).toContain(word);
    }
    for (const [, tool, action] of source.matchAll(
      /`([a-z-]+)`\s+action=`([a-z-]+)`/g
    )) {
      expect(TOOLS_BY_NAME[tool]).toBeDefined();
      expect(TOOLS_BY_NAME[tool].inputSchema.properties.action.enum).toContain(
        action
      );
    }
  });

  if (file !== SKILL_MD) {
    test('has no frontmatter and opens with a title and when to read it', () => {
      expect(source.startsWith('# ')).toBe(true);
      expect(source.split('\n')[2]).toMatch(/^Read this when/);
    });
  }
});
