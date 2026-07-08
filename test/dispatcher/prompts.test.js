const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

function runMcp(requests) {
  const input = requests.map((request) => JSON.stringify(request)).join('\n');
  const result = spawnSync(process.execPath, ['index.js'], {
    cwd: repoRoot,
    input: `${input}\n`,
    encoding: 'utf8',
    timeout: 3000,
    env: {
      ...process.env,
      USE_TEST_MODE: 'true',
      OUTLOOK_CLIENT_ID: 'test-client-id',
    },
  });

  if (result.error) throw result.error;
  return result.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const initializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'prompt-test', version: '1' },
  },
};

describe('MCP prompts protocol', () => {
  test('initialize advertises prompts capability', () => {
    const [response] = runMcp([initializeRequest]);

    expect(response.result.capabilities).toHaveProperty('prompts');
  });

  test('prompts/list returns built-in email workflow prompts', () => {
    const responses = runMcp([
      initializeRequest,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'prompts/list',
      },
    ]);
    const prompts = responses.find((response) => response.id === 2).result
      .prompts;

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      'draft-reply',
      'meeting-prep',
      'triage-inbox',
      'weekly-summary',
    ]);
    expect(prompts.find((prompt) => prompt.name === 'draft-reply')).toEqual(
      expect.objectContaining({
        description: expect.stringContaining('reply'),
        arguments: expect.arrayContaining([
          expect.objectContaining({ name: 'emailId', required: true }),
        ]),
      })
    );
  });

  test('prompts/get interpolates arguments into prompt messages', () => {
    const responses = runMcp([
      initializeRequest,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'prompts/get',
        params: {
          name: 'draft-reply',
          arguments: { emailId: 'message-123' },
        },
      },
    ]);
    const result = responses.find((response) => response.id === 2).result;
    const text = result.messages[0].content.text;

    expect(result.description).toContain('Draft a reply');
    expect(text).toContain('message-123');
    expect(text).toContain('read-email');
    expect(text).toContain('send-email');
    expect(text).toContain('dryRun');
  });

  test('prompts/get rejects unknown prompt names', () => {
    const responses = runMcp([
      initializeRequest,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'prompts/get',
        params: { name: 'not-a-prompt' },
      },
    ]);
    const response = responses.find((item) => item.id === 2);

    expect(response.result.error.code).toBe(-32602);
    expect(response.result.error.message).toContain('Unknown prompt');
  });

  test('tools/list count remains unchanged', () => {
    const responses = runMcp([
      initializeRequest,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      },
    ]);
    const tools = responses.find((response) => response.id === 2).result.tools;

    expect(tools).toHaveLength(23);
  });
});
