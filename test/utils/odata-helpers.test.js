const {
  escapeODataString,
  escapeSearchPhrase,
  quoteSearchPhrase,
  isWholeQuotedSearch,
  quoteSearchExpression,
} = require('../../utils/odata-helpers');

describe('escapeSearchPhrase', () => {
  test('backslash-escapes double quotes', () => {
    expect(escapeSearchPhrase('Sam "the man" Lee')).toBe(
      'Sam \\"the man\\" Lee'
    );
  });

  test('doubles a backslash', () => {
    expect(escapeSearchPhrase('a\\b')).toBe('a\\\\b');
  });

  test('escapes backslashes before quotes so an escape is not re-escaped', () => {
    // `\"` → `\\` + `\"` (an escaped backslash, then an escaped quote)
    expect(escapeSearchPhrase('\\"')).toBe('\\\\\\"');
  });

  test('leaves plain text and single quotes unchanged', () => {
    expect(escapeSearchPhrase("Jane O'Neil")).toBe("Jane O'Neil");
  });

  test('passes empty values through', () => {
    expect(escapeSearchPhrase('')).toBe('');
    expect(escapeSearchPhrase(undefined)).toBeUndefined();
  });
});

describe('quoteSearchPhrase', () => {
  test('wraps escaped text in double quotes', () => {
    expect(quoteSearchPhrase('Sam "the man" Lee')).toBe(
      '"Sam \\"the man\\" Lee"'
    );
  });

  test('quotes plain text unchanged', () => {
    expect(quoteSearchPhrase('invoice')).toBe('"invoice"');
  });

  test('a trailing backslash cannot escape the closing quote', () => {
    expect(quoteSearchPhrase('path\\')).toBe('"path\\\\"');
  });
});

describe('escapeODataString', () => {
  test('still only doubles single quotes', () => {
    expect(escapeODataString('O\'Neil "x" \\')).toBe('O\'\'Neil "x" \\');
  });
});

// #333: Graph reads KQL (field scopes, operators, comparisons) only inside one
// pair of double quotes. Measured on a personal mailbox: unquoted `from:x` is a
// 400, and an unquoted multi-word expression returns recent mail unfiltered.
describe('isWholeQuotedSearch', () => {
  test.each([
    ['"invoice"'],
    ['"from:example.com AND received>=2026-01-01"'],
    ['"subject:\\"reset your password\\""'],
    ['"a\\\\"'],
    ['""'],
  ])('true for one quoted string: %s', (expr) => {
    expect(isWholeQuotedSearch(expr)).toBe(true);
  });

  test.each([
    ['invoice'],
    ['from:example.com'],
    ['subject:"reset your password"'],
    ['"invoice" OR "receipt"'],
    ['"reset" "password"'],
    ['"unterminated'],
    ['unopened"'],
    ['"'],
    ['"ends with an escaped quote\\"'],
    [''],
  ])('false otherwise: %s', (expr) => {
    expect(isWholeQuotedSearch(expr)).toBe(false);
  });
});

describe('quoteSearchExpression', () => {
  test('leaves an expression that is already one quoted string alone', () => {
    expect(quoteSearchExpression('"from:example.com"')).toBe(
      '"from:example.com"'
    );
    expect(quoteSearchExpression('"subject:\\"a b\\""')).toBe(
      '"subject:\\"a b\\""'
    );
  });

  test('wraps field scopes, operators and comparisons in one pair of quotes', () => {
    expect(quoteSearchExpression('from:example.com')).toBe(
      '"from:example.com"'
    );
    expect(quoteSearchExpression('invoice AND received<2023-01-01')).toBe(
      '"invoice AND received<2023-01-01"'
    );
    expect(quoteSearchExpression('invoice')).toBe('"invoice"');
  });

  test('escapes the caller’s own quotes and backslashes when it wraps', () => {
    expect(quoteSearchExpression('subject:"reset your password"')).toBe(
      '"subject:\\"reset your password\\""'
    );
    expect(quoteSearchExpression('"invoice" OR "receipt"')).toBe(
      '"\\"invoice\\" OR \\"receipt\\""'
    );
    expect(quoteSearchExpression('C:\\Reports')).toBe('"C:\\\\Reports"');
  });
});
