/**
 * Risk-class map contract (#270, #277).
 *
 * `utils/risk-classes.js` is the single source of truth for how risky each
 * tool and action is. Annotations are derived from it, so this suite fails if
 * any tool or action is unclassified (new surfaces must be classified on
 * purpose), if the map names something that no longer exists, or if a tool's
 * published annotations drift from the map.
 */
const { TOOLS } = require('../../tools');
const {
  DRY_RUN_ACTIONS,
  RISK_CLASSES,
  TOOL_RISK,
  classify,
  riskAnnotations,
  riskMeta,
  supportsDryRun,
} = require('../../utils/risk-classes');

const byName = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
const actionEnum = (tool) => tool.inputSchema?.properties?.action?.enum;

describe('risk-class map coverage', () => {
  test.each(TOOLS.map((t) => t.name))('%s is classified', (name) => {
    const entry = TOOL_RISK[name];
    expect(entry).toBeDefined();
    const actions = actionEnum(byName[name]);
    if (actions) {
      expect(Object.keys(entry.actions || {}).sort()).toEqual(
        [...actions].sort()
      );
      expect(entry.default).toBeUndefined();
    } else {
      expect(entry.actions).toBeUndefined();
      expect(RISK_CLASSES).toContain(entry.default);
    }
  });

  test('the map names no tool that does not exist', () => {
    for (const name of Object.keys(TOOL_RISK)) {
      expect(byName[name]).toBeDefined();
    }
  });

  test('every class used is a known class', () => {
    for (const entry of Object.values(TOOL_RISK)) {
      const classes = entry.actions
        ? Object.values(entry.actions)
        : [entry.default];
      for (const c of classes) expect(RISK_CLASSES).toContain(c);
    }
  });
});

describe('classify', () => {
  test('returns the action class for action-based tools', () => {
    expect(classify('draft', 'send')).toBe('outward');
    expect(classify('draft', 'create')).toBe('reversible');
    expect(classify('manage-rules', 'create')).toBe('persistent');
    expect(classify('folders', 'delete')).toBe('destructive');
    expect(classify('folders', 'list')).toBe('read');
  });

  test('returns the default class for single-purpose tools', () => {
    expect(classify('send-email')).toBe('outward');
    expect(classify('search-emails')).toBe('read');
  });

  test('returns undefined for an unknown tool or action', () => {
    expect(classify('no-such-tool')).toBeUndefined();
    expect(classify('draft', 'no-such-action')).toBeUndefined();
  });

  // #271: read-only mode classifies calls that leave `action` out.
  test('uses the default action when the call leaves action out', () => {
    expect(classify('auth')).toBe('read');
    expect(classify('folders')).toBe('read');
    expect(classify('mailbox-settings')).toBe('read');
    expect(classify('apply-category')).toBe('reversible');
  });

  test('treats a null action like a missing one, as the handlers do', () => {
    // Coercion lets `action: null` through; handlers then run their
    // default (`args.action || 'list'`), so the gate must classify that.
    expect(classify('folders', null)).toBe('read');
    expect(classify('apply-category', null)).toBe('reversible');
    expect(classify('draft', null)).toBeUndefined();
  });

  test('returns undefined when action is required but missing', () => {
    expect(classify('draft')).toBeUndefined();
    expect(classify('manage-event')).toBeUndefined();
  });
});

describe('default actions match the tools (#271)', () => {
  const actionTools = TOOLS.filter((t) => actionEnum(t));

  test.each(actionTools.map((t) => t.name))(
    '%s declares a default action only when action is optional',
    (name) => {
      const tool = byName[name];
      const entry = TOOL_RISK[name];
      const required = (tool.inputSchema.required || []).includes('action');
      if (required) {
        expect(entry.defaultAction).toBeUndefined();
        return;
      }
      expect(actionEnum(tool)).toContain(entry.defaultAction);
      // The schema documents the same default the handler uses.
      const doc = tool.inputSchema.properties.action.description;
      expect(doc).toMatch(
        new RegExp(`default:? ${entry.defaultAction}\\b`, 'i')
      );
    }
  );
});

