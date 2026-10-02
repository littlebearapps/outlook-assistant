const {
  ATTENDEE_TYPES,
  normaliseAttendeeInput,
  buildAttendees,
} = require('../../calendar/attendees');
const { calendarTools } = require('../../calendar');
const { coerceArgsAgainstSchema } = require('../../utils/schema-coerce');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

// #249: attendee types (required / optional / resource) on create and update
describe('normaliseAttendeeInput', () => {
  it('accepts a plain email string with no type', () => {
    expect(normaliseAttendeeInput('a@example.com', 0)).toEqual({
      email: 'a@example.com',
      type: undefined,
    });
  });

  it('accepts {email, type} for each allowed type', () => {
    expect(ATTENDEE_TYPES).toEqual(['required', 'optional', 'resource']);
    for (const type of ATTENDEE_TYPES) {
      expect(
        normaliseAttendeeInput({ email: 'a@example.com', type }, 0)
      ).toEqual({ email: 'a@example.com', type });
    }
  });

  it('treats an object without a type like a string', () => {
    expect(normaliseAttendeeInput({ email: 'a@example.com' }, 0)).toEqual({
      email: 'a@example.com',
      type: undefined,
    });
  });

  it.each([
    [{ email: 'a@example.com', type: 'chair' }, /type 'chair'/],
    [{ email: 'a@example.com', type: 'Optional' }, /type 'Optional'/],
    [{ type: 'optional' }, /email/],
    [{ email: '   ' }, /email/],
    [{ email: 'a@example.com', name: 'A' }, /Unknown attendee field 'name'/],
    ['', /email/],
    [42, /email address or an \{email, type\} object/],
    [['a@example.com'], /email address or an \{email, type\} object/],
    [null, /email address or an \{email, type\} object/],
  ])('rejects %j', (entry, pattern) => {
    expect(() => normaliseAttendeeInput(entry, 2)).toThrow(
      /^Invalid attendee at position 3/
    );
    expect(() => normaliseAttendeeInput(entry, 2)).toThrow(pattern);
  });
});

describe('buildAttendees', () => {
  const current = [
    { type: 'optional', emailAddress: { address: 'Opt@Example.com' } },
    { type: 'resource', emailAddress: { address: 'room@example.com' } },
  ];

  it('defaults untyped entries to required when there is no current list', () => {
    expect(
      buildAttendees(['a@example.com', { email: 'b@example.com' }])
    ).toEqual([
      { emailAddress: { address: 'a@example.com' }, type: 'required' },
      { emailAddress: { address: 'b@example.com' }, type: 'required' },
    ]);
  });

  it('keeps the current type of an untyped entry (case-insensitive)', () => {
    expect(
      buildAttendees(
        ['opt@example.com', 'ROOM@example.com', 'n@example.com'],
        current
      )
    ).toEqual([
      { emailAddress: { address: 'opt@example.com' }, type: 'optional' },
      { emailAddress: { address: 'ROOM@example.com' }, type: 'resource' },
      { emailAddress: { address: 'n@example.com' }, type: 'required' },
    ]);
  });

  it('lets an explicit type win over the current type', () => {
    expect(
      buildAttendees([{ email: 'room@example.com', type: 'optional' }], current)
    ).toEqual([
      { emailAddress: { address: 'room@example.com' }, type: 'optional' },
    ]);
  });

  it('refuses a non-list', () => {
    expect(() => buildAttendees('a@example.com')).toThrow(
      /^Invalid attendees: expected a list/
    );
  });

  it('ignores malformed entries in the current list', () => {
    expect(
      buildAttendees(['a@example.com'], [null, {}, { emailAddress: {} }])
    ).toEqual([
      { emailAddress: { address: 'a@example.com' }, type: 'required' },
    ]);
  });
});

describe('attendee schemas and MCP-boundary coercion', () => {
  const manageEvent = calendarTools.find((t) => t.name === 'manage-event');
  const createEvent = calendarTools.find((t) => t.name === 'create-event');

  beforeEach(() => {
    callGraphAPI.mockReset();
    ensureAuthenticated.mockReset();
    ensureAuthenticated.mockResolvedValue('test_token');
  });

  it.each([
    ['manage-event', manageEvent],
    ['create-event', createEvent],
  ])('%s attendees items accept a string or {email, type}', (_name, tool) => {
    const { items } = tool.inputSchema.properties.attendees;
    expect(items.oneOf).toEqual([
      { type: 'string' },
      {
        type: 'object',
        properties: {
          email: { type: 'string' },
          type: { type: 'string', enum: ['required', 'optional', 'resource'] },
        },
        required: ['email'],
        additionalProperties: false,
      },
    ]);
  });

  it('manage-event update accepts a JSON-stringified array of typed attendees', async () => {
    callGraphAPI
      .mockResolvedValueOnce({
        attendees: [
          { type: 'optional', emailAddress: { address: 'opt@example.com' } },
        ],
      })
      .mockResolvedValueOnce({ id: 'evt_1' });

    const coerced = coerceArgsAgainstSchema(
      {
        action: 'update',
        eventId: 'evt_1',
        attendees: JSON.stringify([
          'opt@example.com',
          { email: 'room@example.com', type: 'resource' },
        ]),
      },
      manageEvent.inputSchema
    );
    expect(coerced.error).toBeUndefined();
    expect(coerced.args.attendees).toEqual([
      'opt@example.com',
      { email: 'room@example.com', type: 'resource' },
    ]);

    await manageEvent.handler(coerced.args);

    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    expect(callGraphAPI.mock.calls[1][1]).toBe('PATCH');
    expect(callGraphAPI.mock.calls[1][3].attendees).toEqual([
      { emailAddress: { address: 'opt@example.com' }, type: 'optional' },
      { emailAddress: { address: 'room@example.com' }, type: 'resource' },
    ]);
  });

  it('create-event accepts a JSON-stringified array of typed attendees', async () => {
    callGraphAPI.mockResolvedValue({ id: 'evt_new' });

    const coerced = coerceArgsAgainstSchema(
      {
        subject: 'S',
        start: '2026-12-03T10:00:00',
        end: '2026-12-03T10:30:00',
        attendees:
          '[{"email":"room@example.com","type":"resource"},"a@example.com"]',
      },
      createEvent.inputSchema
    );
    expect(coerced.error).toBeUndefined();

    await createEvent.handler(coerced.args);

    expect(callGraphAPI.mock.calls[0][3].attendees).toEqual([
      { emailAddress: { address: 'room@example.com' }, type: 'resource' },
      { emailAddress: { address: 'a@example.com' }, type: 'required' },
    ]);
  });

  it('an attendee object with an unknown field is refused by the handler', async () => {
    const coerced = coerceArgsAgainstSchema(
      {
        action: 'update',
        eventId: 'evt_1',
        attendees: [{ email: 'a@example.com', kind: 'optional' }],
      },
      manageEvent.inputSchema
    );
    // schema-coerce does not validate inside array items, so the handler must.
    const result = await manageEvent.handler(coerced.args);

    expect(result.content[0].text).toMatch(/Unknown attendee field 'kind'/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});
