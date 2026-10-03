/**
 * Recipient allowlist and rate limit on every draft path that can lead to a
 * message going out: send re-checks the draft's current to/cc/bcc, reply and
 * reply-all check the recipients Graph fills in, and reply/reply-all/forward
 * count against the `draft` rate limit.
 *
 * Modules are reloaded per test so each one starts with fresh rate-limit
 * counters.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const ENV_KEYS = [
  'OUTLOOK_ALLOWED_RECIPIENTS',
  'OUTLOOK_MAX_DRAFT_PER_SESSION',
  'OUTLOOK_MAX_SEND_EMAIL_PER_SESSION',
  'OUTLOOK_MAX_EMAILS_PER_SESSION',
];

const recipient = (address) => ({ emailAddress: { name: address, address } });

let handleDraft;
let callGraphAPI;
let savedEnv;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  jest.resetModules();
  handleDraft = require('../../email/draft');
  ({ callGraphAPI } = require('../../utils/graph-api'));
  require('../../auth').ensureAuthenticated.mockResolvedValue('test_token');
  jest.spyOn(console, 'error').mockImplementation();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  console.error.mockRestore();
});

/** Graph mock: GET returns `draft`; any other call succeeds with `other`. */
function draftLookup(draft, other) {
  callGraphAPI.mockImplementation((_t, method) =>
    Promise.resolve(method === 'GET' ? draft : other)
  );
}

const sendCalls = () =>
  callGraphAPI.mock.calls.filter(
    ([, method, endpoint]) => method === 'POST' && endpoint.endsWith('/send')
  );

