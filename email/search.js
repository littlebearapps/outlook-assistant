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
const { escapeODataString } = require('../utils/odata-helpers');

// Upper bound on how many recent messages the client-side fallback scans
// before giving up. Deliberately DECOUPLED from the requested result count so
// that broadening the scope (searchAllFolders → me/messages) doesn't shrink
// coverage — a maxCount*5 window spread across every folder used to drop inbox
// matches that an inbox-only window retained. Surfaced as `truncated` in
// searchMetadata when the budget is exhausted. Override with
// OUTLOOK_SEARCH_SCAN_LIMIT. (#169 V37-F-2)
const _parsedScanLimit = Number.parseInt(
  process.env.OUTLOOK_SEARCH_SCAN_LIMIT || '',
  10
);
const CLIENT_SCAN_LIMIT =
  Number.isSafeInteger(_parsedScanLimit) && _parsedScanLimit > 0
    ? Math.min(_parsedScanLimit, 5000)
    : 500;

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

  // F-17: accept `maxResults` as an alias for `count` in non-delta mode.
  // The schema declares both, but `maxResults` was only consumed by
  // the delta path, so callers passing `maxResults=5` to a normal
  // search saw their override silently ignored.
  const requestedCount =
    args.count ?? args.maxResults ?? DEFAULT_LIMITS.searchEmails;
  const verbosity = args.outputVerbosity || VERBOSITY.STANDARD;
  const query = (args.query || '').trim();
  const from = args.from || '';
  const to = args.to || '';
  const subject = args.subject || '';
  const hasAttachments = args.hasAttachments;
  const unreadOnly = args.unreadOnly;
  const receivedAfter = args.receivedAfter || '';
  const receivedBefore = args.receivedBefore || '';
  const searchAllFolders = args.searchAllFolders || false;
  // `searchExpression` is the accurate name — it's a Microsoft Graph $search
  // expression, not full KQL. `kqlQuery` is retained as a deprecated alias.
  // Trim so a whitespace-only value doesn't send `$search: '""'`. (#169)
  const kqlQuery =
    (args.searchExpression || '').trim() || (args.kqlQuery || '').trim();

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

    // Label the scope accurately — a cross-folder search is not "inbox". (#169)
    const scopeLabel = searchAllFolders ? 'all folders' : folder;
    return formatSearchResults(
      response,
      scopeLabel,
      verbosity,
      searchAllFolders
    );
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

/** Field prefixes a `searchExpression` can be translated into OData filters. */
const TRANSLATABLE_KQL_FIELDS = new Set(['from', 'to', 'subject']);

/**
 * Parse a `searchExpression` that consists purely of recognised field-scoped
 * terms, e.g. `from:info@example.com` or `subject:"Quarterly Report"`. (#217)
 *
 * Unscoped `$search` works fine on personal Outlook.com accounts; only the
 * field-scoped forms come back empty. Those same messages are reachable
 * through the OData filters the ladder already builds, so a recognised
 * expression can be translated and retried rather than reported as absent.
 *
 * This parser is deliberately strict, and returns null for anything it does
 * not fully understand — free text, `AND`/`OR`/`NOT`, parentheses, unknown
 * prefixes, a repeated field, or free text mixed in with a scoped term. That
 * keeps the terminal no-fallthrough behaviour for every expression whose
 * meaning we cannot reproduce exactly, which is what #169 V37-F-1 shipped to
 * guarantee. Translating a half-understood expression would reintroduce it.
 *
 * @param {string} expression - The trimmed raw search expression
 * @returns {object|null} - Search terms to retry with, or null if not translatable
 */
