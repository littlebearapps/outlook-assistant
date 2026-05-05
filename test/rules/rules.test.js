const { handleListRules } = require('../../rules/list');
const handleCreateRule = require('../../rules/create');
const handleUpdateRule = require('../../rules/update');
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

const mockRuleWithExceptions = {
  id: 'rule-3',
  displayName: 'Receipts to folder',
  isEnabled: true,
  sequence: 3,
  conditions: {
    hasAttachment: true,
    subjectContains: ['invoice', 'receipt', 'payment'],
  },
  actions: {
    moveToFolder: 'folder-receipts',
    markAsRead: true,
  },
  exceptions: {
    fromAddresses: [{ emailAddress: { address: 'tax@withaccounting.com' } }],
    subjectContains: ['FYI'],
  },
};

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

  it('should show exceptions in detailed view', async () => {
    callGraphAPI.mockResolvedValue({
      value: [...mockRules, mockRuleWithExceptions],
    });

    const result = await handleListRules({ includeDetails: true });

    expect(result.content[0].text).toContain('Exceptions:');
    expect(result.content[0].text).toContain('tax@withaccounting.com');
    expect(result.content[0].text).toContain('FYI');
  });

  it('should display new condition types', async () => {
    const ruleWithNewConditions = {
      id: 'rule-new',
      displayName: 'Complex rule',
      isEnabled: true,
      sequence: 1,
      conditions: {
        bodyOrSubjectContains: ['urgent', 'asap'],
        senderContains: ['example.com'],
        sentToMe: true,
        sensitivity: 'confidential',
      },
      actions: {
        markImportance: 'high',
        assignCategories: ['Priority'],
        stopProcessingRules: true,
      },
    };
    callGraphAPI.mockResolvedValue({ value: [ruleWithNewConditions] });

    const result = await handleListRules({ includeDetails: true });

    expect(result.content[0].text).toContain('Body/subject contains');
    expect(result.content[0].text).toContain('Sender contains');
    expect(result.content[0].text).toContain('Sent to me');
    expect(result.content[0].text).toContain('Sensitivity: confidential');
    expect(result.content[0].text).toContain('Mark importance: high');
    expect(result.content[0].text).toContain('Assign categories: Priority');
    expect(result.content[0].text).toContain('Stop processing rules');
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
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    getFolderIdByName.mockResolvedValue('target-folder-id');
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Test Rule',
      fromAddresses: 'user@example.com',
      moveToFolder: 'Archive',
    });

    expect(result.content[0].text).toContain('Successfully created rule');
    expect(result.content[0].text).toContain('Test Rule');
    // F-43: rule ID surfaced in response and _meta
    expect(result.content[0].text).toMatch(/\*\*ID\*\*: new-rule-id/);
    expect(result._meta.ruleId).toBe('new-rule-id');
  });

  it('should create a rule with subject condition and markAsRead', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Subject Rule',
      containsSubject: 'newsletter',
      markAsRead: true,
    });

    expect(result.content[0].text).toContain('Successfully created rule');
  });

  it('should create a rule with OR subject keywords', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Receipt Rule',
      containsSubject: 'invoice, receipt, payment',
      hasAttachments: true,
      markAsRead: true,
    });

    expect(result.content[0].text).toContain('Successfully created rule');

    // Verify the POST payload has array of subject keywords
    const postCall = callGraphAPI.mock.calls[1];
    const ruleBody = postCall[3];
    expect(ruleBody.conditions.subjectContains).toEqual([
      'invoice',
      'receipt',
      'payment',
    ]);
    expect(ruleBody.conditions.hasAttachment).toBe(true);
  });

  it('should create a rule with bodyContains', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    await handleCreateRule({
      name: 'Body Rule',
      bodyContains: 'urgent, action required',
      markAsRead: true,
    });

    const postCall = callGraphAPI.mock.calls[1];
    expect(postCall[3].conditions.bodyContains).toEqual([
      'urgent',
      'action required',
    ]);
  });

  it('should create a rule with exceptions', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    await handleCreateRule({
      name: 'Rule with Exceptions',
      hasAttachments: true,
      containsSubject: 'invoice, receipt',
      markAsRead: true,
      exceptFromAddresses: 'tax@accounting.com',
      exceptSubjectContains: 'FYI, discussion',
    });

    const postCall = callGraphAPI.mock.calls[1];
    expect(postCall[3].exceptions).toBeDefined();
    expect(postCall[3].exceptions.fromAddresses).toEqual([
      { emailAddress: { address: 'tax@accounting.com' } },
    ]);
    expect(postCall[3].exceptions.subjectContains).toEqual([
      'FYI',
      'discussion',
    ]);
  });

  it('should support dryRun without creating', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });

    const result = await handleCreateRule({
      name: 'Dry Run Rule',
      fromAddresses: 'user@example.com',
      markAsRead: true,
      dryRun: true,
    });

    expect(result.content[0].text).toContain('DRY RUN');
    expect(result.content[0].text).toContain('Dry Run Rule');
    // Should only have the getInboxRules call, no POST
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  it('should create a rule with stopProcessingRules', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    await handleCreateRule({
      name: 'Stop Rule',
      fromAddresses: 'important@example.com',
      markAsRead: true,
      stopProcessingRules: true,
    });

    const postCall = callGraphAPI.mock.calls[1];
    expect(postCall[3].actions.stopProcessingRules).toBe(true);
  });

  it('should create a rule with deleteMessage and show warning', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    const result = await handleCreateRule({
      name: 'Delete Rule',
      senderContains: 'spam',
      deleteMessage: true,
    });

    expect(result.content[0].text).toContain('Successfully created rule');
    expect(result.content[0].text).toContain('Deleted Items');
  });

  it('should create a rule with assignCategories', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockResolvedValueOnce({ id: 'new-rule-id' });

    await handleCreateRule({
      name: 'Category Rule',
      fromAddresses: 'team@example.com',
      assignCategories: 'Work, Team',
    });

    const postCall = callGraphAPI.mock.calls[1];
    expect(postCall[3].actions.assignCategories).toEqual(['Work', 'Team']);
  });

  it('should create a rule with custom sequence', async () => {
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
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    callGraphAPI.mockRejectedValueOnce(new Error('Create failed'));

    const result = await handleCreateRule({
      name: 'Test',
      containsSubject: 'test',
      markAsRead: true,
    });

    expect(result.content[0].text).toBe('Error creating rule: Create failed');
  });
});

