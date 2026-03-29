const handleDraft = require('../../email/draft');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

const mockDraftResponse = {
  id: 'draft-123',
  subject: 'Test Draft',
  toRecipients: [{ emailAddress: { address: 'user@example.com' } }],
  lastModifiedDateTime: '2026-03-26T10:00:00Z',
  isDraft: true,
  hasAttachments: false,
};

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

// ──────────────────────────────────────────────────
// Action validation
// ──────────────────────────────────────────────────
describe('action validation', () => {
  it('should require action', async () => {
    const result = await handleDraft({});
    expect(result.content[0].text).toContain('Action is required');
  });

  it('should reject invalid action', async () => {
    const result = await handleDraft({ action: 'invalid' });
    expect(result.content[0].text).toContain("Invalid action 'invalid'");
  });
});

// ──────────────────────────────────────────────────
// action=create
// ──────────────────────────────────────────────────
describe('action=create', () => {
  it('should create a draft with all fields', async () => {
    callGraphAPI.mockResolvedValue(mockDraftResponse);

    const result = await handleDraft({
      action: 'create',
      to: 'user@example.com',
      cc: 'cc@example.com',
      subject: 'Test Draft',
      body: 'Hello draft',
      importance: 'high',
    });

    expect(result.content[0].text).toContain('Draft created');
    expect(result.content[0].text).toContain('draft-123');
    expect(result._meta.draftId).toBe('draft-123');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages',
      expect.objectContaining({
        subject: 'Test Draft',
        body: expect.objectContaining({
          contentType: 'text',
          content: 'Hello draft',
        }),
        importance: 'high',
        toRecipients: [{ emailAddress: { address: 'user@example.com' } }],
        ccRecipients: [{ emailAddress: { address: 'cc@example.com' } }],
      })
    );
  });

  it('should create a draft with minimal fields', async () => {
    callGraphAPI.mockResolvedValue({ id: 'draft-456', isDraft: true });

    const result = await handleDraft({
      action: 'create',
      subject: 'Just a subject',
    });

    expect(result.content[0].text).toContain('Draft created');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages',
      expect.objectContaining({ subject: 'Just a subject' })
    );
  });

  it('should detect HTML body content type', async () => {
    callGraphAPI.mockResolvedValue(mockDraftResponse);

    await handleDraft({
      action: 'create',
      subject: 'HTML draft',
      body: '<p>Hello <strong>world</strong></p>',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages',
      expect.objectContaining({
        body: expect.objectContaining({ contentType: 'html' }),
      })
    );
  });

  it('should support dry-run preview', async () => {
    const result = await handleDraft({
      action: 'create',
      to: 'user@example.com',
      subject: 'Preview',
      body: 'Test body',
      dryRun: true,
    });

    expect(result.content[0].text).toContain('DRY RUN');
    expect(result.content[0].text).toContain('Draft NOT saved');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDraft({
      action: 'create',
      subject: 'Test',
    });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Bad Request'));

    const result = await handleDraft({
      action: 'create',
      subject: 'Test',
    });

    expect(result.content[0].text).toContain('Error creating draft');
    expect(result.content[0].text).toContain('Bad Request');
  });
});

// ──────────────────────────────────────────────────
// action=update
// ──────────────────────────────────────────────────
describe('action=update', () => {
  it('should update a draft', async () => {
    callGraphAPI.mockResolvedValue({
      ...mockDraftResponse,
      subject: 'Updated Subject',
    });

    const result = await handleDraft({
      action: 'update',
      id: 'draft-123',
      subject: 'Updated Subject',
      body: 'Updated body',
    });

    expect(result.content[0].text).toContain('Draft updated');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'me/messages/draft-123',
      expect.objectContaining({ subject: 'Updated Subject' })
    );
  });

  it('should require id for update', async () => {
    const result = await handleDraft({ action: 'update', subject: 'Test' });
    expect(result.content[0].text).toContain('Draft ID (id) is required');
  });
});

