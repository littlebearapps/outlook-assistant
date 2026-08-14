/**
 * Tests for the dynamic scope fallback (work/school = full scopes; personal =
 * automatic fallback to base scopes; refresh re-requests only granted scopes).
 *
 * Covers:
 *   - isScopeConsentError predicate (auth/device-code.js)
 *   - BASE_SCOPES / SHARED_SCOPES / AUTH_CONFIG scope exports (config.js)
 *   - resolveRefreshScopes scope selection (auth/token-storage.js)
 */
const {
  isScopeConsentError,
  isConsentRequiredError,
} = require('../../auth/device-code');
const config = require('../../config');
const { resolveRefreshScopes } = require('../../auth/token-storage');

/** Build an Error carrying an OAuth payload, as pollForToken does. */
function oauthError(message, oauth) {
  const err = new Error(message);
  if (oauth) {
    err.oauth = oauth;
  }
  return err;
}

describe('isScopeConsentError — fallback triggers', () => {
  // A true here means: silently downgrade to base scopes, PERMANENTLY (the
  // reduced set is persisted as granted_scopes and reused on every refresh).
  // Only "this scope value isn't supported for this account" qualifies.
  const cases = [
    [
      'OAuth error=invalid_scope',
      oauthError('AADSTS70011: invalid scope', { error: 'invalid_scope' }),
      true,
    ],
    [
      'AADSTS650053 in error_codes array (numeric)',
      oauthError('scope rejected', {
        error: 'invalid_request',
        error_codes: [650053],
      }),
      true,
    ],
    [
      'AADSTS70011 in error_codes array (string)',
      oauthError('scope rejected', {
        error: 'invalid_request',
        error_codes: ['70011'],
      }),
      true,
    ],
    [
      'AADSTS650053 embedded in error_description',
      oauthError('Token polling failed', {
        error: 'invalid_request',
        error_description:
          "AADSTS650053: The application asked for scope 'Mail.Read.Shared' that doesn't exist.",
      }),
      true,
    ],
    [
      'AADSTS70011 embedded in the message string',
      oauthError(
        'AADSTS70011: The provided value for the input parameter scope is not valid.'
      ),
      true,
    ],
    [
      'error_description naming Mail.Read.Shared (no known AADSTS code)',
      oauthError('Token polling failed', {
        error: 'invalid_request',
        error_description:
          "AADSTS99999: Scope 'Mail.Read.Shared' is not supported for this account.",
      }),
      true,
    ],

    // --- must NOT fall back ---
    [
      'bare invalid_grant (MFA / conditional access / revoked grant)',
      oauthError('consent required', { error: 'invalid_grant' }),
      false,
    ],
    [
      'AADSTS50076 MFA-required invalid_grant',
      oauthError('multi-factor authentication required', {
        error: 'invalid_grant',
        error_codes: [50076],
        error_description:
          'AADSTS50076: Due to a configuration change made by your administrator, you must use multi-factor authentication.',
      }),
      false,
    ],
    [
      'AADSTS65001 alone (consent required — remediable)',
      oauthError('not consented', {
        error: 'invalid_grant',
        error_codes: [65001],
        error_description:
          'AADSTS65001: The user or administrator has not consented to use the application.',
      }),
      false,
    ],
    [
      'AADSTS28000 (generic invalid request)',
      oauthError('invalid request', {
        error: 'invalid_request',
        error_codes: [28000],
      }),
      false,
    ],
    [
      'authorization_pending',
      oauthError('authorization pending', { error: 'authorization_pending' }),
      false,
    ],
    [
      'expired_token',
      oauthError('Device code expired.', { error: 'expired_token' }),
      false,
    ],
    ['network error (no oauth payload)', oauthError('ECONNRESET'), false],
    [
      'unrelated server error',
      oauthError('Something unrelated went wrong', {
        error: 'server_error',
        error_codes: [50000],
      }),
      false,
    ],
  ];

  it.each(cases)('%s → %s', (_name, err, expected) => {
    expect(isScopeConsentError(err)).toBe(expected);
  });

  it('returns false for null / undefined', () => {
    expect(isScopeConsentError(null)).toBe(false);
    expect(isScopeConsentError(undefined)).toBe(false);
  });
});

