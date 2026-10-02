const {
  parseIsoInstant,
  toGraphDateTimeTimeZone,
  InvalidDateTimeError,
  zonedParts,
  zonedWallTimeToUtcMs,
} = require('../../utils/datetime');

describe('parseIsoInstant', () => {
  it('parses Z and offset instants to epoch ms', () => {
    expect(parseIsoInstant('2026-03-01T09:00:00Z')).toBe(
      Date.UTC(2026, 2, 1, 9)
    );
    expect(parseIsoInstant('2026-03-01T09:00:00+10:00')).toBe(
      Date.UTC(2026, 1, 28, 23)
    );
  });

  it.each([
    '2026-03-01T09:00:00',
    '2026-03-01',
    '2026-02-30T09:00:00Z',
    '1899-12-31T00:00:00Z',
    'soon',
    42,
  ])('returns NaN for %j', (value) => {
    expect(parseIsoInstant(value)).toBeNaN();
  });
});

describe('toGraphDateTimeTimeZone', () => {
  it('sends zoned values as UTC without a trailing Z', () => {
    expect(toGraphDateTimeTimeZone('2026-03-01T09:00:00+10:00', 'due')).toEqual(
      { dateTime: '2026-02-28T23:00:00', timeZone: 'UTC' }
    );
  });

  it('keeps naive values in the given timezone', () => {
    expect(
      toGraphDateTimeTimeZone('2026-03-01T09:00', 'due', 'Europe/London')
    ).toEqual({ dateTime: '2026-03-01T09:00', timeZone: 'Europe/London' });
  });

  it('throws InvalidDateTimeError naming the parameter', () => {
    expect(() => toGraphDateTimeTimeZone('tomorrow', 'dueDateTime')).toThrow(
      InvalidDateTimeError
    );
    expect(() => toGraphDateTimeTimeZone('tomorrow', 'dueDateTime')).toThrow(
      /Invalid dueDateTime/
    );
  });
});

describe('zone conversion', () => {
  it('converts wall-clock time in a zone to UTC on both sides of DST', () => {
    // Melbourne: AEST (+10) until 4 Oct 2026, then AEDT (+11).
    expect(
      zonedWallTimeToUtcMs('2026-10-01T09:00:00', 'Australia/Melbourne')
    ).toBe(Date.UTC(2026, 8, 30, 23));
    expect(
      zonedWallTimeToUtcMs('2026-10-05T09:00:00', 'Australia/Melbourne')
    ).toBe(Date.UTC(2026, 9, 4, 22));
  });

  it('returns NaN for an unknown zone', () => {
    expect(zonedWallTimeToUtcMs('2026-10-01T09:00:00', 'Not/AZone')).toBeNaN();
    expect(zonedParts(Date.UTC(2026, 0, 1), 'Not/AZone')).toBeNull();
  });

  it('reads wall-clock parts in a zone', () => {
    expect(
      zonedParts(Date.UTC(2026, 2, 1, 9), 'Australia/Melbourne')
    ).toMatchObject({ date: '2026-03-01', time: '20:00:00' });
  });
});
