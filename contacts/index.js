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
  minimal: ['id', 'displayName', 'emailAddresses'],
  list: [
    'id',
    'displayName',
    'emailAddresses',
    'mobilePhone',
    'businessPhones',
  ],
  full: [
    'id',
    'displayName',
    'givenName',
    'surname',
    'emailAddresses',
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
  if (contact.emailAddresses?.length > 0) {
    const emails = contact.emailAddresses.map((e) => e.address).join(', ');
    lines.push(`**Email**: ${emails}`);
  }

  // Skip phone/company/ID at minimal verbosity
  if (verbosity !== 'minimal') {
    // Phone numbers
    const phones = [];
    if (contact.mobilePhone) phones.push(`Mobile: ${contact.mobilePhone}`);
    if (contact.businessPhones?.length > 0)
      phones.push(`Work: ${contact.businessPhones[0]}`);
    if (contact.homePhones?.length > 0)
      phones.push(`Home: ${contact.homePhones[0]}`);
    if (phones.length > 0) {
      lines.push(`**Phone**: ${phones.join(' | ')}`);
    }

    // Company info
    if (contact.companyName || contact.jobTitle) {
      const company = [contact.jobTitle, contact.companyName]
        .filter(Boolean)
        .join(' at ');
      lines.push(`**Company**: ${company}`);
    }
  }

  // Full verbosity extras
  if (verbosity === 'full') {
    if (contact.department) lines.push(`**Department**: ${contact.department}`);
    if (contact.officeLocation)
      lines.push(`**Office**: ${contact.officeLocation}`);
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

/**
 * List contacts handler
 */
async function handleListContacts(args) {
  const count = Math.min(args.count || 50, 100);
  const verbosity = args.outputVerbosity || 'standard';
  const folder = args.folder || null; // null = default contacts folder

  try {
    const accessToken = await ensureAuthenticated();

    const fields =
      verbosity === 'full'
        ? CONTACT_FIELDS.full
        : verbosity === 'minimal'
          ? CONTACT_FIELDS.minimal
          : CONTACT_FIELDS.list;
    const endpoint = folder
      ? `me/contactFolders/${folder}/contacts`
      : 'me/contacts';

    const queryParams = {
      $select: fields.join(','),
      $top: count,
      $orderby: 'displayName',
    };

    const response = await callGraphAPI(
      accessToken,
      'GET',
      endpoint,
      null,
      queryParams
    );
    const contacts = response.value || [];

    let output = [];
    output.push(`# Contacts\n`);
    output.push(`**Total**: ${contacts.length}`);
    output.push('');

    contacts.forEach((contact) => {
      output.push(formatContact(contact, verbosity));
    });

    return {
      content: [{ type: 'text', text: output.join('\n') }],
      _meta: { count: contacts.length },
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

    const fields =
      verbosity === 'full'
        ? CONTACT_FIELDS.full
        : verbosity === 'minimal'
          ? CONTACT_FIELDS.minimal
          : CONTACT_FIELDS.list;
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

    let output = [];
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
  const { displayName, email, mobilePhone, companyName, jobTitle, notes } =
    args;

  if (!displayName && !email) {
    return {
      content: [
        { type: 'text', text: 'At least displayName or email is required.' },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    const contactData = {};

    if (displayName) contactData.displayName = displayName;
    if (email) {
      contactData.emailAddresses = [
        { address: email, name: displayName || email },
      ];
    }
    if (mobilePhone) contactData.mobilePhone = mobilePhone;
    if (companyName) contactData.companyName = companyName;
    if (jobTitle) contactData.jobTitle = jobTitle;
    if (notes) contactData.personalNotes = notes;

    // Parse name into given/surname if provided
    if (displayName && displayName.includes(' ')) {
      const parts = displayName.split(' ');
      contactData.givenName = parts[0];
      contactData.surname = parts.slice(1).join(' ');
    }

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

/**
 * Update contact handler
 */
async function handleUpdateContact(args) {
  const { id, displayName, email, mobilePhone, companyName, jobTitle, notes } =
    args;

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

    let output = [];
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

// Consolidated tool definitions (7 → 2)
const contactsTools = [
  {
    name: 'manage-contact',
    description:
      'Manage personal contacts. action=list (default) lists contacts. action=search searches by name/email. action=get retrieves full details. action=create adds a contact. action=update modifies a contact. action=delete removes a contact.',
    annotations: {
      title: 'Contacts',
      readOnlyHint: false,
      destructiveHint: false,
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
        email: {
          type: 'string',
          description: 'Primary email address (action=create/update)',
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
        default:
          return handleListContacts(args);
      }
    },
  },
  {
    name: 'search-people',
    description:
      'Search for people by relevance (includes contacts, directory, and recent communications). Uses a different API from manage-contact search.',
    annotations: {
      title: 'People Search',
      readOnlyHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query (name, email, company)',
        },
        count: {
          type: 'number',
          description: 'Maximum results to return (default: 25, max: 50)',
        },
      },
      required: ['query'],
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
