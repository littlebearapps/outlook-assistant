const {
  handleListCategories,
  handleCreateCategory,
  handleUpdateCategory,
  handleDeleteCategory,
  handleApplyCategory,
  handleGetFocusedInboxOverrides,
  handleSetFocusedInboxOverride,
} = require('../../categories');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

const mockCategory = {
  id: 'cat-1',
  displayName: 'Important',
  color: 'preset0',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleListCategories', () => {
  it('should list categories with colour names', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockCategory] });

    const result = await handleListCategories({});

    expect(result.content[0].text).toContain('Master Categories');
    expect(result.content[0].text).toContain('Important');
    expect(result.content[0].text).toContain('Red');
    expect(result._meta.count).toBe(1);
  });

  it('should emit full IDs (F-9: no truncation)', async () => {
    const longIdCategory = {
      id: 'b906d6f3-1234-5678-90ab-cdef01234567',
      displayName: 'WithLongId',
      color: 'preset0',
    };
    callGraphAPI.mockResolvedValue({ value: [longIdCategory] });

    const result = await handleListCategories({});

    expect(result.content[0].text).toContain(longIdCategory.id);
    expect(result.content[0].text).not.toContain('b906d6f3...');
  });

  it('should handle empty categories', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleListCategories({});

    expect(result.content[0].text).toContain('No categories found');
  });

  it('should support minimal verbosity', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockCategory] });

    const result = await handleListCategories({ outputVerbosity: 'minimal' });

    expect(result.content[0].text).toContain('- Important');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListCategories({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleListCategories({});

    expect(result.content[0].text).toBe('Error listing categories: API Error');
  });
});

