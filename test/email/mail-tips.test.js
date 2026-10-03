const { handleGetMailTips, formatMailTips } = require('../../email/mail-tips');

// Mock dependencies
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

describe('mail-tips', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue('test_token');
  });

  describe('formatMailTips', () => {
    it('should format clean recipients with no warnings', () => {
      const tips = [
        {
          emailAddress: { address: 'user@example.com' },
          automaticReplies: { message: '' },
          mailboxFullStatus: false,
        },
      ];

      const { formatted, warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(0);
      expect(formatted).toContain('user@example.com');
      expect(formatted).toContain('No issues detected');
    });

    it('should format out-of-office recipients', () => {
      const tips = [
        {
          emailAddress: { address: 'ooo@example.com' },
          automaticReplies: {
            message: 'I am on leave until next week.',
            scheduledStartTime: { dateTime: '2026-03-01T00:00:00' },
            scheduledEndTime: { dateTime: '2026-03-08T00:00:00' },
          },
          mailboxFullStatus: false,
        },
      ];

      const { formatted, warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(1);
      expect(formatted).toContain('Out of Office');
      expect(formatted).toContain('on leave until next week');
      expect(formatted).toContain('Schedule');
    });

    it('should format mailbox full status', () => {
      const tips = [
        {
          emailAddress: { address: 'full@example.com' },
          mailboxFullStatus: true,
        },
      ];

      const { formatted, warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(1);
      expect(formatted).toContain('Mailbox Full');
    });

    it('should format custom mail tips', () => {
      const tips = [
        {
          emailAddress: { address: 'admin@example.com' },
          customMailTip: 'This mailbox is monitored by IT.',
          mailboxFullStatus: false,
        },
      ];

      const { formatted, warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(1);
      expect(formatted).toContain('This mailbox is monitored by IT');
    });

    it('should format external recipients', () => {
      const tips = [
        {
          emailAddress: { address: 'ext@other.com' },
          recipientScope: 'external',
          mailboxFullStatus: false,
        },
      ];

      const { formatted } = formatMailTips(tips);

      expect(formatted).toContain('External');
      expect(formatted).toContain('outside your organisation');
    });

    it('should format delivery restrictions', () => {
      const tips = [
        {
          emailAddress: { address: 'restricted@example.com' },
          deliveryRestriction: {
            isDeliveryRestricted: true,
            message: 'Sender not in allowed senders list',
          },
          mailboxFullStatus: false,
        },
      ];

      const { formatted, warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(1);
      expect(formatted).toContain('Delivery Restricted');
    });

    it('should format moderated recipients', () => {
      const tips = [
        {
          emailAddress: { address: 'moderated@example.com' },
          moderationStatus: 'moderated',
          mailboxFullStatus: false,
        },
      ];

      const { formatted, warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(1);
      expect(formatted).toContain('Moderated');
    });

    it('should format group member counts', () => {
      const tips = [
        {
          emailAddress: { address: 'group@example.com' },
          totalMemberCount: 150,
          externalMemberCount: 12,
          mailboxFullStatus: false,
        },
      ];

      const { formatted } = formatMailTips(tips);

      expect(formatted).toContain('150 total');
      expect(formatted).toContain('12 external');
    });

    it('should accumulate multiple warnings for one recipient', () => {
      const tips = [
        {
          emailAddress: { address: 'trouble@example.com' },
          automaticReplies: { message: 'Away' },
          mailboxFullStatus: true,
          customMailTip: 'Legacy mailbox',
        },
      ];

      const { warningCount } = formatMailTips(tips);

      expect(warningCount).toBe(3);
    });
  });

  describe('handleGetMailTips', () => {
    it('should return error when no recipients provided', async () => {
      const result = await handleGetMailTips({});

      expect(result.content[0].text).toContain('required');
    });

    it('should return error for empty recipients array', async () => {
      const result = await handleGetMailTips({ recipients: [] });

      expect(result.content[0].text).toContain('required');
    });

    it('should call Graph API with correct payload for array recipients', async () => {
      callGraphAPI.mockResolvedValue({
        value: [
          {
            emailAddress: { address: 'test@example.com' },
            mailboxFullStatus: false,
          },
        ],
      });

      await handleGetMailTips({ recipients: ['test@example.com'] });

      expect(callGraphAPI).toHaveBeenCalledWith(
        'test_token',
        'POST',
        'me/getMailTips',
        expect.objectContaining({
          EmailAddresses: ['test@example.com'],
        })
      );
    });

    it('should handle comma-separated string recipients', async () => {
      callGraphAPI.mockResolvedValue({
        value: [
          {
            emailAddress: { address: 'a@example.com' },
            mailboxFullStatus: false,
          },
          {
            emailAddress: { address: 'b@example.com' },
            mailboxFullStatus: false,
          },
        ],
      });

      await handleGetMailTips({
        recipients: 'a@example.com, b@example.com',
      });

      expect(callGraphAPI).toHaveBeenCalledWith(
        'test_token',
        'POST',
        'me/getMailTips',
        expect.objectContaining({
          EmailAddresses: ['a@example.com', 'b@example.com'],
        })
      );
    });

    it('should return formatted mail tips with metadata', async () => {
      callGraphAPI.mockResolvedValue({
        value: [
          {
            emailAddress: { address: 'ooo@example.com' },
            automaticReplies: { message: 'On holiday' },
            mailboxFullStatus: false,
          },
        ],
      });

      const result = await handleGetMailTips({
        recipients: ['ooo@example.com'],
      });

      expect(result.content[0].text).toContain('Mail Tips');
      expect(result.content[0].text).toContain('ooo@example.com');
      expect(result._meta.recipientCount).toBe(1);
      expect(result._meta.warningCount).toBe(1);
    });

    it('should handle empty API response', async () => {
      callGraphAPI.mockResolvedValue({ value: [] });

      const result = await handleGetMailTips({
        recipients: ['unknown@example.com'],
      });

      expect(result.content[0].text).toContain('No mail tips returned');
    });

    it('should handle auth error', async () => {
      ensureAuthenticated.mockRejectedValue(
        new Error('Authentication required')
      );

      const result = await handleGetMailTips({
        recipients: ['test@example.com'],
      });

      expect(result.content[0].text).toContain('Authentication required');
    });

    it('should handle API error', async () => {
      callGraphAPI.mockRejectedValue(
        new Error('API call failed with status 400')
      );

      const result = await handleGetMailTips({
        recipients: ['test@example.com'],
      });

      expect(result.content[0].text).toContain('Error getting mail tips');
    });
  });
});

// Graph's mailTips resource uses `mailboxFull`, `deliveryRestricted` and
// `isModerated`. send-email's refusal (#272) relies on these being flagged,
// so the formatter must recognise the real field names, and report each
// issue as structured data rather than only as text.
describe('mail-tips issues (#272)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue('test_token');
  });

  it('flags the Graph field names for full mailbox, restriction and moderation', () => {
    const { formatted, warningCount, issues } = formatMailTips([
      { emailAddress: { address: 'full@example.com' }, mailboxFull: true },
      {
        emailAddress: { address: 'locked@example.com' },
        deliveryRestricted: true,
      },
      { emailAddress: { address: 'mod@example.com' }, isModerated: true },
    ]);

    expect(warningCount).toBe(3);
    expect(formatted).toContain('Mailbox Full');
    expect(formatted).toContain('Delivery Restricted');
    expect(formatted).toContain('Moderated');
    expect(issues).toEqual([
      { address: 'full@example.com', type: 'mailboxFull' },
      { address: 'locked@example.com', type: 'deliveryRestricted' },
      { address: 'mod@example.com', type: 'moderated' },
    ]);
  });

  it('does not flag false or notModerated values', () => {
    const { warningCount, issues } = formatMailTips([
      {
        emailAddress: { address: 'ok@example.com' },
        mailboxFull: false,
        deliveryRestricted: false,
        isModerated: false,
        moderationStatus: 'notModerated',
        recipientScope: 'internal',
        automaticReplies: { message: '' },
      },
    ]);

    expect(warningCount).toBe(0);
    expect(issues).toEqual([]);
  });

  it('reports out-of-office, custom tips and every external scope as issues', () => {
    const { issues } = formatMailTips([
      {
        emailAddress: { address: 'ooo@example.com' },
        automaticReplies: { message: 'Away' },
      },
      {
        emailAddress: { address: 'tip@example.com' },
        customMailTip: 'Monitored',
      },
      { emailAddress: { address: 'a@other.com' }, recipientScope: 'external' },
      {
        emailAddress: { address: 'b@partner.com' },
        recipientScope: 'externalPartner',
      },
      {
        emailAddress: { address: 'c@other.com' },
        recipientScope: 'externalNonPartner',
      },
    ]);

    expect(issues).toEqual([
      { address: 'ooo@example.com', type: 'outOfOffice' },
      { address: 'tip@example.com', type: 'customTip' },
      { address: 'a@other.com', type: 'external' },
      { address: 'b@partner.com', type: 'external' },
      { address: 'c@other.com', type: 'external' },
    ]);
  });

  it('reports a group with external members as an external issue', () => {
    const { issues, formatted } = formatMailTips([
      {
        emailAddress: { address: 'team@example.com' },
        totalMemberCount: 20,
        externalMemberCount: 3,
      },
    ]);

    expect(issues).toEqual([
      { address: 'team@example.com', type: 'externalMembers' },
    ]);
    expect(formatted).toContain('3 external');
  });

  it('returns the issues in _meta from handleGetMailTips', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        { emailAddress: { address: 'full@example.com' }, mailboxFull: true },
      ],
    });

    const result = await handleGetMailTips({
      recipients: ['full@example.com'],
    });

    expect(result._meta.issues).toEqual([
      { address: 'full@example.com', type: 'mailboxFull' },
    ]);
  });

  it('returns an empty issues list when Graph returns no tips', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleGetMailTips({
      recipients: ['someone@outlook.com'],
    });

    expect(result._meta).toEqual(
      expect.objectContaining({
        recipientCount: 0,
        warningCount: 0,
        issues: [],
      })
    );
  });
});

