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

  // Validate count
  if (args.count !== undefined && args.count < 1) {
    return {
      content: [{ type: 'text', text: 'count must be at least 1.' }],
    };
  }

  const requestedCount = args.count ?? DEFAULT_LIMITS.searchEmails; // Default 10
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
        response._searchInfo = {
          attemptsCount: searchAttempts.length,
          strategies: searchAttempts,
          originalTerms: searchTerms,
          filterTerms: filterTerms,
        };
        return response;
      }
    } catch (error) {
      console.error(`Raw KQL search failed: ${error.message}`);
    }
  }

  // Check if we have any actual search terms (not just boolean filters)
  const hasSearchTerms =
    searchTerms.query ||
    searchTerms.from ||
    searchTerms.to ||
    searchTerms.subject;

  // 1. Try combined search (most specific) — skip if only boolean filters
  if (
    !hasSearchTerms &&
    (filterTerms.hasAttachments === true || filterTerms.unreadOnly === true)
  ) {
    // Skip directly to boolean-only filter (step 3) — combined search is redundant
    console.error('Only boolean filters provided, skipping combined search');
  } else {
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
        response._searchInfo = {
          attemptsCount: searchAttempts.length,
          strategies: searchAttempts,
          originalTerms: searchTerms,
          filterTerms: filterTerms,
        };
        return response;
      }
    } catch (error) {
      console.error(`Combined search failed: ${error.message}`);
    }
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
          simplifiedParams.$filter = buildFromFilter(searchTerms[term]);
        } else if (term === 'to') {
          simplifiedParams.$filter = buildToFilter(searchTerms[term]);
        } else if (term === 'subject') {
          // Use $filter with contains() — $search silently fails on personal MS accounts
          simplifiedParams.$filter = `contains(subject, '${searchTerms[term].replace(/'/g, "''")}')`;
        } else if (term === 'query') {
          // On personal accounts, $search fails with 503. Use $filter with
          // contains(subject) as a best-effort fallback for free-text queries.
          simplifiedParams.$filter = `contains(subject, '${searchTerms[term].replace(/'/g, "''")}')`;
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
          response._searchInfo = {
            attemptsCount: searchAttempts.length,
            strategies: searchAttempts,
            originalTerms: searchTerms,
            filterTerms: filterTerms,
          };
          return response;
        }

        // Client-side fallback for 'to' filter — toRecipients/any() lambda
        // returns 0 results on personal accounts even when emails exist
        if (term === 'to') {
          console.error(
            'to filter returned 0 results, trying client-side filtering'
          );
          searchAttempts.push('client-side-to');
          const messages = await fetchForClientSideFilter(
            accessToken,
            endpoint,
            maxCount
          );
          const matched = filterToClientSide(messages, searchTerms[term]);
          if (matched.length > 0) {
            console.error(
              `Client-side to filter matched ${matched.length} of ${messages.length} messages`
            );
            return { value: matched.slice(0, maxCount) };
          }
        }

        // Client-side fallback for 'query' — search bodyPreview, subject, from
        if (term === 'query') {
          console.error(
            'query contains(subject) returned 0 results, trying client-side body search'
          );
          searchAttempts.push('client-side-query');
          const messages = await fetchForClientSideFilter(
            accessToken,
            endpoint,
            maxCount
          );
          const matched = filterQueryClientSide(messages, searchTerms[term]);
          if (matched.length > 0) {
            console.error(
              `Client-side query matched ${matched.length} of ${messages.length} messages`
            );
            return { value: matched.slice(0, maxCount) };
          }
        }
      } catch (error) {
        console.error(`Search with ${term} failed: ${error.message}`);

        // Client-side fallback for 'to' when API throws (e.g. InefficientFilter)
        if (term === 'to') {
          try {
            console.error(
              'to filter threw error, trying client-side filtering'
            );
            searchAttempts.push('client-side-to');
            const messages = await fetchForClientSideFilter(
              accessToken,
              endpoint,
              maxCount
            );
            const matched = filterToClientSide(messages, searchTerms[term]);
            if (matched.length > 0) {
              console.error(
                `Client-side to filter matched ${matched.length} of ${messages.length} messages`
              );
              return { value: matched.slice(0, maxCount) };
            }
          } catch (fallbackError) {
            console.error(
              `Client-side to fallback also failed: ${fallbackError.message}`
            );
          }
        }

        // Client-side fallback for 'query' when API throws
        if (term === 'query') {
          try {
            console.error(
              'query filter threw error, trying client-side body search'
            );
            searchAttempts.push('client-side-query');
            const messages = await fetchForClientSideFilter(
              accessToken,
              endpoint,
              maxCount
            );
            const matched = filterQueryClientSide(messages, searchTerms[term]);
            if (matched.length > 0) {
              console.error(
                `Client-side query matched ${matched.length} of ${messages.length} messages`
              );
              return { value: matched.slice(0, maxCount) };
            }
          } catch (fallbackError) {
            console.error(
              `Client-side query fallback also failed: ${fallbackError.message}`
            );
          }
        }
      }
    }
  }

  // 3. Try with only boolean filters (also date range filters)
  const hasBooleanFilters =
    filterTerms.hasAttachments === true || filterTerms.unreadOnly === true;
  const hasDateFilters =
    filterTerms.receivedAfter || filterTerms.receivedBefore;
  if (hasBooleanFilters || hasDateFilters) {
    try {
      console.error('Attempting search with only boolean/date filters');
      searchAttempts.push('boolean-filters-only');

      const filterOnlyParams = {
        $top: Math.min(50, maxCount),
        $select: selectFields,
      };

      // Add the boolean + date filters
      addBooleanFilters(filterOnlyParams, filterTerms);

      // Only add $orderby if no $filter (they can conflict on personal accounts)
      if (!filterOnlyParams.$filter) {
        filterOnlyParams.$orderby = 'receivedDateTime desc';
      }

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
      response._searchInfo = {
        attemptsCount: searchAttempts.length,
        strategies: searchAttempts,
        originalTerms: searchTerms,
        filterTerms: filterTerms,
      };
      return response;
    } catch (error) {
      console.error(`Boolean filter search failed: ${error.message}`);
      // Retry without $orderby if it was the issue
      if (error.message && error.message.includes('InefficientFilter')) {
        try {
          console.error('Retrying boolean filters without $orderby');
          const retryParams = {
            $top: Math.min(50, maxCount),
            $select: selectFields,
          };
          addBooleanFilters(retryParams, filterTerms);
          const response = await callGraphAPIPaginated(
            accessToken,
            'GET',
            endpoint,
            retryParams,
            maxCount
          );
          response._searchInfo = {
            attemptsCount: searchAttempts.length,
            strategies: searchAttempts,
            originalTerms: searchTerms,
            filterTerms: filterTerms,
          };
          return response;
        } catch (retryError) {
          console.error(
            `Boolean filter retry also failed: ${retryError.message}`
          );
        }
      }
    }
  }

  // 4. Final fallback
  // If the user specified search filters, return 0 results with guidance
  // instead of silently returning unfiltered recent emails.
  const hasAnyFilters =
    searchTerms.query ||
    searchTerms.from ||
    searchTerms.to ||
    searchTerms.subject ||
    searchTerms.kqlQuery;

  if (hasAnyFilters) {
    console.error(
      'All search strategies exhausted with filters active — returning 0 results'
    );
    searchAttempts.push('no-results');
    return {
      value: [],
      _searchInfo: {
        attemptsCount: searchAttempts.length,
        strategies: searchAttempts,
        originalTerms: searchTerms,
        filterTerms: filterTerms,
        noResults: true,
      },
    };
  }

  // No search filters specified — return recent emails (list mode)
  console.error('No search filters specified, returning recent emails');
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
  console.error(`Recent emails: found ${response.value?.length || 0} results`);

  response._searchInfo = {
    attemptsCount: searchAttempts.length,
    strategies: searchAttempts,
    originalTerms: searchTerms,
    filterTerms: filterTerms,
  };

  return response;
}