describe('isConsentRequiredError — AADSTS65001 only', () => {
  it('matches AADSTS65001 in error_codes', () => {
    expect(
      isConsentRequiredError(
        oauthError('not consented', {
          error: 'invalid_grant',
          error_codes: [65001],
        })
      )
    ).toBe(true);
  });

  it('matches AADSTS65001 in the message string', () => {
    expect(
      isConsentRequiredError(
        oauthError('AADSTS65001: The user has not consented.')
      )
    ).toBe(true);
  });

  it('does not match a scope-unsupported error', () => {
    expect(
      isConsentRequiredError(
        oauthError('scope rejected', { error_codes: [650053] })
      )
    ).toBe(false);
  });

  it('returns false for null', () => {
    expect(isConsentRequiredError(null)).toBe(false);
  });
});

describe('config scope exports', () => {
  it('BASE_SCOPES excludes the .Shared scopes', () => {
    expect(config.BASE_SCOPES).not.toContain('Mail.Read.Shared');
    expect(config.BASE_SCOPES).not.toContain('Mail.ReadWrite.Shared');
    expect(config.BASE_SCOPES).toContain('Mail.Read');
    expect(config.BASE_SCOPES).toContain('offline_access');
  });

  it('SHARED_SCOPES contains exactly the two .Shared scopes', () => {
    expect(config.SHARED_SCOPES).toEqual([
      'Mail.Read.Shared',
      'Mail.ReadWrite.Shared',
    ]);
  });

  it('AUTH_CONFIG.scopes is base + shared (includes both .Shared)', () => {
    expect(config.AUTH_CONFIG.scopes).toContain('Mail.Read.Shared');
    expect(config.AUTH_CONFIG.scopes).toContain('Mail.ReadWrite.Shared');
    expect(config.AUTH_CONFIG.scopes).toEqual([
      ...config.BASE_SCOPES,
      ...config.SHARED_SCOPES,
    ]);
  });

  it('AUTH_CONFIG.fallbackScopes matches BASE_SCOPES content', () => {
    expect(config.AUTH_CONFIG.fallbackScopes).toEqual(config.BASE_SCOPES);
  });
});

describe('resolveRefreshScopes — refresh uses granted, not configured, scopes', () => {
  const FULL = [...config.BASE_SCOPES, ...config.SHARED_SCOPES];

  it('prefers granted_scopes (array) when present', () => {
    const tokens = { granted_scopes: config.BASE_SCOPES };
    const result = resolveRefreshScopes(tokens, FULL);
    expect(result).toEqual(config.BASE_SCOPES);
    expect(result).not.toContain('Mail.Read.Shared');
  });

  it('parses the scope string when granted_scopes is absent', () => {
    const tokens = { scope: 'offline_access User.Read Mail.Read' };
    const result = resolveRefreshScopes(tokens, FULL);
    expect(result).toEqual(['offline_access', 'User.Read', 'Mail.Read']);
  });

  it('falls back to configured scopes when neither granted_scopes nor scope exist', () => {
    const tokens = { access_token: 'x' };
    const result = resolveRefreshScopes(tokens, FULL);
    expect(result).toEqual(FULL);
  });

  it('falls back to configured scopes when tokens is null', () => {
    expect(resolveRefreshScopes(null, FULL)).toEqual(FULL);
  });

  it('ignores an empty granted_scopes array and falls through to scope string', () => {
    const tokens = { granted_scopes: [], scope: 'offline_access Mail.Read' };
    expect(resolveRefreshScopes(tokens, FULL)).toEqual([
      'offline_access',
      'Mail.Read',
    ]);
  });
});
