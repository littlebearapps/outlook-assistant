/**
 * Sending and drafting as a shared mailbox (OUTLOOK_SHARED_MAILBOX=send).
 *
 * `send-email` and every `draft` action take `sharedMailbox` (alias
 * `email`): the request goes to `users/{mailbox}/...` so the sent copy and
 * drafts live in that mailbox, and `from` is set to its address. Every other
 * mode refuses before any request, dry runs included. The recipient
 * allowlist, session limits, dryRun and checkRecipients behave as they do for
 * the signed-in user's own mailbox.
 *
 * Modules are reloaded per test so each one starts with fresh rate-limit
 * counters and its own shared-mailbox mode.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const SHARED = 'shared@contoso.com';
const ENV_KEYS = [
  'OUTLOOK_ALLOWED_RECIPIENTS',
  'OUTLOOK_MAX_DRAFT_PER_SESSION',
  'OUTLOOK_MAX_SEND_EMAIL_PER_SESSION',
  'OUTLOOK_MAX_EMAILS_PER_SESSION',
];
const FROM_SHARED = { emailAddress: { address: SHARED } };
const recipient = (address) => ({ emailAddress: { address } });
const SEND_ARGS = {
  to: 'someone@example.com',
  subject: 'Barcodes',
  body: 'Hello from the team.',
};

let handleSendEmail;
let handleDraft;
let callGraphAPI;
let ensureAuthenticated;
let config;
let savedEnv;

/** Reload the modules with OUTLOOK_SHARED_MAILBOX parsed as `mode`. */
function load(mode) {
  jest.resetModules();
  config = require('../../config');
  config.SHARED_MAILBOX_MODE = mode;
  handleSendEmail = require('../../email/send');
  handleDraft = require('../../email/draft');
  ({ callGraphAPI } = require('../../utils/graph-api'));
  ({ ensureAuthenticated } = require('../../auth'));
  ensureAuthenticated.mockResolvedValue('test_token');
}

/** A Graph failure as utils/graph-api.js reports it. */
function graphError(status, code) {
  const error = new Error(
    `API call failed with status ${status}: {"error":{"code":"${code}"}}`
  );
  error.status = status;
  error.graphCode = code;
  return error;
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  jest.spyOn(console, 'error').mockImplementation();
  load('send');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  console.error.mockRestore();
});

