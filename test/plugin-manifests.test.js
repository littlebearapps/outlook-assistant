/**
 * Plugin manifest tests.
 *
 * The plugin folder (`plugins/outlook-assistant/`) is what the Claude, GitHub
 * Copilot and Cursor plugin marketplaces install. Those directories reject an
 * unpinned npx launcher, so every manifest must name the exact version in
 * package.json — `npm version` keeps them in step via scripts/sync-version.js,
 * and this suite catches a hand edit that drifts.
 */
const { execFile } = require('child_process');
const path = require('path');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, '..');
const PLUGIN = path.join(ROOT, 'plugins', 'outlook-assistant');
const pkg = require('../package.json');
const claudePlugin = require(
  path.join(PLUGIN, '.claude-plugin', 'plugin.json')
);
const agentPlugin = require(path.join(PLUGIN, 'plugin.json'));
const agentMcp = require(path.join(PLUGIN, 'mcp.json'));
const cursorPlugin = require(
  path.join(PLUGIN, '.cursor-plugin', 'plugin.json')
);

const PINNED = `${pkg.name}@${pkg.version}`;

describe('plugin manifests', () => {
  test('sync-version --check reports every manifest in sync', async () => {
    await expect(
      execFileAsync(process.execPath, [
        path.join(ROOT, 'scripts', 'sync-version.js'),
        '--check',
      ])
    ).resolves.toBeDefined();
  });

  test('versions match package.json', () => {
    expect(claudePlugin.version).toBe(pkg.version);
    expect(agentPlugin.version).toBe(pkg.version);
    expect(cursorPlugin.version).toBe(pkg.version);
  });

  test('every npx launcher is pinned to the exact package version', () => {
    for (const servers of [claudePlugin.mcpServers, agentMcp.mcpServers]) {
      for (const server of Object.values(servers)) {
        expect(server.command).toBe('npx');
        expect(server.args).toContain(PINNED);
      }
    }
  });

  test('Agent Plugins files use the 1.0.0 schemas and stdio transport', () => {
    expect(agentPlugin.$schema).toBe(
      'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json'
    );
    expect(agentMcp.$schema).toBe(
      'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
    );
    expect(agentMcp.mcpServers.outlook.type).toBe('stdio');
  });

  test('no manifest carries a client secret', () => {
    const text = JSON.stringify([
      claudePlugin,
      agentPlugin,
      agentMcp,
      cursorPlugin,
    ]);
    expect(text).not.toMatch(/CLIENT_SECRET/);
  });

  test('every Claude userConfig value has a default, so Cowork can load it', () => {
    for (const option of Object.values(claudePlugin.userConfig)) {
      expect(option).toHaveProperty('default');
      expect(option.sensitive).toBeUndefined();
    }
  });

  test('the Cursor manifest declares no MCP servers, so Cursor uses mcp.json', () => {
    // Without .cursor-plugin, Cursor loads .claude-plugin's inline servers
    // and passes ${user_config.*} through unexpanded (Cursor CLI 2026.10.01).
    expect(cursorPlugin.mcpServers).toBeUndefined();
    expect(JSON.stringify(agentMcp)).not.toMatch(/\$\{user_config\./);
  });
});
