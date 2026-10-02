/**
 * #118 — list-events timezone handling.
 *
 * Guards that event times are emitted as unambiguous canonical UTC ISO-8601
 * (with a labelled local rendering), never a bare zone-less local string that
 * a consumer could mis-interpret.
 */
const handleListEvents = require('../../calendar/list');
const { toUtcIso, formatLocal } = handleListEvents;
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('toUtcIso (#118 normalizer)', () => {
  it('appends Z to a zone-less UTC value (Graph default shape)', () => {
    expect(
      toUtcIso({ dateTime: '2026-04-02T22:00:00.0000000', timeZone: 'UTC' })
    ).toBe('2026-04-02T22:00:00.000Z');
  });

  it('passes through a value already ending in Z (no double-suffix)', () => {
    expect(
      toUtcIso({ dateTime: '2026-04-02T22:00:00Z', timeZone: 'UTC' })
    ).toBe('2026-04-02T22:00:00.000Z');
  });

  it('honours an explicit numeric offset (the reporter 3pm PDT case)', () => {
    // 3:00pm PDT (UTC-7) => 22:00:00Z — must NOT get a stray trailing Z.
    expect(
      toUtcIso({
        dateTime: '2026-04-02T15:00:00-07:00',
        timeZone: 'Pacific Standard Time',
      })
    ).toBe('2026-04-02T22:00:00.000Z');
  });

  it('throws on a zone-less value in a non-UTC zone (never guesses)', () => {
    expect(() =>
      toUtcIso({
        dateTime: '2026-04-02T15:00:00',
        timeZone: 'Pacific Standard Time',
      })
    ).toThrow(/non-UTC zone/);
  });

  it('throws on missing/invalid input', () => {
    expect(() => toUtcIso(undefined)).toThrow(/missing dateTime/);
    expect(() => toUtcIso({ dateTime: 'not-a-date', timeZone: 'UTC' })).toThrow(
      /invalid event dateTime/
    );
  });

  it('is independent of any display timezone (pure UTC)', () => {
    const a = toUtcIso({ dateTime: '2026-04-02T22:00:00', timeZone: 'UTC' });
    // Same instant regardless of server/mailbox zone — the value is UTC.
    expect(a).toBe('2026-04-02T22:00:00.000Z');
  });
});

describe('formatLocal (#118 labelled local rendering)', () => {
  const utc = '2026-04-02T22:00:00.000Z';

  it('labels the offset for a Melbourne display zone', () => {
    const s = formatLocal(utc, 'Australia/Melbourne');
    expect(s).toMatch(/GMT\+11:00/); // AEDT on 3 Apr 2026
    expect(s).toContain('9:00');
  });

  it('labels the offset for a Los Angeles display zone', () => {
    const s = formatLocal(utc, 'America/Los_Angeles');
    expect(s).toMatch(/GMT-07:00/); // PDT
    expect(s).toContain('3:00');
  });

  it('returns empty string for an unparseable instant', () => {
    expect(formatLocal('nope', 'UTC')).toBe('');
  });
});

describe('handleListEvents output contract (#118)', () => {
  const events = [
    {
      id: 'evt-1',
      subject: 'Design review',
      bodyPreview: 'notes',
      start: { dateTime: '2026-04-02T22:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-04-02T23:00:00.0000000', timeZone: 'UTC' },
      location: { displayName: 'Room 1' },
    },
  ];

  it('emits canonical UTC ISO Start/End plus a labelled local rendering', async () => {
    callGraphAPI.mockResolvedValue({ value: events });

    const result = await handleListEvents({});
    const text = result.content[0].text;

    expect(text).toContain('Start: 2026-04-02T22:00:00.000Z');
    expect(text).toContain('End: 2026-04-02T23:00:00.000Z');
    // Labelled local segment present with an explicit GMT offset.
    expect(text).toMatch(/GMT[+-]\d{2}:\d{2}/);
  });

  it('requests events from Graph in UTC via the Prefer header', async () => {
    callGraphAPI.mockResolvedValue({ value: events });

    await handleListEvents({});

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/events',
      null,
      expect.any(Object),
      { Prefer: 'outlook.timezone="UTC"' }
    );
  });

  it('does not crash on a malformed event time (falls back gracefully)', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'evt-bad',
          subject: 'Weird',
          bodyPreview: '',
          start: { dateTime: 'garbage', timeZone: 'UTC' },
          end: { dateTime: 'garbage', timeZone: 'UTC' },
          location: { displayName: 'X' },
        },
      ],
    });

    const result = await handleListEvents({});
    expect(result.content[0].text).toContain('Weird');
  });
});
