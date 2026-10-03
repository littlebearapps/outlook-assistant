/**
 * OUTLOOK_READ_ONLY parsing (#271).
 *
 * Off unless set. Recognised "on" values are true/1/yes/on, in any case.
 * A value that is neither on nor off fails closed: read-only mode turns on,
 * with a warning, because whoever set it meant to restrict the server.
 */
const { parseReadOnly } = require('../config');

describe('parseReadOnly', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  test.each([undefined, '', '  '])('%p is off', (raw) => {
    expect(parseReadOnly(raw)).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test.each(['true', 'TRUE', 'True', '1', 'yes', 'YES', 'on', ' true '])(
    '%p is on',
    (raw) => {
      expect(parseReadOnly(raw)).toBe(true);
      expect(console.warn).not.toHaveBeenCalled();
    }
  );

  test.each(['false', 'FALSE', '0', 'no', 'off'])('%p is off', (raw) => {
    expect(parseReadOnly(raw)).toBe(false);
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('an unrecognised value fails closed, with a warning', () => {
    expect(parseReadOnly('ture')).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/OUTLOOK_READ_ONLY="ture".*read-only mode is on/)
    );
  });

  test('the warning lists every accepted value', () => {
    parseReadOnly('ture');
    const [message] = console.warn.mock.calls[0];
    expect(message).toContain('true, 1, yes or on');
    expect(message).toContain('false, 0, no or off');
  });

  test('the warning redacts personal data in the value', () => {
    parseReadOnly('jane.doe@example.com');
    const [message] = console.warn.mock.calls[0];
    expect(message).not.toContain('jane.doe@example.com');
    expect(message).toContain('<redacted-email>');
  });
});

describe('config.READ_ONLY', () => {
  let original;

  beforeEach(() => {
    original = process.env.OUTLOOK_READ_ONLY;
    jest.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.OUTLOOK_READ_ONLY;
    else process.env.OUTLOOK_READ_ONLY = original;
    jest.resetModules();
  });

  test('is off by default', () => {
    delete process.env.OUTLOOK_READ_ONLY;
    expect(require('../config').READ_ONLY).toBe(false);
  });

  test('reads OUTLOOK_READ_ONLY', () => {
    process.env.OUTLOOK_READ_ONLY = 'yes';
    expect(require('../config').READ_ONLY).toBe(true);
  });
});
