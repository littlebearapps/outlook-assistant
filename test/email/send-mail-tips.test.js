/**
 * send-email with checkRecipients (#272).
 *
 * Mail-tips warnings used to be attached to the Graph sendMail payload as
 * `_mailTipsText`/`_mailTipsMeta` and never shown to the caller. Now they are
 * kept out of the payload, returned in the result, and the send is refused
 * when the tips show external recipients, an out-of-office reply, a full
 * mailbox or delivery restrictions, unless `acknowledgeWarnings: true`.
 */
const handleSendEmail = require('../../email/send');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { emailTools } = require('../../email');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const BASE_ARGS = {
  to: 'someone@example.com',
  subject: 'Quarterly numbers',
  body: 'Hi, the numbers are attached.',
};

/** Route Graph calls: getMailTips returns `tips`, sendMail succeeds. */
function mockGraph(tips) {
  callGraphAPI.mockImplementation((_token, _method, path) => {
    if (path === 'me/getMailTips') return Promise.resolve({ value: tips });
    if (path === 'me/sendMail') return Promise.resolve({});
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function sendMailCalls() {
  return callGraphAPI.mock.calls.filter(([, , path]) => path === 'me/sendMail');
}

/** Every key at every depth of an object. */
function allKeys(value, keys = []) {
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      allKeys(child, keys);
    }
  }
  return keys;
}

/** The sendMail payload for the same arguments without checkRecipients. */
async function plainPayload(args) {
  callGraphAPI.mockResolvedValue({});
  await handleSendEmail(args);
  const payload = sendMailCalls()[0][3];
  callGraphAPI.mockReset();
  return payload;
}

const BLOCKING = [
  [
    'out-of-office reply',
    { automaticReplies: { message: 'On leave until Monday' } },
    /out of office/i,
  ],
  ['full mailbox', { mailboxFull: true }, /mailbox full/i],
  [
    'delivery restriction',
    { deliveryRestricted: true },
    /delivery restricted/i,
  ],
  ['external recipient', { recipientScope: 'external' }, /external/i],
  [
    'group with external members',
    { totalMemberCount: 10, externalMemberCount: 2 },
    /external/i,
  ],
];

beforeEach(() => {
  jest.resetAllMocks();
  ensureAuthenticated.mockResolvedValue('test_token');
});

describe('send-email checkRecipients payload', () => {
  it('never sends _mailTips* (or any non-Graph) keys to Graph', async () => {
    const expected = await plainPayload(BASE_ARGS);
    mockGraph([
      {
        emailAddress: { address: 'someone@example.com' },
        automaticReplies: { message: 'Away' },
        customMailTip: 'Monitored mailbox',
      },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
      acknowledgeWarnings: true,
    });

    expect(result.isError).toBeUndefined();
    expect(sendMailCalls()).toHaveLength(1);
    const payload = sendMailCalls()[0][3];
    expect(allKeys(payload).filter((k) => k.startsWith('_'))).toEqual([]);
    expect(payload).toEqual(expected);
  });

  it('returns non-blocking warnings in the result and still sends', async () => {
    mockGraph([
      {
        emailAddress: { address: 'someone@example.com' },
        customMailTip: 'This mailbox is monitored by IT.',
        recipientScope: 'internal',
      },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
    });

    expect(result.isError).toBeUndefined();
    expect(sendMailCalls()).toHaveLength(1);
    expect(result.content[0].text).toContain('Email sent successfully!');
    expect(result.content[0].text).toContain(
      'This mailbox is monitored by IT.'
    );
    expect(result._meta.mailTips.warningCount).toBe(1);
  });
});

describe('send-email refuses on blocking mail tips', () => {
  it.each(BLOCKING)('refuses a %s', async (_label, tipFields, pattern) => {
    mockGraph([
      { emailAddress: { address: 'someone@example.com' }, ...tipFields },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
    });

    expect(result.isError).toBe(true);
    expect(sendMailCalls()).toHaveLength(0);
    const text = result.content[0].text;
    expect(text).toMatch(/not sent/i);
    expect(text).toContain('someone@example.com');
    expect(text).toMatch(pattern);
    expect(text).toContain('Next step:');
    expect(text).toContain('acknowledgeWarnings: true');
  });

  it('lists every flagged recipient in the refusal', async () => {
    mockGraph([
      { emailAddress: { address: 'a@example.com' }, mailboxFull: true },
      { emailAddress: { address: 'b@other.com' }, recipientScope: 'external' },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      to: 'a@example.com, b@other.com',
      checkRecipients: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('a@example.com');
    expect(result.content[0].text).toContain('b@other.com');
  });

  it('does not count a refused send against the session rate limit', async () => {
    const original = process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION;
    process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION = '1';
    try {
      // A fresh module registry gives this test its own rate-limit counters.
      let isolatedSend;
      jest.isolateModules(() => {
        isolatedSend = require('../../email/send');
      });
      mockGraph([
        { emailAddress: { address: 'someone@example.com' }, mailboxFull: true },
      ]);
      const refused = await isolatedSend({
        ...BASE_ARGS,
        checkRecipients: true,
      });
      expect(refused.isError).toBe(true);

      const sent = await isolatedSend({
        ...BASE_ARGS,
        checkRecipients: true,
        acknowledgeWarnings: true,
      });
      expect(sent.isError).toBeUndefined();
      expect(sendMailCalls()).toHaveLength(1);
    } finally {
      if (original === undefined) {
        delete process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION;
      } else {
        process.env.OUTLOOK_MAX_SEND_EMAIL_PER_SESSION = original;
      }
    }
  });

  it('does not refuse on a custom tip or moderation alone', async () => {
    mockGraph([
      {
        emailAddress: { address: 'someone@example.com' },
        customMailTip: 'Notice',
        isModerated: true,
      },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
    });

    expect(result.isError).toBeUndefined();
    expect(sendMailCalls()).toHaveLength(1);
  });

  it('refuses when the recipient check itself fails', async () => {
    callGraphAPI.mockImplementation((_token, _method, path) =>
      path === 'me/getMailTips'
        ? Promise.reject(new Error('API call failed with status 500'))
        : Promise.resolve({})
    );

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
    });

    expect(result.isError).toBe(true);
    expect(sendMailCalls()).toHaveLength(0);
    expect(result.content[0].text).toMatch(/not sent/i);
    expect(result.content[0].text).toContain('Next step:');
  });
});

describe('send-email acknowledgeWarnings', () => {
  it.each(BLOCKING)(
    'sends despite a %s and returns the warnings',
    async (_label, tipFields, pattern) => {
      const expected = await plainPayload(BASE_ARGS);
      mockGraph([
        { emailAddress: { address: 'someone@example.com' }, ...tipFields },
      ]);

      const result = await handleSendEmail({
        ...BASE_ARGS,
        checkRecipients: true,
        acknowledgeWarnings: true,
      });

      expect(result.isError).toBeUndefined();
      expect(sendMailCalls()).toHaveLength(1);
      expect(sendMailCalls()[0][3]).toEqual(expected);
      const text = result.content[0].text;
      expect(text).toContain('Email sent successfully!');
      expect(text).toMatch(/acknowledged/i);
      expect(text).toMatch(pattern);
      expect(result._meta.mailTips.issues.length).toBeGreaterThan(0);
    }
  );
});

describe('send-email without warnings', () => {
  it('sends unchanged when the tips are clean, with a delivery caveat', async () => {
    const expected = await plainPayload(BASE_ARGS);
    mockGraph([
      {
        emailAddress: { address: 'someone@example.com' },
        recipientScope: 'internal',
        maxMessageSize: 37748736,
      },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
    });

    expect(result.isError).toBeUndefined();
    expect(sendMailCalls()).toHaveLength(1);
    expect(sendMailCalls()[0][3]).toEqual(expected);
    expect(result.content[0].text).toContain('Email sent successfully!');
    expect(result.content[0].text).toMatch(/not proof/i);
  });

  it('sends when a personal account returns no tips, and says so', async () => {
    mockGraph([]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
    });

    expect(result.isError).toBeUndefined();
    expect(sendMailCalls()).toHaveLength(1);
    expect(result.content[0].text).toMatch(/personal/i);
  });

  it.each([
    ['no tips at all', []],
    [
      'tips with nothing in them',
      [{ emailAddress: { address: 'someone@example.com' } }],
    ],
  ])(
    'states the M365-only caveat once when there are %s',
    async (_label, tips) => {
      mockGraph(tips);

      const result = await handleSendEmail({
        ...BASE_ARGS,
        checkRecipients: true,
      });

      const mentions = result.content[0].text.match(/M365-only/g) || [];
      expect(mentions).toHaveLength(1);
    }
  );

  it('does not call getMailTips or change the result without checkRecipients', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleSendEmail({
      ...BASE_ARGS,
      acknowledgeWarnings: true,
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(callGraphAPI.mock.calls[0][2]).toBe('me/sendMail');
    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: `Email sent successfully!\n\nSubject: ${BASE_ARGS.subject}\nRecipients: 1\nMessage Length: ${BASE_ARGS.body.length} characters`,
        },
      ],
    });
  });
});

