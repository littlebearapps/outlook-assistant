// tools/list must publish the spec's top-level `title` and the full,
// risk-derived annotations for every tool (#277).
const { createRequestHandler } = require('../../request-handler');
const { TOOLS } = require('../../tools');

describe('tools/list', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  test('lists every tool with title, annotations and inputSchema', async () => {
    const result = await createRequestHandler(TOOLS)({
      method: 'tools/list',
      id: 1,
    });

    expect(result.tools).toHaveLength(TOOLS.length);
    for (const listed of result.tools) {
      const tool = TOOLS.find((t) => t.name === listed.name);
      expect(listed.title).toBe(tool.title);
      expect(listed.annotations).toEqual(tool.annotations);
      expect(listed.inputSchema).toBe(tool.inputSchema);
      expect(listed.handler).toBeUndefined();
    }
  });
});
