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
