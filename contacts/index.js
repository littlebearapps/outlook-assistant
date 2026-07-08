/**
 * Contacts module for Outlook Assistant server
 *
 * Provides access to personal contacts and people search via Microsoft Graph API.
 */
const {
  callGraphAPI,
  callGraphAPIPaginated: _callGraphAPIPaginated,
} = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');

/**
 * Contact field presets for different use cases
 */
const CONTACT_FIELDS = {
  minimal: [
    'id',
    'displayName',
    'emailAddresses',
    'primaryEmailAddress',
    'secondaryEmailAddress',
    'tertiaryEmailAddress',
  ],
  list: [
    'id',
    'displayName',
    'emailAddresses',
    'primaryEmailAddress',
    'secondaryEmailAddress',
    'tertiaryEmailAddress',
    'mobilePhone',
    'businessPhones',
  ],
  full: [
    'id',
    'displayName',
    'givenName',
    'surname',
    'emailAddresses',
    'primaryEmailAddress',
    'secondaryEmailAddress',
    'tertiaryEmailAddress',
    'mobilePhone',
    'businessPhones',
    'homePhones',
    'companyName',
    'jobTitle',
    'department',
    'officeLocation',
    'businessAddress',
    'homeAddress',
    'birthday',
    'personalNotes',
    'categories',
    'createdDateTime',
    'lastModifiedDateTime',
  ],
};

/**
 * Format contact for display
 * @param {object} contact - Contact object from Graph API
 * @param {string} verbosity - Output verbosity level
 * @returns {string} - Formatted contact string
 */
function formatContact(contact, verbosity = 'standard') {
  const lines = [];

  lines.push(`### ${contact.displayName || '(No name)'}`);

  // Email addresses
  const structuredEmailLines = formatStructuredEmailLines(contact);
  if (structuredEmailLines.length > 0) {
    lines.push(...structuredEmailLines);
  } else if (contact.emailAddresses?.length > 0) {
    const emails = contact.emailAddresses.map((e) => e.address).join(', ');
    lines.push(`**Email**: ${emails}`);
  }

  // Skip phone/company/ID at minimal verbosity
  if (verbosity !== 'minimal') {
    // Phone numbers
    const phones = [];
    if (contact.mobilePhone) phones.push(`Mobile: ${contact.mobilePhone}`);
    if (contact.businessPhones?.length > 0) {
      phones.push(`Work: ${contact.businessPhones[0]}`);
    }
    if (contact.homePhones?.length > 0) {
      phones.push(`Home: ${contact.homePhones[0]}`);
    }
    if (phones.length > 0) {
      lines.push(`**Phone**: ${phones.join(' | ')}`);
    }

    // Job title and company info — F-40: previously squashed into a
    // single 'Company' label which mislabeled jobTitle-only contacts.
    if (contact.jobTitle) lines.push(`**Job Title**: ${contact.jobTitle}`);
    if (contact.companyName) lines.push(`**Company**: ${contact.companyName}`);
  }

  // Full verbosity extras
  if (verbosity === 'full') {
    if (contact.department) lines.push(`**Department**: ${contact.department}`);
    if (contact.officeLocation) {
      lines.push(`**Office**: ${contact.officeLocation}`);
    }
    if (contact.birthday) lines.push(`**Birthday**: ${contact.birthday}`);

    // Addresses
    if (contact.businessAddress?.city) {
      const addr = contact.businessAddress;
      lines.push(
        `**Business Address**: ${[addr.street, addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')}`
      );
    }
    if (contact.homeAddress?.city) {
      const addr = contact.homeAddress;
      lines.push(
        `**Home Address**: ${[addr.street, addr.city, addr.state, addr.postalCode].filter(Boolean).join(', ')}`
      );
    }

    if (contact.personalNotes) {
      lines.push(
        `**Notes**: ${contact.personalNotes.substring(0, 200)}${contact.personalNotes.length > 200 ? '...' : ''}`
      );
    }
  }

  if (verbosity !== 'minimal') {
    lines.push(`*ID: \`${contact.id}\`*`);
  }
  lines.push('');

  return lines.join('\n');
}

function formatStructuredEmailLines(contact) {
  const fields = [
    ['Primary Email', contact.primaryEmailAddress],
    ['Secondary Email', contact.secondaryEmailAddress],
    ['Tertiary Email', contact.tertiaryEmailAddress],
  ];
  return fields
    .filter(([, value]) => value?.address)
    .map(([label, value]) => `**${label}**: ${value.address}`);
}

