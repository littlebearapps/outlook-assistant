/**
 * Tool errors must look like errors (#275).
 *
 * Signed out, no tool call can succeed: each one fails either validation or
 * the sign-in check. Every result must carry `isError: true`, or clients and
 * models treat the failure as a success. Auth failures must point to the
 * real `auth` tool, not the long-gone 'authenticate' tool.
 *
 * Each tool/action runs twice: with only `action` (hits validation), and
 * with every schema property filled in (gets further, usually to the sign-in
 * check).
 */
const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');
const { tokenStorage } = require('../../auth');
const { AUTH_NEXT_STEP } = require('../../utils/tool-error');

const call = createRequestHandler(TOOLS);

/** A plausible value for a schema property, so validation passes. */
function sampleValue(name, schema) {
  if (schema.enum) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === 'boolean') return false;
  if (type === 'number' || type === 'integer') return schema.minimum ?? 1;
  if (type === 'array') {
    return [sampleValue(name, schema.items || { type: 'string' })];
  }
  if (type === 'object') return {};
  if (/mail|recipient|^to$|^cc$|^bcc$/i.test(name)) return 'a@example.com';
  if (/date|time|start|end|after|before/i.test(name)) {
    return '2026-01-01T09:00:00';
  }
  return 'x';
}

function fullArgs(tool, action) {
  const args = {};
  for (const [name, schema] of Object.entries(
    tool.inputSchema?.properties || {}
  )) {
    // Aliases and mailbox targeting add their own validation paths; the
    // shared-mailbox suites cover those.
    if (['email', 'sharedMailbox', 'id', 'kqlQuery'].includes(name)) continue;
    args[name] = sampleValue(name, schema);
  }
  if (action) args.action = action;
  return args;
}

const cases = [];
for (const tool of TOOLS) {
  if (tool.name === 'auth') continue; // reports sign-in state; never needs it
  const actions = tool.inputSchema?.properties?.action?.enum || [undefined];
  for (const action of actions) {
    const label = action ? `${tool.name} action=${action}` : tool.name;
    cases.push([`${label} (action only)`, tool.name, action ? { action } : {}]);
    cases.push([`${label} (all params)`, tool.name, fullArgs(tool, action)]);
  }
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(tokenStorage, 'getValidAccessToken').mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test.each(cases)('%s returns isError', async (_label, name, args) => {
  const result = await call({
    method: 'tools/call',
    params: { name, arguments: args },
    id: 1,
  });
  const text = result.content?.[0]?.text || '';
  expect({ name, args, text, isError: result.isError }).toEqual({
    name,
    args,
    text,
    isError: true,
  });
  if (/Authentication required/.test(text)) {
    expect(text).toContain(AUTH_NEXT_STEP);
  }
});

test('a good share of calls get as far as the sign-in check', async () => {
  let authFailures = 0;
  for (const [, name, args] of cases) {
    const result = await call({
      method: 'tools/call',
      params: { name, arguments: args },
      id: 1,
    });
    if (result.content?.[0]?.text?.startsWith('Authentication required.')) {
      authFailures++;
    }
  }
  expect(authFailures).toBeGreaterThanOrEqual(30);
});