describe('handleCreateCategory', () => {
  it('should create a category', async () => {
    callGraphAPI.mockResolvedValue({
      id: 'new-cat',
      displayName: 'Work',
      color: 'preset7',
    });

    const result = await handleCreateCategory({
      displayName: 'Work',
      color: 'preset7',
    });

    expect(result.content[0].text).toContain('Category created');
    expect(result.content[0].text).toContain('Work');
    expect(result.content[0].text).toContain('Blue');
  });

  it('should default to preset0 (Red) when no colour specified', async () => {
    callGraphAPI.mockResolvedValue({
      id: 'new-cat',
      displayName: 'Test',
      color: 'preset0',
    });

    await handleCreateCategory({ displayName: 'Test' });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/outlook/masterCategories',
      expect.objectContaining({ color: 'preset0' })
    );
  });

  it('should require displayName', async () => {
    const result = await handleCreateCategory({});

    expect(result.content[0].text).toContain('displayName) is required');
  });

  it('should reject invalid colour', async () => {
    const result = await handleCreateCategory({
      displayName: 'Test',
      color: 'invalid',
    });

    expect(result.content[0].text).toContain('Invalid color');
  });

  it('should handle duplicate category', async () => {
    callGraphAPI.mockRejectedValue(new Error('already exists'));

    const result = await handleCreateCategory({ displayName: 'Existing' });

    expect(result.content[0].text).toContain('already exists');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleCreateCategory({ displayName: 'Test' });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleUpdateCategory', () => {
  it('should update a category', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        id: 'cat-1',
        displayName: 'Updated',
        color: 'preset4',
      }); // GET fresh state

    const result = await handleUpdateCategory({
      id: 'cat-1',
      displayName: 'Updated',
      color: 'preset4',
    });

    expect(result.content[0].text).toContain('Category updated');
    expect(result.content[0].text).toContain('Green');
    // No divergence warning when Graph stored what was requested
    expect(result.content[0].text).not.toMatch(/Warning/);
  });

  it('should warn when Graph silently drops the color update (F-35)', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        id: 'cat-1',
        displayName: 'Important',
        color: 'preset0', // Graph kept the original color
      }); // GET fresh state

    const result = await handleUpdateCategory({
      id: 'cat-1',
      color: 'preset5', // requested orange, Graph stored red
    });

    expect(result.content[0].text).toMatch(/Warning/);
    expect(result.content[0].text).toMatch(
      /Requested color `preset5`.*Graph stored `preset0`/
    );
    expect(result.content[0].text).toMatch(
      /master-category colors may be immutable/
    );
  });

  it('should accept categoryId as deprecated alias for id (F-34)', async () => {
    callGraphAPI
      .mockResolvedValueOnce({}) // PATCH
      .mockResolvedValueOnce({
        id: 'cat-1',
        displayName: 'Renamed',
        color: 'preset0',
      });

    const result = await handleUpdateCategory({
      categoryId: 'cat-1', // legacy param name
      displayName: 'Renamed',
    });

    expect(result.content[0].text).toContain('Category updated');
    // Confirm PATCH was sent to the right ID
    expect(callGraphAPI.mock.calls[0][2]).toBe(
      'me/outlook/masterCategories/cat-1'
    );
  });

  it('should require ID', async () => {
    const result = await handleUpdateCategory({ displayName: 'Test' });

    expect(result.content[0].text).toContain('Category ID is required');
  });

  it('should require at least displayName or colour', async () => {
    const result = await handleUpdateCategory({ id: 'cat-1' });

    expect(result.content[0].text).toContain(
      'At least one of displayName or color'
    );
  });

  it('should reject invalid colour', async () => {
    const result = await handleUpdateCategory({
      id: 'cat-1',
      color: 'bad',
    });

    expect(result.content[0].text).toContain('Invalid color');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleUpdateCategory({
      id: 'cat-1',
      displayName: 'Test',
    });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleDeleteCategory', () => {
  it('should delete a category', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeleteCategory({ id: 'cat-1' });

    expect(result.content[0].text).toContain('Category deleted');
  });

  it('should accept categoryId as deprecated alias for id (F-34)', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeleteCategory({ categoryId: 'cat-1' });

    expect(result.content[0].text).toContain('Category deleted');
    expect(callGraphAPI.mock.calls[0][2]).toBe(
      'me/outlook/masterCategories/cat-1'
    );
  });

  it('should require ID', async () => {
    const result = await handleDeleteCategory({});

    expect(result.content[0].text).toContain('Category ID is required');
  });

  it('should handle not found error', async () => {
    callGraphAPI.mockRejectedValue(new Error('not found'));

    const result = await handleDeleteCategory({ id: 'bad-id' });

    expect(result.content[0].text).toContain('Category not found');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDeleteCategory({ id: 'cat-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleApplyCategory', () => {
  it('should apply categories to a single message (set)', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['Important'],
    });

    expect(result.content[0].text).toContain('applied to 1 message');
  });

  it('should apply categories to multiple messages', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleApplyCategory({
      messageIds: ['msg-1', 'msg-2'],
      categories: ['Work'],
    });

    expect(result.content[0].text).toContain('applied to 2 message');
  });

  it('should add categories to existing ones', async () => {
    // First call: GET current categories; Second call: PATCH
    callGraphAPI
      .mockResolvedValueOnce({ categories: ['Old'] })
      .mockResolvedValueOnce({});

    const result = await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['New'],
      action: 'add',
    });

    expect(result.content[0].text).toContain('applied to 1 message');
  });

  it('should remove categories', async () => {
    callGraphAPI
      .mockResolvedValueOnce({ categories: ['Keep', 'Remove'] })
      .mockResolvedValueOnce({});

    const result = await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['Remove'],
      action: 'remove',
    });

    expect(result.content[0].text).toContain('removed from 1 message');
  });

  it('should target a shared mailbox when sharedMailbox is provided', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['Important'],
      sharedMailbox: 'shared@company.com',
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'users/shared@company.com/messages/msg-1',
      { categories: ['Important'] }
    );
  });

  it('should accept email as an alias and prefix the add-GET too', async () => {
    callGraphAPI
      .mockResolvedValueOnce({ categories: ['Old'] })
      .mockResolvedValueOnce({});

    await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['New'],
      action: 'add',
      email: 'shared@company.com',
    });

    expect(callGraphAPI).toHaveBeenNthCalledWith(
      1,
      mockAccessToken,
      'GET',
      'users/shared@company.com/messages/msg-1',
      null,
      { $select: 'categories' }
    );
    expect(callGraphAPI).toHaveBeenNthCalledWith(
      2,
      mockAccessToken,
      'PATCH',
      'users/shared@company.com/messages/msg-1',
      { categories: ['Old', 'New'] }
    );
  });

  it('should default to the signed-in mailbox (me) when no shared mailbox', async () => {
    callGraphAPI.mockResolvedValue({});

    await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['Important'],
    });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      'me/messages/msg-1',
      { categories: ['Important'] }
    );
  });

  it('should require message IDs', async () => {
    const result = await handleApplyCategory({ categories: ['Test'] });

    expect(result.content[0].text).toContain('Message ID');
  });

  it('should require categories array', async () => {
    const result = await handleApplyCategory({ messageId: 'msg-1' });

    expect(result.content[0].text).toContain('Categories array is required');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleApplyCategory({
      messageId: 'msg-1',
      categories: ['Test'],
    });

    expect(result.content[0].text).toContain('Authentication required');
  });
});

