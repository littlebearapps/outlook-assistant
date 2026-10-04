const handleSendEmail = require('../../email/send');
const handleMarkAsRead = require('../../email/mark-as-read');
const handleReadEmail = require('../../email/read');
const {
  handleListAttachments,
  handleGetAttachmentContent,
} = require('../../email/attachments');
const { handleGetEmailHeaders } = require('../../email/headers');
const handleListEmailsDelta = require('../../email/delta');
const { handleGetMimeContent } = require('../../email/mime');
const { handleSearchByMessageId } = require('../../email/search');
const { callGraphAPI, callGraphAPIRaw } = require('../../utils/graph-api');
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

// ──────────────────────────────────────────────────
// handleSendEmail
// ──────────────────────────────────────────────────
describe('handleSendEmail', () => {
  it('should send a basic email', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleSendEmail({
      to: 'user@example.com',
      subject: 'Test Subject',
      body: 'Hello, world!',
    });

    expect(result.content[0].text).toContain('Email sent successfully');
    expect(result.content[0].text).toContain('Test Subject');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/sendMail',
      expect.objectContaining({
        message: expect.objectContaining({ subject: 'Test Subject' }),
      })
    );
  });

  it('should send with cc and bcc', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleSendEmail({
      to: 'user@example.com',
      cc: 'cc1@example.com,cc2@example.com',
      bcc: 'bcc@example.com',
      subject: 'With CC',
      body: 'Test',
    });

    expect(result.content[0].text).toContain('2 CC');
    expect(result.content[0].text).toContain('1 BCC');
  });

  it('should require to', async () => {
    const result = await handleSendEmail({ subject: 'Test', body: 'Test' });
    expect(result.content[0].text).toBe('Recipient (to) is required.');
  });

  it('should require subject', async () => {
    const result = await handleSendEmail({
      to: 'user@example.com',
      body: 'Test',
    });
    expect(result.content[0].text).toBe('Subject is required.');
  });

  it('should require body', async () => {
    const result = await handleSendEmail({
      to: 'user@example.com',
      subject: 'Test',
    });
    expect(result.content[0].text).toBe('Body content is required.');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSendEmail({
      to: 'a@b.com',
      subject: 'Test',
      body: 'Test',
    });
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Send failed'));

    const result = await handleSendEmail({
      to: 'a@b.com',
      subject: 'Test',
      body: 'Test',
    });
    expect(result.content[0].text).toBe('Error sending email: Send failed');
  });
});

// ──────────────────────────────────────────────────
// handleMarkAsRead
// ──────────────────────────────────────────────────
describe('handleMarkAsRead', () => {
  it('should mark email as read', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleMarkAsRead({ id: 'msg-1' });

    expect(result.content[0].text).toContain('marked as read');
  });

  it('should mark email as unread', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleMarkAsRead({ id: 'msg-1', isRead: false });

    expect(result.content[0].text).toContain('marked as unread');
  });

  it('should require email ID', async () => {
    const result = await handleMarkAsRead({});
    expect(result.content[0].text).toBe('Email ID is required.');
  });

  it('should handle invalid mailbox error', async () => {
    callGraphAPI.mockRejectedValue(
      new Error("doesn't belong to the targeted mailbox")
    );

    const result = await handleMarkAsRead({ id: 'bad-id' });
    expect(result.content[0].text).toContain('invalid');
  });

  it('should handle UNAUTHORIZED error', async () => {
    callGraphAPI.mockRejectedValue(new Error('UNAUTHORIZED'));

    const result = await handleMarkAsRead({ id: 'msg-1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('action=authenticate');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleMarkAsRead({ id: 'msg-1' });
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle generic API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleMarkAsRead({ id: 'msg-1' });
    expect(result.content[0].text).toContain('Failed to mark email');
  });
});