/**
 * Detect if a value is a domain-only filter (e.g. "@souliv.com.au" or "souliv.com.au")
 * vs a full email address (e.g. "user@souliv.com.au") vs a display name (e.g. "Billie")
 * @param {string} val - The from/to filter value
 * @returns {'domain'|'email'|'name'} - The type of filter
 */
function classifyEmailFilter(val) {
  if (val.startsWith('@')) return 'domain';
  // Has dots but no @ — likely a domain like "souliv.com.au"
  if (!val.includes('@') && val.includes('.')) return 'domain';
  if (val.includes('@')) return 'email';
  return 'name';
}

/**
 * Build a $filter condition for a from field value
 * @param {string} val - The from filter value
 * @returns {string} - OData $filter condition
 */
function buildFromFilter(val) {
  const type = classifyEmailFilter(val);
  if (type === 'domain') {
    // Use contains() — endswith() not supported on personal accounts
    const domain = val.startsWith('@') ? val : `@${val}`;
    return `contains(from/emailAddress/address, '${domain.substring(1)}')`;
  } else if (type === 'email') {
    return `from/emailAddress/address eq '${val}'`;
  }
  return `contains(from/emailAddress/name, '${val}')`;
}

/**
 * Build a $filter condition for a to field value
 * @param {string} val - The to filter value
 * @returns {string} - OData $filter condition
 */
function buildToFilter(val) {
  const type = classifyEmailFilter(val);
  if (type === 'domain') {
    const domain = val.startsWith('@') ? val : `@${val}`;
    // Use contains() — endswith() not supported on personal accounts
    return `toRecipients/any(r: contains(r/emailAddress/address, '${domain.substring(1)}'))`;
  } else if (type === 'email') {
    return `toRecipients/any(r: r/emailAddress/address eq '${val}')`;
  }
  return `toRecipients/any(r: contains(r/emailAddress/name, '${val}'))`;
}

