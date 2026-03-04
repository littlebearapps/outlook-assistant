/**
 * Improved search emails functionality
 *
 * Token-efficient implementation with outputVerbosity support and Markdown formatting.
 */
const _config = require('../config'); // Reserved for future use
const { callGraphAPI, callGraphAPIPaginated } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolderPath } = require('./folder-utils');
const {
  formatEmailList,
  VERBOSITY,
  DEFAULT_LIMITS,
} = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');

/**
 * Search emails handler
 * @param {object} args - Tool arguments
 * @param {string} [args.folder] - Folder to search (default: inbox)
 * @param {number} [args.count] - Number of results (default: 10, max: 50)
 * @param {string} [args.outputVerbosity] - minimal, standard, or full (default: standard)
 * @param {string} [args.kqlQuery] - Raw KQL query for advanced users
 * @returns {object} - MCP response with Markdown formatted content
 */
async function handleSearchEmails(args) {
  const folder = args.folder || 'inbox';
  const requestedCount = args.count || DEFAULT_LIMITS.searchEmails; // Default 10
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;
  const query = args.query || '';
  const from = args.from || '';
  const to = args.to || '';
  const subject = args.subject || '';
  const hasAttachments = args.hasAttachments;
  const unreadOnly = args.unreadOnly;
  const receivedAfter = args.receivedAfter || '';
  const receivedBefore = args.receivedBefore || '';
  const searchAllFolders = args.searchAllFolders || false;
  const kqlQuery = args.kqlQuery || ''; // Raw KQL for advanced users

  // Select fields based on verbosity
  const selectFields = getEmailFields(
    verbosity === VERBOSITY.FULL ? 'search' : 'list'
  );

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Determine endpoint - search all folders or specific folder
    let endpoint;
    if (searchAllFolders) {
      endpoint = 'me/messages';
      console.error('Searching across all mail folders');
    } else {
      endpoint = await resolveFolderPath(accessToken, folder);
      console.error(`Using endpoint: ${endpoint} for folder: ${folder}`);
    }

    // Execute progressive search with pagination
    const response = await progressiveSearch(
      endpoint,
      accessToken,
      { query, from, to, subject, kqlQuery },
      { hasAttachments, unreadOnly, receivedAfter, receivedBefore },
      requestedCount,
      selectFields
    );

    return formatSearchResults(response, folder, verbosity);
  } catch (error) {
    // Handle authentication errors
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'authenticate' tool first.",
          },
        ],
      };
    }

    // General error response
    return {
      content: [
        {
          type: 'text',
          text: `Error searching emails: ${error.message}`,
        },
      ],
    };
  }
}

/**
 * Execute a search with progressively simpler fallback strategies
 * @param {string} endpoint - API endpoint
 * @param {string} accessToken - Access token
 * @param {object} searchTerms - Search terms (query, from, to, subject, kqlQuery)
 * @param {object} filterTerms - Filter terms (hasAttachments, unreadOnly)
 * @param {number} maxCount - Maximum number of results to retrieve
 * @param {string} selectFields - Comma-separated field list for $select
 * @returns {Promise<object>} - Search results
 */