describe('handleUpdateRule', () => {
  it('should update rule name', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      name: 'Renamed Rule',
    });

    expect(result.content[0].text).toContain('Successfully updated');
    expect(result.content[0].text).toContain('name');

    const patchCall = callGraphAPI.mock.calls[1];
    expect(patchCall[3].displayName).toBe('Renamed Rule');
  });

  it('should update rule enabled state with before/after rendering (F-45)', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      isEnabled: false,
    });

    // The previous bare 'enabled'/'disabled' string was ambiguous —
    // now show explicit transition.
    expect(result.content[0].text).toContain('isEnabled: true → false');
  });

  it('should render rename with before/after (F-45)', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      name: 'Renamed',
    });

    expect(result.content[0].text).toContain(
      'name: "Move newsletters" → "Renamed"'
    );
  });

  it('should update conditions (replace)', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    await handleUpdateRule({
      ruleName: 'Move newsletters',
      containsSubject: 'invoice, receipt',
      hasAttachments: true,
    });

    const patchCall = callGraphAPI.mock.calls[1];
    expect(patchCall[3].conditions.subjectContains).toEqual([
      'invoice',
      'receipt',
    ]);
    expect(patchCall[3].conditions.hasAttachment).toBe(true);
    // fromAddresses should NOT be in patch (not provided in update)
    expect(patchCall[3].conditions.fromAddresses).toBeUndefined();
  });

  it('should update actions', async () => {
    getFolderIdByName.mockResolvedValue('new-folder-id');
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    await handleUpdateRule({
      ruleName: 'Move newsletters',
      moveToFolder: 'Projects',
      stopProcessingRules: true,
    });

    const patchCall = callGraphAPI.mock.calls[1];
    expect(patchCall[3].actions.moveToFolder).toBe('new-folder-id');
    expect(patchCall[3].actions.stopProcessingRules).toBe(true);
  });

  it('should add exceptions to existing rule', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    await handleUpdateRule({
      ruleName: 'Move newsletters',
      exceptSenderContains: 'noreply',
    });

    const patchCall = callGraphAPI.mock.calls[1];
    expect(patchCall[3].exceptions.senderContains).toEqual(['noreply']);
  });

  it('should support dryRun preview', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      name: 'New Name',
      dryRun: true,
    });

    expect(result.content[0].text).toContain('DRY RUN');
    expect(result.content[0].text).toContain('CURRENT:');
    expect(result.content[0].text).toContain('AFTER UPDATE:');
    // Should only have the getInboxRules call, no PATCH
    expect(callGraphAPI).toHaveBeenCalledTimes(1);
  });

  it('should update by ruleId', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleUpdateRule({
      ruleId: 'rule-1',
      isEnabled: false,
    });

    expect(result.content[0].text).toContain('Successfully updated');
  });

  it('should error when no changes provided', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });

    const result = await handleUpdateRule({ ruleName: 'Move newsletters' });

    expect(result.content[0].text).toContain('No changes specified');
  });

  it('should error when rule not found', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });

    const result = await handleUpdateRule({
      ruleName: 'NonExistent',
      isEnabled: false,
    });

    expect(result.content[0].text).toContain('not found');
  });

  it('should require ruleName or ruleId', async () => {
    const result = await handleUpdateRule({ isEnabled: false });

    expect(result.content[0].text).toContain(
      'Either ruleName or ruleId is required'
    );
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleUpdateRule({
      ruleName: 'Test',
      isEnabled: false,
    });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
    callGraphAPI.mockRejectedValueOnce(new Error('Update failed'));

    const result = await handleUpdateRule({
      ruleName: 'Move newsletters',
      isEnabled: false,
    });

    expect(result.content[0].text).toBe('Error updating rule: Update failed');
  });

  it('should reject invalid sequence', async () => {
    const result = await handleUpdateRule({
      ruleName: 'Test',
      sequence: -1,
    });

    expect(result.content[0].text).toContain(
      'Sequence must be a positive number'
    );
  });
});

describe('handleEditRuleSequence', () => {
  it('should update rule sequence', async () => {
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
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
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
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
    callGraphAPI.mockResolvedValueOnce({ value: mockRules });
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