// ──────────────────────────────────────────────────
// handleReadEmail
// ──────────────────────────────────────────────────
describe('handleReadEmail', () => {
  const mockEmail = {
    id: 'email-1',
    subject: 'Important Meeting',
    from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
    toRecipients: [
      { emailAddress: { name: 'Bob', address: 'bob@example.com' } },
    ],
    body: { contentType: 'text', content: 'Meeting at 3pm' },
    receivedDateTime: '2024-01-15T10:00:00Z',
    conversationId: 'conv-1',
    internetMessageId: '<msg123@example.com>',
  };

  it('should read an email', async () => {
    callGraphAPI.mockResolvedValue(mockEmail);

    const result = await handleReadEmail({ id: 'email-1' });

    expect(result.content[0].text).toBeDefined();
    expect(result._meta.emailId).toBe('email-1');
    expect(result._meta.conversationId).toBe('conv-1');
  });

  it('should handle email not found', async () => {
    callGraphAPI.mockResolvedValue(null);

    const result = await handleReadEmail({ id: 'bad-id' });
    expect(result.content[0].text).toContain('not found');
  });

  it('should require email ID', async () => {
    const result = await handleReadEmail({});
    expect(result.content[0].text).toBe('Email ID is required.');
  });

  it('should handle invalid mailbox error', async () => {
    callGraphAPI.mockRejectedValue(
      new Error("doesn't belong to the targeted mailbox")
    );

    const result = await handleReadEmail({ id: 'bad-id' });
    expect(result.content[0].text).toContain('invalid');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleReadEmail({ id: 'email-1' });
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Fetch failed'));

    const result = await handleReadEmail({ id: 'email-1' });
    expect(result.content[0].text).toContain('Failed to read email');
  });
});

// ──────────────────────────────────────────────────
// handleListAttachments
// ──────────────────────────────────────────────────
describe('handleListAttachments', () => {
  it('should list attachments', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'att-1',
          name: 'report.pdf',
          contentType: 'application/pdf',
          size: 51200,
          isInline: false,
        },
        {
          id: 'att-2',
          name: 'logo.png',
          contentType: 'image/png',
          size: 10240,
          isInline: true,
        },
      ],
    });

    const result = await handleListAttachments({ messageId: 'msg-1' });

    expect(result.content[0].text).toContain('2 attachment(s)');
    expect(result.content[0].text).toContain('report.pdf');
    expect(result.content[0].text).toContain('[inline]');
  });

  it('should handle no attachments', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleListAttachments({ messageId: 'msg-1' });
    expect(result.content[0].text).toContain('No attachments found');
  });

  it('should require messageId', async () => {
    const result = await handleListAttachments({});
    expect(result.content[0].text).toContain('messageId is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListAttachments({ messageId: 'msg-1' });
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('List failed'));

    const result = await handleListAttachments({ messageId: 'msg-1' });
    expect(result.content[0].text).toBe(
      'Error listing attachments: List failed'
    );
  });
});

// ──────────────────────────────────────────────────
// handleGetAttachmentContent
// ──────────────────────────────────────────────────
describe('handleGetAttachmentContent', () => {
  it('should return text file content', async () => {
    const base64Content = Buffer.from('Hello text file').toString('base64');
    callGraphAPI.mockResolvedValue({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'readme.txt',
      contentType: 'text/plain',
      size: 15,
      contentBytes: base64Content,
    });

    const result = await handleGetAttachmentContent({
      messageId: 'msg-1',
      attachmentId: 'att-1',
    });

    expect(result.content[0].text).toContain('readme.txt');
    expect(result.content[0].text).toContain('Hello text file');
  });

  it('should return binary file metadata', async () => {
    callGraphAPI.mockResolvedValue({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'photo.jpg',
      contentType: 'image/jpeg',
      size: 102400,
      contentBytes: 'base64data',
    });

    const result = await handleGetAttachmentContent({
      messageId: 'msg-1',
      attachmentId: 'att-1',
    });

    expect(result.content[0].text).toContain('photo.jpg');
    expect(result.content[0].text).toContain('download-attachment');
  });

  it('should require both IDs', async () => {
    const result = await handleGetAttachmentContent({ messageId: 'msg-1' });
    expect(result.content[0].text).toContain('required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetAttachmentContent({
      messageId: 'msg-1',
      attachmentId: 'att-1',
    });
    expect(result.content[0].text).toContain('Authentication required');
  });
});

