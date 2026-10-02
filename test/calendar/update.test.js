const handleUpdateEvent = require('../../calendar/update');
const { DEFAULT_TIMEZONE } = require('../../config');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

/**
 * Pull the PATCH body from a callGraphAPI invocation by name rather than
 * positional index. Documents the expected (accessToken, method, endpoint,
 * body) contract in one place — if the signature changes, only this helper
 * needs updating instead of every test.
 */
function patchBodyOf(call) {
  const [, method, , body] = call;
  expect(method).toBe('PATCH');
  return body;
}

describe('handleUpdateEvent', () => {
  beforeEach(() => {
    // mockReset() (vs mockClear()) clears both call history AND mock
    // implementations, so validation-only tests below can't accidentally
    // pass because an earlier test left ensureAuthenticated resolved.
    callGraphAPI.mockReset();
    ensureAuthenticated.mockReset();
  });

  test('returns error when eventId is missing', async () => {
    const result = await handleUpdateEvent({ subject: 'foo' });
    expect(result.content[0].text).toBe(
      'Event ID is required to update an event.'
    );
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('returns error when no updatable fields are provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    const result = await handleUpdateEvent({ eventId: 'evt_1' });
    expect(result.content[0].text).toMatch(/No fields to update/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('PATCHes only the subject when subject-only update is requested', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1', subject: 'New' });

    await handleUpdateEvent({ eventId: 'evt_1', subject: 'New' });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const [, method, endpoint, body] = callGraphAPI.mock.calls[0];
    expect(method).toBe('PATCH');
    expect(endpoint).toBe('me/events/evt_1');
    expect(body).toEqual({ subject: 'New' });
  });

  test('uses default timezone when start is provided without timezone', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      start: '2026-05-12T10:00:00',
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.start.dateTime).toBe('2026-05-12T10:00:00');
    expect(body.start.timeZone).toBe(DEFAULT_TIMEZONE);
    expect(body.end).toBeUndefined();
  });

  test('honours explicit timezone on start when provided as object', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      start: { dateTime: '2026-05-12T10:00:00', timeZone: 'Europe/London' },
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.start.timeZone).toBe('Europe/London');
  });

  test('updates end with default timezone when string is provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      end: '2026-05-12T17:00:00',
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.end.dateTime).toBe('2026-05-12T17:00:00');
    expect(body.end.timeZone).toBe(DEFAULT_TIMEZONE);
    expect(body.start).toBeUndefined();
  });

  test('replaces the attendee list when attendees is provided', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI
      .mockResolvedValueOnce({ id: 'evt_1', attendees: [] })
      .mockResolvedValueOnce({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: ['alice@example.com', 'bob@example.com'],
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    const body = patchBodyOf(callGraphAPI.mock.calls[1]);
    expect(body.attendees).toEqual([
      { emailAddress: { address: 'alice@example.com' }, type: 'required' },
      { emailAddress: { address: 'bob@example.com' }, type: 'required' },
    ]);
  });

  test('clears attendees when an empty array is passed', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', attendees: [] });

    // [] needs no current-type lookup: a single PATCH, no GET.
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.attendees).toEqual([]);
  });

  // ── Attendee types (#249) ────────────────────────────────────────────

  const CURRENT_ATTENDEES = {
    id: 'evt_1',
    attendees: [
      {
        type: 'optional',
        emailAddress: { name: 'Opt', address: 'opt@example.com' },
        status: { response: 'none' },
      },
      {
        type: 'resource',
        emailAddress: { name: 'Room', address: 'room@example.com' },
        status: { response: 'none' },
      },
    ],
  };

  test('string attendees keep the type they already have on the event', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI
      .mockResolvedValueOnce(CURRENT_ATTENDEES)
      .mockResolvedValueOnce({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: ['opt@example.com', 'room@example.com', 'new@example.com'],
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    const [, getMethod, getEndpoint, getBody, getQuery] =
      callGraphAPI.mock.calls[0];
    expect(getMethod).toBe('GET');
    expect(getEndpoint).toBe('me/events/evt_1');
    expect(getBody).toBeNull();
    expect(getQuery).toEqual({ $select: 'attendees' });

    const body = patchBodyOf(callGraphAPI.mock.calls[1]);
    expect(body.attendees).toEqual([
      { emailAddress: { address: 'opt@example.com' }, type: 'optional' },
      { emailAddress: { address: 'room@example.com' }, type: 'resource' },
      { emailAddress: { address: 'new@example.com' }, type: 'required' },
    ]);
  });

  test('matches current attendees case-insensitively', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI
      .mockResolvedValueOnce(CURRENT_ATTENDEES)
      .mockResolvedValueOnce({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: ['OPT@Example.com', 'Room@EXAMPLE.com'],
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[1]);
    expect(body.attendees).toEqual([
      { emailAddress: { address: 'OPT@Example.com' }, type: 'optional' },
      { emailAddress: { address: 'Room@EXAMPLE.com' }, type: 'resource' },
    ]);
  });

  test('fully typed attendees are sent as given without reading the event', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: [
        { email: 'opt@example.com', type: 'required' },
        { email: 'room@example.com', type: 'resource' },
        { email: 'x@example.com', type: 'optional' },
      ],
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.attendees).toEqual([
      { emailAddress: { address: 'opt@example.com' }, type: 'required' },
      { emailAddress: { address: 'room@example.com' }, type: 'resource' },
      { emailAddress: { address: 'x@example.com' }, type: 'optional' },
    ]);
  });

  test('an explicit type wins over the current type; untyped entries look it up', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI
      .mockResolvedValueOnce(CURRENT_ATTENDEES)
      .mockResolvedValueOnce({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: [
        { email: 'opt@example.com', type: 'required' },
        { email: 'room@example.com' },
      ],
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    const body = patchBodyOf(callGraphAPI.mock.calls[1]);
    expect(body.attendees).toEqual([
      { emailAddress: { address: 'opt@example.com' }, type: 'required' },
      { emailAddress: { address: 'room@example.com' }, type: 'resource' },
    ]);
  });

  test('rejects an invalid attendee type before any Graph call', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: [{ email: 'a@example.com', type: 'chair' }],
    });

    expect(result.content[0].text).toMatch(/Invalid attendee/);
    expect(result.content[0].text).toMatch(/chair/);
    expect(ensureAuthenticated).not.toHaveBeenCalled();
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('dryRun reads current attendees and previews the resolved types without PATCHing', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValueOnce(CURRENT_ATTENDEES);

    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: ['opt@example.com', 'room@example.com', 'new@example.com'],
      dryRun: true,
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPI.mock.calls[0][1]).toBe('GET');
    expect(result.content[0].text).toMatch(/Dry run/);
    expect(result.content[0].text).toMatch(/"type": "optional"/);
    expect(result.content[0].text).toMatch(/"type": "resource"/);
    expect(result._meta.patch.attendees).toEqual([
      { emailAddress: { address: 'opt@example.com' }, type: 'optional' },
      { emailAddress: { address: 'room@example.com' }, type: 'resource' },
      { emailAddress: { address: 'new@example.com' }, type: 'required' },
    ]);
  });

  test('a failed attendee lookup stops the update', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockRejectedValueOnce(
      new Error('API call failed with status 404: not found')
    );

    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      attendees: ['a@example.com'],
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPI.mock.calls[0][1]).toBe('GET');
    expect(result.content[0].text).toMatch(/^Error updating event: /);
    expect(result.content[0].text).toMatch(/status 404/);
  });

  test('updates body as HTML content', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      body: 'New notes',
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.body).toEqual({ contentType: 'HTML', content: 'New notes' });
  });

  test('updates location as displayName', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      location: '16 Apex Drive',
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.location).toEqual({ displayName: '16 Apex Drive' });
  });

  test('combines multiple fields in a single PATCH', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1', subject: 'Reschedule' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      subject: 'Reschedule',
      start: '2026-05-12T10:00:00',
      end: '2026-05-12T17:00:00',
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.subject).toBe('Reschedule');
    expect(body.start.dateTime).toBe('2026-05-12T10:00:00');
    expect(body.end.dateTime).toBe('2026-05-12T17:00:00');
  });

  test('handles authentication errors with the standard message', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      subject: 'New',
    });
    expect(result.content[0].text).toBe(
      "Authentication required. Please use the 'authenticate' tool first."
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('surfaces Graph API errors to the caller', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockRejectedValue(new Error('Graph API exploded'));

    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      subject: 'New',
    });
    expect(result.content[0].text).toBe(
      'Error updating event: Graph API exploded'
    );
  });

  test('reports which fields were changed in the success output', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1', subject: 'Reschedule' });

    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      subject: 'Reschedule',
      location: '16 Apex Drive',
    });

    const text = result.content[0].text;
    expect(text).toMatch(/updated successfully/);
    expect(text).toMatch(/Fields changed:.*subject/);
    expect(text).toMatch(/Fields changed:.*location/);
    expect(result._meta.fieldsChanged).toEqual(
      expect.arrayContaining(['subject', 'location'])
    );
  });

  // ── Extended fields per issue #124 ───────────────────────────────────

  test('updates isOnlineMeeting flag', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', isOnlineMeeting: true });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.isOnlineMeeting).toBe(true);
  });

  test('coerces truthy/falsy isOnlineMeeting to a real boolean', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', isOnlineMeeting: 0 });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.isOnlineMeeting).toBe(false);
  });

  test('updates sensitivity when value is allowed', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', sensitivity: 'private' });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.sensitivity).toBe('private');
  });

  test('rejects an invalid sensitivity value', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      sensitivity: 'top-secret',
    });
    expect(result.content[0].text).toMatch(/Invalid sensitivity/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('updates showAs when value is allowed', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', showAs: 'tentative' });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.showAs).toBe('tentative');
  });

  test('rejects an invalid showAs value', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      showAs: 'distracted',
    });
    expect(result.content[0].text).toMatch(/Invalid showAs/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('updates importance when value is allowed', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', importance: 'high' });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.importance).toBe('high');
  });

  test('rejects an invalid importance value', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      importance: 'urgent',
    });
    expect(result.content[0].text).toMatch(/Invalid importance/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('replaces categories with the supplied list', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      categories: ['Personal', 'Travel'],
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.categories).toEqual(['Personal', 'Travel']);
  });

  test('clears categories when an empty array is passed', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({ eventId: 'evt_1', categories: [] });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.categories).toEqual([]);
  });

  test('updates reminderMinutesBeforeStart when given a valid number', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');
    callGraphAPI.mockResolvedValue({ id: 'evt_1' });

    await handleUpdateEvent({
      eventId: 'evt_1',
      reminderMinutesBeforeStart: 30,
    });

    const body = patchBodyOf(callGraphAPI.mock.calls[0]);
    expect(body.reminderMinutesBeforeStart).toBe(30);
  });

  test('rejects a negative reminderMinutesBeforeStart', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      reminderMinutesBeforeStart: -5,
    });
    expect(result.content[0].text).toMatch(
      /Invalid reminderMinutesBeforeStart/
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('rejects a non-numeric reminderMinutesBeforeStart', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      reminderMinutesBeforeStart: 'soon',
    });
    expect(result.content[0].text).toMatch(
      /Invalid reminderMinutesBeforeStart/
    );
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  // ── dryRun ───────────────────────────────────────────────────────────

  test('dryRun returns the patch payload without calling Graph', async () => {
    ensureAuthenticated.mockResolvedValue('dummy_access_token');

    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      subject: 'Preview',
      importance: 'high',
      dryRun: true,
    });

    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/Dry run/);
    expect(result.content[0].text).toMatch(/Preview/);
    expect(result.content[0].text).toMatch(/high/);
    expect(result._meta.dryRun).toBe(true);
    expect(result._meta.patch).toEqual({
      subject: 'Preview',
      importance: 'high',
    });
    expect(result._meta.fieldsChanged).toEqual(
      expect.arrayContaining(['subject', 'importance'])
    );
  });

  test('dryRun still rejects invalid enum values before responding', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      sensitivity: 'top-secret',
      dryRun: true,
    });
    expect(result.content[0].text).toMatch(/Invalid sensitivity/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('dryRun still requires at least one updatable field', async () => {
    const result = await handleUpdateEvent({
      eventId: 'evt_1',
      dryRun: true,
    });
    expect(result.content[0].text).toMatch(/No fields to update/);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});
