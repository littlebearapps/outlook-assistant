/**
 * auth/client-config.js — runtime-supplied Azure Application (client) ID,
 * persisted to ~/.outlook-assistant-config.json. Every test runs against a
 * throwaway HOME so the real config file is never read or written.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CONFIG_FILE_NAME,
  getConfigPath,
  isValidClientId,
  loadSavedClientId,
  saveClientId,
  resolveClientId,
  getClientIdSource,
} = require('../../auth/client-config');

const GUID_A = '11111111-2222-3333-4444-555555555555';
const GUID_B = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';

const ORIGINAL_ENV = { ...process.env };
let testHome;

beforeEach(() => {
  testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-client-config-'));
  process.env.HOME = testHome;
  delete process.env.USERPROFILE;
  delete process.env.OUTLOOK_CLIENT_ID;
  delete process.env.MS_CLIENT_ID;
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(testHome, { recursive: true, force: true });
  process.env = { ...ORIGINAL_ENV };
});

const configFile = () => path.join(testHome, CONFIG_FILE_NAME);

describe('getConfigPath', () => {
  test('uses HOME, resolved per call', () => {
    expect(getConfigPath()).toBe(configFile());
  });

  test('falls back to USERPROFILE when HOME is unset', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = testHome;
    expect(getConfigPath()).toBe(configFile());
  });
});

describe('isValidClientId', () => {
  test.each([GUID_A, GUID_B, `  ${GUID_A}\n`])('accepts %p', (id) => {
    expect(isValidClientId(id)).toBe(true);
  });

  test.each([
    '',
    'test-client-id',
    '11111111-2222-3333-4444-55555555555', // one char short
    '11111111222233334444555555555555', // no hyphens
    '{11111111-2222-3333-4444-555555555555}',
    'g1111111-2222-3333-4444-555555555555',
    null,
    undefined,
    42,
    {},
  ])('rejects %p', (id) => {
    expect(isValidClientId(id)).toBe(false);
  });
});

describe('loadSavedClientId', () => {
  test('returns "" when the file does not exist', () => {
    expect(loadSavedClientId()).toBe('');
  });

  test('returns the saved ID (trimmed)', () => {
    fs.writeFileSync(configFile(), JSON.stringify({ clientId: ` ${GUID_A} ` }));
    expect(loadSavedClientId()).toBe(GUID_A);
  });

  test.each([
    ['invalid JSON', '{not json'],
    ['a non-object', '"just a string"'],
    ['an array', `["${GUID_A}"]`],
    ['an invalid ID', JSON.stringify({ clientId: 'not-a-guid' })],
    ['a non-string ID', JSON.stringify({ clientId: 12345 })],
    ['no clientId key', JSON.stringify({ other: true })],
  ])('returns "" and never throws for %s', (_label, contents) => {
    fs.writeFileSync(configFile(), contents);
    expect(() => loadSavedClientId()).not.toThrow();
    expect(loadSavedClientId()).toBe('');
  });

  test('returns "" when the path is unreadable (a directory)', () => {
    fs.mkdirSync(configFile());
    expect(loadSavedClientId()).toBe('');
  });
});

describe('saveClientId', () => {
  test('writes { clientId } and returns the trimmed ID', () => {
    expect(saveClientId(`  ${GUID_A}  `)).toBe(GUID_A);
    expect(JSON.parse(fs.readFileSync(configFile(), 'utf8'))).toEqual({
      clientId: GUID_A,
    });
    expect(loadSavedClientId()).toBe(GUID_A);
  });

  test('writes the file with mode 0600', () => {
    saveClientId(GUID_A);
    // POSIX permission bits only; Windows does not honour them.
    if (process.platform !== 'win32') {
      expect(fs.statSync(configFile()).mode & 0o777).toBe(0o600);
    }
  });

  test('preserves other keys already in the file', () => {
    fs.writeFileSync(
      configFile(),
      JSON.stringify({ clientId: GUID_B, futureSetting: { a: 1 } })
    );
    saveClientId(GUID_A);
    expect(JSON.parse(fs.readFileSync(configFile(), 'utf8'))).toEqual({
      clientId: GUID_A,
      futureSetting: { a: 1 },
    });
  });

  test('replaces an unparseable file rather than failing', () => {
    fs.writeFileSync(configFile(), '{broken');
    saveClientId(GUID_A);
    expect(loadSavedClientId()).toBe(GUID_A);
  });

  test('rejects an invalid ID and leaves the file untouched', () => {
    fs.writeFileSync(configFile(), JSON.stringify({ clientId: GUID_B }));
    expect(() => saveClientId('not-a-guid')).toThrow(/Invalid client ID/);
    expect(loadSavedClientId()).toBe(GUID_B);
  });

  test('writes atomically: temp file in the same directory, then rename', () => {
    const writeSpy = jest.spyOn(fs, 'writeFileSync');
    const renameSpy = jest.spyOn(fs, 'renameSync');
    saveClientId(GUID_A);

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const [tmpPath, , options] = writeSpy.mock.calls[0];
    expect(tmpPath).not.toBe(configFile());
    expect(path.dirname(tmpPath)).toBe(testHome);
    expect(options).toEqual(expect.objectContaining({ mode: 0o600 }));
    expect(renameSpy).toHaveBeenCalledWith(tmpPath, configFile());
    // No temp file left behind
    expect(fs.readdirSync(testHome)).toEqual([CONFIG_FILE_NAME]);
  });

  test('a failed rename leaves the old file intact and removes the temp file', () => {
    fs.writeFileSync(configFile(), JSON.stringify({ clientId: GUID_B }));
    jest.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EXDEV: simulated rename failure');
    });
    expect(() => saveClientId(GUID_A)).toThrow(/simulated rename failure/);
    expect(loadSavedClientId()).toBe(GUID_B);
    expect(fs.readdirSync(testHome)).toEqual([CONFIG_FILE_NAME]);
  });
});

describe('resolveClientId / getClientIdSource precedence', () => {
  test('nothing configured → "" / none', () => {
    expect(resolveClientId()).toBe('');
    expect(getClientIdSource()).toBe('none');
  });

  test('saved file only → saved', () => {
    saveClientId(GUID_A);
    expect(resolveClientId()).toBe(GUID_A);
    expect(getClientIdSource()).toBe('saved');
  });

  test('MS_CLIENT_ID (legacy) beats the saved file', () => {
    saveClientId(GUID_A);
    process.env.MS_CLIENT_ID = 'legacy-id';
    expect(resolveClientId()).toBe('legacy-id');
    expect(getClientIdSource()).toBe('env');
  });

  test('OUTLOOK_CLIENT_ID beats MS_CLIENT_ID and the saved file', () => {
    saveClientId(GUID_A);
    process.env.MS_CLIENT_ID = 'legacy-id';
    process.env.OUTLOOK_CLIENT_ID = 'env-id';
    expect(resolveClientId()).toBe('env-id');
    expect(getClientIdSource()).toBe('env');
  });

  test('an empty env var does not shadow the saved file', () => {
    saveClientId(GUID_A);
    process.env.OUTLOOK_CLIENT_ID = '';
    expect(resolveClientId()).toBe(GUID_A);
    expect(getClientIdSource()).toBe('saved');
  });

  test('a whitespace-only env var does not shadow the saved file', () => {
    saveClientId(GUID_A);
    process.env.OUTLOOK_CLIENT_ID = '   ';
    expect(resolveClientId()).toBe(GUID_A);
    expect(getClientIdSource()).toBe('saved');
  });

  test('env values are trimmed', () => {
    process.env.OUTLOOK_CLIENT_ID = `  ${GUID_B}\n`;
    expect(resolveClientId()).toBe(GUID_B);
  });

  test('an invalid saved ID resolves to "" / none', () => {
    fs.writeFileSync(configFile(), JSON.stringify({ clientId: 'nope' }));
    expect(resolveClientId()).toBe('');
    expect(getClientIdSource()).toBe('none');
  });
});

describe('config.AUTH_CONFIG.clientId', () => {
  test('is resolved on every read, so a saved ID applies without a restart', () => {
    jest.isolateModules(() => {
      const config = require('../../config');
      expect(config.AUTH_CONFIG.clientId).toBe('');
      saveClientId(GUID_A);
      expect(config.AUTH_CONFIG.clientId).toBe(GUID_A);
      process.env.OUTLOOK_CLIENT_ID = 'env-id';
      expect(config.AUTH_CONFIG.clientId).toBe('env-id');
    });
  });
});