// ──────────────────────────────────────────────────
// action=send re-checks the draft's current recipients
// ──────────────────────────────────────────────────
describe('draft action=send checks the current recipients', () => {
  const baseDraft = {
    id: 'draft-1',
    isDraft: true,
    subject: 'Plans',
    toRecipients: [recipient('alice@example.com')],
    ccRecipients: [],
    bccRecipients: [],
  };

  test('asks Graph for to/cc/bcc in the draft lookup', async () => {
    draftLookup(baseDraft);
    await handleDraft({ action: 'send', id: 'draft-1' });

    const [, method, endpoint, , query] = callGraphAPI.mock.calls[0];
    expect(method).toBe('GET');
    expect(endpoint).toBe('me/messages/draft-1');
    for (const field of ['toRecipients', 'ccRecipients', 'bccRecipients']) {
      expect(query.$select.split(',')).toContain(field);
    }
  });

  test.each(['toRecipients', 'ccRecipients', 'bccRecipients'])(
    'refuses when %s holds an address outside the allowlist',
    async (field) => {
      process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
      draftLookup({
        ...baseDraft,
        [field]: [...baseDraft[field], recipient('mallory@elsewhere.test')],
      });

      const result = await handleDraft({ action: 'send', id: 'draft-1' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('mallory@elsewhere.test');
      expect(result.content[0].text).toContain('not sent');
      expect(result.content[0].text).toContain('OUTLOOK_ALLOWED_RECIPIENTS');
      expect(sendCalls()).toHaveLength(0);
    }
  );

  test('sends when every recipient is allowed', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com,bob@partner.test';
    draftLookup({
      ...baseDraft,
      ccRecipients: [recipient('bob@partner.test')],
      bccRecipients: [recipient('Carol@Example.com')],
    });

    const result = await handleDraft({ action: 'send', id: 'draft-1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Draft sent successfully');
    expect(sendCalls()).toHaveLength(1);
  });

  test('a refused send does not use a send-email rate-limit slot', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION = '1';
    draftLookup({
      ...baseDraft,
      toRecipients: [recipient('mallory@elsewhere.test')],
    });
    const refused = await handleDraft({ action: 'send', id: 'draft-1' });
    expect(refused.isError).toBe(true);

    draftLookup(baseDraft);
    const allowed = await handleDraft({ action: 'send', id: 'draft-1' });
    expect(allowed.isError).toBeUndefined();
    expect(sendCalls()).toHaveLength(1);
  });

  test('without an allowlist any recipient is sent as before', async () => {
    draftLookup({
      ...baseDraft,
      bccRecipients: [recipient('anyone@anywhere.test')],
    });

    const result = await handleDraft({ action: 'send', id: 'draft-1' });

    expect(result.isError).toBeUndefined();
    expect(sendCalls()).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────────
// reply / reply-all check the recipients Graph fills in
// ──────────────────────────────────────────────────
describe('draft action=reply/reply-all checks the generated recipients', () => {
  const created = (extra = {}) => ({
    id: 'reply-draft-1',
    isDraft: true,
    subject: 'RE: Plans',
    toRecipients: [recipient('alice@example.com')],
    ccRecipients: [],
    bccRecipients: [],
    ...extra,
  });

  /** Graph mock for create-then-maybe-delete. */
  function replyGraph(draft, { deleteError } = {}) {
    callGraphAPI.mockImplementation((_t, method) => {
      if (method === 'POST') return Promise.resolve(draft);
      if (method === 'DELETE') {
        return deleteError
          ? Promise.reject(deleteError)
          : Promise.resolve(undefined);
      }
      return Promise.resolve(draft);
    });
  }

  const deleteCalls = () =>
    callGraphAPI.mock.calls.filter(([, method]) => method === 'DELETE');

  test('reply-all with a participant outside the allowlist deletes the new draft and refuses', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    replyGraph(created({ ccRecipients: [recipient('eve@outside.test')] }));

    const result = await handleDraft({ action: 'reply-all', id: 'msg-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('eve@outside.test');
    expect(result.content[0].text).toContain('OUTLOOK_ALLOWED_RECIPIENTS');
    expect(result.content[0].text).toMatch(/deleted/i);
    expect(deleteCalls()).toEqual([
      ['test_token', 'DELETE', 'me/messages/reply-draft-1'],
    ]);
  });

  test('reply to a sender outside the allowlist deletes the new draft and refuses', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    replyGraph(created({ toRecipients: [recipient('eve@outside.test')] }));

    const result = await handleDraft({ action: 'reply', id: 'msg-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('eve@outside.test');
    expect(deleteCalls()).toHaveLength(1);
  });

  test('if the delete fails it still refuses and gives the draft id to remove', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    replyGraph(created({ toRecipients: [recipient('eve@outside.test')] }), {
      deleteError: new Error('API call failed with status 503: busy'),
    });

    const result = await handleDraft({ action: 'reply-all', id: 'msg-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('eve@outside.test');
    expect(result.content[0].text).toContain('reply-draft-1');
    expect(result.content[0].text).toContain('could not be deleted');
    expect(result.content[0].text).toContain('action=delete');
  });

  test('fetches the recipients when Graph returns a draft without them', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    callGraphAPI.mockImplementation((_t, method) => {
      if (method === 'POST') return Promise.resolve({ id: 'reply-draft-1' });
      if (method === 'GET') {
        return Promise.resolve(
          created({ ccRecipients: [recipient('eve@outside.test')] })
        );
      }
      return Promise.resolve(undefined);
    });

    const result = await handleDraft({ action: 'reply-all', id: 'msg-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('eve@outside.test');
    expect(deleteCalls()).toHaveLength(1);
  });

  test('deletes the draft and refuses when its recipients cannot be fetched', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    callGraphAPI.mockImplementation((_t, method) => {
      if (method === 'POST') return Promise.resolve({ id: 'reply-draft-1' });
      if (method === 'GET') {
        return Promise.reject(new Error('API call failed with status 500'));
      }
      return Promise.resolve(undefined);
    });

    const result = await handleDraft({ action: 'reply', id: 'msg-1' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('could not be checked');
    expect(deleteCalls()).toHaveLength(1);
  });

  test('keeps the draft when every recipient is allowed', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    replyGraph(created({ ccRecipients: [recipient('bob@example.com')] }));

    const result = await handleDraft({ action: 'reply-all', id: 'msg-1' });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('reply-all draft created');
    expect(deleteCalls()).toHaveLength(0);
  });

  test('without an allowlist the draft is kept, with no extra Graph calls', async () => {
    replyGraph(created({ ccRecipients: [recipient('eve@outside.test')] }));

    const result = await handleDraft({ action: 'reply-all', id: 'msg-1' });

    expect(result.isError).toBeUndefined();
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────
// reply / reply-all / forward count against the draft rate limit
// ──────────────────────────────────────────────────
describe('draft rate limit covers reply, reply-all and forward', () => {
  const extraArgs = {
    reply: {},
    'reply-all': {},
    forward: { to: 'alice@example.com' },
  };

  test.each(['reply', 'reply-all', 'forward'])(
    'action=%s is refused once the draft limit is used up',
    async (action) => {
      process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '1';
      callGraphAPI.mockResolvedValue({
        id: 'd1',
        toRecipients: [recipient('alice@example.com')],
        ccRecipients: [],
        bccRecipients: [],
      });

      const first = await handleDraft({
        action,
        id: 'msg-1',
        ...extraArgs[action],
      });
      expect(first.isError).toBeUndefined();

      const second = await handleDraft({
        action,
        id: 'msg-1',
        ...extraArgs[action],
      });
      expect(second.isError).toBe(true);
      expect(second.content[0].text).toContain('Rate limit reached');
      expect(callGraphAPI).toHaveBeenCalledTimes(1);
    }
  );

  test('reply, reply-all, forward and create share one draft counter', async () => {
    process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '3';
    callGraphAPI.mockResolvedValue({ id: 'd1' });

    await handleDraft({ action: 'reply', id: 'msg-1' });
    await handleDraft({ action: 'reply-all', id: 'msg-1' });
    await handleDraft({ action: 'forward', id: 'msg-1', to: 'a@b.test' });
    const fourth = await handleDraft({ action: 'create', subject: 'x' });

    expect(fourth.content[0].text).toContain('Rate limit reached');
  });

  test('a create dry run does not use a draft slot', async () => {
    process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '1';
    callGraphAPI.mockResolvedValue({ id: 'd1' });

    const preview = await handleDraft({
      action: 'create',
      subject: 'x',
      dryRun: true,
    });
    expect(preview.content[0].text).toContain('Draft NOT saved');

    const reply = await handleDraft({ action: 'reply', id: 'msg-1' });
    expect(reply.isError).toBeUndefined();
  });

  test('a forward refused by the allowlist does not use a draft slot', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    process.env.OUTLOOK_MAX_DRAFT_PER_SESSION = '1';
    callGraphAPI.mockResolvedValue({ id: 'd1' });

    const refused = await handleDraft({
      action: 'forward',
      id: 'msg-1',
      to: 'eve@outside.test',
    });
    expect(refused.isError).toBe(true);

    const allowed = await handleDraft({
      action: 'forward',
      id: 'msg-1',
      to: 'alice@example.com',
    });
    expect(allowed.isError).toBeUndefined();
  });

  test('without a limit configured, reply is unlimited', async () => {
    callGraphAPI.mockResolvedValue({ id: 'd1' });
    for (let i = 0; i < 15; i++) {
      const r = await handleDraft({ action: 'reply', id: 'msg-1' });
      expect(r.isError).toBeUndefined();
    }
  });
});
