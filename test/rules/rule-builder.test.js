const {
  parseCommaSeparated,
  formatRecipientObjects,
  buildConditions,
  buildActions,
  buildExceptions,
  hasAnyCondition,
  hasAnyAction,
  VALID_IMPORTANCE,
  VALID_SENSITIVITY,
} = require('../../rules/rule-builder');
const { resolveFolder } = require('../../folder/resolve');
const { checkRecipientAllowlist } = require('../../utils/safety');

// Keep the real looksLikeFolderId; only the Graph-backed resolver is mocked.
jest.mock('../../folder/resolve', () => ({
  ...jest.requireActual('../../folder/resolve'),
  resolveFolder: jest.fn(),
}));
jest.mock('../../utils/safety', () => ({
  ...jest.requireActual('../../utils/safety'),
  checkRecipientAllowlist: jest.fn(),
}));

describe('parseCommaSeparated', () => {
  it('should return empty array for empty string', () => {
    expect(parseCommaSeparated('')).toEqual([]);
  });

  it('should return empty array for null/undefined', () => {
    expect(parseCommaSeparated(null)).toEqual([]);
    expect(parseCommaSeparated(undefined)).toEqual([]);
  });

  it('should parse single value', () => {
    expect(parseCommaSeparated('invoice')).toEqual(['invoice']);
  });

  it('should parse multiple values', () => {
    expect(parseCommaSeparated('invoice, receipt, payment')).toEqual([
      'invoice',
      'receipt',
      'payment',
    ]);
  });

  it('should trim whitespace', () => {
    expect(parseCommaSeparated('  hello ,  world  ')).toEqual([
      'hello',
      'world',
    ]);
  });

  it('should filter empty entries', () => {
    expect(parseCommaSeparated('a,,b, ,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('formatRecipientObjects', () => {
  it('should format single email', () => {
    expect(formatRecipientObjects('user@example.com')).toEqual([
      { emailAddress: { address: 'user@example.com' } },
    ]);
  });

  it('should format multiple emails', () => {
    expect(formatRecipientObjects('a@example.com, b@example.com')).toEqual([
      { emailAddress: { address: 'a@example.com' } },
      { emailAddress: { address: 'b@example.com' } },
    ]);
  });

  it('should return empty array for empty string', () => {
    expect(formatRecipientObjects('')).toEqual([]);
  });
});

describe('buildConditions', () => {
  it('should build subjectContains from containsSubject with OR logic', () => {
    const { conditions, warnings } = buildConditions({
      containsSubject: 'invoice, receipt, payment',
    });

    expect(conditions.subjectContains).toEqual([
      'invoice',
      'receipt',
      'payment',
    ]);
    expect(warnings).toHaveLength(0);
  });

  it('should wrap single containsSubject in array', () => {
    const { conditions } = buildConditions({ containsSubject: 'newsletter' });
    expect(conditions.subjectContains).toEqual(['newsletter']);
  });

  it('should build bodyContains', () => {
    const { conditions } = buildConditions({ bodyContains: 'urgent, asap' });
    expect(conditions.bodyContains).toEqual(['urgent', 'asap']);
  });

  it('should build bodyOrSubjectContains', () => {
    const { conditions } = buildConditions({
      bodyOrSubjectContains: 'invoice, receipt',
    });
    expect(conditions.bodyOrSubjectContains).toEqual(['invoice', 'receipt']);
  });

  it('should build senderContains', () => {
    const { conditions } = buildConditions({
      senderContains: 'example.com, test.com',
    });
    expect(conditions.senderContains).toEqual(['example.com', 'test.com']);
  });

  it('should build recipientContains', () => {
    const { conditions } = buildConditions({
      recipientContains: 'team, support',
    });
    expect(conditions.recipientContains).toEqual(['team', 'support']);
  });

  it('should build fromAddresses as recipient objects', () => {
    const { conditions } = buildConditions({
      fromAddresses: 'a@example.com, b@example.com',
    });
    expect(conditions.fromAddresses).toEqual([
      { emailAddress: { address: 'a@example.com' } },
      { emailAddress: { address: 'b@example.com' } },
    ]);
  });

  it('should build sentToAddresses as recipient objects', () => {
    const { conditions } = buildConditions({
      sentToAddresses: 'team@example.com',
    });
    expect(conditions.sentToAddresses).toEqual([
      { emailAddress: { address: 'team@example.com' } },
    ]);
  });

  it('should set boolean conditions', () => {
    const { conditions } = buildConditions({
      hasAttachments: true,
      sentToMe: true,
      sentOnlyToMe: true,
      sentCcMe: true,
      isAutomaticReply: true,
    });
    expect(conditions.hasAttachment).toBe(true);
    expect(conditions.sentToMe).toBe(true);
    expect(conditions.sentOnlyToMe).toBe(true);
    expect(conditions.sentCcMe).toBe(true);
    expect(conditions.isAutomaticReply).toBe(true);
  });

  it('should not set boolean conditions when false', () => {
    const { conditions } = buildConditions({
      hasAttachments: false,
      sentToMe: false,
    });
    expect(conditions.hasAttachment).toBeUndefined();
    expect(conditions.sentToMe).toBeUndefined();
  });

  it('should validate importance enum', () => {
    const { conditions, warnings } = buildConditions({
      importance: 'high',
    });
    expect(conditions.importance).toBe('high');
    expect(warnings).toHaveLength(0);
  });

  it('should warn on invalid importance', () => {
    const { conditions, warnings } = buildConditions({
      importance: 'critical',
    });
    expect(conditions.importance).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Invalid importance');
  });

  it('should validate sensitivity enum', () => {
    const { conditions } = buildConditions({ sensitivity: 'confidential' });
    expect(conditions.sensitivity).toBe('confidential');
  });

  it('should warn on invalid sensitivity', () => {
    const { warnings } = buildConditions({ sensitivity: 'top-secret' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Invalid sensitivity');
  });

  it('should combine multiple conditions', () => {
    const { conditions } = buildConditions({
      fromAddresses: 'boss@example.com',
      containsSubject: 'urgent, critical',
      hasAttachments: true,
      importance: 'high',
    });
    expect(conditions.fromAddresses).toHaveLength(1);
    expect(conditions.subjectContains).toEqual(['urgent', 'critical']);
    expect(conditions.hasAttachment).toBe(true);
    expect(conditions.importance).toBe('high');
  });

  it('should return empty conditions when no args match', () => {
    const { conditions } = buildConditions({});
    expect(Object.keys(conditions)).toHaveLength(0);
  });
});

describe('buildActions', () => {
  const mockToken = 'test_token';

  beforeEach(() => {
    jest.resetAllMocks();
    checkRecipientAllowlist.mockReturnValue(null);
  });

  const FOLDER_ID =
    'AQMkADAwATM0MDAAMS1iNTcwLWIyYTUtMDACLTAwCgAuAAADSgVHq9fNbkWcZeTl5AAAAA==';

  it('should resolve a nested moveToFolder path via the shared resolver (#248)', async () => {
    resolveFolder.mockResolvedValue({
      id: 'nested-id',
      displayName: 'Delete',
      parentId: 'triage-id',
      path: 'Triage/Delete',
    });

    const { actions, warnings } = await buildActions(
      { moveToFolder: 'Triage/Delete' },
      mockToken
    );

    expect(resolveFolder).toHaveBeenCalledWith(mockToken, {
      name: 'Triage/Delete',
    });
    expect(actions.moveToFolder).toBe('nested-id');
    expect(warnings.filter((w) => w.includes('not found'))).toHaveLength(0);
  });

  it('should resolve a well-known alias such as archive', async () => {
    resolveFolder.mockResolvedValue({
      id: 'archive-id',
      displayName: 'Archive',
      parentId: null,
      path: 'Archive',
    });

    const { actions } = await buildActions(
      { moveToFolder: 'archive' },
      mockToken
    );

    expect(resolveFolder).toHaveBeenCalledWith(mockToken, { name: 'archive' });
    expect(actions.moveToFolder).toBe('archive-id');
  });

  it('should pass a raw folder ID to the resolver as an id', async () => {
    resolveFolder.mockResolvedValue({
      id: FOLDER_ID,
      displayName: 'Projects',
      parentId: null,
      path: 'Projects',
    });

    const { actions } = await buildActions(
      { moveToFolder: FOLDER_ID },
      mockToken
    );

    expect(resolveFolder).toHaveBeenCalledWith(mockToken, { id: FOLDER_ID });
    expect(actions.moveToFolder).toBe(FOLDER_ID);
  });

  it('should pass a name containing an apostrophe through unchanged', async () => {
    resolveFolder.mockResolvedValue({
      id: 'apostrophe-id',
      displayName: "Nathan's Bills",
      parentId: null,
      path: "Nathan's Bills",
    });

    const { actions } = await buildActions(
      { moveToFolder: "Nathan's Bills" },
      mockToken
    );

    expect(resolveFolder).toHaveBeenCalledWith(mockToken, {
      name: "Nathan's Bills",
    });
    expect(actions.moveToFolder).toBe('apostrophe-id');
  });

  it('should warn and add no action when moveToFolder is not found', async () => {
    resolveFolder.mockRejectedValue(
      new Error('Folder "Triage/Nope" not found. Use `folders` action=list…')
    );

    const { actions, warnings } = await buildActions(
      { moveToFolder: 'Triage/Nope' },
      mockToken
    );

    expect(actions.moveToFolder).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining('Target folder "Triage/Nope" not found'),
    ]);
  });

  it('should treat an unknown folder ID (Graph 404) as not found', async () => {
    resolveFolder.mockRejectedValue(
      new Error('API call failed with status 404: {"error":{}}')
    );

    const { actions, warnings } = await buildActions(
      { copyToFolder: FOLDER_ID },
      mockToken
    );

    expect(actions.copyToFolder).toBeUndefined();
    expect(warnings).toEqual([
      expect.stringContaining(`Copy-to folder "${FOLDER_ID}" not found`),
    ]);
  });

  it('should report an invalid folder path as not found, with the reason', async () => {
    resolveFolder.mockRejectedValue(
      new Error('Invalid folder path "Triage//Delete": empty path segment.')
    );

    const { actions, warnings } = await buildActions(
      { moveToFolder: 'Triage//Delete' },
      mockToken
    );

    expect(actions.moveToFolder).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Target folder "Triage//Delete" not found');
    expect(warnings[0]).toContain('empty path segment');
    expect(warnings[0]).toContain('`folders` action=list');
  });

  it("should report a Graph 400 as not found, with Graph's message", async () => {
    resolveFolder.mockRejectedValue(
      new Error(
        'API call failed with status 400: {"error":{"code":"ErrorInvalidIdMalformed"}}'
      )
    );

    const { actions, warnings } = await buildActions(
      { copyToFolder: FOLDER_ID },
      mockToken
    );

    expect(actions.copyToFolder).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`Copy-to folder "${FOLDER_ID}" not found`);
    expect(warnings[0]).toContain('ErrorInvalidIdMalformed');
  });

  it("should keep the resolver's not-found guidance without repeating it", async () => {
    resolveFolder.mockRejectedValue(
      new Error(
        'Folder "Nope" not found. Use `folders` action=list to see folders (with IDs and full paths), pass a folder path like "Parent/Child", or a folderId.'
      )
    );

    const { warnings } = await buildActions(
      { moveToFolder: 'Nope' },
      mockToken
    );

    expect(warnings[0]).toContain('Target folder "Nope" not found');
    expect(warnings[0].match(/action=list/g)).toHaveLength(1);
  });

  it('should warn with the candidates when the folder name is ambiguous', async () => {
    resolveFolder.mockRejectedValue(
      new Error(
        'Folder "Delete" is ambiguous — 2 folders match:\n  - Triage/Delete  (folderId: a)\n  - Old/Delete  (folderId: b)'
      )
    );

    const { actions, warnings } = await buildActions(
      { moveToFolder: 'Delete' },
      mockToken
    );

    expect(actions.moveToFolder).toBeUndefined();
    // "not found" keeps create/update treating it as fatal when it is the only action.
    expect(warnings[0]).toContain('Target folder "Delete" not found');
    expect(warnings[0]).toContain('Triage/Delete');
  });

  it('should rethrow errors that are not folder-resolution failures', async () => {
    resolveFolder.mockRejectedValue(new Error('UNAUTHORIZED'));

    await expect(
      buildActions({ moveToFolder: 'Archive' }, mockToken)
    ).rejects.toThrow('UNAUTHORIZED');
  });

  it('should resolve a nested copyToFolder path', async () => {
    resolveFolder.mockResolvedValue({
      id: 'copy-folder-id',
      displayName: 'Backup',
      parentId: 'p',
      path: 'Projects/Backup',
    });

    const { actions } = await buildActions(
      { copyToFolder: 'Projects/Backup' },
      mockToken
    );

    expect(resolveFolder).toHaveBeenCalledWith(mockToken, {
      name: 'Projects/Backup',
    });
    expect(actions.copyToFolder).toBe('copy-folder-id');
  });

  it('should set markAsRead', async () => {
    const { actions } = await buildActions({ markAsRead: true }, mockToken);
    expect(actions.markAsRead).toBe(true);
  });

  it('should set stopProcessingRules', async () => {
    const { actions } = await buildActions(
      { stopProcessingRules: true },
      mockToken
    );
    expect(actions.stopProcessingRules).toBe(true);
  });

  it('should set deleteMessage with warning', async () => {
    const { actions, warnings } = await buildActions(
      { deleteMessage: true },
      mockToken
    );
    expect(actions.delete).toBe(true);
    expect(warnings.some((w) => w.includes('Deleted Items'))).toBe(true);
  });

  it('should validate markImportance enum', async () => {
    const { actions } = await buildActions(
      { markImportance: 'high' },
      mockToken
    );
    expect(actions.markImportance).toBe('high');
  });

  it('should warn on invalid markImportance', async () => {
    const { actions, warnings } = await buildActions(
      { markImportance: 'critical' },
      mockToken
    );
    expect(actions.markImportance).toBeUndefined();
    expect(warnings.some((w) => w.includes('Invalid markImportance'))).toBe(
      true
    );
  });

  it('should build forwardTo with recipient allowlist check', async () => {
    const { actions, warnings } = await buildActions(
      { forwardTo: 'user@example.com' },
      mockToken
    );

    expect(actions.forwardTo).toEqual([
      { emailAddress: { address: 'user@example.com' } },
    ]);
    expect(warnings.some((w) => w.includes('forward'))).toBe(true);
    expect(checkRecipientAllowlist).toHaveBeenCalled();
  });

  // #273: never build a rule minus its blocked forwarding.
  it.each(['forwardTo', 'redirectTo'])(
    'should throw rather than drop %s when the allowlist rejects',
    async (param) => {
      checkRecipientAllowlist.mockReturnValue({
        content: [{ type: 'text', text: 'blocked' }],
        isError: true,
      });

      await expect(
        buildActions({ [param]: 'blocked@evil.com' }, mockToken)
      ).rejects.toThrow(`${param} recipients blocked`);
    }
  );

  it('should build redirectTo', async () => {
    const { actions } = await buildActions(
      { redirectTo: 'alias@example.com' },
      mockToken
    );
    expect(actions.redirectTo).toEqual([
      { emailAddress: { address: 'alias@example.com' } },
    ]);
  });

  it('should build assignCategories', async () => {
    const { actions } = await buildActions(
      { assignCategories: 'Work, Important' },
      mockToken
    );
    expect(actions.assignCategories).toEqual(['Work', 'Important']);
  });
});

describe('buildExceptions', () => {
  it('should build exceptFromAddresses', () => {
    const { exceptions } = buildExceptions({
      exceptFromAddresses: 'noreply@example.com',
    });
    expect(exceptions.fromAddresses).toEqual([
      { emailAddress: { address: 'noreply@example.com' } },
    ]);
  });

  it('should build exceptSubjectContains', () => {
    const { exceptions } = buildExceptions({
      exceptSubjectContains: 'unsubscribe, opt-out',
    });
    expect(exceptions.subjectContains).toEqual(['unsubscribe', 'opt-out']);
  });

  it('should build exceptSenderContains', () => {
    const { exceptions } = buildExceptions({
      exceptSenderContains: 'noreply',
    });
    expect(exceptions.senderContains).toEqual(['noreply']);
  });

  it('should build exceptBodyContains', () => {
    const { exceptions } = buildExceptions({
      exceptBodyContains: 'automated message',
    });
    expect(exceptions.bodyContains).toEqual(['automated message']);
  });

  it('should build exceptHasAttachments', () => {
    const { exceptions } = buildExceptions({ exceptHasAttachments: true });
    expect(exceptions.hasAttachment).toBe(true);
  });

  it('should return empty exceptions when no except params', () => {
    const { exceptions } = buildExceptions({});
    expect(Object.keys(exceptions)).toHaveLength(0);
  });

  it('should combine multiple exceptions', () => {
    const { exceptions } = buildExceptions({
      exceptFromAddresses: 'boss@example.com',
      exceptSubjectContains: 'FYI',
      exceptHasAttachments: true,
    });
    expect(exceptions.fromAddresses).toHaveLength(1);
    expect(exceptions.subjectContains).toEqual(['FYI']);
    expect(exceptions.hasAttachment).toBe(true);
  });
});

describe('hasAnyCondition', () => {
  it('should return true for fromAddresses', () => {
    expect(hasAnyCondition({ fromAddresses: 'a@b.com' })).toBe(true);
  });

  it('should return true for containsSubject', () => {
    expect(hasAnyCondition({ containsSubject: 'test' })).toBe(true);
  });

  it('should return true for new conditions', () => {
    expect(hasAnyCondition({ bodyContains: 'test' })).toBe(true);
    expect(hasAnyCondition({ senderContains: 'test' })).toBe(true);
    expect(hasAnyCondition({ importance: 'high' })).toBe(true);
    expect(hasAnyCondition({ sentToMe: true })).toBe(true);
  });

  it('should return false for empty args', () => {
    expect(hasAnyCondition({})).toBe(false);
  });

  it('should return false for false booleans', () => {
    expect(hasAnyCondition({ hasAttachments: false, sentToMe: false })).toBe(
      false
    );
  });
});

describe('hasAnyAction', () => {
  it('should return true for moveToFolder', () => {
    expect(hasAnyAction({ moveToFolder: 'Archive' })).toBe(true);
  });

  it('should return true for new actions', () => {
    expect(hasAnyAction({ copyToFolder: 'Archive' })).toBe(true);
    expect(hasAnyAction({ forwardTo: 'a@b.com' })).toBe(true);
    expect(hasAnyAction({ assignCategories: 'Work' })).toBe(true);
    expect(hasAnyAction({ deleteMessage: true })).toBe(true);
    expect(hasAnyAction({ stopProcessingRules: true })).toBe(true);
  });

  it('should return false for empty args', () => {
    expect(hasAnyAction({})).toBe(false);
  });
});

describe('constants', () => {
  it('should export valid importance values', () => {
    expect(VALID_IMPORTANCE).toEqual(['low', 'normal', 'high']);
  });

  it('should export valid sensitivity values', () => {
    expect(VALID_SENSITIVITY).toEqual([
      'normal',
      'personal',
      'private',
      'confidential',
    ]);
  });
});