async function progressiveSearch(
  endpoint,
  accessToken,
  searchTerms,
  filterTerms,
  maxCount,
  selectFields
) {
  // Track search strategies attempted
  const searchAttempts = [];

  // 0. If raw KQL query provided, use it directly
  if (searchTerms.kqlQuery) {
    try {
      console.error(`Attempting raw KQL search: "${searchTerms.kqlQuery}"`);
      searchAttempts.push('raw-kql');

      const kqlParams = {
        $top: Math.min(50, maxCount),
        $select: selectFields,
        $search: `"${searchTerms.kqlQuery}"`,
      };

      const response = await callGraphAPIPaginated(
        accessToken,
        'GET',
        endpoint,
        kqlParams,
        maxCount
      );
      if (response.value && response.value.length > 0) {
        console.error(
          `Raw KQL search successful: found ${response.value.length} results`
        );
        return response;
      }
    } catch (error) {
      console.error(`Raw KQL search failed: ${error.message}`);
    }
  }

  // 1. Try combined search (most specific)
  try {
    const params = buildSearchParams(
      searchTerms,
      filterTerms,
      Math.min(50, maxCount),
      selectFields
    );
    console.error('Attempting combined search with params:', params);
    searchAttempts.push('combined-search');

    const response = await callGraphAPIPaginated(
      accessToken,
      'GET',
      endpoint,
      params,
      maxCount
    );
    if (response.value && response.value.length > 0) {
      console.error(
        `Combined search successful: found ${response.value.length} results`
      );
      return response;
    }
  } catch (error) {
    console.error(`Combined search failed: ${error.message}`);
  }

  // 2. Try each search term individually, starting with most specific
  const searchPriority = ['from', 'to', 'subject', 'query'];

  for (const term of searchPriority) {
    if (searchTerms[term]) {
      try {
        console.error(
          `Attempting search with only ${term}: "${searchTerms[term]}"`
        );
        searchAttempts.push(`single-term-${term}`);

        const simplifiedParams = {
          $top: Math.min(50, maxCount),
          $select: selectFields,
        };

        // Use $filter for from/to/subject (more reliable on personal accounts),
        // $search for free-text query only.
        // NOTE: $filter and $orderby cannot be used together on mailbox - Graph API limitation
        if (term === 'from') {
          if (searchTerms[term].includes('@')) {
            simplifiedParams.$filter = `from/emailAddress/address eq '${searchTerms[term]}'`;
          } else {
            simplifiedParams.$filter = `contains(from/emailAddress/name, '${searchTerms[term]}')`;
          }
        } else if (term === 'to') {
          if (searchTerms[term].includes('@')) {
            simplifiedParams.$filter = `toRecipients/any(r: r/emailAddress/address eq '${searchTerms[term]}')`;
          } else {
            simplifiedParams.$filter = `toRecipients/any(r: contains(r/emailAddress/name, '${searchTerms[term]}'))`;
          }
        } else if (term === 'subject') {
          // Use $filter with contains() — $search silently fails on personal MS accounts
          simplifiedParams.$filter = `contains(subject, '${searchTerms[term].replace(/'/g, "''")}')`;
        } else if (term === 'query') {
          simplifiedParams.$orderby = 'receivedDateTime desc';
          simplifiedParams.$search = `"${searchTerms[term]}"`;
        }

        // Add boolean filters if applicable
        addBooleanFilters(simplifiedParams, filterTerms);

        const response = await callGraphAPIPaginated(
          accessToken,
          'GET',
          endpoint,
          simplifiedParams,
          maxCount
        );
        if (response.value && response.value.length > 0) {
          console.error(
            `Search with ${term} successful: found ${response.value.length} results`
          );
          return response;
        }
      } catch (error) {
        console.error(`Search with ${term} failed: ${error.message}`);
      }
    }
  }

  // 3. Try with only boolean filters
  if (filterTerms.hasAttachments === true || filterTerms.unreadOnly === true) {
    try {
      console.error('Attempting search with only boolean filters');
      searchAttempts.push('boolean-filters-only');

      const filterOnlyParams = {
        $top: Math.min(50, maxCount),
        $select: selectFields,
        $orderby: 'receivedDateTime desc',
      };

      // Add the boolean filters
      addBooleanFilters(filterOnlyParams, filterTerms);

      const response = await callGraphAPIPaginated(
        accessToken,
        'GET',
        endpoint,
        filterOnlyParams,
        maxCount
      );
      console.error(
        `Boolean filter search found ${response.value?.length || 0} results`
      );
      return response;
    } catch (error) {
      console.error(`Boolean filter search failed: ${error.message}`);
    }
  }

  // 4. Final fallback: just get recent emails with pagination
  console.error('All search strategies failed, falling back to recent emails');
  searchAttempts.push('recent-emails');

  const basicParams = {
    $top: Math.min(50, maxCount),
    $select: selectFields,
    $orderby: 'receivedDateTime desc',
  };

  const response = await callGraphAPIPaginated(
    accessToken,
    'GET',
    endpoint,
    basicParams,
    maxCount
  );
  console.error(
    `Fallback to recent emails found ${response.value?.length || 0} results`
  );

  // Add a note to the response about the search attempts
  response._searchInfo = {
    attemptsCount: searchAttempts.length,
    strategies: searchAttempts,
    originalTerms: searchTerms,
    filterTerms: filterTerms,
  };

  return response;
}

