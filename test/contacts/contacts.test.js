const {
  handleListContacts,
  handleSearchContacts,
  handleGetContact,
  handleCreateContact,
  handleUpdateContact,
  handleDeleteContact,
  handleSearchPeople,
} = require('../../contacts');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const mockAccessToken = 'test_token';

const mockContact = {
  id: 'contact-1',
  displayName: 'John Smith',
  emailAddresses: [{ address: 'john@example.com' }],
  mobilePhone: '+61400000000',
  businessPhones: ['+61300000000'],
  companyName: 'Acme Corp',
  jobTitle: 'Engineer',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation();
  ensureAuthenticated.mockResolvedValue(mockAccessToken);
});

afterEach(() => {
  console.error.mockRestore();
});

describe('handleListContacts', () => {
  it('should list contacts successfully', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockContact] });

    const result = await handleListContacts({});

    expect(result.content[0].text).toContain('# Contacts');
    expect(result.content[0].text).toContain('John Smith');
    expect(result._meta.count).toBe(1);
  });

  it('should handle empty contacts', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleListContacts({});

    expect(result.content[0].text).toContain('**Total**: 0');
  });

  it('should respect count parameter', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleListContacts({ count: 10 });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/contacts',
      null,
      expect.objectContaining({ $top: 10 })
    );
  });

  it('should cap count at 100', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleListContacts({ count: 200 });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/contacts',
      null,
      expect.objectContaining({ $top: 100 })
    );
  });

  it('should use contact folder when specified', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    await handleListContacts({ folder: 'folder-123' });

    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'GET',
      'me/contactFolders/folder-123/contacts',
      null,
      expect.any(Object)
    );
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleListContacts({});

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Graph API Error'));

    const result = await handleListContacts({});

    expect(result.content[0].text).toBe(
      'Error listing contacts: Graph API Error'
    );
  });
});

describe('handleSearchContacts', () => {
  it('should search contacts by query', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockContact] });

    const result = await handleSearchContacts({ query: 'john' });

    expect(result.content[0].text).toContain('Contact Search Results');
    expect(result.content[0].text).toContain('"john"');
    expect(result._meta.query).toBe('john');
  });

  it('should require query parameter', async () => {
    const result = await handleSearchContacts({});

    expect(result.content[0].text).toBe('Search query is required.');
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSearchContacts({ query: 'test' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Search failed'));

    const result = await handleSearchContacts({ query: 'test' });

    expect(result.content[0].text).toBe(
      'Error searching contacts: Search failed'
    );
  });
});

describe('handleGetContact', () => {
  it('should get a contact by ID', async () => {
    callGraphAPI.mockResolvedValue(mockContact);

    const result = await handleGetContact({ id: 'contact-1' });

    expect(result.content[0].text).toContain('Contact Details');
    expect(result.content[0].text).toContain('John Smith');
    expect(result._meta.contactId).toBe('contact-1');
  });

  it('should require contact ID', async () => {
    const result = await handleGetContact({});

    expect(result.content[0].text).toBe('Contact ID is required.');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleGetContact({ id: 'contact-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Not found'));

    const result = await handleGetContact({ id: 'bad-id' });

    expect(result.content[0].text).toBe('Error getting contact: Not found');
  });
});