describe('requiresUserInteraction (#271)', () => {
  const flagged = Object.keys(TOOL_RISK).filter(
    (name) => TOOL_RISK[name].requiresUserInteraction
  );

  test('only send-email and create-event are flagged', () => {
    expect(flagged.sort()).toEqual(['create-event', 'send-email']);
  });

  test('never flags a tool that has a read action (decision D1)', () => {
    for (const name of flagged) {
      const entry = TOOL_RISK[name];
      const classes = entry.actions
        ? Object.values(entry.actions)
        : [entry.default];
      expect(classes).not.toContain('read');
    }
  });

  test('riskMeta carries the Claude flag for flagged tools only', () => {
    expect(riskMeta('send-email')).toEqual({
      'anthropic/requiresUserInteraction': true,
    });
    expect(riskMeta('create-event')).toEqual({
      'anthropic/requiresUserInteraction': true,
    });
    expect(riskMeta('draft')).toBeUndefined();
    expect(riskMeta('search-emails')).toBeUndefined();
    expect(riskMeta('no-such-tool')).toBeUndefined();
  });
});

describe('riskAnnotations', () => {
  test('throws for an unclassified tool, so it cannot ship unannotated', () => {
    expect(() => riskAnnotations('no-such-tool', 'X')).toThrow(/no-such-tool/);
  });

  test('a read tool is read-only, non-destructive and idempotent', () => {
    expect(riskAnnotations('find-meeting-rooms', 'Rooms')).toEqual({
      title: 'Rooms',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  test('a tool that surfaces untrusted content is open-world', () => {
    expect(riskAnnotations('read-email', 'Read').openWorldHint).toBe(true);
  });

  test('calendar and mail-tip text from other people is untrusted', () => {
    // Event subjects/previews come from external organisers; mail tips echo
    // recipients' out-of-office messages.
    for (const name of ['list-events', 'get-mail-tips']) {
      expect(riskAnnotations(name, name).openWorldHint).toBe(true);
    }
  });

  test('outward and persistent actions are destructive and open-world', () => {
    for (const name of ['create-event', 'mailbox-settings', 'manage-rules']) {
      const a = riskAnnotations(name, name);
      expect(a.destructiveHint).toBe(true);
      expect(a.openWorldHint).toBe(true);
    }
  });

  test('a delete action makes a tool destructive (#277)', () => {
    for (const name of ['manage-category', 'manage-focused-inbox']) {
      expect(riskAnnotations(name, name).destructiveHint).toBe(true);
    }
  });

  test('reversible-only write tools are not destructive', () => {
    const a = riskAnnotations('update-email', 'Update');
    expect(a.readOnlyHint).toBe(false);
    expect(a.destructiveHint).toBe(false);
    expect(a.idempotentHint).toBe(true);
  });
});

describe('published tool metadata matches the map (#277)', () => {
  test.each(TOOLS.map((t) => t.name))(
    '%s sets all four hints explicitly, from the map',
    (name) => {
      const tool = byName[name];
      const a = tool.annotations;
      for (const hint of [
        'readOnlyHint',
        'destructiveHint',
        'idempotentHint',
        'openWorldHint',
      ]) {
        expect(typeof a[hint]).toBe('boolean');
      }
      expect(a).toEqual(riskAnnotations(name, a.title));
    }
  );

  test.each(TOOLS.map((t) => t.name))(
    '%s has a top-level title matching annotations.title',
    (name) => {
      const tool = byName[name];
      expect(typeof tool.title).toBe('string');
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.annotations.title).toBe(tool.title);
    }
  );
});

describe('dry-run map', () => {
  const withDryRun = TOOLS.filter((t) => t.inputSchema?.properties?.dryRun);

  test('names exactly the tools whose schema has dryRun', () => {
    expect(Object.keys(DRY_RUN_ACTIONS).sort()).toEqual(
      withDryRun.map((t) => t.name).sort()
    );
  });

  test.each(Object.entries(DRY_RUN_ACTIONS))(
    '%s lists only real actions, or is single-purpose',
    (name, supported) => {
      const actions = actionEnum(byName[name]);
      if (supported === true) {
        expect(actions).toBeUndefined();
      } else {
        expect(supported.length).toBeGreaterThan(0);
        for (const action of supported) expect(actions).toContain(action);
      }
    }
  );

  test('supportsDryRun resolves listed actions, defaults and unknown tools', () => {
    expect(supportsDryRun('send-email')).toBe(true);
    expect(supportsDryRun('draft', 'create')).toBe(true);
    expect(supportsDryRun('draft', 'send')).toBe(false);
    expect(supportsDryRun('manage-rules', 'reorder')).toBe(false);
    // folders defaults to list, which has nothing to preview.
    expect(supportsDryRun('folders')).toBe(false);
    expect(supportsDryRun('folders', null)).toBe(false);
    expect(supportsDryRun('search-emails')).toBe(false);
    expect(supportsDryRun('no-such-tool')).toBe(false);
  });
});
