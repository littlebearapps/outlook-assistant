/**
 * Regression tests: item-scoped readers must route to the owning shared/
 * delegated mailbox when `sharedMailbox`/`email` is supplied.
 *
 * Message IDs are mailbox-scoped — an ID issued by a shared mailbox is not
 * resolvable under /me and returns 404 ErrorInvalidMailboxItemId. These tests
 * lock in the /users/{mailbox} routing for read-email, headers, attachments,
 * and conversation retrieval.
 *
 * folder-utils is intentionally NOT mocked so the real buildMailboxPrefix /
 * resolveFolderPath logic runs.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const handleReadEmail = require('../../email/read');
const { handleGetEmailHeaders } = require('../../email/headers');
const {
  handleListAttachments,
  handleGetAttachmentContent,
  handleDownloadAttachment,
} = require('../../email/attachments');
const { handleGetConversation } = require('../../email/conversations');
const { handleExportEmail } = require('../../email/export');
const { handleGetMimeContent } = require('../../email/mime');
const { callGraphAPI, callGraphAPIRaw } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const TOKEN = 'test_token';
const MAILBOX = 'office@werdropo.com';
const ID = 'AAMkADItem-Id-From-Shared-Mailbox=';

let scratchDir;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(TOKEN);
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-readers-'));
});

afterEach(() => {
  console.error.mockRestore();
  if (scratchDir && fs.existsSync(scratchDir)) {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
});

/** Return the endpoint (3rd positional arg) of the Nth callGraphAPI call. */
function endpointOfCall(n = 0) {
  return callGraphAPI.mock.calls[n][2];
}

describe('read-email shared-mailbox routing', () => {
  test('routes to /users/{mailbox} when sharedMailbox is set', async () => {
    callGraphAPI.mockResolvedValue({ id: ID, subject: 'Hi', body: {} });
    await handleReadEmail({ id: ID, sharedMailbox: MAILBOX });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages/${ID}`);
  });

  test('accepts `email` as an alias', async () => {
    callGraphAPI.mockResolvedValue({ id: ID, subject: 'Hi', body: {} });
    await handleReadEmail({ id: ID, email: MAILBOX });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages/${ID}`);
  });

  test('defaults to /me when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue({ id: ID, subject: 'Hi', body: {} });
    await handleReadEmail({ id: ID });
    expect(endpointOfCall()).toBe(`me/messages/${ID}`);
  });
});

describe('headers (headersMode) shared-mailbox routing', () => {
  test('routes to /users/{mailbox} when sharedMailbox is set', async () => {
    callGraphAPI.mockResolvedValue({ id: ID, internetMessageHeaders: [] });
    await handleGetEmailHeaders({ id: ID, sharedMailbox: MAILBOX });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages/${ID}`);
  });

  test('defaults to /me when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue({ id: ID, internetMessageHeaders: [] });
    await handleGetEmailHeaders({ id: ID });
    expect(endpointOfCall()).toBe(`me/messages/${ID}`);
  });
});

describe('attachments shared-mailbox routing', () => {
  test('list routes to /users/{mailbox}', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleListAttachments({ messageId: ID, sharedMailbox: MAILBOX });
    expect(endpointOfCall()).toBe(
      `users/${MAILBOX}/messages/${ID}/attachments`
    );
  });

  test('view routes to /users/{mailbox}', async () => {
    callGraphAPI.mockResolvedValue({
      name: 'f.txt',
      contentType: 'text/plain',
      '@odata.type': '#microsoft.graph.fileAttachment',
      contentBytes: Buffer.from('hi').toString('base64'),
    });
    await handleGetAttachmentContent({
      messageId: ID,
      attachmentId: 'att-1',
      email: MAILBOX,
    });
    expect(endpointOfCall()).toBe(
      `users/${MAILBOX}/messages/${ID}/attachments/att-1`
    );
  });

  test('download routes metadata fetch to /users/{mailbox}', async () => {
    callGraphAPI.mockResolvedValue({
      name: 'f.bin',
      contentType: 'application/octet-stream',
      '@odata.type': '#microsoft.graph.fileAttachment',
      contentBytes: Buffer.from('x').toString('base64'),
    });
    await handleDownloadAttachment({
      messageId: ID,
      attachmentId: 'att-1',
      sharedMailbox: MAILBOX,
      outputDir: scratchDir,
    });
    expect(endpointOfCall()).toBe(
      `users/${MAILBOX}/messages/${ID}/attachments/att-1`
    );
  });

  test('list defaults to /me when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });
    await handleListAttachments({ messageId: ID });
    expect(endpointOfCall()).toBe(`me/messages/${ID}/attachments`);
  });
});

describe('get-conversation shared-mailbox routing', () => {
  test('routes to /users/{mailbox}/messages when sharedMailbox is set', async () => {
    callGraphAPI.mockResolvedValue({ value: [{ id: ID, subject: 'T' }] });
    await handleGetConversation({
      conversationId: 'conv-1',
      sharedMailbox: MAILBOX,
    });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages`);
  });

  test('defaults to /me/messages when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue({ value: [{ id: ID, subject: 'T' }] });
    await handleGetConversation({ conversationId: 'conv-1' });
    expect(endpointOfCall()).toBe('me/messages');
  });
});

describe('export (target=message) shared-mailbox routing', () => {
  const emailMeta = {
    id: ID,
    subject: 'Hi',
    receivedDateTime: '2026-02-15T10:30:00Z',
    from: { emailAddress: { name: 'A', address: 'a@x.com' } },
    hasAttachments: false,
    body: { content: 'body', contentType: 'text' },
  };

  test('json export fetches metadata from /users/{mailbox}', async () => {
    callGraphAPI.mockResolvedValue(emailMeta);
    await handleExportEmail({
      id: ID,
      format: 'json',
      outputDir: scratchDir,
      sharedMailbox: MAILBOX,
    });
    expect(endpointOfCall()).toBe(`users/${MAILBOX}/messages/${ID}`);
  });

  test('mime/eml export routes raw MIME fetch to the shared mailbox', async () => {
    callGraphAPI.mockResolvedValue(emailMeta);
    callGraphAPIRaw.mockResolvedValue('MIME-Version: 1.0\n\nbody');
    await handleExportEmail({
      id: ID,
      format: 'eml',
      outputDir: scratchDir,
      email: MAILBOX,
    });
    expect(callGraphAPIRaw).toHaveBeenCalledWith(TOKEN, ID, `users/${MAILBOX}`);
  });

  test('defaults to /me when no mailbox supplied', async () => {
    callGraphAPI.mockResolvedValue(emailMeta);
    await handleExportEmail({ id: ID, format: 'json', outputDir: scratchDir });
    expect(endpointOfCall()).toBe(`me/messages/${ID}`);
  });
});

describe('export (target=mime) shared-mailbox routing', () => {
  test('routes raw MIME fetch to /users/{mailbox}', async () => {
    callGraphAPIRaw.mockResolvedValue('MIME-Version: 1.0\r\n\r\nbody');
    await handleGetMimeContent({ id: ID, sharedMailbox: MAILBOX });
    expect(callGraphAPIRaw).toHaveBeenCalledWith(TOKEN, ID, `users/${MAILBOX}`);
  });

  test('defaults to /me when no mailbox supplied', async () => {
    callGraphAPIRaw.mockResolvedValue('MIME-Version: 1.0\r\n\r\nbody');
    await handleGetMimeContent({ id: ID });
    expect(callGraphAPIRaw).toHaveBeenCalledWith(TOKEN, ID, 'me');
  });
});
