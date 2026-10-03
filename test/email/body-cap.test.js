/**
 * #279: outputVerbosity=full had no size cap, so one huge message could flood
 * the client. Tool results now cap each body at
 * DEFAULT_LIMITS.maxFullBodyChars and say how to get the rest; a file export
 * still writes the whole message.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const handleReadEmail = require('../../email/read');
const { handleGetConversation } = require('../../email/conversations');
const { handleExportEmail } = require('../../email/export');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { DEFAULT_LIMITS } = require('../../utils/response-formatter');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const { enableSharedMailbox } = require('../helpers/shared-mailbox');

enableSharedMailbox();

const CAP = DEFAULT_LIMITS.maxFullBodyChars;
const LENGTH = CAP + 5000;

const bigEmail = {
  id: 'AAMk-big',
  conversationId: 'conv-1',
  subject: 'Big',
  receivedDateTime: '2026-09-01T00:00:00Z',
  from: { emailAddress: { name: 'A', address: 'a@example.com' } },
  hasAttachments: false,
  body: { contentType: 'text', content: 'y'.repeat(LENGTH) },
};

let scratchDir;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('test_token');
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'body-cap-'));
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe('read-email outputVerbosity=full', () => {
  test('caps the body and names the export call for the rest', async () => {
    callGraphAPI.mockResolvedValue(bigEmail);
    const result = await handleReadEmail({
      id: 'AAMk-big',
      outputVerbosity: 'full',
    });
    const text = result.content[0].text;

    expect(text).toContain('y'.repeat(CAP));
    expect(text).not.toContain('y'.repeat(CAP + 1));
    expect(text).toMatch(/export with target=message, id=`AAMk-big`/);
  });

  test('carries a shared mailbox into the hint', async () => {
    callGraphAPI.mockResolvedValue(bigEmail);
    const result = await handleReadEmail({
      id: 'AAMk-big',
      outputVerbosity: 'full',
      email: 'team@example.com',
    });
    expect(result.content[0].text).toContain('sharedMailbox=team@example.com');
  });
});

describe('search-emails conversationId at outputVerbosity=full', () => {
  test('caps each body', async () => {
    callGraphAPI.mockResolvedValue({ value: [bigEmail] });
    const result = await handleGetConversation({
      conversationId: 'conv-1',
      outputVerbosity: 'full',
    });
    const text = result.content[0].text;

    expect(text).not.toContain('y'.repeat(CAP + 1));
    expect(text).toMatch(/export with target=message, id=`AAMk-big`/);
  });
});

describe('export target=message format=markdown', () => {
  test('writes the whole body to the file', async () => {
    callGraphAPI.mockResolvedValue(bigEmail);
    const result = await handleExportEmail({
      id: 'AAMk-big',
      format: 'markdown',
      savePath: scratchDir,
    });
    const written = fs.readFileSync(result._meta.filePath, 'utf8');

    expect(written).toContain('y'.repeat(LENGTH));
    expect(written).not.toContain('truncated');
  });
});