/**
 * List contacts handler
 */
async function handleListContacts(args) {
  const count = Math.min(args.count || 50, 100);
  const verbosity = args.outputVerbosity || 'standard';
  const folder = args.folder || null; // null = default contacts folder

  const skip = args.skip || 0;

  try {
    const accessToken = await ensureAuthenticated();

    const fields = CONTACT_FIELDS[verbosity] || CONTACT_FIELDS.list;
    const endpoint = folder
      ? `me/contactFolders/${folder}/contacts`
      : 'me/contacts';

    const queryParams = {
      $select: fields.join(','),
      $top: count,
      $orderby: 'displayName',
      $count: 'true', // Surface true total so callers know if more pages exist
    };
    if (skip > 0) queryParams.$skip = skip;

    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );
    const contacts = response.value || [];
    const totalAvailable = response['@odata.count'];
    const hasMore = Boolean(response['@odata.nextLink']);

    const output = [];
    output.push(`# Contacts\n`);
    if (typeof totalAvailable === 'number') {
      output.push(
        `**Showing**: ${contacts.length} of ${totalAvailable}${skip > 0 ? ` (offset ${skip})` : ''}`
      );
    } else {
      output.push(`**Showing**: ${contacts.length}`);
    }
    // F-22: surface pagination cue when more results exist so callers
    // know to ask for the next page instead of assuming "Total: 50"
    // is the entire address book.
    if (
      hasMore ||
      (totalAvailable && contacts.length + skip < totalAvailable)
    ) {
      output.push(
        `**More available**: pass \`skip: ${skip + contacts.length}\` to fetch the next page (or \`count\` to raise the page size up to 100).`
      );
    }
    output.push('');

    contacts.forEach((contact) => {
      output.push(formatContact(contact, verbosity));
    });

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: {
        count: contacts.length,
        ...(typeof totalAvailable === 'number' && {
          totalAvailable,
        }),
        hasMore,
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error listing contacts: ${error.message}` },
      ],
    };
  }
}

/**
 * Search contacts handler
 */
async function handleSearchContacts(args) {
  const query = args.query;
  const count = Math.min(args.count || 25, 50);
  const verbosity = args.outputVerbosity || 'standard';

  if (!query) {
    return { content: [{ type: 'text', text: 'Search query is required.' }] };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const fields = CONTACT_FIELDS[verbosity] || CONTACT_FIELDS.list;
    const endpoint = 'me/contacts';

    // Build filter for name — emailAddresses/any() lambda is unreliable on personal accounts
    // and $orderby is incompatible with $filter on the contacts endpoint
    const escapedQuery = query.replace(/'/g, "''");
    const filter = `contains(displayName,'${escapedQuery}')`;

    let response;
    try {
      const queryParams = {
        $select: fields.join(','),
        $filter: filter,
        $top: count,
      };

      response = await callGraphAPI(
        accessToken,
        'GET',
        endpoint,
        null,
        queryParams
      );
    } catch (filterError) {
      // Fallback: fetch all contacts and filter client-side if $filter is unsupported
      console.error(
        `Contact $filter failed (${filterError.message}), falling back to client-side filter`
      );
      const allParams = {
        $select: fields.join(','),
        $top: 100,
        $orderby: 'displayName',
      };
      const allResponse = await callGraphAPI(
        accessToken,
        'GET',
        endpoint,
        null,
        allParams
      );
      const q = query.toLowerCase();
      response = {
        value: (allResponse.value || []).filter(
          (c) =>
            c.displayName?.toLowerCase().includes(q) ||
            c.emailAddresses?.some((e) => e.address?.toLowerCase().includes(q))
        ),
      };
      response.value = response.value.slice(0, count);
    }
    const contacts = response.value || [];

    const output = [];
    output.push(`# Contact Search Results\n`);
    output.push(`**Query**: "${query}"`);
    output.push(`**Found**: ${contacts.length}`);
    output.push('');

    contacts.forEach((contact) => {
      output.push(formatContact(contact, verbosity));
    });

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: { query, count: contacts.length },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error searching contacts: ${error.message}` },
      ],
    };
  }
}

/**
 * Get contact handler
 */
async function handleGetContact(args) {
  const contactId = args.id;

  if (!contactId) {
    return { content: [{ type: 'text', text: 'Contact ID is required.' }] };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const endpoint = `me/contacts/${contactId}`;
    const queryParams = {
      $select: CONTACT_FIELDS.full.join(','),
    };

    const contact = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );

    const output = formatContact(contact, 'full');

    return {
      content: [{ type: 'text', text: `# Contact Details\n\n${output}` }],
      _meta: { contactId: contact.id },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error getting contact: ${error.message}` },
      ],
    };
  }
}

/**
 * Create contact handler
 */
async function handleCreateContact(args) {
  const {
    displayName,
    firstName,
    lastName,
    email,
    emails,
    primaryEmailAddress,
    secondaryEmailAddress,
    tertiaryEmailAddress,
    mobilePhone,
    companyName,
    jobTitle,
    notes,
  } = args;

  // F-39: derive displayName from firstName/lastName if not provided.
  const resolvedDisplayName =
    displayName ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    primaryEmailAddress ||
    secondaryEmailAddress ||
    tertiaryEmailAddress ||
    email ||
    (Array.isArray(emails) && emails[0]);

  if (
    !resolvedDisplayName &&
    !email &&
    !(emails && emails.length > 0) &&
    !primaryEmailAddress &&
    !secondaryEmailAddress &&
    !tertiaryEmailAddress
  ) {
    return {
      content: [
        {
          type: 'text',
          text: 'At least displayName, firstName/lastName, email, or emails is required.',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const contactData = {};

    if (resolvedDisplayName) contactData.displayName = resolvedDisplayName;

    // F-39: prefer explicit givenName/surname when supplied; otherwise
    // derive from displayName if it's a multi-word string.
    if (firstName) contactData.givenName = firstName;
    if (lastName) contactData.surname = lastName;
    if (
      !contactData.givenName &&
      !contactData.surname &&
      displayName &&
      displayName.includes(' ')
    ) {
      const parts = displayName.split(' ');
      contactData.givenName = parts[0];
      contactData.surname = parts.slice(1).join(' ');
    }

    // Email: accept either `email` (single) or `emails` (array).
    const allEmails = [];
    if (email) allEmails.push(email);
    if (Array.isArray(emails)) allEmails.push(...emails);
    if (allEmails.length > 0) {
      contactData.emailAddresses = allEmails.map((addr) => ({
        address: addr,
        name: resolvedDisplayName || addr,
      }));
    }

    addStructuredEmailFields(contactData, {
      primaryEmailAddress,
      secondaryEmailAddress,
      tertiaryEmailAddress,
      displayName: resolvedDisplayName,
      includeName: true,
    });

    if (mobilePhone) contactData.mobilePhone = mobilePhone;
    if (companyName) contactData.companyName = companyName;
    if (jobTitle) contactData.jobTitle = jobTitle;
    if (notes) contactData.personalNotes = notes;

    const contact = await callGraphAPI(
      accessToken,
      'POST',
      'me/contacts',
      contactData
    );

    return {
      content: [
        {
          type: 'text',
          text: `# Contact Created\n\n${formatContact(contact, 'full')}`,
        },
      ],
      _meta: { contactId: contact.id },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error creating contact: ${error.message}` },
      ],
    };
  }
}

function addStructuredEmailFields(target, options) {
  const mappings = [
    ['primaryEmailAddress', options.primaryEmailAddress],
    ['secondaryEmailAddress', options.secondaryEmailAddress],
    ['tertiaryEmailAddress', options.tertiaryEmailAddress],
  ];

  mappings.forEach(([field, address]) => {
    if (address === undefined) return;
    if (!address) {
      target[field] = null;
      return;
    }
    target[field] = { address };
    if (options.includeName) {
      target[field].name = options.displayName || address;
    }
  });
}

/**
 * Update contact handler
 */
async function handleUpdateContact(args) {
  const {
    id,
    displayName,
    email,
    primaryEmailAddress,
    secondaryEmailAddress,
    tertiaryEmailAddress,
    mobilePhone,
    companyName,
    jobTitle,
    notes,
  } = args;

  if (!id) {
    return { content: [{ type: 'text', text: 'Contact ID is required.' }] };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const contactData = {};

    if (displayName !== undefined) {
      contactData.displayName = displayName;
      if (displayName && displayName.includes(' ')) {
        const parts = displayName.split(' ');
        contactData.givenName = parts[0];
        contactData.surname = parts.slice(1).join(' ');
      }
    }
    if (email !== undefined) {
      contactData.emailAddresses = email ? [{ address: email }] : [];
    }
    addStructuredEmailFields(contactData, {
      primaryEmailAddress,
      secondaryEmailAddress,
      tertiaryEmailAddress,
      includeName: false,
    });
    if (mobilePhone !== undefined) contactData.mobilePhone = mobilePhone;
    if (companyName !== undefined) contactData.companyName = companyName;
    if (jobTitle !== undefined) contactData.jobTitle = jobTitle;
    if (notes !== undefined) contactData.personalNotes = notes;

    const endpoint = `me/contacts/${id}`;
    const contact = await callGraphAPI(
      accessToken,
      'PATCH',
      endpoint,
      contactData
    );

    return {
      content: [
        {
          type: 'text',
          text: `# Contact Updated\n\n${formatContact(contact, 'full')}`,
        },
      ],
      _meta: { contactId: contact.id },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error updating contact: ${error.message}` },
      ],
    };
  }
}

/**
 * Delete contact handler
 */
async function handleDeleteContact(args) {
  const contactId = args.id;

  if (!contactId) {
    return { content: [{ type: 'text', text: 'Contact ID is required.' }] };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const endpoint = `me/contacts/${contactId}`;
    await callGraphAPI(accessToken, 'DELETE', endpoint);

    return {
      content: [
        {
          type: 'text',
          text: `# Contact Deleted\n\nContact with ID \`${contactId}\` has been deleted.`,
        },
      ],
      _meta: { contactId, deleted: true },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error deleting contact: ${error.message}` },
      ],
    };
  }
}

/**
 * Search people handler (relevance-based search via People API)
 */
async function handleSearchPeople(args) {
  const action = args.action || 'search';
  if (action === 'manager') {
    return handlePeopleManagerLookup(args);
  }
  if (action === 'directReports') {
    return handlePeopleDirectReportsLookup(args);
  }
  if (action !== 'search') {
    return {
      content: [
        {
          type: 'text',
          text: `Unknown action '${action}'. Valid actions: search, manager, directReports.`,
        },
      ],
    };
  }

  const query = args.query;
  const count = Math.min(args.count || 25, 50);

  if (!query) {
    return { content: [{ type: 'text', text: 'Search query is required.' }] };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const endpoint = 'me/people';
    const queryParams = {
      $search: `"${query}"`,
      $top: count,
      $select:
        'id,displayName,scoredEmailAddresses,phones,companyName,jobTitle,department,userPrincipalName,personType',
    };

    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );
    const people = response.value || [];

    const output = [];
    output.push(`# People Search Results\n`);
    output.push(`**Query**: "${query}"`);
    output.push(`**Found**: ${people.length} (sorted by relevance)`);
    output.push('');

    people.forEach((person, index) => {
      output.push(`### ${index + 1}. ${person.displayName || '(No name)'}`);

      // Person type
      const personType = person.personType?.class || 'Unknown';
      output.push(`**Type**: ${personType}`);

      // Email
      if (person.scoredEmailAddresses?.length > 0) {
        output.push(`**Email**: ${person.scoredEmailAddresses[0].address}`);
      } else if (person.userPrincipalName) {
        output.push(`**Email**: ${person.userPrincipalName}`);
      }

      // Company info
      if (person.companyName || person.jobTitle) {
        const company = [person.jobTitle, person.companyName]
          .filter(Boolean)
          .join(' at ');
        output.push(`**Position**: ${company}`);
      }
      if (person.department) {
        output.push(`**Department**: ${person.department}`);
      }

      // Phone
      if (person.phones?.length > 0) {
        output.push(`**Phone**: ${person.phones[0].number}`);
      }

      output.push('');
    });

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: { query, count: people.length },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    return {
      content: [
        { type: 'text', text: `Error searching people: ${error.message}` },
      ],
    };
  }
}