describe('handleCreateContact', () => {
  it('should create a contact with display name', async () => {
    callGraphAPI.mockResolvedValue({ ...mockContact, id: 'new-contact' });

    const result = await handleCreateContact({ displayName: 'John Smith' });

    expect(result.content[0].text).toContain('Contact Created');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'POST',
      'me/contacts',
      expect.objectContaining({
        displayName: 'John Smith',
        givenName: 'John',
        surname: 'Smith',
      })
    );
  });

  it('should create a contact with email only', async () => {
    callGraphAPI.mockResolvedValue({ ...mockContact, id: 'new-contact' });

    const result = await handleCreateContact({ email: 'john@example.com' });

    expect(result.content[0].text).toContain('Contact Created');
  });

  it('should require displayName or email', async () => {
    const result = await handleCreateContact({});

    expect(result.content[0].text).toBe(
      'At least displayName or email is required.'
    );
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleCreateContact({ displayName: 'Test' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Create failed'));

    const result = await handleCreateContact({ displayName: 'Test' });

    expect(result.content[0].text).toBe(
      'Error creating contact: Create failed'
    );
  });
});

describe('handleUpdateContact', () => {
  it('should update a contact', async () => {
    callGraphAPI.mockResolvedValue({
      ...mockContact,
      displayName: 'John Updated',
    });

    const result = await handleUpdateContact({
      id: 'contact-1',
      displayName: 'John Updated',
    });

    expect(result.content[0].text).toContain('Contact Updated');
    expect(callGraphAPI).toHaveBeenCalledWith(
      mockAccessToken,
      'PATCH',
      expect.stringContaining('me/contacts/'),
      expect.objectContaining({ displayName: 'John Updated' })
    );
  });

  it('should require contact ID', async () => {
    const result = await handleUpdateContact({ displayName: 'Test' });

    expect(result.content[0].text).toBe('Contact ID is required.');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleUpdateContact({
      id: 'contact-1',
      displayName: 'Test',
    });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Update failed'));

    const result = await handleUpdateContact({
      id: 'contact-1',
      displayName: 'Test',
    });

    expect(result.content[0].text).toBe(
      'Error updating contact: Update failed'
    );
  });
});

describe('handleDeleteContact', () => {
  it('should delete a contact', async () => {
    callGraphAPI.mockResolvedValue({});

    const result = await handleDeleteContact({ id: 'contact-1' });

    expect(result.content[0].text).toContain('Contact Deleted');
    expect(result.content[0].text).toContain('contact-1');
    expect(result._meta.deleted).toBe(true);
  });

  it('should require contact ID', async () => {
    const result = await handleDeleteContact({});

    expect(result.content[0].text).toBe('Contact ID is required.');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleDeleteContact({ id: 'contact-1' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('Delete failed'));

    const result = await handleDeleteContact({ id: 'contact-1' });

    expect(result.content[0].text).toBe(
      'Error deleting contact: Delete failed'
    );
  });
});

describe('handleSearchPeople', () => {
  const mockPerson = {
    displayName: 'Jane Doe',
    scoredEmailAddresses: [{ address: 'jane@example.com' }],
    companyName: 'Acme Corp',
    jobTitle: 'Manager',
    personType: { class: 'Person' },
    phones: [{ number: '+61400111222' }],
  };

  it('should search people by query', async () => {
    callGraphAPI.mockResolvedValue({ value: [mockPerson] });

    const result = await handleSearchPeople({ query: 'jane' });

    expect(result.content[0].text).toContain('People Search Results');
    expect(result.content[0].text).toContain('Jane Doe');
    expect(result.content[0].text).toContain('jane@example.com');
    expect(result._meta.query).toBe('jane');
  });

  it('should require query parameter', async () => {
    const result = await handleSearchPeople({});

    expect(result.content[0].text).toBe('Search query is required.');
  });

  it('should handle empty results', async () => {
    callGraphAPI.mockResolvedValue({ value: [] });

    const result = await handleSearchPeople({ query: 'nobody' });

    expect(result.content[0].text).toContain('**Found**: 0');
  });

  it('should handle auth error', async () => {
    ensureAuthenticated.mockRejectedValue(new Error('Authentication required'));

    const result = await handleSearchPeople({ query: 'test' });

    expect(result.content[0].text).toContain('Authentication required');
  });

  it('should handle API error', async () => {
    callGraphAPI.mockRejectedValue(new Error('People search failed'));

    const result = await handleSearchPeople({ query: 'test' });

    expect(result.content[0].text).toBe(
      'Error searching people: People search failed'
    );
  });
});
