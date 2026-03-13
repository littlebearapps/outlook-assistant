const {
  formatEmailsAsCSV,
  escapeCSV,
} = require('../../utils/response-formatter');

// ──────────────────────────────────────────────────
// escapeCSV
// ──────────────────────────────────────────────────
describe('escapeCSV', () => {
  it('returns empty string for null and undefined', () => {
    expect(escapeCSV(null)).toBe('');
    expect(escapeCSV(undefined)).toBe('');
  });

  it('returns plain value unchanged when no special chars', () => {
    expect(escapeCSV('hello')).toBe('hello');
  });

  it('wraps value in quotes when it contains a comma', () => {
    expect(escapeCSV('Smith, John')).toBe('"Smith, John"');
  });

  it('wraps value in quotes and escapes inner quotes', () => {
    expect(escapeCSV('say "hello"')).toBe('"say ""hello"""');
  });

  it('wraps value in quotes when it contains a \n and \r', () => {
    expect(escapeCSV('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCSV('line1\rline2')).toBe('"line1\rline2"');
  });

  it('prefixes with single-quote when value starts with a tab character', () => {
    expect(escapeCSV('\t=formula')).toBe('"\'\t=formula"');
  });

  it('prefixes with single-quote when value starts with a newline character', () => {
    expect(escapeCSV('\n=formula')).toBe('"\'\n=formula"');
  });

  it('does not double-protect a safe value that happens to contain =', () => {
    // '=' not at start — should not be formula-protected
    expect(escapeCSV('a=b')).toBe('a=b');
  });

  // CSV injection protection
  it('prefixes with single-quote when value starts with formulaChar', () => {
    const result = escapeCSV('=CMD("cmd","/C calc")');
    const plusPrefixResult = escapeCSV('+1234');
    const minusPrefixResult = escapeCSV('-SUM(A1)');
    const atPrefixResult = escapeCSV('@SUM(1+1)');

    expect(result).toBe(`"'=CMD(""cmd"",""/C calc"")"`);
    expect(plusPrefixResult).toBe(`"'+1234"`);
    expect(minusPrefixResult).toBe(`"'-SUM(A1)"`);
    expect(atPrefixResult).toBe(`"'@SUM(1+1)"`);
  });
});

// ──────────────────────────────────────────────────
// formatEmailsAsCSV
// ──────────────────────────────────────────────────
describe('formatEmailsAsCSV', () => {
  const baseEmail = {
    id: 'email-1',
    subject: 'Hello World',
    from: { emailAddress: { name: 'John Doe', address: 'john@example.com' } },
    toRecipients: [
      { emailAddress: { name: 'Jane', address: 'jane@example.com' } },
    ],
    ccRecipients: [],
    receivedDateTime: '2024-01-15T10:00:00Z',
    isRead: false,
    importance: 'normal',
    hasAttachments: false,
  };

  it('returns a header row as the first line', () => {
    const csv = formatEmailsAsCSV(baseEmail);
    const firstLine = csv.split('\n')[0];

    expect(firstLine).toBe(
      'id,subject,from,to,cc,receivedDateTime,isRead,importance,hasAttachments'
    );
  });

  it('exports a single email object (not array)', () => {
    const csv = formatEmailsAsCSV(baseEmail);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(2); // header + 1 data row
  });

  it('exports an array of emails with one row per email', () => {
    const email2 = {
      ...baseEmail,
      id: 'email-2',
      subject: 'Second Email',
      from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
    };
    const csv = formatEmailsAsCSV([baseEmail, email2]);
    const lines = csv.split('\n');

    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('includes the correct field values in a data row', () => {
    const csv = formatEmailsAsCSV(baseEmail);
    const dataRow = csv.split('\n')[1];

    expect(dataRow).toContain('email-1');
    expect(dataRow).toContain('Hello World');
    expect(dataRow).toContain('john@example.com');
    expect(dataRow).toContain('false');
    expect(dataRow).toContain('normal');
  });

  describe('CSV escaping', () => {
    it('escapes commas in the subject field', () => {
      const email = { ...baseEmail, subject: 'Hello, World' };
      const csv = formatEmailsAsCSV(email);
      const dataRow = csv.split('\n')[1];

      expect(dataRow).toContain('"Hello, World"');
    });

    it('escapes double-quotes in sender name', () => {
      const email = {
        ...baseEmail,
        from: {
          emailAddress: {
            name: 'O\'Brien, "The Boss"',
            address: 'ob@example.com',
          },
        },
      };
      const csv = formatEmailsAsCSV(email);
      expect(csv).toContain('""The Boss""');
    });
  });

  describe('CSV injection protection', () => {
    it('protects against CSV injection in subject', () => {
      const email = {
        ...baseEmail,
        subject: '=HYPERLINK("http://evil.com","Click")',
      };
      const csv = formatEmailsAsCSV(email);
      expect(csv).toContain("'=HYPERLINK");
    });

    it('protects against CSV injection starting with +', () => {
      const email = { ...baseEmail, subject: '+cmd|/C calc' };
      const csv = formatEmailsAsCSV(email);
      expect(csv).toContain("'+cmd");
    });

    it('protects against CSV injection starting with -', () => {
      const email = { ...baseEmail, subject: '-2+3+cmd|' };
      const csv = formatEmailsAsCSV(email);
      expect(csv).toContain("'-2");
    });

    it('protects against CSV injection starting with @', () => {
      const email = { ...baseEmail, subject: '@SUM(1+1)*cmd|/C' };
      const csv = formatEmailsAsCSV(email);
      expect(csv).toContain("'@SUM");
    });
  });

  it('handles isRead=false and hasAttachments=false as explicit false strings', () => {
    const csv = formatEmailsAsCSV({
      ...baseEmail,
      isRead: false,
      hasAttachments: false,
    });

    expect(csv).toContain('false');

    const matches = csv.match(/false/g) || [];

    expect(matches).toHaveLength(2); // for both columns
  });

  it('handles isRead=true and hasAttachments=true', () => {
    const csv = formatEmailsAsCSV({
      ...baseEmail,
      isRead: true,
      hasAttachments: true,
    });

    expect(csv).toContain('true');

    const matches = csv.match(/true/g) || [];

    expect(matches).toHaveLength(2);
  });

  describe('missing/empty field handling', () => {
    it('handles missing from field gracefully', () => {
      const email = { ...baseEmail, from: undefined };
      const dataRow = formatEmailsAsCSV(email).split('\n')[1];

      expect(dataRow).toContain('Unknown'); // formatEmailAddress fallback
    });

    it('handles null/undefined subject gracefully', () => {
      const email = { ...baseEmail, subject: null };
      const fields = formatEmailsAsCSV(email).split('\n')[1].split(',');

      expect(fields[1]).toBe(''); // `subject` column is empty
    });

    it('handles missing toRecipients gracefully', () => {
      const email = { ...baseEmail, toRecipients: undefined };
      const fields = formatEmailsAsCSV(email).split('\n')[1].split(',');

      expect(fields[3]).toBe(''); // `to` column is empty
    });

    it('handles empty toRecipients and ccRecipients arrays', () => {
      const email = { ...baseEmail, toRecipients: [], ccRecipients: [] };
      const fields = formatEmailsAsCSV(email).split('\n')[1].split(',');

      expect(fields[3]).toBe(''); // `to` column is empty
      expect(fields[4]).toBe(''); // `cc` column is empty
    });

    it('handles null isRead and hasAttachments as empty strings', () => {
      const email = { ...baseEmail, isRead: null, hasAttachments: null };
      const fields = formatEmailsAsCSV(email).split('\n')[1].split(',');

      expect(fields[6]).toBe(''); // `isRead` column is empty
      expect(fields[8]).toBe(''); // `hasAttachments` column is empty
    });
  });
});