const ORG_PERSON_SELECT =
  'id,displayName,mail,userPrincipalName,jobTitle,department,companyName,businessPhones,mobilePhone,officeLocation';

function buildOrgHierarchyEndpoint(userId, relationship) {
  if (!userId || userId === 'me') {
    return `me/${relationship}`;
  }
  return `users/${encodeURIComponent(userId)}/${relationship}`;
}

function formatDirectoryPerson(person, headingPrefix = '###') {
  const lines = [];
  lines.push(`${headingPrefix} ${person.displayName || '(No name)'}`);

  const email = person.mail || person.userPrincipalName;
  if (email) lines.push(`**Email**: ${email}`);

  const position = [person.jobTitle, person.companyName]
    .filter(Boolean)
    .join(' at ');
  if (position) lines.push(`**Position**: ${position}`);
  if (person.department) lines.push(`**Department**: ${person.department}`);
  if (person.officeLocation) {
    lines.push(`**Office**: ${person.officeLocation}`);
  }

  const phone =
    person.mobilePhone ||
    (Array.isArray(person.businessPhones) && person.businessPhones[0]);
  if (phone) lines.push(`**Phone**: ${phone}`);

  return lines.join('\n');
}

function orgHierarchyGuidance() {
  return (
    'Org hierarchy requires a work or school account and the Microsoft Graph ' +
    '`User.Read.All` delegated permission. Personal Outlook.com accounts do not ' +
    'support manager or direct reports lookups. If you just added the scope, ' +
    'delete the token file and authenticate again so Microsoft issues a token ' +
    'with the new permission.'
  );
}

