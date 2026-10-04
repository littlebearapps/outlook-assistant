#!/usr/bin/env node
/**
 * Copy the risk-class map (utils/risk-classes.js) into the plugin, which
 * can't load repo code at run time:
 *   - plugins/outlook-assistant/hooks/risk-map.json, read by the hook
 *     (hooks/outlook-gate.js) to classify each call
 *   - the risk table in the skill's SKILL.md, between the
 *     `<!-- risk-table:start -->` and `<!-- risk-table:end -->` markers
 *
 * Run it after any change to utils/risk-classes.js;
 * test/plugin-hooks.test.js fails while either copy is stale.
 *
 * Usage: node scripts/sync-risk-map.js [--check]
 *   --check  exit 1 if either file is out of sync, without writing
 */
const fs = require('fs');
const path = require('path');
const {
  DRY_RUN_ACTIONS,
  RISK_CLASSES,
  TOOL_RISK,
} = require('../utils/risk-classes');

const root = path.join(__dirname, '..');
const PLUGIN = path.join(root, 'plugins', 'outlook-assistant');
const RISK_MAP = path.join(PLUGIN, 'hooks', 'risk-map.json');
const SKILL = path.join(
  PLUGIN,
  'skills',
  'using-outlook-assistant',
  'SKILL.md'
);
const START = '<!-- risk-table:start -->';
const END = '<!-- risk-table:end -->';

/** The hook's copy of the map: only the fields the hook reads. */
function riskMap() {
  const tools = {};
  for (const [name, entry] of Object.entries(TOOL_RISK)) {
    tools[name] = {
      ...(entry.actions
        ? { actions: entry.actions }
        : { default: entry.default }),
      ...(entry.defaultAction && { defaultAction: entry.defaultAction }),
      ...(entry.untrustedContent && { untrustedContent: true }),
      ...(DRY_RUN_ACTIONS[name] && { dryRun: DRY_RUN_ACTIONS[name] }),
    };
  }
  return {
    $comment:
      'Generated from utils/risk-classes.js by scripts/sync-risk-map.js. Do not edit by hand.',
    tools,
  };
}

/** The skill's risk table: one row per tool, actions grouped by class. */
function riskTable() {
  const rows = Object.entries(TOOL_RISK).map(([name, entry]) => {
    const cells = RISK_CLASSES.map((riskClass) => {
      if (!entry.actions) return entry.default === riskClass ? 'all' : '';
      return Object.entries(entry.actions)
        .filter(([, c]) => c === riskClass)
        .map(([action]) => action)
        .join(', ');
    });
    return `| \`${name}\` | ${cells.join(' | ')} |`;
  });
  return [
    `| Tool | ${RISK_CLASSES.join(' | ')} |`,
    `|---|${RISK_CLASSES.map(() => '---').join('|')}|`,
    ...rows,
  ].join('\n');
}

async function format(filePath, text) {
  const prettier = await import('prettier');
  const options = await prettier.resolveConfig(filePath);
  return prettier.format(text, { ...options, filepath: filePath });
}

async function main() {
  const check = process.argv.includes('--check');
  const skill = fs.readFileSync(SKILL, 'utf8');
  const start = skill.indexOf(START);
  const end = skill.indexOf(END);
  if (start === -1 || end < start) {
    throw new Error(`${SKILL} is missing the ${START} … ${END} markers`);
  }

  const wanted = {
    [RISK_MAP]: await format(RISK_MAP, JSON.stringify(riskMap())),
    [SKILL]: await format(
      SKILL,
      `${skill.slice(0, start)}${START}\n\n${riskTable()}\n\n${skill.slice(end)}`
    ),
  };

  const stale = [];
  for (const [file, text] of Object.entries(wanted)) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current === text) continue;
    stale.push(path.relative(root, file));
    if (!check) fs.writeFileSync(file, text);
  }

  if (check && stale.length) {
    console.error(
      `Out of sync with utils/risk-classes.js: ${stale.join(', ')}`
    );
    console.error('Run: node scripts/sync-risk-map.js');
    process.exit(1);
  }
  if (!check) {
    console.log(
      stale.length ? `Updated ${stale.join(', ')}` : 'Risk map already in sync'
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