/**
 * Client-side filter for toRecipients — used when the OData toRecipients/any()
 * lambda expression fails on personal accounts (InefficientFilter).
 * Mirrors the pattern from conversations.js lines 138-147.
 * @param {Array} messages - Array of message objects with toRecipients
 * @param {string} toValue - The to filter value (email, domain, or name)
 * @returns {Array} - Filtered messages where at least one recipient matches
 */
function filterToClientSide(messages, toValue) {
  const toLower = toValue.toLowerCase();
  return messages.filter((m) =>
    (m.toRecipients || []).some((r) => {
      const addr = (r.emailAddress?.address || '').toLowerCase();
      const name = (r.emailAddress?.name || '').toLowerCase();
      return addr.includes(toLower) || name.includes(toLower);
    })
  );
}

/**
 * Client-side filter for free-text query — used when $search and
 * contains(subject) both fail on personal accounts.
 * Searches subject, bodyPreview, from address, and from name.
 * @param {Array} messages - Array of message objects
 * @param {string} queryText - The query text to search for
 * @returns {Array} - Filtered messages matching the query
 */
function filterQueryClientSide(messages, queryText) {
  const queryLower = queryText.toLowerCase();
  return messages.filter((m) => {
    const subject = (m.subject || '').toLowerCase();
    const body = (m.bodyPreview || '').toLowerCase();
    const fromAddr = (m.from?.emailAddress?.address || '').toLowerCase();
    const fromName = (m.from?.emailAddress?.name || '').toLowerCase();
    return (
      subject.includes(queryLower) ||
      body.includes(queryLower) ||
      fromAddr.includes(queryLower) ||
      fromName.includes(queryLower)
    );
  });
}

/**
 * Fetch recent messages for client-side filtering fallback.
 * Uses the 'search' field preset which includes toRecipients and bodyPreview.
 * @param {string} accessToken - Access token
 * @param {string} endpoint - API endpoint
 * @param {number} maxCount - Maximum results to fetch
 * @returns {Promise<Array>} - Array of message objects
 */
async function fetchForClientSideFilter(accessToken, endpoint, maxCount) {
  const searchFields = getEmailFields('search');
  const params = {
    $top: Math.min(200, maxCount * 5),
    $select: searchFields,
    $orderby: 'receivedDateTime desc',
  };
  const response = await callGraphAPIPaginated(
    accessToken,
    'GET',
    endpoint,
    params,
    Math.min(200, maxCount * 5)
  );
  return response.value || [];
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
    filterConditions.push(buildFromFilter(searchTerms.from));
  }

  if (searchTerms.to) {
    usesEmailFilter = true;
    filterConditions.push(buildToFilter(searchTerms.to));
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
  // Build metadata
  const meta = {
    returned: (response.value || []).length,
    totalAvailable: response['@odata.count'] || null,
    hasMore: Boolean(response['@odata.nextLink']),
    verbosity: verbosity,
  };

  // Add searchMetadata to _meta when available (for programmatic fallback detection)
  if (response._searchInfo) {
    const finalStrategy =
      response._searchInfo.strategies[
        response._searchInfo.strategies.length - 1
      ];
    meta.searchMetadata = {
      strategiesAttempted: response._searchInfo.strategies,
      finalStrategy: finalStrategy,
      filterApplied: !response._searchInfo.noResults,
      originalFilters: response._searchInfo.originalTerms,
    };
  }

  // Handle 0 results
  if (!response.value || response.value.length === 0) {
    // Actionable guidance when filters were specified but matched nothing
    if (response._searchInfo?.noResults) {
      const filters = response._searchInfo.originalTerms || {};
      const activeFilters = Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k]) => k);
      const filterDesc =
        activeFilters.length > 0
          ? ` (filters: ${activeFilters.join(', ')})`
          : '';

      const text =
        `No emails found matching your filters in "${folder}"${filterDesc}.\n\n` +
        '**Suggestions:**\n' +
        '- Try `searchAllFolders: true` to search across all folders including Archive\n' +
        '- Specify the correct folder if emails have been moved (use `folders` tool to list folders)\n' +
        '- Use `from` filter instead of `to` (more reliable on personal accounts)\n' +
        '- Use `kqlQuery` with `searchAllFolders: true` for cross-folder search';

      return {
        content: [{ type: 'text', text }],
        _meta: meta,
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: 'No emails found matching your search criteria.',
        },
      ],
      _meta: meta,
    };
  }

  // Add search strategy note for transparency
  let searchNote = '';
  if (response._searchInfo) {
    const strategy = meta.searchMetadata.finalStrategy;
    if (strategy === 'recent-emails') {
      searchNote =
        '\n\n**Note**: No search filters were applied — showing recent emails.';
    } else if (strategy.startsWith('client-side-')) {
      searchNote = `\n\n_Search strategy: ${strategy} (filtered locally due to personal account API limitations)_`;
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
  buildFromFilter,
  buildToFilter,
  classifyEmailFilter,
  filterToClientSide,
  filterQueryClientSide,
};