describe('mail-tips text agrees with the issues (#272)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureAuthenticated.mockResolvedValue('test_token');
  });

  it('counts an external recipient as a warning, not a ✓', () => {
    const { formatted, warningCount } = formatMailTips([
      { emailAddress: { address: 'a@other.com' }, recipientScope: 'external' },
    ]);

    expect(warningCount).toBe(1);
    expect(formatted).toContain('### ⚠ a@other.com');
    expect(formatted).toContain('**Warnings**: External');
  });

  it('counts a group with external members as a warning, not a ✓', () => {
    const { formatted, warningCount } = formatMailTips([
      {
        emailAddress: { address: 'team@example.com' },
        totalMemberCount: 20,
        externalMemberCount: 3,
      },
    ]);

    expect(warningCount).toBe(1);
    expect(formatted).toContain('### ⚠ team@example.com');
    expect(formatted).toContain('**Warnings**: External Members');
  });

  it('shows Warnings: 1 in the header for an external recipient', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        {
          emailAddress: { address: 'a@other.com' },
          recipientScope: 'external',
        },
      ],
    });

    const result = await handleGetMailTips({ recipients: ['a@other.com'] });

    expect(result.content[0].text).toContain('**Warnings**: 1');
    expect(result._meta.warningCount).toBe(1);
  });

  it.each([
    ['an internal recipient scope', { recipientScope: 'internal' }],
    ['an external member count alone', { externalMemberCount: 2 }],
    [
      'a per-recipient error',
      { error: { code: 'ErrorMailTipsFailed', message: 'x' } },
    ],
  ])('does not call %s an empty response', async (_label, fields) => {
    callGraphAPI.mockResolvedValue({
      value: [{ emailAddress: { address: 'a@example.com' }, ...fields }],
    });

    const result = await handleGetMailTips({ recipients: ['a@example.com'] });

    expect(result._meta.allEmpty).toBe(false);
  });

  it('ignores recipientNotFound, which Graph does not return', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        {
          emailAddress: { address: 'a@example.com' },
          recipientNotFound: true,
        },
      ],
    });

    const result = await handleGetMailTips({ recipients: ['a@example.com'] });

    expect(result._meta.allEmpty).toBe(true);
  });

  it('still calls a response with only a "none" scope empty', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        { emailAddress: { address: 'a@outlook.com' }, recipientScope: 'none' },
      ],
    });

    const result = await handleGetMailTips({ recipients: ['a@outlook.com'] });

    expect(result._meta.allEmpty).toBe(true);
  });

  it('says a recipient could not be checked when Graph returns an error for it', () => {
    const { formatted } = formatMailTips([
      {
        emailAddress: { address: 'a@example.com' },
        error: { code: 'ErrorMailTipsFailed', message: 'Lookup failed' },
      },
    ]);

    expect(formatted).not.toContain('No issues detected');
    expect(formatted).toContain('ErrorMailTipsFailed');
  });
});