// ──────────────────────────────────────────────────
// handleGetEmailHeaders
// ──────────────────────────────────────────────────
describe('handleGetEmailHeaders', () => {
  const mockEmailWithHeaders = {
    id: 'email-1',
    subject: 'Test Email',
    from: { emailAddress: { address: 'sender@example.com' } },
    receivedDateTime: '2024-01-15T10:00:00Z',
    internetMessageId: '<msg123@example.com>',
    conversationId: 'conv-1',
    internetMessageHeaders: [
      { name: 'Message-ID', value: '<msg123@example.com>' },
      { name: 'Content-Type', value: 'text/plain; charset=utf-8' },
      { name: 'X-Mailer', value: 'Outlook 16.0' },
      {
        name: 'Authentication-Results',
        value: 'spf=pass dkim=pass dmarc=pass',
      },
    ],
  };

  it('should return email headers', async () => {
    callGraphAPI.mockResolvedValue(mockEmailWithHeaders);

    const result = await handleGetEmailHeaders({ id: 'email-1' });

    expect(result.content[0].text).toContain('Email Headers');
    expect(result.content[0].text).toContain('sender@example.com');
    expect(result._meta.headerCount).toBe(4);
  });

  it('should return raw JSON format', async () => {
    callGraphAPI.mockResolvedValue(mockEmailWithHeaders);

    const result = await handleGetEmailHeaders({ id: 'email-1', raw: true });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.headers).toHaveLength(4);
    expect(result._meta.format).toBe('json');
  });

  it('should filter important headers only', async () => {
    callGraphAPI.mockResolvedValue(mockEmailWithHeaders);

    const result = await handleGetEmailHeaders({
      id: 'email-1',
      importantOnly: true,
    });

    expect(result._meta.displayedHeaders).toBeLessThanOrEqual(
      result._meta.headerCount
    );
  });

  it('should require email ID', async () => {
    const result = await handleGetEmailHeaders({});
    expect(result.content[0].text).toBe('Email ID is required.');
  });

  it('should handle email not found', async () => {
    callGraphAPI.mockResolvedValue(null);

    const result = await handleGetEmailHeaders({ id: 'bad-id' });
    expect(result.content[0].text).toContain('not found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetEmailHeaders({ id: 'email-1' });
    expect(result.content[0].text).toContain('Authentication required');
  });
});

