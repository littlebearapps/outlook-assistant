const { buildMailboxPrefix } = require('../../utils/mailbox');

describe('mailbox', () => {
  describe('buildMailboxPrefix', () => {
    describe('absent mailbox falls back to the signed-in user', () => {
      test('returns "me" for null and undefined', () => {
        expect(buildMailboxPrefix(null)).toBe('me');
        expect(buildMailboxPrefix(undefined)).toBe('me');
        expect(buildMailboxPrefix()).toBe('me');
      });

      test('returns "me" for empty and whitespace-only strings', () => {
        expect(buildMailboxPrefix('')).toBe('me');
        expect(buildMailboxPrefix('   ')).toBe('me');
        expect(buildMailboxPrefix('\t\n')).toBe('me');
      });

      test('returns "me" when the caller passes "me" explicitly', () => {
        expect(buildMailboxPrefix('me')).toBe('me');
        expect(buildMailboxPrefix('  me  ')).toBe('me');
      });
    });

    describe('valid addresses', () => {
      test('builds users/{address} for a normal address', () => {
        expect(buildMailboxPrefix('shared@company.com')).toBe(
          'users/shared@company.com'
        );
      });

      test('accepts subdomains and multi-label domains', () => {
        expect(buildMailboxPrefix('team@mail.corp.example.co.uk')).toBe(
          'users/team@mail.corp.example.co.uk'
        );
      });

      test('accepts dots, dashes and underscores in the local part', () => {
        expect(buildMailboxPrefix('first.last_x-y@company.com')).toBe(
          'users/first.last_x-y@company.com'
        );
      });

      test('trims leading/trailing whitespace', () => {
        expect(buildMailboxPrefix('  shared@company.com  ')).toBe(
          'users/shared@company.com'
        );
        expect(buildMailboxPrefix('\tshared@company.com\n')).toBe(
          'users/shared@company.com'
        );
      });
    });

    describe('path-segment shape', () => {
      test('returns the address raw — encoding happens once, in the Graph client', () => {
        // Pre-encoding here would double-encode (`+` → `%2B` → `%252B`) once
        // callGraphAPI encodes each path segment.
        expect(buildMailboxPrefix('sales+alerts@company.com')).toBe(
          'users/sales+alerts@company.com'
        );
        expect(buildMailboxPrefix('a@b.com')).not.toContain('%');
      });

      test('output is always a two-segment users/ prefix', () => {
        const prefix = buildMailboxPrefix('sales+alerts@company.com');
        expect(prefix.startsWith('users/')).toBe(true);
        // Nothing after `users/` may introduce another path segment.
        expect(prefix.slice('users/'.length)).not.toContain('/');
      });
    });

    describe('rejects values that could escape the path segment', () => {
      test.each([
        ['forward slash', 'a@b.com/messages'],
        ['leading slash', '/etc/passwd'],
        ['query character', 'a@b.com?$select=id'],
        ['fragment character', 'a@b.com#frag'],
        ['percent escape', 'a%2Fb@company.com'],
        ['internal space', 'shared mailbox@company.com'],
        ['space before domain', 'a@ b.com'],
      ])('rejects %s', (_label, value) => {
        expect(() => buildMailboxPrefix(value)).toThrow(/Invalid mailbox/);
      });

      test('rejects a pre-built users/ prefix (passthrough removed)', () => {
        expect(() => buildMailboxPrefix('users/shared@company.com')).toThrow(
          /Invalid mailbox/
        );
        expect(() => buildMailboxPrefix('users/foo')).toThrow(
          /Invalid mailbox/
        );
      });

      test('rejects non-address junk', () => {
        expect(() => buildMailboxPrefix('notanemail')).toThrow(
          /Invalid mailbox/
        );
        expect(() => buildMailboxPrefix('missing-domain@')).toThrow(
          /Invalid mailbox/
        );
        expect(() => buildMailboxPrefix('@missing-local.com')).toThrow(
          /Invalid mailbox/
        );
        expect(() => buildMailboxPrefix('no@dot')).toThrow(/Invalid mailbox/);
        expect(() => buildMailboxPrefix('two@at@signs.com')).toThrow(
          /Invalid mailbox/
        );
      });

      test('rejects a bare user GUID (schemas advertise addresses only)', () => {
        expect(() =>
          buildMailboxPrefix('48d31887-5fad-4d73-a9f5-3c356e68a038')
        ).toThrow(/Invalid mailbox/);
      });

      test('error message names the offending value', () => {
        expect(() => buildMailboxPrefix('users/foo')).toThrow(/users\/foo/);
      });
    });
  });
});
