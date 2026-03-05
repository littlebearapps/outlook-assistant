const { handleListRules } = require('../../rules/list');
const handleCreateRule = require('../../rules/create');
const { handleEditRuleSequence, handleDeleteRule } = require('../../rules');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');
const { getFolderIdByName } = require('../../email/folder-utils');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');
jest.mock('../../email/folder-utils');

const mockAccessToken = 'test_token';

const mockRules = [
  {
    id: 'rule-1',
    displayName: 'Move newsletters',
    isEnabled: true,
    sequence: 1,
    conditions: {
      fromAddresses: [{ emailAddress: { address: 'news@example.com' } }],
    },
    actions: {
      moveToFolder: 'folder-123',
      markAsRead: true,
    },
  },
  {
    id: 'rule-2',
    displayName: 'Flag important',
    isEnabled: false,
    sequence: 2,
    conditions: {
      subjectContains: ['urgent', 'important'],
    },
    actions: {
      markImportance: 'high',
    },
  },
];

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleListRules', () => {
  it('should list rules as simple list', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRules });

    const result = await handleListRules({});

    expect(result.content[0].text).toContain('Found 2 inbox rules');
    expect(result.content[0].text).toContain('Move newsletters');
    expect(result.content[0].text).toContain('Flag important');
    expect(result.content[0].text).toContain('(Disabled)');
  });

  it('should list rules with details', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRules });

    const result = await handleListRules({ includeDetails: true });

    expect(result.content[0].text).toContain('Conditions:');
    expect(result.content[0].text).toContain('Actions:');
    expect(result.content[0].text).toContain('news@example.com');
    expect(result.content[0].text).toContain('Mark as read');
  });

  it('should handle empty rules', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleListRules({});

    expect(result.content[0].text).toContain('No inbox rules found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListRules({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleListRules({});

    expect(result.content[0].text).toBe('Error listing rules: API Error');
  });
});

describe('handleCreateRule', () => {
  it('should create a rule with from condition and move action', async () => {
    // getInboxRules call (auto-sequence)
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    getFolderIdByName.mockResolvedValue('target-folder-id');
    // POST to create rule
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Test Rule',
      fromAddresses: 'user@example.com',
      moveToFolder: 'Archive',
    });

    expect(result.content[0].text).toContain('Successfully created rule');
    expect(result.content[0].text).toContain('Test Rule');
  });

  it('should create a rule with subject condition and markAsRead', async () => {
    // getInboxRules call (auto-sequence)
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    // POST to create rule
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Subject Rule',
      containsSubject: 'newsletter',
      markAsRead: true,
    });

    expect(result.content[0].text).toContain('Successfully created rule');
  });

  it('should create a rule with custom sequence', async () => {
    // No getInboxRules call when sequence is provided
    callGraphAPI.mockResolvedValue({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Priority Rule',
      fromAddresses: 'boss@example.com',
      markAsRead: true,
      sequence: 5,
    });

    expect(result.content[0].text).toContain('Successfully created rule');
    expect(result.content[0].text).toContain('sequence 5');
  });

  it('should require rule name', async () => {
    const result = await handleCreateRule({});

    expect(result.content[0].text).toBe('Rule name is required.');
  });

  it('should require at least one condition', async () => {
    const result = await handleCreateRule({
      name: 'No Condition',
      markAsRead: true,
    });

    expect(result.content[0].text).toContain('At least one condition');
  });

  it('should require at least one action', async () => {
    const result = await handleCreateRule({
      name: 'No Action',
      fromAddresses: 'user@example.com',
    });

    expect(result.content[0].text).toContain('At least one action');
  });

  it('should reject invalid sequence', async () => {
    const result = await handleCreateRule({
      name: 'Bad Sequence',
      fromAddresses: 'user@example.com',
      markAsRead: true,
      sequence: -1,
    });

    expect(result.content[0].text).toContain(
      'Sequence must be a positive number'
    );
  });

  it('should handle target folder not found', async () => {
    // getInboxRules call (auto-sequence)
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    getFolderIdByName.mockResolvedValue(null);

    const result = await handleCreateRule({
      name: 'Move Rule',
      fromAddresses: 'user@example.com',
      moveToFolder: 'NonExistent',
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleCreateRule({
      name: 'Test',
      fromAddresses: 'a@b.com',
      markAsRead: true,
    });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error on create', async () => {
    // getInboxRules succeeds
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    // POST fails
    callGraphAPI.mockRejectedValueOnce(new Error('Create failed'));

    const result = await handleCreateRule({
      name: 'Test',
      containsSubject: 'test',
      markAsRead: true,
    });

    expect(result.content[0].text).toBe('Error creating rule: Create failed');
  });
});

describe('handleEditRuleSequence', () => {
  it('should update rule sequence', async () => {
    // getInboxRules call
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    // PATCH call
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleEditRuleSequence({
      ruleName: 'Move newsletters',
      sequence: 5,
    });

    expect(result.content[0].text).toContain('Successfully updated');
    expect(result.content[0].text).toContain('Move newsletters');
    expect(result.content[0].text).toContain('5');
  });

  it('should require rule name', async () => {
    const result = await handleEditRuleSequence({ sequence: 1 });

    expect(result.content[0].text).toContain('Rule name is required');
  });

  it('should require valid sequence', async () => {
    const result = await handleEditRuleSequence({
      ruleName: 'Test',
      sequence: 0,
    });

    expect(result.content[0].text).toContain('positive sequence number');
  });

  it('should handle rule not found', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRules });

    const result = await handleEditRuleSequence({
      ruleName: 'NonExistent Rule',
      sequence: 1,
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleEditRuleSequence({
      ruleName: 'Test',
      sequence: 1,
    });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    // getInboxRules succeeds
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    // PATCH fails
    callGraphAPI.mockRejectedValueOnce(new Error('Update failed'));

    const result = await handleEditRuleSequence({
      ruleName: 'Move newsletters',
      sequence: 5,
    });

    expect(result.content[0].text).toBe(
      'Error updating rule sequence: Update failed'
    );
  });
});

describe('handleDeleteRule', () => {
  it('should delete a rule by name', async () => {
    // getInboxRules call
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    // DELETE call
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleDeleteRule({ ruleName: 'Move newsletters' });

    expect(result.content[0].text).toContain('Successfully deleted');
    expect(result.content[0].text).toContain('Move newsletters');
  });

  it('should delete a rule by ID', async () => {
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleDeleteRule({ ruleId: 'rule-1' });

    expect(result.content[0].text).toContain('Successfully deleted');
  });

  it('should require ruleName or ruleId', async () => {
    const result = await handleDeleteRule({});

    expect(result.content[0].text).toContain('Either ruleName or ruleId');
  });

  it('should handle rule not found', async () => {
    callGraphAPI.mockResolvedValue({ value: mockRules });

    const result = await handleDeleteRule({ ruleName: 'NonExistent' });

    expect(result.content[0].text).toContain('not found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDeleteRule({ ruleName: 'Test' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockRejectedValueOnce(new Error('Delete failed'));

    const result = await handleDeleteRule({ ruleName: 'Move newsletters' });

    expect(result.content[0].text).toBe('Error deleting rule: Delete failed');
  });
});
