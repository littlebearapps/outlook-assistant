const {
  escapeODataString,
  escapeSearchPhrase,
  quoteSearchPhrase,
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
