const {
  toolError,
  authRequiredError,
  AUTH_NEXT_STEP,
} = require('../../utils/tool-error');

describe('toolError', () => {
  test('returns a visible MCP tool error', () => {
    expect(toolError('Email ID is required.')).toEqual({
      content: [{ type: 'text', text: 'Email ID is required.' }],
      isError: true,
    });
  });

  test('appends the next step when given', () => {
    const result = toolError('Rule not found.', {
      nextStep: 'List rules with manage-rules action=list.',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'Rule not found.\n\nNext step: List rules with manage-rules action=list.'
    );
  });
});

describe('authRequiredError', () => {
  test('is an error that names the auth tool and action', () => {
    const result = authRequiredError();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^Authentication required\./);
    expect(result.content[0].text).toContain(AUTH_NEXT_STEP);
    expect(AUTH_NEXT_STEP).toMatch(/`auth` tool with action=authenticate/);
  });
});

describe('legacy wording (#275)', () => {
  test("no source file tells the model to use an 'authenticate' tool", () => {
    const { execSync } = require('child_process');
    const hits = execSync(
      "git grep -n -I -e \"'authenticate' tool\" -- '*.js' ':!test' || true",
      { cwd: require('path').join(__dirname, '..', '..'), encoding: 'utf8' }
    ).trim();
    expect(hits).toBe('');
  });
});
