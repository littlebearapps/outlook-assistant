#!/usr/bin/env node
/**
 * Copy package.json's version into every other version-bearing manifest.
 *
 * Runs from the npm `version` lifecycle script (`npm version <patch|minor>
 * --no-git-tag-version`), so a release bump updates them all at once:
 *   - server.json (MCP Registry): top-level and packages[0] version
 *   - plugins/outlook-assistant/.claude-plugin/plugin.json (Claude Code):
 *     version and the pinned npx launcher
 *   - plugins/outlook-assistant/plugin.json + mcp.json (Agent Plugins:
 *     Copilot, VS Code, Cursor): version and the pinned npx launcher
 *
 * Plugin directories reject unpinned launchers, so the npx argument must
 * always name an exact version.
 *
 * Usage: node scripts/sync-version.js [--check]
 *   --check  exit 1 if any file is out of sync, without writing
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const version = pkg.version;
const pinned = `${pkg.name}@${version}`;
const check = process.argv.includes('--check');

function pinLaunchers(servers) {
  for (const server of Object.values(servers)) {
    server.args = server.args.map((arg) =>
      arg === pkg.name || arg.startsWith(`${pkg.name}@`) ? pinned : arg
    );
  }
}

const updates = {
  'server.json': (json) => {
    json.version = version;
    json.packages[0].version = version;
  },
  'plugins/outlook-assistant/.claude-plugin/plugin.json': (json) => {
    json.version = version;
    pinLaunchers(json.mcpServers);
  },
  'plugins/outlook-assistant/plugin.json': (json) => {
    json.version = version;
  },
  'plugins/outlook-assistant/mcp.json': (json) => {
    pinLaunchers(json.mcpServers);
  },
};

async function main() {
  const prettier = await import('prettier');
  const stale = [];
  for (const [file, update] of Object.entries(updates)) {
    const filePath = path.join(root, file);
    const before = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const json = structuredClone(before);
    update(json);
    // Compare content, not text: lint-staged reformats these with Prettier.
    if (JSON.stringify(json) === JSON.stringify(before)) continue;
    stale.push(file);
    if (check) continue;
    const options = await prettier.resolveConfig(filePath);
    fs.writeFileSync(
      filePath,
      await prettier.format(JSON.stringify(json, null, 2), {
        ...options,
        filepath: filePath,
      })
    );
  }

  if (check && stale.length) {
    console.error(
      `Out of sync with package.json ${version}: ${stale.join(', ')}`
    );
    console.error('Run: node scripts/sync-version.js');
    process.exit(1);
  }
  if (!check) {
    console.log(
      stale.length
        ? `Synced ${version}: ${stale.join(', ')}`
        : `All manifests already at ${version}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
