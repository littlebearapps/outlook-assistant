// The conversation markdown export must use the shared stripHtml helper so
// entities are decoded once and no markup survives (CodeQL alert #9).

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { handleExportConversation } = require('../../email/conversations');

let outputDir;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue('test_token');
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outlook-conv-md-'));
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(outputDir, { recursive: true, force: true });
});

test('markdown export strips markup and decodes entities once', async () => {
  callGraphAPI.mockResolvedValue({
    value: [
      {
        id: 'm1',
        subject: 'Hello',
        from: { emailAddress: { name: 'Sam', address: 'sam@example.com' } },
        toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
        receivedDateTime: '2026-09-30T00:00:00Z',
        body: {
          contentType: 'html',
          content:
            '<p>Use &amp;lt;tag&amp;gt; &quot;literally&quot;</p><scr<script>ipt>alert(1)</script>',
        },
      },
    ],
  });

  await handleExportConversation({
    conversationId: 'c1',
    format: 'markdown',
    outputDir,
  });

  const [file] = fs.readdirSync(outputDir).filter((f) => f.endsWith('.md'));
  const md = fs.readFileSync(path.join(outputDir, file), 'utf8');

  expect(md).toContain('Use &lt;tag&gt; "literally"');
  expect(md).not.toMatch(/<\/?script/i);
});