// ──────────────────────────────────────────────────
// handleListEmailsDelta
// ──────────────────────────────────────────────────
describe('handleListEmailsDelta', () => {
  it('should perform initial sync', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'msg-1',
          subject: 'New email',
          receivedDateTime: '2024-01-15T10:00:00Z',
        },
        {
          id: 'msg-2',
          subject: 'Another email',
          receivedDateTime: '2024-01-14T09:00:00Z',
        },
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=abc',
    });

    const result = await handleListEmailsDelta({});

    expect(result.content[0].text).toContain('Delta Sync');
    expect(result.content[0].text).toContain('Initial');
    expect(result._meta.syncType).toBe('initial');
    expect(result._meta.itemCount).toBe(2);
    expect(result._meta.deltaToken).toBe(
      'https://graph.microsoft.com/delta?token=abc'
    );
  });

  it('should perform incremental sync with delta token', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        { id: 'msg-3', subject: 'Updated', receivedDateTime: '2024-01-16' },
        { id: 'msg-4', '@removed': { reason: 'deleted' } },
      ],
      '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=def',
    });

    const result = await handleListEmailsDelta({
      deltaToken: 'https://graph.microsoft.com/delta?token=abc',
    });

    expect(result._meta.syncType).toBe('incremental');
    expect(result._meta.changesSummary.updated).toBe(1);
    expect(result._meta.changesSummary.deleted).toBe(1);
  });

  it('should handle minimal verbosity', async () => {
    callGraphAPI.mockResolvedValue({
      value: [{ id: 'msg-1', subject: 'Test' }],
      '@odata.deltaLink': 'token',
    });

    const result = await handleListEmailsDelta({
      outputVerbosity: 'minimal',
    });

    expect(result.content[0].text).toContain('Items');
    expect(result.content[0].text).toContain('Delta Token');
  });

  it('should handle expired delta token', async () => {
    callGraphAPI.mockRejectedValue(
      new Error('410 resyncRequired: delta token expired')
    );

    const result = await handleListEmailsDelta({
      deltaToken: 'expired-token',
    });

    expect(result.content[0].text).toContain('Delta Token Expired');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListEmailsDelta({});
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Server error'));

    const result = await handleListEmailsDelta({});
    expect(result.content[0].text).toBe('Delta sync failed: Server error');
  });

  // #254: `$top` on messages/delta caps the whole sync, not the page; the
  // page size goes in the Prefer header on every request instead.
  describe('page size (#254)', () => {
    const TOKEN =
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc';

    // The initial sync resolves the folder first, so pick out the delta call.
    const deltaCall = () =>
      callGraphAPI.mock.calls.find(
        ([, , path]) => path.endsWith('/messages/delta') || path === TOKEN
      );

    beforeEach(() => {
      callGraphAPI.mockResolvedValue({
        id: 'inbox-id',
        value: [],
        '@odata.deltaLink': TOKEN,
      });
    });

    it('sends the page size as Prefer, never $top, on the initial sync', async () => {
      await handleListEmailsDelta({ deltaMode: true, maxResults: 5 });

      const call = deltaCall();
      expect(call[4].$top).toBeUndefined();
      expect(call[4].$select).toBeDefined();
      expect(call[5]).toEqual({ Prefer: 'odata.maxpagesize=5' });
    });

    it('sends Prefer with no query params when following a token', async () => {
      await handleListEmailsDelta({ deltaToken: TOKEN, maxResults: 5 });

      const call = deltaCall();
      expect(call[4]).toEqual({});
      expect(call[5]).toEqual({ Prefer: 'odata.maxpagesize=5' });
    });

    it('defaults the page size to 100 when following a token', async () => {
      await handleListEmailsDelta({ deltaToken: TOKEN });

      expect(deltaCall()[5]).toEqual({ Prefer: 'odata.maxpagesize=100' });
    });

    it.each([
      [undefined, 100],
      ['abc', 100],
      [NaN, 100],
      [0, 1],
      [-3, 1],
      [1, 1],
      [7.9, 7],
      [200, 200],
      [201, 200],
      [5000, 200],
    ])('clamps maxResults %p to a page size of %p', async (input, expected) => {
      await handleListEmailsDelta({ deltaMode: true, maxResults: input });

      expect(deltaCall()[5]).toEqual({
        Prefer: `odata.maxpagesize=${expected}`,
      });
    });

    it('labels a nextLink page as a continuation with more changes', async () => {
      const nextLink =
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=xyz';
      callGraphAPI.mockResolvedValue({
        id: 'inbox-id',
        value: [{ id: 'msg-1', subject: 'One' }],
        '@odata.nextLink': nextLink,
      });

      const result = await handleListEmailsDelta({
        deltaMode: true,
        maxResults: 1,
      });

      expect(result._meta.tokenType).toBe('continuation');
      expect(result._meta.hasMoreChanges).toBe(true);
      expect(result._meta.deltaToken).toBe(nextLink);
      expect(result.content[0].text).toContain(
        'pass the same `maxResults` on every page'
      );
    });
  });
});