/**
 * Build search parameters from search terms and filter terms
 * Uses $filter for email addresses (more reliable than $search)
 * Uses $search only for general query and subject
 * @param {object} searchTerms - Search terms (query, from, to, subject)
 * @param {object} filterTerms - Filter terms (hasAttachments, unreadOnly)
 * @param {number} count - Maximum number of results
 * @param {string} selectFields - Comma-separated field list for $select
 * @returns {object} - Query parameters
 */
function buildSearchParams(searchTerms, filterTerms, count, selectFields) {
  const params = {
    $top: count,
    $select: selectFields,
  };

  // Track if we're using email address filters (which are incompatible with $orderby)
  let usesEmailFilter = false;

  // Handle search terms - use $search only for free-text query
  if (searchTerms.query) {
    params.$search = `"${searchTerms.query}"`;
  }

  // Build filter conditions array - use $filter for structured fields (more reliable)
  const filterConditions = [];

  // Use $filter for subject — $search silently fails on personal MS accounts
  if (searchTerms.subject) {
    filterConditions.push(
      `contains(subject, '${searchTerms.subject.replace(/'/g, "''")}')`
    );
  }

  // Use $filter for from/to email addresses (much more reliable than $search)
  // NOTE: $filter on email addresses is incompatible with $orderby - Graph API limitation
  if (searchTerms.from) {
    usesEmailFilter = true;
    if (searchTerms.from.includes('@')) {
      filterConditions.push(
        `from/emailAddress/address eq '${searchTerms.from}'`
      );
    } else {
      filterConditions.push(
        `contains(from/emailAddress/name, '${searchTerms.from}')`
      );
    }
  }

  if (searchTerms.to) {
    usesEmailFilter = true;
    if (searchTerms.to.includes('@')) {
      filterConditions.push(
        `toRecipients/any(r: r/emailAddress/address eq '${searchTerms.to}')`
      );
    } else {
      filterConditions.push(
        `toRecipients/any(r: contains(r/emailAddress/name, '${searchTerms.to}'))`
      );
    }
  }

  // Add boolean filters (these ARE compatible with $orderby)
  if (filterTerms.hasAttachments === true) {
    filterConditions.push('hasAttachments eq true');
  }

  if (filterTerms.unreadOnly === true) {
    filterConditions.push('isRead eq false');
  }

  // Add date range filters
  if (filterTerms.receivedAfter) {
    try {
      const afterDate = new Date(filterTerms.receivedAfter).toISOString();
      filterConditions.push(`receivedDateTime ge ${afterDate}`);
    } catch (_e) {
      console.error(`Invalid receivedAfter date: ${filterTerms.receivedAfter}`);
    }
  }

  if (filterTerms.receivedBefore) {
    try {
      const beforeDate = new Date(filterTerms.receivedBefore).toISOString();
      filterConditions.push(`receivedDateTime le ${beforeDate}`);
    } catch (_e) {
      console.error(
        `Invalid receivedBefore date: ${filterTerms.receivedBefore}`
      );
    }
  }

  // Only add $orderby if we're NOT using email address filters
  if (!usesEmailFilter) {
    params.$orderby = 'receivedDateTime desc';
  }

  // Combine all filter conditions
  if (filterConditions.length > 0) {
    params.$filter = filterConditions.join(' and ');
  }

  return params;
}

/**
 * Add boolean and date filters to query parameters
 * @param {object} params - Query parameters
 * @param {object} filterTerms - Filter terms (hasAttachments, unreadOnly, receivedAfter, receivedBefore)
 */
function addBooleanFilters(params, filterTerms) {
  const filterConditions = [];

  if (filterTerms.hasAttachments === true) {
    filterConditions.push('hasAttachments eq true');
  }

  if (filterTerms.unreadOnly === true) {
    filterConditions.push('isRead eq false');
  }

  // Add date range filters
  if (filterTerms.receivedAfter) {
    try {
      const afterDate = new Date(filterTerms.receivedAfter).toISOString();
      filterConditions.push(`receivedDateTime ge ${afterDate}`);
    } catch (_e) {
      console.error(`Invalid receivedAfter date: ${filterTerms.receivedAfter}`);
    }
  }

  if (filterTerms.receivedBefore) {
    try {
      const beforeDate = new Date(filterTerms.receivedBefore).toISOString();
      filterConditions.push(`receivedDateTime le ${beforeDate}`);
    } catch (_e) {
      console.error(
        `Invalid receivedBefore date: ${filterTerms.receivedBefore}`
      );
    }
  }

  // Add $filter parameter if we have any filter conditions
  if (filterConditions.length > 0) {
    params.$filter = filterConditions.join(' and ');
  }
}