function isOrgHierarchyCompatibilityError(error) {
  const message = error.message || '';
  return (
    message.includes('403') ||
    message.includes('401') ||
    message.includes('Authorization_RequestDenied') ||
    message.includes('Insufficient privileges') ||
    message.includes('Unsupported segment') ||
    message.includes('Request_ResourceNotFound') ||
    message.includes('personal') ||
    message.includes('not supported')
  );
}

async function handlePeopleManagerLookup(args) {
  const userId = args.userId || 'me';

  try {
    const accessToken = await ensureAuthenticated();
    const manager = await callGraphAPI(
      accessToken,
      'GET',
      buildOrgHierarchyEndpoint(userId, 'manager'),
      null,
      { $select: ORG_PERSON_SELECT }
    );

    return {
      content: [
        {
          type: 'text',
          text: `# Manager\n\n**User**: ${userId}\n\n${formatDirectoryPerson(manager)}`,
        },
      ],
      _meta: { action: 'manager', userId, managerId: manager.id },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    if (error.message?.includes('404')) {
      return {
        content: [
          {
            type: 'text',
            text: `No manager found for ${userId}.`,
          },
        ],
        _meta: { action: 'manager', userId, found: false },
      };
    }
    if (isOrgHierarchyCompatibilityError(error)) {
      return { content: [{ type: 'text', text: orgHierarchyGuidance() }] };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error looking up manager: ${error.message}`,
        },
      ],
    };
  }
}

async function handlePeopleDirectReportsLookup(args) {
  const userId = args.userId || 'me';
  const count = Math.min(args.count || 25, 50);

  try {
    const accessToken = await ensureAuthenticated();
    const response = await callGraphAPI(
      accessToken,
      'GET',
      buildOrgHierarchyEndpoint(userId, 'directReports'),
      null,
      { $top: count, $select: ORG_PERSON_SELECT }
    );
    const reports = response.value || [];

    const output = [];
    output.push('# Direct Reports\n');
    output.push(`**User**: ${userId}`);
    output.push(`**Found**: ${reports.length}`);
    output.push('');

    if (reports.length === 0) {
      output.push('No direct reports found.');
    } else {
      reports.forEach((person, index) => {
        output.push(formatDirectoryPerson(person, `## ${index + 1}.`));
        output.push('');
      });
    }

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: { action: 'directReports', userId, count: reports.length },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'auth' tool with action=authenticate first.",
          },
        ],
      };
    }
    if (isOrgHierarchyCompatibilityError(error)) {
      return { content: [{ type: 'text', text: orgHierarchyGuidance() }] };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Error looking up direct reports: ${error.message}`,
        },
      ],
    };
  }
}

// Consolidated tool definitions (7 → 2)
const contactsTools = [
  {
    name: 'manage-contact',
    description:
      "Full CRUD over the signed-in user's personal Outlook contacts (destructive: covers `delete` action). action=`list` (default) returns contacts with pagination via `skip`/`count` (default 50). action=`search` returns contacts matching `query` against name/email (default 25). action=`get` returns full contact detail by `id`. action=`create` adds a new contact and returns its `id`. action=`update` patches the given fields by `id` (only fields passed are changed). action=`delete` permanently removes the contact by `id`. Email fields accept the legacy `email`/`emails` array plus structured `primaryEmailAddress`, `secondaryEmailAddress`, and `tertiaryEmailAddress`. Use `outputVerbosity` (minimal/standard/full) on list/search to control field count. Prefer `search-people` for cross-source relevance ranking (contacts + directory + recent comms) — this tool only searches your personal contact store.",
    annotations: {
      title: 'Contacts',
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'search', 'get', 'create', 'update', 'delete'],
          description: 'Action to perform (default: list)',
        },
        // list params
        count: {
          type: 'number',
          description:
            'Number of results (action=list default: 50, action=search default: 25)',
        },
        skip: {
          type: 'integer',
          description:
            'Pagination offset for action=list (default: 0). Use the value suggested by the previous page response.',
        },
        folder: {
          type: 'string',
          description: 'Contact folder ID (action=list)',
        },
        outputVerbosity: {
          type: 'string',
          enum: ['minimal', 'standard', 'full'],
          description:
            'Output detail level (action=list/search, default: standard)',
        },
        // search params
        query: {
          type: 'string',
          description:
            'Search query for name or email (action=search, required)',
        },
        // get/update/delete params
        id: {
          type: 'string',
          description: 'Contact ID (action=get/update/delete, required)',
        },
        // create/update params
        displayName: {
          type: 'string',
          description: 'Full name (action=create/update)',
        },
        firstName: {
          type: 'string',
          description:
            'Given name (action=create/update). Maps to Graph `givenName`. If displayName not provided, will be combined with lastName.',
        },
        lastName: {
          type: 'string',
          description:
            'Surname (action=create/update). Maps to Graph `surname`.',
        },
        email: {
          type: 'string',
          description: 'Primary email address (action=create/update)',
        },
        emails: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Multiple email addresses (action=create/update). First entry is primary.',
        },
        primaryEmailAddress: {
          type: 'string',
          description:
            'Structured primary email address (action=create/update). Maps to Graph `primaryEmailAddress`.',
        },
        secondaryEmailAddress: {
          type: 'string',
          description:
            'Structured secondary email address (action=create/update). Maps to Graph `secondaryEmailAddress`.',
        },
        tertiaryEmailAddress: {
          type: 'string',
          description:
            'Structured tertiary email address (action=create/update). Maps to Graph `tertiaryEmailAddress`.',
        },
        mobilePhone: {
          type: 'string',
          description: 'Mobile phone number (action=create/update)',
        },
        companyName: {
          type: 'string',
          description: 'Company name (action=create/update)',
        },
        jobTitle: {
          type: 'string',
          description: 'Job title (action=create/update)',
        },
        notes: {
          type: 'string',
          description: 'Personal notes (action=create/update)',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: async (args) => {
      const action = args.action || 'list';
      switch (action) {
        case 'search':
          return handleSearchContacts(args);
        case 'get':
          return handleGetContact(args);
        case 'create':
          return handleCreateContact(args);
        case 'update':
          return handleUpdateContact(args);
        case 'delete':
          return handleDeleteContact(args);
        case 'list':
          return handleListContacts(args);
        default:
          return {
            content: [
              {
                type: 'text',
                text: `Unknown action '${action}'. Valid actions: list, search, get, create, update, delete.`,
              },
            ],
          };
      }
    },
  },
  {
    name: 'search-people',
    description:
      'Read-only people lookup. action=`search` (default) does relevance-ranked search across personal contacts, organisation directory, and recent communications via the Microsoft Graph People API. action=`manager` returns the signed-in or specified work/school user manager. action=`directReports` lists the signed-in or specified work/school user direct reports. Org hierarchy actions require a Microsoft 365 work/school account and `User.Read.All`; personal Outlook.com accounts are not supported. Use `manage-contact` action=`search` instead when you specifically need entries from your personal contact store only.',
    annotations: {
      title: 'People Search',
      readOnlyHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'manager', 'directReports'],
          description:
            'Action to perform: search (default), manager, or directReports.',
        },
        query: {
          type: 'string',
          description:
            'Search query for action=search (name, email, company). Required for search.',
        },
        userId: {
          type: 'string',
          description:
            'User ID or user principal name for action=manager/directReports. Defaults to me.',
        },
        count: {
          type: 'number',
          description:
            'Maximum results to return for action=search/directReports (default: 25, max: 50)',
        },
      },
      additionalProperties: false,
      required: [],
    },
    handler: handleSearchPeople,
  },
];

module.exports = {
  contactsTools,
  handleListContacts,
  handleSearchContacts,
  handleGetContact,
  handleCreateContact,
  handleUpdateContact,
  handleDeleteContact,
  handleSearchPeople,
};