// ──────────────────────────────────────────────────
// handleGetMimeContent
// ──────────────────────────────────────────────────
describe('handleGetMimeContent', () => {
  const mockMimeContent =
    'From: sender@example.com\r\n' +
    'To: recipient@example.com\r\n' +
    'Subject: Test Email\r\n' +
    'Content-Type: text/plain; charset=utf-8\r\n' +
    'Message-ID: <msg123@example.com>\r\n' +
    '\r\n' +
    'This is the email body.\r\n';

  it('should return full MIME content', async () => {
    callGraphAPIRaw.mockResolvedValue(mockMimeContent);

    const result = await handleGetMimeContent({ id: 'email-1' });

    expect(result.content[0].text).toContain('MIME Content');
    expect(result.content[0].text).toContain('sender@example.com');
    expect(result.content[0].text).toContain('Test Email');
    expect(result._meta.emailId).toBe('email-1');
    expect(result._meta.format).toBe('raw');
  });

  it('should return headers only', async () => {
    callGraphAPIRaw.mockResolvedValue(mockMimeContent);

    const result = await handleGetMimeContent({
      id: 'email-1',
      headersOnly: true,
    });

    expect(result.content[0].text).toContain('Headers Only');
    expect(result._meta.headersOnly).toBe(true);
  });

  it('should return base64 encoded content', async () => {
    callGraphAPIRaw.mockResolvedValue(mockMimeContent);

    const result = await handleGetMimeContent({
      id: 'email-1',
      base64: true,
    });

    expect(result.content[0].text).toContain('Base64 Encoded');
    expect(result._meta.format).toBe('base64');
  });

  it('should handle content exceeding size limit', async () => {
    const largeMime = `Subject: Big\r\nContent-Type: text/plain\r\n\r\n${'x'.repeat(2000000)}`;
    callGraphAPIRaw.mockResolvedValue(largeMime);

    const result = await handleGetMimeContent({
      id: 'email-1',
      maxSize: 1024 * 1024,
    });

    expect(result.content[0].text).toContain('Too Large');
    expect(result._meta.truncated).toBe(true);
  });

  it('should require email ID', async () => {
    const result = await handleGetMimeContent({});
    expect(result.content[0].text).toBe('Email ID is required.');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetMimeContent({ id: 'email-1' });
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPIRaw.mockRejectedValue(new Error('MIME fetch failed'));

    const result = await handleGetMimeContent({ id: 'email-1' });
    expect(result.content[0].text).toContain('Failed to get MIME content');
  });
});

// ──────────────────────────────────────────────────
// handleSearchByMessageId
// ──────────────────────────────────────────────────
describe('handleSearchByMessageId', () => {
  it('should find email by Message-ID', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        {
          id: 'email-1',
          subject: 'Found Email',
          from: { emailAddress: { address: 'sender@example.com' } },
        },
      ],
    });

    const result = await handleSearchByMessageId({
      messageId: '<msg123@example.com>',
    });

    expect(result.content[0].text).toContain('Message-ID Search Results');
    expect(result.content[0].text).toContain('1 email(s)');
    expect(result._meta.matchCount).toBe(1);
  });

  it('should handle no results', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleSearchByMessageId({
      messageId: '<nonexistent@example.com>',
    });

    expect(result.content[0].text).toContain('No Email Found');
  });

  it('should require messageId', async () => {
    const result = await handleSearchByMessageId({});
    expect(result.content[0].text).toContain('Message-ID is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSearchByMessageId({
      messageId: '<msg@example.com>',
    });
    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Search failed'));

    const result = await handleSearchByMessageId({
      messageId: '<msg@example.com>',
    });
    expect(result.content[0].text).toBe(
      'Error searching by Message-ID: Search failed'
    );
  });
});