// ──────────────────────────────────────────────────
// The opt-in
// ──────────────────────────────────────────────────
describe('refused before any request unless OUTLOOK_SHARED_MAILBOX=send', () => {
  test.each(['off', 'read', 'readwrite'])(
    'mode %s: send-email refuses, dry runs included',
    async (mode) => {
      load(mode);
      for (const dryRun of [false, true]) {
        const result = await handleSendEmail({
          ...SEND_ARGS,
          sharedMailbox: SHARED,
          dryRun,
        });
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('OUTLOOK_SHARED_MAILBOX=send');
        expect(result.content[0].text).toContain('Email not sent');
      }
      expect(callGraphAPI).not.toHaveBeenCalled();
      expect(ensureAuthenticated).not.toHaveBeenCalled();
    }
  );

  test.each([
    'create',
    'update',
    'send',
    'delete',
    'reply',
    'reply-all',
    'forward',
  ])('mode readwrite: draft action=%s refuses', async (action) => {
    load('readwrite');
    const result = await handleDraft({
      action,
      id: 'msg-1',
      to: 'someone@example.com',
      email: SHARED,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OUTLOOK_SHARED_MAILBOX=send');
    expect(result.content[0].text).toContain('Nothing was changed');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('mode readwrite: draft create dry run refuses too', async () => {
    load('readwrite');
    const result = await handleDraft({
      action: 'create',
      sharedMailbox: SHARED,
      dryRun: true,
    });
    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('without sharedMailbox nothing changes: me/sendMail, no from', async () => {
    load('off');
    callGraphAPI.mockResolvedValue({});
    const result = await handleSendEmail(SEND_ARGS);
    expect(result.isError).toBeUndefined();
    const [, method, path, payload] = callGraphAPI.mock.calls[0];
    expect([method, path]).toEqual(['POST', 'me/sendMail']);
    expect(payload.message.from).toBeUndefined();
  });

  test('an invalid address is refused before any request', async () => {
    const result = await handleSendEmail({
      ...SEND_ARGS,
      sharedMailbox: 'shared@contoso.com/messages',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid mailbox');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────
// send-email
// ──────────────────────────────────────────────────
describe('send-email as a shared mailbox', () => {
  test('posts to users/{mailbox}/sendMail with from set and the sent copy kept', async () => {
    callGraphAPI.mockResolvedValue({});
    const result = await handleSendEmail({
      ...SEND_ARGS,
      sharedMailbox: SHARED,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(`From: ${SHARED}`);
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    const [, method, path, payload] = callGraphAPI.mock.calls[0];
    expect(method).toBe('POST');
    expect(path).toBe(`users/${SHARED}/sendMail`);
    expect(payload.message.from).toEqual(FROM_SHARED);
    expect(payload.saveToSentItems).toBe(true);
  });

  test('the `email` alias works the same way', async () => {
    callGraphAPI.mockResolvedValue({});
    await handleSendEmail({ ...SEND_ARGS, email: SHARED });
    expect(callGraphAPI.mock.calls[0][2]).toBe(`users/${SHARED}/sendMail`);
  });

  test('dryRun previews the shared sender and sends nothing', async () => {
    const result = await handleSendEmail({
      ...SEND_ARGS,
      sharedMailbox: SHARED,
      dryRun: true,
    });
    expect(result.content[0].text).toContain('Email NOT sent');
    expect(result.content[0].text).toContain(`From: ${SHARED}`);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('the recipient allowlist refuses before any request', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'example.com';
    const result = await handleSendEmail({
      ...SEND_ARGS,
      to: 'outsider@elsewhere.test',
      sharedMailbox: SHARED,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OUTLOOK_ALLOWED_RECIPIENTS');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('the session limit counts shared sends', async () => {
    process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION = '1';
    callGraphAPI.mockResolvedValue({});
    const args = { ...SEND_ARGS, sharedMailbox: SHARED };
    expect((await handleSendEmail(args)).isError).toBeUndefined();
    const second = await handleSendEmail(args);
    expect(second.isError).toBe(true);
    expect(second.content[0].text).toContain('Rate limit reached');
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  test('checkRecipients still refuses a flagged recipient', async () => {
    callGraphAPI.mockImplementation((_t, _m, path) =>
      path === `users/${SHARED}/getMailTips`
        ? Promise.resolve({
            value: [
              {
                emailAddress: { address: 'someone@example.com' },
                externalMemberCount: 0,
                recipientScope: 'external',
              },
            ],
          })
        : Promise.resolve({})
    );
    const result = await handleSendEmail({
      ...SEND_ARGS,
      sharedMailbox: SHARED,
      checkRecipients: true,
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Email not sent');
    expect(
      callGraphAPI.mock.calls.some(([, , path]) => path.endsWith('/sendMail'))
    ).toBe(false);
  });

  test.each([
    [403, 'ErrorAccessDenied'],
    [400, 'ErrorSendAsDenied'],
  ])('a %i %s explains Send As / Send on Behalf', async (status, code) => {
    callGraphAPI.mockRejectedValue(graphError(status, code));
    const result = await handleSendEmail({
      ...SEND_ARGS,
      sharedMailbox: SHARED,
    });
    const text = result.content[0].text;
    expect(result.isError).toBe(true);
    expect(text).toContain(SHARED);
    expect(text).toContain('Send As');
    expect(text).toContain('Send on Behalf');
    expect(text).toContain('Mail.Send.Shared');
  });

  test('a 403 on the own mailbox keeps the plain error', async () => {
    callGraphAPI.mockRejectedValue(graphError(403, 'ErrorAccessDenied'));
    const result = await handleSendEmail(SEND_ARGS);
    expect(result.content[0].text).toContain('Error sending email');
    expect(result.content[0].text).not.toContain('Send As');
  });
});

// ──────────────────────────────────────────────────
// draft
// ──────────────────────────────────────────────────
describe('draft as a shared mailbox', () => {
  const draft = {
    id: 'draft-1',
    isDraft: true,
    subject: 'Barcodes',
    toRecipients: [recipient('someone@example.com')],
    ccRecipients: [],
    bccRecipients: [],
  };

  /** GET returns `draft`; anything else returns `other`. */
  function graph(other = draft) {
    callGraphAPI.mockImplementation((_t, method) =>
      Promise.resolve(method === 'GET' ? draft : other)
    );
  }
  const calls = () =>
    callGraphAPI.mock.calls.map(([, method, path]) => `${method} ${path}`);

  test('create saves into the shared Drafts with from set', async () => {
    graph();
    const result = await handleDraft({
      action: 'create',
      sharedMailbox: SHARED,
      to: 'someone@example.com',
      subject: 'Barcodes',
      body: 'Hello',
    });
    expect(result.isError).toBeUndefined();
    expect(calls()).toEqual([`POST users/${SHARED}/messages`]);
    expect(callGraphAPI.mock.calls[0][3].from).toEqual(FROM_SHARED);
  });

  test('create dry run shows the shared sender and saves nothing', async () => {
    const result = await handleDraft({
      action: 'create',
      sharedMailbox: SHARED,
      to: 'someone@example.com',
      subject: 'Barcodes',
      body: 'Hello',
      dryRun: true,
    });
    expect(result.content[0].text).toContain('Draft NOT saved');
    expect(result.content[0].text).toContain(`From: ${SHARED}`);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('update looks the draft up and patches it in the shared mailbox', async () => {
    graph();
    await handleDraft({
      action: 'update',
      sharedMailbox: SHARED,
      id: 'draft-1',
      subject: 'New subject',
    });
    expect(calls()).toEqual([
      `GET users/${SHARED}/messages/draft-1`,
      `PATCH users/${SHARED}/messages/draft-1`,
    ]);
  });

  test('send re-checks and sends from the shared mailbox', async () => {
    graph({});
    const result = await handleDraft({
      action: 'send',
      sharedMailbox: SHARED,
      id: 'draft-1',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain(`Sent Items of ${SHARED}`);
    expect(calls()).toEqual([
      `GET users/${SHARED}/messages/draft-1`,
      `POST users/${SHARED}/messages/draft-1/send`,
    ]);
  });

  test('send refuses a recipient the allowlist does not allow', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'partner.test';
    graph({});
    const result = await handleDraft({
      action: 'send',
      sharedMailbox: SHARED,
      id: 'draft-1',
    });
    expect(result.isError).toBe(true);
    expect(calls()).toEqual([`GET users/${SHARED}/messages/draft-1`]);
  });

  test('send shares the send-email session limit', async () => {
    process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION = '1';
    graph({});
    await handleSendEmail({ ...SEND_ARGS, sharedMailbox: SHARED });
    const result = await handleDraft({
      action: 'send',
      sharedMailbox: SHARED,
      id: 'draft-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Rate limit reached');
  });

  test('delete looks the draft up and deletes it in the shared mailbox', async () => {
    graph({});
    await handleDraft({ action: 'delete', email: SHARED, id: 'draft-1' });
    expect(calls()).toEqual([
      `GET users/${SHARED}/messages/draft-1`,
      `DELETE users/${SHARED}/messages/draft-1`,
    ]);
  });

  test.each([
    ['reply', 'createReply'],
    ['reply-all', 'createReplyAll'],
  ])(
    '%s drafts on the shared message, from the shared address',
    async (action, endpoint) => {
      graph({ ...draft, id: 'reply-1' });
      const result = await handleDraft({
        action,
        sharedMailbox: SHARED,
        id: 'msg-1',
        comment: 'Thanks!',
      });
      expect(result.isError).toBeUndefined();
      const [, method, path, body] = callGraphAPI.mock.calls[0];
      expect(`${method} ${path}`).toBe(
        `POST users/${SHARED}/messages/msg-1/${endpoint}`
      );
      expect(body).toEqual({
        comment: 'Thanks!',
        message: { from: FROM_SHARED },
      });
    }
  );

  test('reply with a body keeps the body next to from', async () => {
    graph({ ...draft, id: 'reply-1' });
    await handleDraft({
      action: 'reply',
      sharedMailbox: SHARED,
      id: 'msg-1',
      body: 'Thanks!',
    });
    const body = callGraphAPI.mock.calls[0][3];
    expect(body.message.from).toEqual(FROM_SHARED);
    expect(body.message.body.content).toBe('Thanks!');
  });

  test('a reply-all to a blocked recipient is deleted in the shared mailbox', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'partner.test';
    graph({ ...draft, id: 'reply-1' });
    const result = await handleDraft({
      action: 'reply-all',
      sharedMailbox: SHARED,
      id: 'msg-1',
    });
    expect(result.isError).toBe(true);
    expect(calls()).toEqual([
      `POST users/${SHARED}/messages/msg-1/createReplyAll`,
      `DELETE users/${SHARED}/messages/reply-1`,
    ]);
  });

  test('forward drafts on the shared message, from the shared address', async () => {
    graph({ ...draft, id: 'fwd-1' });
    await handleDraft({
      action: 'forward',
      sharedMailbox: SHARED,
      id: 'msg-1',
      to: 'someone@example.com',
    });
    const [, method, path, body] = callGraphAPI.mock.calls[0];
    expect(`${method} ${path}`).toBe(
      `POST users/${SHARED}/messages/msg-1/createForward`
    );
    expect(body.message.from).toEqual(FROM_SHARED);
    expect(body.toRecipients).toEqual([recipient('someone@example.com')]);
  });

  test('forward to a blocked recipient is refused before any request', async () => {
    process.env.OUTLOOK_ALLOWED_RECIPIENTS = 'partner.test';
    const result = await handleDraft({
      action: 'forward',
      sharedMailbox: SHARED,
      id: 'msg-1',
      to: 'someone@example.com',
    });
    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('a 403 on draft send explains Send As / Send on Behalf', async () => {
    callGraphAPI.mockImplementation((_t, method) =>
      method === 'GET'
        ? Promise.resolve(draft)
        : Promise.reject(graphError(403, 'ErrorSendAsDenied'))
    );
    const result = await handleDraft({
      action: 'send',
      sharedMailbox: SHARED,
      id: 'draft-1',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Send As');
    expect(result.content[0].text).toContain(SHARED);
  });
});

// ──────────────────────────────────────────────────
// Own mailbox and schema
// ──────────────────────────────────────────────────
describe('with send on but no sharedMailbox, drafts stay in your own mailbox', () => {
  test('create posts to me/messages without from', async () => {
    callGraphAPI.mockResolvedValue({ id: 'draft-1' });
    await handleDraft({ action: 'create', subject: 'Hi' });
    const [, method, path, body] = callGraphAPI.mock.calls[0];
    expect(`${method} ${path}`).toBe('POST me/messages');
    expect(body.from).toBeUndefined();
  });

  test('reply without comment or body still posts no body', async () => {
    callGraphAPI.mockResolvedValue({ id: 'reply-1' });
    await handleDraft({ action: 'reply', id: 'msg-1' });
    const [, method, path, body] = callGraphAPI.mock.calls[0];
    expect(`${method} ${path}`).toBe('POST me/messages/msg-1/createReply');
    expect(body).toBeNull();
  });

  test('a draft id not found hints at the mailbox it belongs to', async () => {
    callGraphAPI.mockRejectedValue(graphError(404, 'ErrorItemNotFound'));
    const result = await handleDraft({ action: 'send', id: 'draft-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('`sharedMailbox`');
  });
});

describe('tool schemas accept the new parameter', () => {
  const { TOOLS } = require('../../tools');
  const { coerceArgsAgainstSchema } = require('../../utils/schema-coerce');

  test.each([
    ['send-email', { ...SEND_ARGS, sharedMailbox: SHARED }],
    ['send-email', { ...SEND_ARGS, email: SHARED }],
    ['draft', { action: 'create', sharedMailbox: SHARED }],
    ['draft', { action: 'reply', id: 'msg-1', email: SHARED }],
  ])('%s with %o', (name, args) => {
    const tool = TOOLS.find((t) => t.name === name);
    expect(coerceArgsAgainstSchema(args, tool.inputSchema).error).toBeFalsy();
  });
});