/**
 * Format search results into Markdown using response-formatter utilities
 * @param {object} response - The API response object
 * @param {string} folder - Folder that was searched
 * @param {string} verbosity - Output verbosity level
 * @returns {object} - MCP response object
 */
function formatSearchResults(response, folder, verbosity) {
  if (!response.value || response.value.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: `No emails found matching your search criteria.`,
        },
      ],
    };
  }

  // Build metadata
  const meta = {
    returned: response.value.length,
    totalAvailable: response['@odata.count'] || null,
    hasMore: !!response['@odata.nextLink'],
    verbosity: verbosity,
  };

  // Add search strategy info if available (for debugging)
  let searchNote = '';
  if (response._searchInfo) {
    const strategy =
      response._searchInfo.strategies[
        response._searchInfo.strategies.length - 1
      ];
    if (strategy === 'recent-emails') {
      searchNote =
        '\n\n**Note**: Your search query could not be applied — showing recent emails instead. ' +
        'On personal Microsoft accounts, free-text `query` search may not work. ' +
        'Try using `subject`, `from`, `to`, or `kqlQuery` parameters for more reliable filtering.';
    } else {
      searchNote = `\n\n_Search strategy: ${strategy}_`;
    }
  }

  // Format results using shared formatter
  const formattedOutput = formatEmailList(
    response.value,
    `Search Results (${folder})`,
    verbosity,
    meta
  );

  return {
    content: [
      {
        type: 'text',
        text: formattedOutput + searchNote,
      },
    ],
    _meta: meta,
  };
}

/**
 * Search for email by Message-ID header
 * @param {object} args - Tool arguments
 * @param {string} args.messageId - Full Message-ID header value (e.g., <abc123@example.com>)
 * @param {string} [args.outputVerbosity] - Output detail level
 * @returns {object} - MCP response with matching email(s)
 */
async function handleSearchByMessageId(args) {
  const messageId = args.messageId;
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;

  if (!messageId) {
    return {
      content: [
        {
          type: 'text',
          text: 'Message-ID is required. Provide the full Message-ID header value (e.g., <abc123@example.com>)',
        },
      ],
    };
  }

  try {
    const accessToken = await ensureAuthenticated();

    // Search across all folders for the Message-ID
    const selectFields = getEmailFields(
      verbosity === VERBOSITY.FULL ? 'forensic' : 'read'
    );

    // Build filter - need to escape the Message-ID properly
    // Graph API expects: internetMessageId eq '<value>'
    const escapedMessageId = messageId.replace(/'/g, "''");

    const params = {
      $filter: `internetMessageId eq '${escapedMessageId}'`,
      $select: selectFields,
      $top: '10', // Usually only one match, but allow for edge cases
    };

    console.error(`Searching for Message-ID: ${messageId}`);

    const response = await callGraphAPI(
      accessToken,
      'GET',
      'me/messages',
      null,
      params
    );

    const emails = response.value || [];

    if (emails.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `## No Email Found\n\nNo email found with Message-ID: \`${messageId}\`\n\n**Tips:**\n- Ensure the full Message-ID is provided including angle brackets\n- Message-ID format: \`<unique-id@domain.com>\`\n- The email may have been deleted or not yet synced`,
          },
        ],
      };
    }

    // Format results
    let resultText = `## Message-ID Search Results\n\n`;
    resultText += `**Query:** \`${messageId}\`\n`;
    resultText += `**Found:** ${emails.length} email(s)\n\n`;

    // Use formatEmailList for consistent output
    resultText += formatEmailList(emails, 'Match', verbosity);

    return {
      content: [
        {
          type: 'text',
          text: resultText,
        },
      ],
      _meta: {
        messageId: messageId,
        matchCount: emails.length,
        emailIds: emails.map((e) => e.id),
      },
    };
  } catch (error) {
    if (error.message === 'Authentication required') {
      return {
        content: [
          {
            type: 'text',
            text: "Authentication required. Please use the 'authenticate' tool first.",
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Error searching by Message-ID: ${error.message}`,
        },
      ],
    };
  }
}

module.exports = {
  handleSearchEmails,
  handleSearchByMessageId,
};
