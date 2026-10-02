/**
 * Azure AD (AADSTS) error translation (#69).
 */
const {
  getAuthErrorHints,
  describeAuthError,
} = require('../../auth/auth-errors');

describe('getAuthErrorHints', () => {
  describe('AADSTS7000215 — invalid client secret', () => {
    const RAW =
      'AADSTS7000215: Invalid client secret provided. Ensure the secret being sent in the request is the client secret value, not the client secret ID, for a secret added to app.';

    it('returns a hint', () => {
      expect(getAuthErrorHints(RAW).length).toBeGreaterThan(0);
    });

    it('explains the Secret ID vs Secret Value mistake', () => {
      const hint = getAuthErrorHints(RAW).join('\n');
      expect(hint).toMatch(/Secret ID/i);
      expect(hint).toMatch(/Value/);
    });

    it('names the environment variable to fix', () => {
      expect(getAuthErrorHints(RAW).join('\n')).toContain(
        'OUTLOOK_CLIENT_SECRET'
      );
    });

    it('points at where in Azure to find it', () => {
      expect(getAuthErrorHints(RAW).join('\n')).toMatch(
        /Certificates & secrets/i
      );
    });

    it('mentions that an expired secret produces the same error', () => {
      expect(getAuthErrorHints(RAW).join('\n')).toMatch(/expire/i);
    });

    it('matches the bare error code without the description', () => {
      expect(getAuthErrorHints('AADSTS7000215').length).toBeGreaterThan(0);
    });

    it('is case-insensitive', () => {
      expect(getAuthErrorHints('aadsts7000215').length).toBeGreaterThan(0);
    });

    it('accepts an Error instance as well as a string', () => {
      expect(getAuthErrorHints(new Error(RAW)).length).toBeGreaterThan(0);
    });
  });

  describe('other known codes', () => {
    it('maps AADSTS9002331 to the audience hint', () => {
      expect(getAuthErrorHints('AADSTS9002331').join('\n')).toContain(
        'OUTLOOK_AUTH_AUDIENCE'
      );
    });

    it('maps AADSTS7000218 to the public-client-flows hint', () => {
      expect(getAuthErrorHints('AADSTS7000218').join('\n')).toMatch(
        /public client flows/i
      );
    });

    it('maps AADSTS700016 (unknown application) to a client-id hint', () => {
      // Deliberately not an alternation — this table feeds real auth error
      // responses, and `/A|B/` would let a future wrong hint pass CI.
      expect(getAuthErrorHints('AADSTS700016').join('\n')).toMatch(
        /OUTLOOK_CLIENT_ID/
      );
    });

    it('maps invalid_grant to a re-authentication hint', () => {
      expect(getAuthErrorHints('invalid_grant').join('\n')).toMatch(
        /re-?authenticat/i
      );
    });
  });

  describe('unknown errors', () => {
    it('returns no hints rather than guessing', () => {
      expect(getAuthErrorHints('something entirely unexpected')).toEqual([]);
    });

    it('handles null and undefined safely', () => {
      expect(getAuthErrorHints(null)).toEqual([]);
      expect(getAuthErrorHints(undefined)).toEqual([]);
    });
  });

  it('suppresses the generic invalid_client hint when 7000215 is present', () => {
    const h = getAuthErrorHints(
      'invalid_client: AADSTS7000215: Invalid client secret provided.'
    ).join('\n');
    expect(h).toContain('Secret ID');
    expect(h).not.toMatch(/public client flows/i);
  });

  it('still gives the public-client hint for a bare invalid_client', () => {
    expect(getAuthErrorHints('invalid_client').join('\n')).toMatch(
      /public client flows/i
    );
  });

  it('does not confuse 7000215 with 7000218', () => {
    const h = getAuthErrorHints('AADSTS7000218').join('\n');
    expect(h).not.toMatch(/Secret ID/i);
  });
});

describe('describeAuthError', () => {
  const RAW = 'AADSTS7000215: Invalid client secret provided.';

  it('preserves the original message verbatim', () => {
    expect(describeAuthError(RAW)).toContain(RAW);
  });

  it('appends the actionable hint after the original message', () => {
    const out = describeAuthError(RAW);
    expect(out.indexOf('Secret ID')).toBeGreaterThan(out.indexOf(RAW));
  });

  it('returns the message unchanged when nothing is known', () => {
    expect(describeAuthError('Bad auth code')).toBe('Bad auth code');
  });

  it('accepts an Error and returns a string', () => {
    expect(typeof describeAuthError(new Error(RAW))).toBe('string');
  });
});
