/**
 * Tool output text fixes from the v3.14.0 live test (#306).
 *
 * Calls go through the dispatcher, which adds the one "DRY RUN — nothing was
 * changed." line, so previews must not carry a second label of their own.
 */
jest.mock('../../utils/graph-api');

const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const { tokenStorage } = require('../../auth');
const graph = require('../../utils/graph-api');

const call = createRequestHandler(TOOLS);

function run(name, args) {
  return call({
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });
}

const textOf = (result) => result.content[0].text;
const count = (text, needle) => text.split(needle).length - 1;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue('token');
  graph.callGraphAPI.mockReset();
  graph.callGraphAPIRaw.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('send-email dry run says DRY RUN once', async () => {
  const text = textOf(
    await run('send-email', {
      to: 'a@example.com',
      subject: 'S',
      body: 'B',
      dryRun: true,
    })
  );
  expect(count(text, 'DRY RUN')).toBe(1);
  expect(text).toMatch(/Email NOT sent\./);
  expect(text).toMatch(/Save to Sent: true/);
});

test('draft create dry run says DRY RUN once and has no "Save to Sent"', async () => {
  const text = textOf(
    await run('draft', {
      action: 'create',
      to: 'a@example.com',
      subject: 'S',
      body: 'B',
      dryRun: true,
    })
  );
  expect(count(text, 'DRY RUN')).toBe(1);
  expect(text).toMatch(/Draft NOT saved\./);
  expect(text).not.toMatch(/Save to Sent/);
});

test('manage-rules create dry run says DRY RUN once', async () => {
  const text = textOf(
    await run('manage-rules', {
      action: 'create',
      name: 'R',
      containsSubject: 'x',
      markAsRead: true,
      dryRun: true,
    })
  );
  expect(count(text, 'DRY RUN')).toBe(1);
  expect(text).toMatch(/Rule preview \(not created\):/);
});

test('draft reply result reads "Reply draft created."', async () => {
  graph.callGraphAPI.mockImplementation((_t, method) =>
    Promise.resolve(
      method === 'POST'
        ? {
            id: 'd1',
            subject: 'RE: S',
            toRecipients: [{ emailAddress: { address: 'a@example.com' } }],
          }
        : { value: [] }
    )
  );
  const text = textOf(await run('draft', { action: 'reply', id: 'm1' }));
  expect(text).toMatch(/^Reply draft created\./);
  expect(text).not.toMatch(/Draft reply draft/);
});

test('manage-category set works and says it is deprecated', async () => {
  graph.callGraphAPI.mockResolvedValue({
    id: 'c1',
    displayName: 'Blue',
    color: 'preset7',
  });
  const text = textOf(
    await run('manage-category', { action: 'set', id: 'c1', color: 'preset7' })
  );
  expect(text).toMatch(/Category updated/);
  expect(text).toMatch(/action=`set` is a deprecated alias for `update`/);
});

test('export target=mime headersOnly keeps the headers within maxSize', async () => {
  const headers = Array.from(
    { length: 200 },
    (_, i) => `X-Header-${i}: ${'v'.repeat(40)}`
  ).join('\r\n');
  graph.callGraphAPIRaw.mockResolvedValue(
    `${headers}\r\nSubject: S\r\n\r\nbody`
  );
  const result = await run('export', {
    target: 'mime',
    id: 'm1',
    headersOnly: true,
    maxSize: 2000,
  });
  const block = textOf(result).split('```')[1];
  expect(Buffer.byteLength(block, 'utf8')).toBeLessThan(2200);
  expect(textOf(result)).toMatch(/headers cut at maxSize 2000 bytes/);
});

test('attachments view names the real download action', async () => {
  graph.callGraphAPI.mockResolvedValue({
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'photo.jpg',
    contentType: 'image/jpeg',
    size: 2048,
    contentBytes: 'AAAA',
  });
  const text = textOf(
    await run('attachments', {
      action: 'view',
      messageId: 'm1',
      attachmentId: 'a1',
    })
  );
  expect(text).toMatch(/Use `attachments` action=`download`/);
  expect(text).not.toMatch(/download-attachment/);
});
