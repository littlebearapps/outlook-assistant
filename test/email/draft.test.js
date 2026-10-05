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

    expect(result.content[0].text).toContain('Draft NOT saved');
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

describe('action=create with checkRecipients (#272)', () => {
  it('returns the mail tips and keeps them out of the draft payload', async () => {
    callGraphAPI.mockImplementation((_token, _method, path) =>
      Promise.resolve(
        path === 'me/getMailTips'
          ? {
              value: [
                {
                  emailAddress: { address: 'user@example.com' },
                  automaticReplies: { message: 'Away until Monday' },
                },
              ],
            }
          : mockDraftResponse
      )
    );

    const result = await handleDraft({
      action: 'create',
      to: 'user@example.com',
      subject: 'Test Draft',
      body: 'Hello draft',
      checkRecipients: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Draft created');
    expect(result.content[0].text).toContain('Away until Monday');
    expect(result._meta.draftId).toBe('draft-123');
    expect(result._meta.mailTips.warningCount).toBe(1);

    const createCall = callGraphAPI.mock.calls.find(
      ([, , path]) => path === 'me/messages'
    );
    expect(
      Object.keys(createCall[3]).filter((key) => key.startsWith('_'))
    ).toEqual([]);
  });
});

// ──────────────────────────────────────────────────
// action=update
// ──────────────────────────────────────────────────
describe('action=update', () => {
  it('should update a draft', async () => {
    callGraphAPI
      .mockResolvedValueOnce({ id: 'draft-123', isDraft: true })
      .mockResolvedValueOnce({
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
    callGraphAPI
      .mockResolvedValueOnce({ id: 'draft-123', isDraft: true })
      .mockResolvedValueOnce(undefined); // 202 no body

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
    callGraphAPI
      .mockResolvedValueOnce({ id: 'draft-123', isDraft: true })
      .mockResolvedValueOnce(undefined); // 204 no body

    const result = await handleDraft({
      action: 'delete',
      id: 'draft-123',
    });

    expect(result.content[0].text).toContain('deleted');
    // Graph DELETE skips Deleted Items: the draft lands in Recoverable Items
    expect(result.content[0].text).toContain('Recoverable Items');
    expect(result.content[0].text).not.toContain('moved to Deleted Items');
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
// update/send/delete refuse ids that are not drafts (#246)
// ──────────────────────────────────────────────────
describe('draft guard: update/send/delete only act on drafts', () => {
  const receivedMessage = {
    id: 'msg-received',
    isDraft: false,
    subject: 'Weekly newsletter',
  };

  const mutations = [
    {
      action: 'update',
      args: { subject: 'Weekly newsletter' },
      method: 'PATCH',
      path: 'me/messages/msg-received',
      select: 'id,isDraft,subject',
    },
    {
      action: 'send',
      args: {},
      method: 'POST',
      path: 'me/messages/msg-received/send',
      // send also re-reads the recipients for the allowlist check
      select: 'id,isDraft,subject,toRecipients,ccRecipients,bccRecipients',
    },
    {
      action: 'delete',
      args: {},
      method: 'DELETE',
      path: 'me/messages/msg-received',
      select: 'id,isDraft,subject',
    },
  ];

  it.each(mutations)(
    'action=$action refuses a non-draft with one GET and no mutation',
    async ({ action, args, select }) => {
      callGraphAPI.mockResolvedValueOnce(receivedMessage);

      const result = await handleDraft({ action, id: 'msg-received', ...args });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('is not a draft');
      expect(result.content[0].text).toContain('Weekly newsletter');
      expect(callGraphAPI).toHaveBeenCalledTimes(1);
      expect(callGraphAPI).toHaveBeenCalledWith(
        mockAccessToken,
        'GET',
        'me/messages/msg-received',
        null,
        { $select: select }
      );
    }
  );

  it.each(mutations)(
    'action=$action on a draft checks first, then mutates as call #2',
    async ({ action, args, method, path }) => {
      callGraphAPI
        .mockResolvedValueOnce({ ...receivedMessage, isDraft: true })
        .mockResolvedValueOnce(mockDraftResponse);

      const result = await handleDraft({ action, id: 'msg-received', ...args });

      expect(result.isError).toBeUndefined();
      expect(callGraphAPI).toHaveBeenCalledTimes(2);
      expect(callGraphAPI.mock.calls[0][1]).toBe('GET');
      expect(callGraphAPI.mock.calls[1][1]).toBe(method);
      expect(callGraphAPI.mock.calls[1][2]).toBe(path);
    }
  );

  it.each(mutations)(
    'action=$action reports "Draft not found" on a 404',
    async ({ action, args }) => {
      callGraphAPI.mockRejectedValueOnce(
        new Error(
          'API call failed with status 404: {"error":{"code":"ErrorItemNotFound","message":"The specified object was not found in the store."}}'
        )
      );

      const result = await handleDraft({ action, id: 'gone-id', ...args });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Draft not found');
      expect(result.content[0].text).toContain('gone-id');
      expect(callGraphAPI).toHaveBeenCalledTimes(1);
    }
  );

  it('passes other lookup errors through unchanged', async () => {
    callGraphAPI.mockRejectedValueOnce(
      new Error('API call failed with status 500: boom')
    );

    const result = await handleDraft({ action: 'delete', id: 'draft-123' });

    expect(result.content[0].text).toContain(
      'Error deleting draft: API call failed with status 500: boom'
    );
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['update', 'OUTLOOK_MAX_DRAFT_PER_SESSION', { subject: 'S' }],
    ['send', 'OUTLOOK_MAX_SEND_EMAIL_PER_SESSION', {}],
  ])(
    'a refused action=%s does not consume a rate-limit slot',
    async (action, envKey, args) => {
      process.env[envKey] = '1';
      try {
        // Refused: not a draft — must not count against the limit
        callGraphAPI.mockResolvedValueOnce(receivedMessage);
        const refused = await handleDraft({
          action,
          id: 'msg-received',
          ...args,
        });
        expect(refused.content[0].text).toContain('is not a draft');

        // The single allowed slot is still available for a real draft
        callGraphAPI
          .mockResolvedValueOnce({ id: 'draft-123', isDraft: true })
          .mockResolvedValueOnce(mockDraftResponse);
        const allowed = await handleDraft({ action, id: 'draft-123', ...args });
        expect(allowed.content[0].text).not.toContain('Rate limit reached');
        expect(callGraphAPI).toHaveBeenCalledTimes(3);
      } finally {
        delete process.env[envKey];
      }
    }
  );
});

describe('draft tool description', () => {
  const { emailTools } = require('../../email');
  const draftTool = emailTools.find((t) => t.name === 'draft');

  it('does not claim delete is permanent', () => {
    expect(draftTool.description).not.toMatch(/permanent/i);
    // Verified live (v3.12.1): Graph DELETE puts the draft in Recoverable
    // Items (Deletions), not Deleted Items
    expect(draftTool.description).toContain('Recoverable Items');
    expect(draftTool.description).not.toMatch(
      /moves? (a|the) draft to Deleted Items/
    );
  });

  it('says update/send/delete refuse non-drafts', () => {
    expect(draftTool.description).toMatch(/refuse/i);
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

    expect(result.content[0].text).toContain('Reply draft created');
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

    expect(result.content[0].text).toContain('Reply-all draft created');
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

    expect(result.content[0].text).toContain('Forward draft created');
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