function parseFieldScopedExpression(expression) {
  const trimmed = (expression || '').trim();
  if (!trimmed) return null;

  const terms = {};
  let i = 0;

  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) i++;
    if (i >= trimmed.length) break;

    // Every token must be `field:value`. A token without a colon is free
    // text; a colon further along belongs to a later token, and the slice
    // then carries whitespace or an operator, which fails the field check.
    const colon = trimmed.indexOf(':', i);
    if (colon === -1) return null;

    const field = trimmed.slice(i, colon).toLowerCase();
    if (!TRANSLATABLE_KQL_FIELDS.has(field)) return null;
    if (terms[field]) return null; // repeated field — ambiguous, don't guess
    i = colon + 1;

    let value;
    if (trimmed[i] === '"') {
      const end = trimmed.indexOf('"', i + 1);
      if (end === -1) return null; // unbalanced quote
      value = trimmed.slice(i + 1, end);
      i = end + 1;
      // A quoted value must be followed by whitespace or end-of-string.
      if (i < trimmed.length && !/\s/.test(trimmed[i])) return null;
    } else {
      let end = i;
      while (end < trimmed.length && !/\s/.test(trimmed[end])) end++;
      value = trimmed.slice(i, end);
      i = end;
    }

    if (!value) return null;
    terms[field] = value;
  }

  return Object.keys(terms).length > 0 ? terms : null;
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
  // Populated by the client-side fallback with its scan coverage so the final
  // no-results response can still disclose whether the scan was bounded. (#169)
  const scanState = {};

  // 0. If raw KQL query provided, use it directly. The kqlQuery branch
  //    *terminates* — if Graph returns 0 (or throws), we surface that
  //    explicitly rather than falling through to combined-search, which
  //    would drop the user's filter and return unrelated recent emails
  //    with a misleading "combined-search" strategy line. (#169)
  if (searchTerms.kqlQuery) {
    try {
      // Pass the user's KQL through as-is. The user is responsible for
      // their own phrase quoting (e.g. `subject:"foo bar"`); we do NOT
      // auto-wrap, which previously produced broken nested quotes like
      // `"subject:"foo bar""` on Graph $search and silently returned
      // recent unfiltered messages. (#169 V37-F-1)
      const trimmedKql = searchTerms.kqlQuery.trim();
      const alreadyQuoted =
        trimmedKql.startsWith('"') && trimmedKql.endsWith('"');
      const looksLikeExpression =
        trimmedKql.includes(':') || /\s/.test(trimmedKql);
      // Already-quoted phrases and KQL-looking expressions (field syntax
      // or multi-word) are passed through as-is; only bare single tokens
      // are wrapped so Graph treats them as phrase searches.
      let kqlForSearch;
      if (alreadyQuoted || looksLikeExpression) {
        kqlForSearch = trimmedKql;
      } else {
        kqlForSearch = `"${trimmedKql}"`;
      }

      console.error(`Attempting raw KQL search: ${kqlForSearch}`);
      searchAttempts.push('raw-kql');

      const kqlParams = {
        $top: Math.min(50, maxCount),
        $select: selectFields,
        $search: kqlForSearch,
      };

      const response = await callGraphAPIPaginated(
        accessToken,
        'GET',
        endpoint,
        kqlParams,
        maxCount
      );
      console.error(
        `Raw KQL search complete: ${response.value?.length || 0} results`
      );
      const matched = response.value?.length || 0;
      response._searchInfo = {
        attemptsCount: searchAttempts.length,
        strategies: searchAttempts,
        originalTerms: searchTerms,
        filterTerms: filterTerms,
        kqlApplied: kqlForSearch,
        appliedTerms: ['kqlQuery'],
        // noResults flips on the helpful "Suggestions" block in the
        // formatter — without it, an empty kqlQuery result would render
        // the bare "No emails found matching your search criteria" line
        // with no guidance.
        noResults: matched === 0,
      };
      // A field-scoped expression that Graph answered with 0 is the #217
      // case: unscoped $search works on personal accounts, but `from:`,
      // `to:` and `subject:` forms come back empty even though the OData
      // filters reach the very same messages. Translate and retry down the
      // normal ladder, which also picks up the client-side `to` fallback.
      //
      // Anything the parser does not fully understand returns null and keeps
      // the terminal behaviour below — translating a half-understood
      // expression would reintroduce #169 V37-F-1.
      const translated =
        matched === 0 ? parseFieldScopedExpression(trimmedKql) : null;
      if (translated) {
        console.error(
          `Raw KQL returned 0; retrying as OData filters: ${JSON.stringify(translated)}`
        );
        searchAttempts.push('raw-kql-translated');
        const retry = await progressiveSearch(
          endpoint,
          accessToken,
          translated,
          filterTerms,
          maxCount,
          selectFields
        );
        const retryCount = retry.value?.length || 0;
        const strategies = [
          ...searchAttempts.filter((a) => a !== 'raw-kql-translated'),
          ...(retry._searchInfo?.strategies || []),
          // Last, so finalStrategy names the translation rather than whichever
          // rung of the ladder happened to answer it.
          'raw-kql-translated',
        ];
        retry._searchInfo = {
          ...retry._searchInfo,
          attemptsCount: strategies.length,
          strategies,
          // Report what the caller actually asked for, not the rewrite.
          originalTerms: searchTerms,
          filterTerms: filterTerms,
          kqlApplied: kqlForSearch,
          kqlTranslatedTo: translated,
          appliedTerms: ['kqlQuery'],
          noResults: retryCount === 0,
        };
        return retry;
      }

      // Otherwise always return — never silently fall through to a path that
      // would ignore kqlQuery and return unrelated emails.
      return response;
    } catch (error) {
      console.error(`Raw KQL search failed: ${error.message}`);
      // Surface the failure rather than masking it with unrelated results.
      searchAttempts.push('raw-kql-error');
      return {
        value: [],
        _searchInfo: {
          attemptsCount: searchAttempts.length,
          strategies: searchAttempts,
          originalTerms: searchTerms,
          filterTerms: filterTerms,
          kqlError: error.message,
          appliedTerms: ['kqlQuery'],
          noResults: true,
        },
      };
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
          // The combined $filter carried every supplied term. (#229)
          appliedTerms: SEARCH_TERM_KEYS.filter((t) => searchTerms[t]),
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
    if (!searchTerms[term]) {
      continue;
    }

    // 2a. Server-side single-term attempt (isolated try/catch — a failure
    // here just falls through to the one client-side fallback below).
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
        simplifiedParams.$filter = `contains(subject, '${escapeODataString(
          searchTerms[term]
        )}')`;
      } else if (term === 'query') {
        // On personal accounts, $search fails with 503. Use $filter with
        // contains(subject) as a best-effort fallback for free-text queries.
        // Split multi-word queries and AND a contains(subject) per word so a
        // query like "github token" matches a subject where the words are
        // non-contiguous ("[GitHub] ... personal access token"); single
        // words behave exactly as before. (#169)
        const queryWords = searchTerms[term]
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        simplifiedParams.$filter = queryWords
          .map((w) => `contains(subject, '${escapeODataString(w)}')`)
          .join(' and ');
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
        // This $filter carried only `term`. Apply every other supplied search
        // term locally before returning — otherwise we hand back the
        // single-term superset while claiming the filter was applied. (#229)
        const { matched, secondaryApplied } = applySecondarySearchTerms(
          response.value,
          searchTerms,
          term
        );
        if (matched.length > 0) {
          const narrowing =
            secondaryApplied.length > 0
              ? ` after local ${secondaryApplied.join(', ')} narrowing of ${response.value.length}`
              : '';
          console.error(
            `Search with ${term} successful: found ${matched.length} results${narrowing}`
          );
          response.value = matched;
          response._searchInfo = {
            attemptsCount: searchAttempts.length,
            strategies: searchAttempts,
            originalTerms: searchTerms,
            filterTerms: filterTerms,
            appliedTerms: [term, ...secondaryApplied],
            ...(secondaryApplied.length > 0 && {
              clientSideTerms: secondaryApplied,
            }),
          };
          return response;
        }
        console.error(
          `Search with ${term} found ${response.value.length} results, but none also satisfied ${secondaryApplied.join(', ')} — continuing`
        );
      }
    } catch (error) {
      console.error(`Search with ${term} failed: ${error.message}`);
      // Fall through to the client-side fallback below.
    }

    // 2b. Client-side fallback — runs EXACTLY ONCE per term whether the
    // server-side attempt returned zero results OR threw. Only 'to' and
    // 'query' have a local matcher. Keeping this outside the server-side
    // try/catch prevents the double-scan/double-label a throw inside a
    // success-path fallback would otherwise cause. (#169)
    if (term === 'to' || term === 'query') {
      console.error(
        `${term} unsatisfied server-side, trying client-side filtering`
      );
      searchAttempts.push(`client-side-${term}`);
      try {
        const fallback = await runClientSideFallback(
          accessToken,
          endpoint,
          maxCount,
          searchAttempts,
          searchTerms,
          filterTerms,
          term,
          scanState
        );
        if (fallback) return fallback;
      } catch (fallbackError) {
        console.error(
          `Client-side ${term} fallback also failed: ${fallbackError.message}`
        );
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
      // This step applied only the boolean/date filters. Narrow by the
      // caller's search terms rather than returning "every unread email" as
      // though it were "every unread email from X". (#229)
      const { matched, secondaryApplied } = applySecondarySearchTerms(
        response.value || [],
        searchTerms,
        null
      );
      if (matched.length > 0 || secondaryApplied.length === 0) {
        response.value = matched;
        response._searchInfo = {
          attemptsCount: searchAttempts.length,
          strategies: searchAttempts,
          originalTerms: searchTerms,
          filterTerms: filterTerms,
          appliedTerms: secondaryApplied,
          ...(secondaryApplied.length > 0 && {
            clientSideTerms: secondaryApplied,
          }),
        };
        return response;
      }
      console.error(
        `Boolean filter search found ${response.value.length} results, but none satisfied ${secondaryApplied.join(', ')} — continuing`
      );
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
          const { matched, secondaryApplied } = applySecondarySearchTerms(
            response.value || [],
            searchTerms,
            null
          );
          response.value = matched;
          response._searchInfo = {
            attemptsCount: searchAttempts.length,
            strategies: searchAttempts,
            originalTerms: searchTerms,
            filterTerms: filterTerms,
            appliedTerms: secondaryApplied,
            ...(secondaryApplied.length > 0 && {
              clientSideTerms: secondaryApplied,
            }),
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
        // Disclose scan coverage if a client-side fallback ran but matched
        // nothing — otherwise a bounded scan reads as a definitive "none". (#169)
        ...(scanState.candidatesScanned !== undefined && {
          candidatesScanned: scanState.candidatesScanned,
          scanLimit: scanState.scanLimit,
          truncated: scanState.truncated,
        }),
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
    return `contains(from/emailAddress/address, '${escapeODataString(
      domain.substring(1)
    )}')`;
  } else if (type === 'email') {
    return `from/emailAddress/address eq '${escapeODataString(val)}'`;
  }
  return `contains(from/emailAddress/name, '${escapeODataString(val)}')`;
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
    return `toRecipients/any(r: contains(r/emailAddress/address, '${escapeODataString(
      domain.substring(1)
    )}'))`;
  } else if (type === 'email') {
    return `toRecipients/any(r: r/emailAddress/address eq '${escapeODataString(
      val
    )}')`;
  }
  return `toRecipients/any(r: contains(r/emailAddress/name, '${escapeODataString(
    val
  )}'))`;
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
  // F-12: split multi-word queries on whitespace and require ALL words
  // to be present (AND search). Previous behaviour was substring match
  // on the literal phrase, which missed the common case where the
  // user types e.g. "github token" expecting it to find a subject
  // like "[GitHub] Your fine-grained personal access token".
  const queryLower = queryText.toLowerCase().trim();
  if (!queryLower) return messages;
  const words = queryLower.split(/\s+/).filter(Boolean);

  return messages.filter((m) => {
    const haystack = [
      m.subject,
      m.bodyPreview,
      m.from?.emailAddress?.address,
      m.from?.emailAddress?.name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** Relabel internal keys to the caller-facing param names. (#169) */
const FILTER_LABELS = { kqlQuery: 'searchExpression' };

/** Every filter key a caller can supply, including the terminal raw-KQL one. */
const SEARCH_FILTER_KEYS = ['from', 'to', 'subject', 'query', 'kqlQuery'];

/**
 * The search terms a caller can supply, in ladder-priority order. `kqlQuery`
 * is handled by the terminal raw-KQL branch and never mixes with these.
 */
const SEARCH_TERM_KEYS = ['from', 'to', 'subject', 'query'];

/**
 * Client-side matcher for a `from` value. Mirrors filterToClientSide, matching
 * either the sender address or the display name. (#229)
 * @param {Array} messages - Messages to filter
 * @param {string} fromValue - The from filter value
 * @returns {Array} - Matching messages
 */
function filterFromClientSide(messages, fromValue) {
  const needle = fromValue.toLowerCase();
  return messages.filter((m) => {
    const addr = (m.from?.emailAddress?.address || '').toLowerCase();
    const name = (m.from?.emailAddress?.name || '').toLowerCase();
    return addr.includes(needle) || name.includes(needle);
  });
}

/**
 * Client-side matcher for a `subject` value — the local equivalent of the
 * server-side `contains(subject, '…')`. (#229)
 * @param {Array} messages - Messages to filter
 * @param {string} subjectValue - The subject filter value
 * @returns {Array} - Matching messages
 */
function filterSubjectClientSide(messages, subjectValue) {
  const needle = subjectValue.toLowerCase().trim();
  if (!needle) return messages;
  return messages.filter((m) =>
    (m.subject || '').toLowerCase().includes(needle)
  );
}

const CLIENT_SIDE_TERM_MATCHERS = {
  from: filterFromClientSide,
  to: filterToClientSide,
  subject: filterSubjectClientSide,
  query: filterQueryClientSide,
};

/**
 * Narrow a result set by every supplied search term that the winning strategy
 * did NOT apply server-side. (#229)
 *
 * Steps 2 and 3 of the ladder each satisfy at most one search term — step 2
 * returns on the first single term that yields results, and step 3 applies
 * only the boolean/date filters. Both used to return that set verbatim, so
 * `from=X` + `subject=Y` handed back every email from X while
 * `searchMetadata.filterApplied` still said `true`. For an AI caller asking
 * "find the email from X about Y", a confident superset is strictly worse
 * than returning nothing.
 *
 * Narrowing locally can only ever remove messages the caller did not ask for,
 * so it cannot introduce false positives. It can miss a match that sits beyond
 * the server-side page — the ladder simply continues to the next strategy in
 * that case, and the bounded-scan disclosure already covers the rest.
 *
 * @param {Array} messages - Messages returned by the winning strategy
 * @param {object} searchTerms - All search terms the caller supplied
 * @param {string|null} appliedTerm - The term already satisfied server-side
 * @returns {{matched: Array, secondaryApplied: string[]}}
 */
function applySecondarySearchTerms(messages, searchTerms, appliedTerm) {
  const secondary = SEARCH_TERM_KEYS.filter(
    (t) => t !== appliedTerm && searchTerms[t]
  );
  let matched = messages;
  for (const term of secondary) {
    matched = CLIENT_SIDE_TERM_MATCHERS[term](matched, searchTerms[term]);
  }
  return { matched, secondaryApplied: secondary };
}

/**
 * Fetch a window of recent messages for the client-side filtering fallback.
 * Uses the 'search' field preset (includes toRecipients and bodyPreview).
 *
 * Scan depth is bounded by `scanLimit` and decoupled from the requested result
 * count (see CLIENT_SCAN_LIMIT). Returns scan metadata so callers can surface
 * whether coverage was truncated. (#169 V37-F-2)
 *
 * @param {string} accessToken - Access token
 * @param {string} endpoint - API endpoint
 * @param {number} scanLimit - Max messages to scan
 * @returns {Promise<{messages: Array, candidatesScanned: number, truncated: boolean}>}
 */
async function fetchRecentCandidates(accessToken, endpoint, scanLimit) {
  const searchFields = getEmailFields('search');
  const params = {
    $top: Math.min(50, scanLimit),
    $select: searchFields,
    $orderby: 'receivedDateTime desc',
  };
  const response = await callGraphAPIPaginated(
    accessToken,
    'GET',
    endpoint,
    params,
    scanLimit
  );
  const messages = response.value || [];
  return {
    messages,
    candidatesScanned: messages.length,
    // Filled the scan budget → older unscanned messages may also match.
    truncated: messages.length >= scanLimit,
  };
}

/**
 * Re-apply active boolean/date filters to a client-side result set so the
 * local fallback honours the same constraints the server-side $filter path
 * enforces (hasAttachments, unreadOnly, receivedAfter/Before). The 'search'
 * field preset includes hasAttachments/isRead/receivedDateTime. (#169)
 * @param {Array} messages - Messages already matched by the term filter
 * @param {object} filterTerms - Active boolean/date filters
 * @returns {Array} - Messages that also satisfy the boolean/date filters
 */
function applyBooleanDateFilters(messages, filterTerms) {
  const after = filterTerms.receivedAfter
    ? Date.parse(filterTerms.receivedAfter)
    : null;
  const before = filterTerms.receivedBefore
    ? Date.parse(filterTerms.receivedBefore)
    : null;
  return messages.filter((m) => {
    if (filterTerms.hasAttachments === true && m.hasAttachments !== true) {
      return false;
    }
    if (filterTerms.unreadOnly === true && m.isRead !== false) {
      return false;
    }
    if (after !== null && !Number.isNaN(after)) {
      const rec = Date.parse(m.receivedDateTime);
      if (Number.isNaN(rec) || rec < after) return false;
    }
    if (before !== null && !Number.isNaN(before)) {
      const rec = Date.parse(m.receivedDateTime);
      if (Number.isNaN(rec) || rec > before) return false;
    }
    return true;
  });
}

/**
 * Run a client-side fallback scan for a 'to' or 'query' term: fetch a bounded
 * window of recent messages, filter locally, and (on a match) return a result
 * carrying full `_searchInfo` including scan metadata. Returns null when nothing
 * matches so the caller can continue its strategy ladder. (#169)
 *
 * @param {string} accessToken - Access token
 * @param {string} endpoint - API endpoint
 * @param {number} maxCount - Requested result count
 * @param {string[]} searchAttempts - Accumulated strategy labels
 * @param {object} searchTerms - Search terms
 * @param {object} filterTerms - Filter terms
 * @param {'to'|'query'} kind - Which term to filter on
 * @returns {Promise<object|null>}
 */
async function runClientSideFallback(
  accessToken,
  endpoint,
  maxCount,
  searchAttempts,
  searchTerms,
  filterTerms,
  kind,
  scanState
) {
  const { messages, candidatesScanned, truncated } =
    await fetchRecentCandidates(accessToken, endpoint, CLIENT_SCAN_LIMIT);
  // Record scan coverage even when nothing matches, so the eventual
  // no-results response can still disclose that the scan was bounded. (#169)
  if (scanState) {
    scanState.candidatesScanned = candidatesScanned;
    scanState.scanLimit = CLIENT_SCAN_LIMIT;
    scanState.truncated = truncated;
  }
  // Apply the term matcher, then RE-APPLY any active boolean/date filters —
  // the server-side path enforces these via $filter, so the local fallback
  // must too, otherwise e.g. `unreadOnly:true` would leak read mail while
  // searchMetadata still claims filterApplied. (#169)
  const termMatched =
    kind === 'to'
      ? filterToClientSide(messages, searchTerms.to)
      : filterQueryClientSide(messages, searchTerms.query);
  // The local matcher covers only `kind`; narrow by the caller's other search
  // terms too, or this path returns the same superset step 2 used to. (#229)
  const { matched: narrowed, secondaryApplied } = applySecondarySearchTerms(
    termMatched,
    searchTerms,
    kind
  );
  const matched = applyBooleanDateFilters(narrowed, filterTerms);
  if (matched.length === 0) {
    return null;
  }
  console.error(
    `Client-side ${kind} matched ${matched.length} of ${messages.length} scanned messages`
  );
  return {
    value: matched.slice(0, maxCount),
    _searchInfo: {
      attemptsCount: searchAttempts.length,
      strategies: searchAttempts,
      originalTerms: searchTerms,
      filterTerms,
      appliedTerms: [kind, ...secondaryApplied],
      ...(secondaryApplied.length > 0 && { clientSideTerms: secondaryApplied }),
      candidatesScanned,
      scanLimit: CLIENT_SCAN_LIMIT,
      truncated,
    },
  };
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
      `contains(subject, '${escapeODataString(searchTerms.subject)}')`
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
 * Build no-results guidance from what the caller actually supplied and what the
 * progressive-search ladder actually attempted, rather than printing the same
 * four lines on every empty search. (#231)
 *
 * The previous fixed list included "use `from` filter instead of `to` (more
 * reliable on personal accounts)", which has been untrue since v3.7.1 added the
 * client-side `to` fallback (#139 / PR #141). The tool was teaching its callers
 * something false about itself.
 *
 * @param {object} searchInfo - The _searchInfo block from progressiveSearch
 * @param {boolean} searchAllFolders - Whether the search already spanned all folders
 * @returns {string[]} - Ordered suggestion lines, without the leading bullet
 */
function buildNoResultsSuggestions(searchInfo, searchAllFolders) {
  const filters = searchInfo.originalTerms || {};
  const strategies = searchInfo.strategies || [];
  const suggestions = [];

  // Scope — only worth suggesting when it isn't already what we just did.
  if (searchAllFolders) {
    suggestions.push(
      'All folders were already searched, so no message in this mailbox matches these filters'
    );
  } else {
    suggestions.push(
      'Try `searchAllFolders: true` to search across all folders including Archive'
    );
    suggestions.push(
      'Specify the correct folder if emails have been moved (use the `folders` tool to list folders)'
    );
  }

  // Report the fallback the ladder actually took, instead of guessing at one.
  const clientSide = strategies.filter((s) => s.startsWith('client-side-'));
  if (clientSide.length > 0) {
    const fields = clientSide
      .map((s) => `\`${s.slice('client-side-'.length)}\``)
      .join(', ');
    let note = `${fields} was matched locally after the server-side filter came back empty`;
    if (searchInfo.candidatesScanned) {
      note += ` — ${searchInfo.candidatesScanned} recent messages examined`;
      if (searchInfo.truncated) {
        note += `, hitting the ${searchInfo.scanLimit} scan limit, so older matches were not seen (narrow with \`receivedAfter\`)`;
      }
    }
    suggestions.push(note);
  }

  if (filters.kqlQuery) {
    suggestions.push(
      'Structured filters (`from`, `to`, `subject`) reach messages that `searchExpression` cannot on personal accounts'
    );
  }

  if (filters.query) {
    suggestions.push(
      'Free-text `query` falls back to a subject match on personal accounts — try `subject` directly, or fewer words'
    );
  }

  if (filters.subject) {
    suggestions.push(
      '`subject` is a substring match — try a shorter, more distinctive fragment'
    );
  }

  const applied = ['from', 'to', 'subject', 'query', 'kqlQuery'].filter(
    (k) => filters[k]
  );
  if (applied.length > 1) {
    suggestions.push(
      `All ${applied.length} filters must match the same message — try removing one`
    );
  }

  return suggestions;
}

/**
 * Format search results into Markdown using response-formatter utilities
 * @param {object} response - The API response object
 * @param {string} folder - Folder that was searched
 * @param {string} verbosity - Output verbosity level
 * @param {boolean} [searchAllFolders] - Whether the search spanned all folders
 * @returns {object} - MCP response object
 */
function formatSearchResults(response, folder, verbosity, searchAllFolders) {
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
    // Which supplied filters actually reached the result set, and which the
    // winning strategy could not honour. `droppedFilters` is normally empty;
    // a non-empty value means the response is a superset of what was asked
    // for, and `filterApplied` must not claim otherwise. (#229)
    const suppliedTerms = SEARCH_FILTER_KEYS.filter(
      (k) => response._searchInfo.originalTerms?.[k]
    );
    const appliedTerms = response._searchInfo.appliedTerms ?? suppliedTerms;
    const droppedFilters = suppliedTerms
      .filter((k) => !appliedTerms.includes(k))
      .map((k) => FILTER_LABELS[k] || k);

    meta.searchMetadata = {
      strategiesAttempted: response._searchInfo.strategies,
      finalStrategy: finalStrategy,
      filterApplied:
        !response._searchInfo.noResults && droppedFilters.length === 0,
      droppedFilters,
      ...(response._searchInfo.clientSideTerms && {
        clientSideFilters: response._searchInfo.clientSideTerms,
      }),
      originalFilters: response._searchInfo.originalTerms,
      // Surface client-side scan coverage so callers can tell when a fallback
      // result may be incomplete (older matches beyond the scan budget). (#169)
      ...(response._searchInfo.candidatesScanned !== undefined && {
        candidatesScanned: response._searchInfo.candidatesScanned,
        scanLimit: response._searchInfo.scanLimit,
        truncated: response._searchInfo.truncated,
      }),
    };
  }

  // Handle 0 results
  if (!response.value || response.value.length === 0) {
    // Actionable guidance when filters were specified but matched nothing
    if (response._searchInfo?.noResults) {
      const filters = response._searchInfo.originalTerms || {};
      const activeFilters = Object.entries(filters)
        .filter(([, v]) => v)
        .map(([k]) => FILTER_LABELS[k] || k);
      const filterDesc =
        activeFilters.length > 0
          ? ` (filters: ${activeFilters.join(', ')})`
          : '';

      const suggestions = buildNoResultsSuggestions(
        response._searchInfo,
        searchAllFolders
      );

      const bullets = suggestions.map((line) => `- ${line}`).join('\n');
      const text = `No emails found matching your filters in "${folder}"${filterDesc}.\n\n**Suggestions:**\n${bullets}`;

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
    const escapedMessageId = escapeODataString(messageId);

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
  filterFromClientSide,
  filterSubjectClientSide,
};