describe('send-email dryRun with checkRecipients', () => {
  it('shows the warnings and preview without sending or refusing', async () => {
    mockGraph([
      {
        emailAddress: { address: 'someone@example.com' },
        automaticReplies: { message: 'On leave until Monday' },
      },
    ]);

    const result = await handleSendEmail({
      ...BASE_ARGS,
      checkRecipients: true,
      dryRun: true,
    });

    expect(result.isError).toBeUndefined();
    expect(sendMailCalls()).toHaveLength(0);
    const text = result.content[0].text;
    expect(text).toContain('# Mail Tips');
    expect(text).toContain('On leave until Monday');
    expect(text).toContain('Email NOT sent');
    expect(text).toContain('acknowledgeWarnings: true');
    expect(result._meta.mailTips.warningCount).toBe(1);
  });
});

describe('send-email schema', () => {
  const tool = emailTools.find((t) => t.name === 'send-email');

  it('declares acknowledgeWarnings as a boolean defaulting to false', () => {
    const prop = tool.inputSchema.properties.acknowledgeWarnings;
    expect(prop.type).toBe('boolean');
    expect(prop.default).toBe(false);
    expect(prop.description.length).toBeLessThanOrEqual(1024);
    expect(prop.description).toMatch(/checkRecipients/);
  });

  it('keeps the tool description within 1,024 characters and notes the limits', () => {
    expect(tool.description.length).toBeLessThanOrEqual(1024);
    expect(tool.description).toMatch(/acknowledgeWarnings/);
    expect(tool.description).toMatch(/personal/i);
  });
});
