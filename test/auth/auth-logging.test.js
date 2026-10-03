/**
 * Auth logging (#278): the device user code is returned to the model but
 * never written to stderr; tokens, device codes and Azure error bodies stay
 * out of stderr by default, and are redacted under OUTLOOK_DEBUG. Failures
 * surface at the default level only as a short note (e.g. an AADSTS code).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');

const ORIGINAL_HOME = process.env.HOME;
const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-auth-logging-'));
process.env.HOME = TEST_HOME;
process.env.OUTLOOK_CLIENT_ID = 'test-client-id';

afterAll(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.HOME;
  else process.env.HOME = ORIGINAL_HOME;
  fs.rmSync(TEST_HOME, { recursive: true, force: true });
});

jest.mock('https');
jest.mock('../../auth/device-code', () => ({
  ...jest.requireActual('../../auth/device-code'),
  initiateDeviceCodeFlow: jest.fn(),
  pollForToken: jest.fn(),
}));

const {
  handleDeviceCodeAuth,
  handleDeviceCodeComplete,
} = require('../../auth/tools');
const {
  initiateDeviceCodeFlow,
  pollForToken,
} = require('../../auth/device-code');
const TokenStorage = require('../../auth/token-storage');
const { withCallContext } = require('../../utils/logger');

const USER_CODE = 'WXYZ-9K7Q';
const DEVICE_CODE = 'DAQABAAEAAAD--devicecode-secret-value';
const ACCESS_TOKEN =
  'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJ1cG4iOiJqYW5lQGV4YW1wbGUuY29tIn0.c2lnbmF0dXJl';
const REFRESH_TOKEN = 'M.C5_BAY.0.U.-refresh-secret-value';
const ADDRESS = 'jane.doe@example.com';
const AZURE_ERROR = `AADSTS50020: User account '${ADDRESS}' from identity provider 'live.com' does not exist in tenant. Trace ID: 3f2504e0-4f89-11d3-9a0c-0305e82c3301`;

const savedDebug = process.env.OUTLOOK_DEBUG;
let errorSpy;
let warnSpy;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.OUTLOOK_DEBUG;
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  if (savedDebug === undefined) delete process.env.OUTLOOK_DEBUG;
  else process.env.OUTLOOK_DEBUG = savedDebug;
});

const stderr = () =>
  [...errorSpy.mock.calls, ...warnSpy.mock.calls]
    .map((c) => c.join(' '))
    .join('\n');

const SECRETS = [USER_CODE, DEVICE_CODE, ACCESS_TOKEN, REFRESH_TOKEN];

function expectNoSecrets(text) {
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain(ADDRESS);
}

/** Run inside a tool-call context; returns [result, notes]. */
function inCall(fn) {
  return withCallContext(async (ctx) => [await fn(), ctx.notes]);
}

describe.each([
  ['default', undefined],
  ['debug', 'true'],
])('%s level', (_label, debug) => {
  beforeEach(() => {
    if (debug) process.env.OUTLOOK_DEBUG = debug;
  });

  test('device code start: user code goes to the model, not stderr', async () => {
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: USER_CODE,
      deviceCode: DEVICE_CODE,
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      interval: 5,
    });
    const [result] = await inCall(() => handleDeviceCodeAuth());
    expect(result.content[0].text).toContain(USER_CODE);
    expectNoSecrets(stderr());
  });

  test('device code start failure: AADSTS code noted, body kept out', async () => {
    initiateDeviceCodeFlow.mockRejectedValue(new Error(AZURE_ERROR));
    const [result, notes] = await inCall(() => handleDeviceCodeAuth());
    expect(result.isError).toBe(true);
    expect(notes.get('auth')).toBe('device-code-failed:AADSTS50020');
    expectNoSecrets(stderr());
    if (debug) expect(stderr()).toContain('<redacted-email>');
    else expect(stderr()).toBe('');
  });

  test('device code completion: tokens never logged', async () => {
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: USER_CODE,
      deviceCode: DEVICE_CODE,
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      interval: 5,
    });
    await handleDeviceCodeAuth();
    pollForToken.mockResolvedValue({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_in: 3600,
      scope: 'User.Read Mail.Read',
      token_type: 'Bearer',
    });
    const [result] = await inCall(() => handleDeviceCodeComplete());
    expect(result.isError).toBeFalsy();
    expectNoSecrets(stderr());
  });

  test('device code completion failure: AADSTS code noted, body kept out', async () => {
    initiateDeviceCodeFlow.mockResolvedValue({
      userCode: USER_CODE,
      deviceCode: DEVICE_CODE,
      verificationUri: 'https://microsoft.com/devicelogin',
      expiresIn: 900,
      interval: 5,
    });
    await handleDeviceCodeAuth();
    pollForToken.mockRejectedValue(new Error(AZURE_ERROR));
    const [result, notes] = await inCall(() => handleDeviceCodeComplete());
    expect(result.isError).toBe(true);
    expect(notes.get('auth')).toBe('device-code-complete-failed:AADSTS50020');
    expectNoSecrets(stderr());
  });

  test('token refresh failure: AADSTS code noted, Azure body kept out', async () => {
    const body = {
      error: 'invalid_grant',
      error_description: AZURE_ERROR,
      error_codes: [50020],
    };
    https.request.mockImplementationOnce((_url, _opts, cb) => {
      const res = {
        statusCode: 400,
        on: jest.fn((event, fn) => {
          if (event === 'data') fn(JSON.stringify(body));
          if (event === 'end') fn();
          return res;
        }),
      };
      cb(res);
      return { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    });
    const storage = new TokenStorage({
      clientId: 'test-client-id',
      tokenStorePath: path.join(TEST_HOME, 'tokens.json'),
      scopes: ['offline_access', 'User.Read'],
      tokenEndpoint:
        'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    });
    storage.getTokens = jest.fn().mockResolvedValue(null);
    storage.tokens = {
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
      expires_at: Date.now() - 1000,
      auth_method: 'device-code',
    };
    const [token, notes] = await inCall(() => storage.getValidAccessToken());
    expect(token).toBeNull();
    expect(notes.get('auth')).toBe('refresh-failed:AADSTS50020');
    expectNoSecrets(stderr());
    if (!debug) expect(stderr()).toBe('');
  });
});
