/**
 * Conversation reads and exports must work on personal Microsoft accounts.
 * Graph rejects `$filter=conversationId eq '…'` combined with `$orderby` with
 * `400 InefficientFilter` there, so the query carries no `$orderby`: the
 * messages are fetched (every page) and sorted by `receivedDateTime` locally.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleGetConversation,
  handleExportConversation,
} = require('../../email/conversations');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

function msg(id, receivedDateTime) {
  return {
    id,
    subject: 'Thread',
    from: { emailAddress: { name: 'Sam', address: 'sam@example.com' } },
    toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
    receivedDateTime,
    body: { contentType: 'text', content: `body of ${id}` },
  };
}

// Deliberately out of order, with one message missing its date.
const SHUFFLED = [
  msg('m3', '2026-09-03T00:00:00Z'),
  msg('m-nodate', undefined),
  msg('m1', '2026-09-01T00:00:00Z'),
  msg('m2', '2026-09-02T00:00:00Z'),
];

let outputDir;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('test_token');
  callGraphAPI.mockResolvedValue({ value: SHUFFLED });
  outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-conv-order-'));
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(outputDir, { recursive: true, force: true });
});

async function exportJson(extra = {}) {
  const result = await handleExportConversation({
    conversationId: 'c1',
    format: 'json',
    outputDir,
    ...extra,
  });
  const json = JSON.parse(fs.readFileSync(result._meta.files[0], 'utf8'));
  return json.messages.map((m) => m.id);
}

describe('conversation query', () => {
  test('get-conversation filters by conversationId without $orderby', async () => {
    await handleGetConversation({ conversationId: 'c1' });

    const params = callGraphAPI.mock.calls[0][4];
    expect(params.$filter).toBe("conversationId eq 'c1'");
    expect(params).not.toHaveProperty('$orderby');
  });

  test.each(['chronological', 'reverse'])(
    'conversation export (order=%s) filters without $orderby',
    async (order) => {
      await exportJson({ order });

      const params = callGraphAPI.mock.calls[0][4];
      expect(params.$filter).toBe("conversationId eq 'c1'");
      expect(params).not.toHaveProperty('$orderby');
    }
  );
});

describe('client-side ordering', () => {
  test('get-conversation lists messages oldest first, undated last', async () => {
    const result = await handleGetConversation({ conversationId: 'c1' });
    const text = result.content[0].text;

    const positions = ['m1', 'm2', 'm3', 'm-nodate'].map((id) =>
      text.indexOf(`body of ${id}`)
    );
    positions.forEach((p) => expect(p).toBeGreaterThan(-1));
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  test('export defaults to chronological order, undated last', async () => {
    expect(await exportJson()).toEqual(['m1', 'm2', 'm3', 'm-nodate']);
  });

  test('export order=reverse is newest first, undated still last', async () => {
    expect(await exportJson({ order: 'reverse' })).toEqual([
      'm3',
      'm2',
      'm1',
      'm-nodate',
    ]);
  });

  test('messages with the same date keep their fetched order', async () => {
    callGraphAPI.mockResolvedValue({
      value: [
        msg('b', '2026-09-01T00:00:00Z'),
        msg('a', '2026-09-01T00:00:00Z'),
      ],
    });
    expect(await exportJson()).toEqual(['b', 'a']);
  });
});

describe('pagination', () => {
  const NEXT =
    "https://graph.microsoft.com/v1.0/me/messages?$filter=conversationId eq 'c1'&$skip=2";

  beforeEach(() => {
    callGraphAPI
      .mockResolvedValueOnce({
        value: [
          msg('m4', '2026-09-04T00:00:00Z'),
          msg('m2', '2026-09-02T00:00:00Z'),
        ],
        '@odata.nextLink': NEXT,
      })
      .mockResolvedValueOnce({
        value: [
          msg('m3', '2026-09-03T00:00:00Z'),
          msg('m1', '2026-09-01T00:00:00Z'),
        ],
      });
  });

  test('export follows @odata.nextLink and sorts across pages', async () => {
    expect(await exportJson()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    expect(callGraphAPI.mock.calls[1][3]).toBeNull();
    expect(callGraphAPI.mock.calls[1][2]).toBe(NEXT);
  });

  test('get-conversation follows @odata.nextLink', async () => {
    const result = await handleGetConversation({ conversationId: 'c1' });
    expect(result._meta.messageCount).toBe(4);
    expect(callGraphAPI.mock.calls[1][2]).toBe(NEXT);
  });
});

describe('conversationId escaping', () => {
  test('a single quote in the ID is doubled inside the $filter literal', async () => {
    await handleGetConversation({ conversationId: "ab'cd" });

    expect(callGraphAPI.mock.calls[0][4].$filter).toBe(
      "conversationId eq 'ab''cd'"
    );
  });

  test.each([
    ['get-conversation', () => handleGetConversation],
    ['conversation export', () => handleExportConversation],
  ])('%s keeps an injection payload inside the literal', async (_n, get) => {
    const payload = "x' or conversationId ne 'x";
    await get()({ conversationId: payload, format: 'json', outputDir });

    const filter = callGraphAPI.mock.calls[0][4].$filter;
    expect(filter).toBe("conversationId eq 'x'' or conversationId ne ''x'");
    // Strip the escaped quotes: exactly one literal remains, wrapping it all.
    expect(filter.replace(/''/g, '')).toMatch(/^conversationId eq '[^']*'$/);
  });
});

describe('fetch limits', () => {
  const page = (start, n) =>
    Array.from({ length: n }, (_, i) =>
      msg(
        `m${start + i}`,
        new Date(Date.UTC(2026, 0, 1) + (start + i) * 60000).toISOString()
      )
    );

  test('get-conversation stops at 100 messages and says it was truncated', async () => {
    let calls = 0;
    callGraphAPI.mockImplementation(() => {
      const start = calls * 100;
      calls += 1;
      return {
        value: page(start, 100),
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/messages?$skip=${start + 100}`,
      };
    });

    const result = await handleGetConversation({ conversationId: 'c1' });

    expect(callGraphAPI).toHaveBeenCalledTimes(1);
    expect(result._meta.messageCount).toBe(100);
    expect(result._meta.truncated).toBe(true);
    expect(result.content[0].text).toContain(
      'Conversation truncated at 100 messages'
    );
  });

  test('get-conversation trims an oversized page to 100 messages', async () => {
    callGraphAPI.mockResolvedValue({ value: page(0, 150) });

    const result = await handleGetConversation({ conversationId: 'c1' });

    expect(result._meta.messageCount).toBe(100);
    expect(result._meta.truncated).toBe(true);
  });

  test('get-conversation with exactly 100 messages and no nextLink is complete', async () => {
    callGraphAPI.mockResolvedValue({ value: page(0, 100) });

    const result = await handleGetConversation({ conversationId: 'c1' });

    expect(result._meta.messageCount).toBe(100);
    expect(result._meta.truncated).toBe(false);
  });

  test('export reports truncation in its text and _meta', async () => {
    let calls = 0;
    callGraphAPI.mockImplementation(() => {
      const start = calls * 100;
      calls += 1;
      return {
        value: page(start, 100),
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/messages?$skip=${start + 100}`,
      };
    });

    const result = await handleExportConversation({
      conversationId: 'c1',
      format: 'json',
      outputDir,
    });

    expect(callGraphAPI).toHaveBeenCalledTimes(10);
    expect(result._meta.messageCount).toBe(1000);
    expect(result._meta.truncated).toBe(true);
    expect(result.content[0].text).toContain(
      'Conversation truncated at 1000 messages'
    );
    const json = JSON.parse(fs.readFileSync(result._meta.files[0], 'utf8'));
    expect(json.messages).toHaveLength(1000);
    expect(json.messages[0].id).toBe('m0');
  });

  test('stops when Graph repeats a nextLink', async () => {
    const LOOP = 'https://graph.microsoft.com/v1.0/me/messages?$skip=2';
    let calls = 0;
    callGraphAPI.mockImplementation(() => {
      const start = calls * 2;
      calls += 1;
      return { value: page(start, 2), '@odata.nextLink': LOOP };
    });

    const result = await handleGetConversation({ conversationId: 'c1' });

    expect(callGraphAPI).toHaveBeenCalledTimes(2);
    expect(result._meta.messageCount).toBe(4);
    expect(result._meta.truncated).toBe(true);
    expect(result.content[0].text).toContain(
      'Conversation truncated at 4 messages'
    );
  });

  test('a complete conversation is not marked truncated', async () => {
    const result = await handleGetConversation({ conversationId: 'c1' });
    expect(result._meta.truncated).toBe(false);
    expect(result.content[0].text).not.toContain('truncated');
  });
});

describe('Graph errors', () => {
  const inefficient = new Error(
    'API call failed with status 400: {"error":{"code":"InefficientFilter","message":"The restriction or sort order is too complex for this operation."}}'
  );

  test('get-conversation reports the Graph error, not a personal-account claim', async () => {
    callGraphAPI.mockRejectedValue(inefficient);
    const result = await handleGetConversation({ conversationId: 'c1' });
    const text = result.content[0].text;

    expect(text).toContain('InefficientFilter');
    expect(text).not.toMatch(/personal Microsoft account/i);
  });

  test('conversation export reports the Graph error, not a personal-account claim', async () => {
    callGraphAPI.mockRejectedValue(inefficient);
    const result = await handleExportConversation({
      conversationId: 'c1',
      format: 'markdown',
      outputDir,
    });
    const text = result.content[0].text;

    expect(text).toContain('InefficientFilter');
    expect(text).not.toMatch(/personal Microsoft account/i);
    expect(fs.readdirSync(outputDir)).toEqual([]);
  });
});
