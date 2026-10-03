/**
 * MCP Registry and Smithery metadata (#281).
 *
 * Since v3.13.0 the client ID can be supplied at sign-in (auth
 * action=authenticate clientId=<id>), and device-code sign-in never needs
 * the client secret, so neither listing may demand them up front.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const serverJson = require('../server.json');
const pkg = require('../package.json');
const smithery = fs.readFileSync(path.join(ROOT, 'smithery.yaml'), 'utf8');

const envVar = (name) =>
  serverJson.packages[0].environmentVariables.find((v) => v.name === name);

describe('server.json', () => {
  test('has a display title and website', () => {
    expect(serverJson.title).toBe('Outlook Assistant');
    expect(serverJson.websiteUrl).toBe(pkg.homepage);
  });

  test('has an https PNG icon that exists in the repo', () => {
    expect(serverJson.icons).toHaveLength(1);
    const [icon] = serverJson.icons;
    expect(icon.mimeType).toBe('image/png');
    expect(icon.sizes).toEqual(['1000x1000']);
    const prefix =
      'https://raw.githubusercontent.com/littlebearapps/outlook-assistant/main/';
    expect(icon.src.startsWith(prefix)).toBe(true);
    expect(fs.existsSync(path.join(ROOT, icon.src.slice(prefix.length)))).toBe(
      true
    );
  });

  test('does not require the client ID, and says it can be set at sign-in', () => {
    const clientId = envVar('OUTLOOK_CLIENT_ID');
    expect(clientId.isRequired).toBe(false);
    expect(clientId.description).toMatch(/clientId=/);
  });

  test('does not require the client secret', () => {
    expect(envVar('OUTLOOK_CLIENT_SECRET').isRequired).toBe(false);
  });
});

describe('smithery.yaml', () => {
  test('requires neither the client ID nor the client secret', () => {
    expect(smithery).not.toMatch(/^\s*required:/m);
  });

  test('passes only the values the user actually set', () => {
    expect(smithery).not.toMatch(/OUTLOOK_CLIENT_SECRET: config\./);
  });
});