describe('handleGetFocusedInboxOverrides', () => {
  const mockOverride = {
    id: 'override-1',
    classifyAs: 'focused',
    senderEmailAddress: {
      name: 'Boss',
      address: 'boss@example.com',
    },
  };

  it('should list focused inbox overrides', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockOverride] });

    const result = await handleGetFocusedInboxOverrides({});

    expect(result.content[0].text).toContain('Focused Inbox Overrides');
    expect(result.content[0].text).toContain('boss@example.com');
    expect(result._meta.count).toBe(1);
  });

  it('should handle empty overrides', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleGetFocusedInboxOverrides({});

    expect(result.content[0].text).toContain('No Focused Inbox overrides');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetFocusedInboxOverrides({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('API Error'));

    const result = await handleGetFocusedInboxOverrides({});

    expect(result.content[0].text).toBe(
      'Error getting Focused Inbox overrides: API Error'
    );
  });
});

describe('handleSetFocusedInboxOverride', () => {
  it('should create a new override', async () => {
    // First call: GET existing overrides (empty)
    callGraphAPI.mockResolvedValueOnce({ value: [] });
    // Second call: POST new override
    callGraphAPI.mockResolvedValueOnce({
      id: 'new-override',
      classifyAs: 'focused',
      senderEmailAddress: { name: 'Boss', address: 'boss@example.com' },
    });

    const result = await handleSetFocusedInboxOverride({
      emailAddress: 'boss@example.com',
      name: 'Boss',
    });

    expect(result.content[0].text).toContain('Created override');
    expect(result.content[0].text).toContain('Focused inbox');
  });

  it('should update an existing override', async () => {
    callGraphAPI.mockResolvedValueOnce({
      value: [
        {
          id: 'existing-override',
          classifyAs: 'other',
          senderEmailAddress: { address: 'boss@example.com' },
        },
      ],
    });
    callGraphAPI.mockResolvedValueOnce({
      id: 'existing-override',
      classifyAs: 'focused',
      senderEmailAddress: { name: 'Boss', address: 'boss@example.com' },
    });

    const result = await handleSetFocusedInboxOverride({
      emailAddress: 'boss@example.com',
      classifyAs: 'focused',
    });

    expect(result.content[0].text).toContain('Updated override');
  });

  it('should delete an existing override', async () => {
    callGraphAPI.mockResolvedValueOnce({
      value: [
        {
          id: 'existing-override',
          senderEmailAddress: { address: 'boss@example.com' },
        },
      ],
    });
    callGraphAPI.mockResolvedValueOnce({});

    const result = await handleSetFocusedInboxOverride({
      emailAddress: 'boss@example.com',
      action: 'delete',
    });

    expect(result.content[0].text).toContain('Removed override');
  });

  it('should handle delete when no override exists', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleSetFocusedInboxOverride({
      emailAddress: 'nobody@example.com',
      action: 'delete',
    });

    expect(result.content[0].text).toContain('No override found');
  });

  it('should require email address', async () => {
    const result = await handleSetFocusedInboxOverride({});

    expect(result.content[0].text).toContain('Email address is required');
  });

  it('should reject invalid classifyAs', async () => {
    const result = await handleSetFocusedInboxOverride({
      emailAddress: 'test@example.com',
      classifyAs: 'invalid',
    });

    expect(result.content[0].text).toContain(
      "classifyAs must be 'focused' or 'other'"
    );
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSetFocusedInboxOverride({
      emailAddress: 'test@example.com',
    });

    expect(result.content[0].text).toContain('Authentication required');
  });
});