// ──────────────────────────────────────────────────
// action=send
// ──────────────────────────────────────────────────
describe('action=send', () => {
  it('should send a draft', async () => {
    callGraphAPI.mockResolvedValue(undefined); // 202 no body

    const result = await handleDraft({
      action: 'send',
      id: 'draft-123',
    });

    expect(result.content[0].text).toContain('Draft sent successfully');
    expect(result.content[0].text).toContain('no longer valid');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/draft-123/send'
    );
  });

  it('should require id for send', async () => {
    const result = await handleDraft({ action: 'send' });
    expect(result.content[0].text).toContain('Draft ID (id) is required');
  });
});

// ──────────────────────────────────────────────────
// action=delete
// ──────────────────────────────────────────────────
describe('action=delete', () => {
  it('should delete a draft', async () => {
    callGraphAPI.mockResolvedValue(undefined); // 204 no body

    const result = await handleDraft({
      action: 'delete',
      id: 'draft-123',
    });

    expect(result.content[0].text).toContain('deleted');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'DELETE',
      'me/messages/draft-123'
    );
  });

  it('should require id for delete', async () => {
    const result = await handleDraft({ action: 'delete' });
    expect(result.content[0].text).toContain('Draft ID (id) is required');
  });
});

// ──────────────────────────────────────────────────
// action=reply / reply-all
// ──────────────────────────────────────────────────
describe('action=reply', () => {
  it('should create a reply draft', async () => {
    callGraphAPI.mockResolvedValue(mockDraftResponse);

    const result = await handleDraft({
      action: 'reply',
      id: 'msg-456',
      comment: 'Thanks for this!',
    });

    expect(result.content[0].text).toContain('reply draft created');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/msg-456/createReply',
      { comment: 'Thanks for this!' }
    );
  });

  it('should create a reply draft with body instead of comment', async () => {
    callGraphAPI.mockResolvedValue(mockDraftResponse);

    await handleDraft({
      action: 'reply',
      id: 'msg-456',
      body: '<p>Detailed reply</p>',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/msg-456/createReply',
      {
        message: {
          body: { contentType: 'html', content: '<p>Detailed reply</p>' },
        },
      }
    );
  });

  it('should create reply-all draft', async () => {
    callGraphAPI.mockResolvedValue(mockDraftResponse);

    const result = await handleDraft({
      action: 'reply-all',
      id: 'msg-456',
    });

    expect(result.content[0].text).toContain('reply-all draft created');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/msg-456/createReplyAll',
      null
    );
  });

  it('should require id for reply', async () => {
    const result = await handleDraft({ action: 'reply' });
    expect(result.content[0].text).toContain('Message ID (id) is required');
  });

  it('should reject both comment and body', async () => {
    const result = await handleDraft({
      action: 'reply',
      id: 'msg-456',
      comment: 'Short note',
      body: '<p>Full body</p>',
    });
    expect(result.content[0].text).toContain(
      'Cannot use both comment and body'
    );
  });
});

// ──────────────────────────────────────────────────
// action=forward
// ──────────────────────────────────────────────────
describe('action=forward', () => {
  it('should create a forward draft', async () => {
    callGraphAPI.mockResolvedValue(mockDraftResponse);

    const result = await handleDraft({
      action: 'forward',
      id: 'msg-456',
      to: 'forward@example.com',
      comment: 'FYI',
    });

    expect(result.content[0].text).toContain('forward draft created');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/messages/msg-456/createForward',
      {
        toRecipients: [{ emailAddress: { address: 'forward@example.com' } }],
        comment: 'FYI',
      }
    );
  });

  it('should require id for forward', async () => {
    const result = await handleDraft({
      action: 'forward',
      to: 'user@example.com',
    });
    expect(result.content[0].text).toContain('Message ID (id) is required');
  });

  it('should require to for forward', async () => {
    const result = await handleDraft({ action: 'forward', id: 'msg-456' });
    expect(result.content[0].text).toContain(
      'Forward recipient (to) is required'
    );
  });

  it('should reject both comment and body', async () => {
    const result = await handleDraft({
      action: 'forward',
      id: 'msg-456',
      to: 'user@example.com',
      comment: 'FYI',
      body: '<p>Full body</p>',
    });
    expect(result.content[0].text).toContain(
      'Cannot use both comment and body'
    );
  });
});
