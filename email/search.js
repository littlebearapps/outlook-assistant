/**
 * Improved search emails functionality
 *
 * Token-efficient implementation with outputVerbosity support and Markdown formatting.
 */
const _config = require('../config'); // Reserved for future use
const { callGraphAPI, callGraphAPIPaginated } = require('../utils/graph-api');
const { ensureAuthenticated } = require('../auth');
const { resolveFolderPath } = require('./folder-utils');
const { buildMailboxPrefix } = require('../utils/mailbox');
const {
  formatEmailList,
  VERBOSITY,
  DEFAULT_LIMITS,
} = require('../utils/response-formatter');
const { getEmailFields } = require('../utils/field-presets');
const {
  escapeODataString,
  quoteSearchPhrase,
  isWholeQuotedSearch,
  quoteSearchExpression,
} = require('../utils/odata-helpers');
const { toolError, authRequiredError } = require('../utils/tool-error');
const { log } = require('../utils/logger');

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
    return toolError('count must be at least 1.');
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
  // Optional: scope the search to a shared/delegated mailbox rather than the
  // signed-in account. Accepts a custom/localized folder name or nested path.
  const sharedMailbox = args.sharedMailbox || args.email || null;

  // Select fields based on verbosity — but never at the cost of correctness.
  // When more than one search term is supplied, the ladder may satisfy one
  // server-side and narrow by the rest locally (#229), and those matchers read
  // `toRecipients` and `bodyPreview`, which the `list` preset omits. Without
  // this, a `from`+`to` search would drop every row at default verbosity and
  // return "No emails found" — making `outputVerbosity`, a presentation
  // parameter, decide which messages are found.
  //
  // A SINGLE term needs the richer preset too when it is `to` or `query`. The
  // date/boolean rung applies no search term server-side, so it narrows by
  // every supplied term locally — and `filterToClientSide` reads
  // `toRecipients` while `filterQueryClientSide` reads `bodyPreview`, neither
  // of which the `list` preset requests. Left lean, those matchers see
  // `undefined` on every row and drop the entire result set.
  const searchTermCount = [query, from, to, subject].filter(Boolean).length;
  const needsMatcherFields = Boolean(to) || Boolean(query);
  // A `searchExpression` needs it as well: a translated `to:` term is matched
  // locally wherever Graph rejects the recipient filter, and the lean preset
  // also left `hasAttachments` out, so its results never showed the
  // attachment marker. (#333)
  const selectFields = getEmailFields(
    verbosity === VERBOSITY.FULL ||
      searchTermCount > 1 ||
      needsMatcherFields ||
      Boolean(kqlQuery)
      ? 'search'
      : 'list'
  );

  try {
    // Get access token
    const accessToken = await ensureAuthenticated();

    // Determine endpoint - search all folders or specific folder, scoped to
    // the signed-in account or a shared mailbox.
    let endpoint;
    if (searchAllFolders) {
      endpoint = `${buildMailboxPrefix(sharedMailbox)}/messages`;
      log.debug(
        `Searching across all mail folders${sharedMailbox ? ` in ${sharedMailbox}` : ''}`
      );
    } else {
      endpoint = await resolveFolderPath(accessToken, folder, sharedMailbox);
      log.debug(`Using endpoint: ${endpoint} for folder: ${folder}`);
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
      return authRequiredError();
    }

    // General error response
    return toolError(`Error searching emails: ${error.message}`);
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
    // Wildcards and grouping mean something in KQL that an OData `eq` or
    // `contains` does not reproduce. Rather than translate them literally,
    // decline the whole expression.
    if (/[()*]/.test(value)) return null;
    terms[field] = value;
  }

  return Object.keys(terms).length > 0 ? terms : null;
}

/**
 * Retry a field-scoped `searchExpression` as OData filters, down the normal
 * ladder. Returns null when the expression is not translatable, which keeps
 * the terminal no-fallthrough behaviour #169 V37-F-1 shipped. (#217)
 *
 * @param {object} ctx - Everything the retry needs from the raw-KQL branch
 * @returns {Promise<object|null>} - A merged response, or null if untranslatable
 */
async function retryFieldScopedExpression(ctx) {
  const {
    endpoint,
    accessToken,
    trimmedKql,
    kqlForSearch,
    searchTerms,
    filterTerms,
    maxCount,
    selectFields,
    searchAttempts,
  } = ctx;

  // A caller who already quoted the whole expression gets the same retry as
  // one who didn't: translate what is inside the quotes. (#333)
  const translated = parseFieldScopedExpression(
    isWholeQuotedSearch(trimmedKql)
      ? trimmedKql.slice(1, -1).replace(/\\(.)/g, '$1')
      : trimmedKql
  );
  if (!translated) return null;

  log.debug(
    `Retrying field-scoped searchExpression as OData filters: ${JSON.stringify(translated)}`
  );
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
    ...searchAttempts,
    ...(retry._searchInfo?.strategies || []),
    // Last, so finalStrategy names the translation rather than whichever rung
    // of the ladder happened to answer it.
    'raw-kql-translated',
  ];
  retry._searchInfo = {
    ...retry._searchInfo,
    attemptsCount: strategies.length,
    strategies,
    // Report what the caller actually asked for, not the rewrite.
    originalTerms: searchTerms,
    filterTerms,
    kqlApplied: kqlForSearch,
    kqlTranslatedTo: translated,
    appliedTerms: ['kqlQuery'],
    noResults: retryCount === 0,
  };
  return retry;
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
  // Populated by the client-side fallback with its scan coverage so the final
  // no-results response can still disclose whether the scan was bounded. (#169)
  const scanState = {};
  const response = await runSearchLadder(
    endpoint,
    accessToken,
    searchTerms,
    filterTerms,
    maxCount,
    selectFields,
    scanState
  );
  // `$search` was read to its paging limit without reaching the date window,
  // and a later step answered: say so on whatever that step returned. (#261)
  if (scanState.searchWindowUnreached && response?._searchInfo) {
    response._searchInfo.searchWindowUnreached =
      scanState.searchWindowUnreached;
  }
  return response;
}

/** The ladder itself; see progressiveSearch. */
async function runSearchLadder(
  endpoint,
  accessToken,
  searchTerms,
  filterTerms,
  maxCount,
  selectFields,
  scanState
) {
  // Track search strategies attempted
  const searchAttempts = [];

  // 0. If raw KQL query provided, use it directly. The kqlQuery branch
  //    *terminates* — if Graph returns 0 (or throws), we surface that
  //    explicitly rather than falling through to combined-search, which
  //    would drop the user's filter and return unrelated recent emails
  //    with a misleading "combined-search" strategy line. (#169)
  if (searchTerms.kqlQuery) {
    // Graph reads KQL (operators, `received>=…`, mixed terms) only when the
    // whole expression is one double-quoted string. Unquoted, a multi-word
    // expression comes back as the newest mail, unfiltered, and a comparison
    // is a 400. So the expression is sent quoted: as written when it already
    // is one quoted string, otherwise wrapped with the caller's own `"` and
    // `\` escaped (`body:"a b"` becomes `"body:\"a b\""`, never the broken
    // `"body:"a b""` of #169 V37-F-1). (#333)
    //
    // The exception is an expression made only of `from:`/`to:`/`subject:`
    // terms. It keeps the v3.14.1 sequence, as written first and then the
    // OData filters, so its results (substring match, every folder searched,
    // date and boolean params applied by the filters) do not change in a
    // patch release. Which of the two should answer it waits on a Microsoft
    // 365 test matrix (#334).
    const trimmedKql = searchTerms.kqlQuery.trim();
    const kqlForSearch = parseFieldScopedExpression(trimmedKql)
      ? trimmedKql
      : quoteSearchExpression(trimmedKql);

    // Graph rejects an unquoted field scope on personal accounts ("Syntax
    // error: character ':' is not valid") and some tenants answer it with
    // nothing, so the translated retry is reachable from the catch and from
    // the empty path.
    const translationContext = {
      endpoint,
      accessToken,
      trimmedKql,
      kqlForSearch,
      searchTerms,
      filterTerms,
      maxCount,
      selectFields,
      searchAttempts,
    };

    try {
      log.debug(`Attempting raw KQL search: ${kqlForSearch}`);
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
      log.debug(
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
        // `$search` carries no `$filter`, so the date/boolean window never
        // reached Graph. Report it rather than imply it was applied. (#329)
        ignoredFilters: activeWindowFilters(filterTerms),
        // noResults flips on the helpful "Suggestions" block in the
        // formatter — without it, an empty kqlQuery result would render
        // the bare "No emails found matching your search criteria" line
        // with no guidance.
        noResults: matched === 0,
      };
      // Empty-but-successful is the other #217 shape: some tenants answer a
      // field-scoped expression with 0 rather than a 400.
      if (matched === 0) {
        // Guarded like the error path below: if the translated ladder threw,
        // an unguarded call here would land in the catch and run the whole
        // retry a second time.
        try {
          const retry = await retryFieldScopedExpression(translationContext);
          if (retry) return retry;
        } catch (retryError) {
          log.debug(`Translated retry failed: ${retryError.message}`);
        }
      }

      // Otherwise always return — never silently fall through to a path that
      // would ignore kqlQuery and return unrelated emails.
      return response;
    } catch (error) {
      log.debug(`Raw KQL search failed: ${error.message}`);
      searchAttempts.push('raw-kql-error');

      // A field-scoped expression is what Graph rejects here on personal
      // accounts. Translating and retrying beats reporting mail that plainly
      // exists as absent — the same messages come back from the equivalent
      // OData filter. Anything untranslatable still surfaces the error. (#217)
      try {
        const retry = await retryFieldScopedExpression(translationContext);
        if (retry) {
          retry._searchInfo.kqlError = error.message;
          return retry;
        }
      } catch (retryError) {
        log.debug(`Translated retry also failed: ${retryError.message}`);
      }

      // Surface the failure rather than masking it with unrelated results.
      return {
        value: [],
        _searchInfo: {
          attemptsCount: searchAttempts.length,
          strategies: searchAttempts,
          originalTerms: searchTerms,
          filterTerms: filterTerms,
          kqlError: error.message,
          appliedTerms: ['kqlQuery'],
          ignoredFilters: activeWindowFilters(filterTerms),
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
    log.debug('Only boolean filters provided, skipping combined search');
  } else {
    // `query` with `from`/`to`/`subject`: Graph takes `$search` only on its
    // own, so the structured terms go out as the `$filter` (the narrower set)
    // and `query` is matched locally, rather than narrowing a `$search` page
    // of mostly other senders. (#261 follow-up)
    const structuredQuery =
      Boolean(searchTerms.query) &&
      Boolean(searchTerms.from || searchTerms.to || searchTerms.subject);
    // Narrowing reads full pages, so a window costs few requests.
    const narrows =
      structuredQuery ||
      (Boolean(searchTerms.query) &&
        activeWindowFilters(filterTerms).length > 0);
    const pageSize = narrows ? NARROW_PAGE_SIZE : Math.min(50, maxCount);
    try {
      const params = buildSearchParams(
        structuredQuery ? { ...searchTerms, query: undefined } : searchTerms,
        filterTerms,
        pageSize,
        selectFields
      );
      log.debug('Attempting combined search with params:', params);
      searchAttempts.push('combined-search');

      const response = await callGraphAPIPaginated(
        accessToken,
        'GET',
        endpoint,
        params,
        narrows ? pageSize : maxCount
      );
      const narrowCtx = {
        accessToken,
        pageSize,
        maxCount,
        searchTerms,
        filterTerms,
        searchAttempts,
        scanState,
      };
      if (params.$search) {
        const fromSearch = await narrowSearchPage(response, narrowCtx);
        if (fromSearch) return fromSearch;
      } else if (structuredQuery) {
        const fromFilter = await narrowStructuredPage(response, narrowCtx);
        if (fromFilter) return fromFilter;
      } else if (response.value && response.value.length > 0) {
        log.debug(
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
      log.debug(`Combined search failed: ${error.message}`);
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
      log.debug(`Attempting search with only ${term}: "${searchTerms[term]}"`);
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

      // Sorted, with `receivedDateTime` leading, so the newest matches come
      // back: unsorted, Graph returns the oldest first. The recipient lambda
      // stays unsorted (unverified where Graph accepts it). If Graph refuses
      // the sort, the unsorted request this step always sent is retried, and
      // its page is put in date order locally. (#331)
      const termClause = simplifiedParams.$filter;
      addBooleanFilters(simplifiedParams, filterTerms);
      const sortedParams =
        term === 'to'
          ? null
          : {
              ...simplifiedParams,
              $filter: [
                buildSearchParams({}, filterTerms, 1, selectFields).$filter ||
                  receivedFirstClauses()[0],
                termClause,
              ].join(' and '),
              $orderby: 'receivedDateTime desc',
            };

      const response = await fetchSortedOrUnsorted(
        accessToken,
        endpoint,
        sortedParams,
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
          log.debug(
            `Search with ${term} successful: found ${matched.length} results${narrowing}`
          );
          narrowResponse(response, matched);
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
        recordNarrowingMiss(scanState, response.value.length);
        log.debug(
          `Search with ${term} found ${response.value.length} results, but none also satisfied ${secondaryApplied.join(', ')} — continuing`
        );
      }
    } catch (error) {
      log.debug(`Search with ${term} failed: ${error.message}`);
      // Fall through to the client-side fallback below.
    }

    // 2b. Client-side fallback — runs EXACTLY ONCE per term whether the
    // server-side attempt returned zero results OR threw. Only 'to' and
    // 'query' have a local matcher. Keeping this outside the server-side
    // try/catch prevents the double-scan/double-label a throw inside a
    // success-path fallback would otherwise cause. (#169)
    if (term === 'to' || term === 'query') {
      log.debug(
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
        log.debug(
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
      log.debug('Attempting search with only boolean/date filters');
      searchAttempts.push('boolean-filters-only');

      const filterOnlyParams = {
        $top: Math.min(50, maxCount),
        $select: selectFields,
      };

      // Sorted, with `receivedDateTime` leading the filter as Graph requires.
      // Unsorted, Graph returned the oldest matches first, so a search with
      // more matches than `count` showed the oldest ones. If Graph refuses the
      // sort, the catch below retries the old unsorted shape. (#331)
      filterOnlyParams.$filter = buildSearchParams(
        {},
        filterTerms,
        filterOnlyParams.$top,
        selectFields
      ).$filter;
      filterOnlyParams.$orderby = 'receivedDateTime desc';

      const response = await callGraphAPIPaginated(
        accessToken,
        'GET',
        endpoint,
        filterOnlyParams,
        maxCount
      );
      log.debug(
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
        narrowResponse(response, matched);
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
      recordNarrowingMiss(scanState, response.value.length);
      log.debug(
        `Boolean filter search found ${response.value.length} results, but none satisfied ${secondaryApplied.join(', ')} — continuing`
      );
    } catch (error) {
      log.debug(`Boolean filter search failed: ${error.message}`);
      // Retry without $orderby if it was the issue
      if (error.message && error.message.includes('InefficientFilter')) {
        try {
          log.debug('Retrying boolean filters without $orderby');
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
          // Same guard as the primary boolean path above: an empty set here
          // means the search terms went unsatisfied, so fall through to the
          // no-results rung rather than returning 0 with filterApplied true
          // and no guidance.
          if (matched.length > 0 || secondaryApplied.length === 0) {
            narrowResponse(response, matched);
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
          recordNarrowingMiss(scanState, response.value.length);
          log.debug(
            `Boolean filter retry found ${response.value.length} results, but none satisfied ${secondaryApplied.join(', ')} — continuing`
          );
        } catch (retryError) {
          log.debug(`Boolean filter retry also failed: ${retryError.message}`);
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
    log.debug(
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
        // A local narrowing pass that matched nothing looked only at the page
        // the winning filter returned, so say how much that was. (#229)
        ...(scanState.narrowedCandidates !== undefined && {
          narrowedCandidates: scanState.narrowedCandidates,
        }),
      },
    };
  }

  // No search filters specified — return recent emails (list mode)
  log.debug('No search filters specified, returning recent emails');
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
  log.debug(`Recent emails: found ${response.value?.length || 0} results`);

  response._searchInfo = {
    attemptsCount: searchAttempts.length,
    strategies: searchAttempts,
    originalTerms: searchTerms,
    filterTerms: filterTerms,
  };

  return response;
}

/**
 * Run `sorted` (a date-first `$filter` with `$orderby`); if Graph refuses the
 * sort, run `unsorted` and order that page newest first locally.
 * @param {object|null} sorted - Sorted params, or null to go straight to unsorted
 */
async function fetchSortedOrUnsorted(
  accessToken,
  endpoint,
  sorted,
  unsorted,
  maxCount
) {
  if (sorted) {
    try {
      return await callGraphAPIPaginated(
        accessToken,
        'GET',
        endpoint,
        sorted,
        maxCount
      );
    } catch (error) {
      if (!String(error.message).includes('InefficientFilter')) throw error;
      log.debug('Sorted filter refused, retrying unsorted');
    }
  }
  const response = await callGraphAPIPaginated(
    accessToken,
    'GET',
    endpoint,
    unsorted,
    maxCount
  );
  if (sorted && Array.isArray(response?.value)) {
    const time = (m) => Date.parse(m.receivedDateTime) || 0;
    response.value = [...response.value].sort((a, b) => time(b) - time(a));
  }
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
  // No `@` and no `.`: a display name, or a bare domain label such as
  // `examplecorp`. Match either field; a label never appears in the display
  // name, so a name-only match missed that sender's mail entirely. The `or`
  // is parenthesised because callers AND this onto other conditions. (#328)
  const escaped = escapeODataString(val);
  return `(contains(from/emailAddress/name, '${escaped}') or contains(from/emailAddress/address, '${escaped}'))`;
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
  // No `@` and no `.`: a display name, or a bare domain label such as
  // `examplecorp`. Match either field of the same recipient, as
  // buildFromFilter does for the sender (#328) and filterToClientSide does
  // locally; the `or` sits inside the lambda, so it needs no parentheses. (#332)
  const escaped = escapeODataString(val);
  return `toRecipients/any(r: contains(r/emailAddress/name, '${escaped}') or contains(r/emailAddress/address, '${escaped}'))`;
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
  // Mirror buildFromFilter branch for branch. A plain substring test over both
  // address and name diverges from the server in both directions: it misses
  // `@example.com` against `alerts@mail.example.com` (the server strips the
  // leading @ and does contains), and it wrongly keeps `bbob@x.com` for
  // `bob@x.com` (the server uses eq).
  const type = classifyEmailFilter(fromValue);

  if (type === 'domain') {
    const domain = (
      fromValue.startsWith('@') ? fromValue.slice(1) : fromValue
    ).toLowerCase();
    return messages.filter((m) =>
      (m.from?.emailAddress?.address || '').toLowerCase().includes(domain)
    );
  }

  if (type === 'email') {
    const needle = fromValue.toLowerCase();
    return messages.filter(
      (m) => (m.from?.emailAddress?.address || '').toLowerCase() === needle
    );
  }

  const needle = fromValue.toLowerCase();
  return messages.filter(
    (m) =>
      (m.from?.emailAddress?.name || '').toLowerCase().includes(needle) ||
      (m.from?.emailAddress?.address || '').toLowerCase().includes(needle)
  );
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
 * Narrowing runs over the rows the winning strategy already fetched, so it can
 * miss a match beyond that page; the ladder continues to the next strategy when
 * it comes up empty, and `recordNarrowingMiss` records how much was examined so
 * the no-results response can disclose it rather than implying the mailbox was
 * exhausted.
 *
 * The local matchers mirror their server-side counterparts but are not
 * identical to them — `filterQueryClientSide` searches the body preview, and a
 * display-name match is a substring test either side — so a narrowed set is a
 * close approximation of the combined filter, not a formal equivalent.
 *
 * @param {Array} messages - Messages returned by the winning strategy
 * @param {object} searchTerms - All search terms the caller supplied
 * @param {string|null} appliedTerm - The term already satisfied server-side
 * @returns {{matched: Array, secondaryApplied: string[]}}
 */
/**
 * Replace a response's rows with the narrowed subset, keeping the reported
 * totals honest. `@odata.count` was set from the pre-narrowing page, so
 * leaving it makes `_meta.totalAvailable` claim matches that do not exist and
 * invites a caller to paginate for them. (#229)
 *
 * @param {object} response - The Graph response being narrowed in place
 * @param {Array} matched - The rows that survived narrowing
 */
function narrowResponse(response, matched) {
  const examined = (response.value || []).length;
  const dropped = examined !== matched.length;
  response.value = matched;
  if (dropped) {
    const more = Boolean(response.hasMore || response['@odata.nextLink']);
    delete response['@odata.count'];
    delete response['@odata.nextLink'];
    delete response.hasMore;
    // Rows beyond this page were never checked, so more matches may exist:
    // say so rather than present the survivors as the whole answer.
    // (#261 follow-up)
    if (more) {
      response.hasMore = true;
      response._partialNarrowing = { examined };
    }
  }
}

/** Page size a narrowing search requests, so a window costs few requests. */
const NARROW_PAGE_SIZE = 50;

/**
 * Most messages a narrowing search reads (five full pages) before it stops
 * and reports partial coverage. (#261 follow-up)
 */
const NARROW_SCAN_LIMIT = 250;

/**
 * Read pages from a first response, keeping the rows `narrow` accepts, until
 * `maxCount` are kept, Graph has no more, NARROW_SCAN_LIMIT rows have been
 * read, or (for newest-first `$search` results) a page ends before
 * `stopBefore`, past which nothing can match. A failed follow-up page keeps
 * what was found and reports that more may exist.
 *
 * @returns {Promise<{kept: Array, scanned: number, pages: number, more: boolean}>}
 */
async function collectNarrowed(first, narrow, ctx, stopBefore) {
  let rows = first.value || [];
  let scanned = rows.length;
  let pages = 1;
  const kept = narrow(rows);
  let nextLink = first['@odata.nextLink'];
  let more = Boolean(first.hasMore || nextLink);
  const pastWindow = (page) =>
    stopBefore !== undefined &&
    page.length > 0 &&
    (Date.parse(page[page.length - 1].receivedDateTime) || 0) < stopBefore;

  while (
    kept.length < ctx.maxCount &&
    nextLink &&
    scanned < NARROW_SCAN_LIMIT &&
    !pastWindow(rows)
  ) {
    let next;
    try {
      next = await callGraphAPIPaginated(
        ctx.accessToken,
        'GET',
        nextLink,
        {},
        ctx.pageSize
      );
    } catch (error) {
      log.debug(`Narrowing stopped on a failed page: ${error.message}`);
      break;
    }
    rows = next?.value || [];
    scanned += rows.length;
    pages += 1;
    kept.push(...narrow(rows));
    nextLink = next?.['@odata.nextLink'];
    more = Boolean(next?.hasMore || nextLink);
  }
  // `$search` is newest first: rows past the window's start can't match.
  if (pastWindow(rows)) more = false;
  return { kept, scanned, pages, more };
}

/**
 * Put the narrowed rows on the response: newest first when `sort`, cut to
 * `maxCount`, with `hasMore` and a partial-coverage marker when rows were
 * dropped and Graph had more to read. (#261 follow-up)
 */
function finishNarrowed(response, { kept, scanned, more }, maxCount, sort) {
  const time = (m) => Date.parse(m.receivedDateTime) || 0;
  const ordered = sort ? [...kept].sort((a, b) => time(b) - time(a)) : kept;
  const hasMore = more || ordered.length > maxCount;
  response.value = ordered.slice(0, maxCount);
  delete response['@odata.count'];
  delete response['@odata.nextLink'];
  delete response.hasMore;
  delete response._partialNarrowing;
  if (hasMore) {
    response.hasMore = true;
    if (scanned > kept.length) {
      response._partialNarrowing = {
        examined: scanned,
        capped: scanned >= NARROW_SCAN_LIMIT,
      };
    }
  }
}

/**
 * Note that a narrowing pass examined rows and matched none of them, so the
 * eventual no-results response can say how much was actually looked at rather
 * than implying the mailbox was exhausted. (#229)
 *
 * @param {object} scanState - Side-channel carried to the no-results rung
 * @param {number} examined - How many rows the narrowing pass saw
 */
function recordNarrowingMiss(scanState, examined) {
  if (!scanState) return;
  scanState.narrowedCandidates = Math.max(
    scanState.narrowedCandidates || 0,
    examined
  );
}

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

/** Date/boolean filters, in the order they are reported. */
const WINDOW_FILTER_KEYS = [
  'receivedAfter',
  'receivedBefore',
  'hasAttachments',
  'unreadOnly',
];

/**
 * The date/boolean filters the caller actually set. The booleans only count
 * when `true`: `false` filters nothing, so it is never applied or dropped.
 * @param {object} filterTerms - Filter terms
 * @returns {string[]} - Keys in WINDOW_FILTER_KEYS order
 */
function activeWindowFilters(filterTerms) {
  return WINDOW_FILTER_KEYS.filter((k) =>
    k === 'hasAttachments' || k === 'unreadOnly'
      ? filterTerms[k] === true
      : Boolean(filterTerms[k])
  );
}

/** `a`, `a` and `b`, `a`, `b` and `c` (backticked). */
function listParams(keys) {
  const quoted = keys.map((k) => `\`${k}\``);
  return quoted.length > 1
    ? `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
    : quoted[0];
}

/**
 * Say which filters an untranslated `searchExpression` left out. (#329)
 * @param {string[]} keys - The ignored filter keys
 * @returns {string}
 */
function ignoredFiltersNote(keys) {
  const verb = keys.length === 1 ? 'was' : 'were';
  return `${listParams(keys)} ${verb} not applied: \`searchExpression\` goes to Graph \`$search\`, which takes no date or boolean filters. To limit by date, put it in the expression, e.g. \`invoice AND received>=2026-01-01\``;
}

/**
 * Finish the combined step's `$search` request. Graph accepts `$search` only
 * on its own (#261), so the other search terms and the date/boolean window
 * are applied here, to the page it returned, and the survivors are sorted
 * newest first. Graph returns message `$search` results by sent date; the
 * local sort by received date makes that order explicit.
 *
 * A window reads further pages (collectNarrowed) rather than narrowing one
 * page and dropping the rest. (#261 follow-up)
 *
 * @returns {Promise<object|null>} - The narrowed response, or null to continue the ladder
 */
async function narrowSearchPage(response, ctx) {
  const { searchTerms, filterTerms, searchAttempts, scanState } = ctx;
  const secondaryApplied = SEARCH_TERM_KEYS.filter(
    (t) => t !== 'query' && searchTerms[t]
  );
  const narrow = (rows) =>
    applyBooleanDateFilters(
      applySecondarySearchTerms(rows, searchTerms, 'query').matched,
      filterTerms
    );
  const after = filterTerms.receivedAfter
    ? Date.parse(filterTerms.receivedAfter)
    : NaN;
  // Graph returns `$search` results newest first by sent date; a message is
  // received after it is sent, so once a page ends before `receivedAfter`,
  // later pages hold nothing in the window.
  const collected = await collectNarrowed(
    response,
    narrow,
    ctx,
    Number.isNaN(after) ? undefined : after
  );
  if (collected.kept.length === 0) {
    if (collected.scanned > 0) {
      recordNarrowingMiss(scanState, collected.scanned);
    }
    // Graph's `$search` stream is newest first and stops after a few hundred
    // rows, so a window older than what was read can't be reached by paging.
    // (Not when the read stopped because it had passed `receivedAfter`:
    // `more` is false then.)
    if (
      scanState &&
      activeWindowFilters(filterTerms).length > 0 &&
      (collected.more || collected.scanned >= NARROW_SCAN_LIMIT)
    ) {
      scanState.searchWindowUnreached = collected.scanned;
    }
    log.debug(
      `$search returned ${collected.scanned} results, none passing the other filters — continuing`
    );
    return null;
  }

  finishNarrowed(response, collected, ctx.maxCount, true);
  const localFilters = [
    ...secondaryApplied,
    ...activeWindowFilters(filterTerms),
  ];
  log.debug(
    `$search successful: ${collected.kept.length} of ${collected.scanned} kept`
  );
  response._searchInfo = {
    attemptsCount: searchAttempts.length,
    strategies: searchAttempts,
    originalTerms: searchTerms,
    filterTerms,
    appliedTerms: ['query', ...secondaryApplied],
    ...(localFilters.length > 0 && { clientSideTerms: localFilters }),
    orderedWithinPage: true,
    searchPageSize: collected.scanned,
    searchPages: collected.pages,
  };
  return response;
}

/**
 * Finish the combined step for `query` with `from`/`to`/`subject`: Graph
 * applied the structured terms and the window as `$filter`; `query` is
 * matched here against subject, preview and sender, reading further pages
 * until `count` match. (#261 follow-up)
 *
 * @returns {Promise<object|null>} - The narrowed response, or null to continue the ladder
 */
async function narrowStructuredPage(response, ctx) {
  const { searchTerms, filterTerms, searchAttempts, scanState } = ctx;
  const collected = await collectNarrowed(
    response,
    (rows) => filterQueryClientSide(rows, searchTerms.query),
    ctx
  );
  if (collected.kept.length === 0) {
    if (collected.scanned > 0) {
      recordNarrowingMiss(scanState, collected.scanned);
    }
    log.debug(
      `Combined $filter returned ${collected.scanned} results, none matching query — continuing`
    );
    return null;
  }

  finishNarrowed(response, collected, ctx.maxCount, false);
  log.debug(
    `Combined search successful: ${collected.kept.length} of ${collected.scanned} matched query`
  );
  response._searchInfo = {
    attemptsCount: searchAttempts.length,
    strategies: searchAttempts,
    originalTerms: searchTerms,
    filterTerms,
    appliedTerms: SEARCH_TERM_KEYS.filter((t) => searchTerms[t]),
    clientSideTerms: ['query'],
    queryMatchedLocally: true,
  };
  return response;
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
  log.debug(
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

/** Lower bound that is true for every message; see receivedFirstClauses. */
const EARLIEST_RECEIVED = '1900-01-01T00:00:00Z';

/**
 * The date window as `$filter` clauses, only for the bounds that were given.
 * @param {{receivedAfter?: string, receivedBefore?: string}} window
 * @returns {string[]}
 */
function receivedWindowClauses({ receivedAfter, receivedBefore } = {}) {
  const clauses = [];
  if (receivedAfter) {
    clauses.push(
      `receivedDateTime ge ${new Date(receivedAfter).toISOString()}`
    );
  }
  if (receivedBefore) {
    clauses.push(
      `receivedDateTime le ${new Date(receivedBefore).toISOString()}`
    );
  }
  return clauses;
}

/**
 * The clauses that must open a `$filter` sent with
 * `$orderby=receivedDateTime desc`. Graph allows the sort only when the sorted
 * property leads the filter (otherwise 400 InefficientFilter), so without
 * `receivedAfter` an always-true lower bound stands in. Shared by search-emails
 * (#331) and the export search (#263). An invalid date throws a RangeError.
 * @param {{receivedAfter?: string, receivedBefore?: string}} window
 * @returns {string[]} - One or two clauses, `receivedDateTime ge …` first
 */
function receivedFirstClauses(window = {}) {
  const clauses = receivedWindowClauses(window);
  return window.receivedAfter
    ? clauses
    : [`receivedDateTime ge ${EARLIEST_RECEIVED}`, ...clauses];
}

/**
 * A date the window helpers can take, or '' (logged) when it does not parse,
 * so a bad value is left out of the request as it always has been here.
 */
function validDateOrEmpty(value, label) {
  if (!value) return '';
  if (Number.isNaN(new Date(value).getTime())) {
    log.debug(`Invalid ${label} date: ${value}`);
    return '';
  }
  return value;
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

  // Free-text `query` goes out as `$search`, and alone: Graph rejects
  // `$search` with `$orderby` (400 SearchWithOrderBy) and with `$filter`
  // (400 SearchWithFilter). Sending either made this step fail on every
  // query search, so `query` never reached `$search`. The caller applies the
  // other terms and the date/boolean window to the returned page. (#261)
  if (searchTerms.query) {
    params.$search = quoteSearchPhrase(searchTerms.query);
    return params;
  }

  // Only the recipient lambda goes out without `$orderby`: personal accounts
  // reject it outright, and the sorted form is unverified where it is accepted.
  let usesRecipientFilter = false;

  // Build filter conditions array - use $filter for structured fields (more reliable)
  const filterConditions = [];

  // Use $filter for subject — $search silently fails on personal MS accounts
  if (searchTerms.subject) {
    filterConditions.push(
      `contains(subject, '${escapeODataString(searchTerms.subject)}')`
    );
  }

  // Use $filter for from/to email addresses (much more reliable than $search)
  if (searchTerms.from) {
    filterConditions.push(buildFromFilter(searchTerms.from));
  }

  if (searchTerms.to) {
    usesRecipientFilter = true;
    filterConditions.push(buildToFilter(searchTerms.to));
  }

  if (filterTerms.hasAttachments === true) {
    filterConditions.push('hasAttachments eq true');
  }

  if (filterTerms.unreadOnly === true) {
    filterConditions.push('isRead eq false');
  }

  const window = {
    receivedAfter: validDateOrEmpty(filterTerms.receivedAfter, 'receivedAfter'),
    receivedBefore: validDateOrEmpty(
      filterTerms.receivedBefore,
      'receivedBefore'
    ),
  };
  const hasWindow = Boolean(window.receivedAfter || window.receivedBefore);

  if (usesRecipientFilter) {
    // Unsorted (`to`): the window follows the field clauses, as it always has.
    if (hasWindow) {
      filterConditions.push(...receivedWindowClauses(window));
    }
  } else {
    // Sorted. Graph takes `$orderby` next to a `$filter` only when the sorted
    // property leads the filter, otherwise 400 InefficientFilter (which cost
    // every `subject` search a failed request on personal accounts). A `from`
    // filter is sorted too: unsorted, Graph returned its oldest matches. (#331)
    params.$orderby = 'receivedDateTime desc';
    if (filterConditions.length > 0 || hasWindow) {
      filterConditions.unshift(...receivedFirstClauses(window));
    }
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

  filterConditions.push(
    ...receivedWindowClauses({
      receivedAfter: validDateOrEmpty(
        filterTerms.receivedAfter,
        'receivedAfter'
      ),
      receivedBefore: validDateOrEmpty(
        filterTerms.receivedBefore,
        'receivedBefore'
      ),
    })
  );

  // AND onto any $filter the caller already built — never replace it.
  //
  // The single-term rung sets `$filter` from the search term (e.g.
  // `toRecipients/any(...)`) and then calls this to add the date/boolean
  // window. Assigning here silently dropped that term, so a `to` + date-window
  // search issued a DATE-ONLY request and returned the whole window labelled
  // `single-term-to` with `appliedTerms: ['to']` — a superset presented as a
  // filtered result. Affected `from`, `to`, `subject` and `query` alike.
  //
  // Every condition either side is a conjunct, so a flat ' and ' join is
  // sound; there is no top-level `or` that would need parenthesising.
  if (filterConditions.length > 0) {
    const added = filterConditions.join(' and ');
    params.$filter = params.$filter ? `${params.$filter} and ${added}` : added;
  }
}

/**
 * What to say when `$search` was read to its paging limit and none of it fell
 * in the date window, so a subject-only step answered (or nothing did). (#261)
 * @param {object} searchInfo - `_searchInfo` with `searchWindowUnreached` (rows read)
 * @returns {string}
 */
function searchWindowNote(searchInfo) {
  const read = searchInfo.searchWindowUnreached;
  const window = searchInfo.filterTerms || {};
  const day = (value) => new Date(value).toISOString().slice(0, 10);
  const bounds = [
    window.receivedAfter && `received>=${day(window.receivedAfter)}`,
    window.receivedBefore && `received<=${day(window.receivedBefore)}`,
    window.unreadOnly === true && 'isread:false',
    window.hasAttachments === true && 'hasattachment:true',
  ].filter(Boolean);
  const example =
    bounds.length > 0
      ? ` To search bodies there, put the condition in a \`searchExpression\`, e.g. \`<words> AND ${bounds.join(' AND ')}\`.`
      : '';
  return `Graph \`$search\` returned its ${read} newest results and none fell inside the date window or passed the other filters, so the window lies beyond what \`$search\` paging can reach. Anything listed here comes from a filter-based fallback that matches \`query\` against the subject, newest first; a message that matches only in its body is not included.${example}`;
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
  // Say nothing in the mailbox matches only when every filter was checked
  // server-side; a local pass over a bounded scan or one page is not proof
  // of absence, and the notes below say how much was examined. (#328)
  const partialCoverage = Boolean(
    searchInfo.truncated || searchInfo.narrowedCandidates
  );
  // A `searchExpression` answered by `$search` alone never reached Deleted
  // Items or Junk Email, so it is not proof of absence either. (#333)
  const answeredBySearchOnly =
    Boolean(filters.kqlQuery) && !strategies.includes('raw-kql-translated');
  if (searchAllFolders && partialCoverage) {
    suggestions.push(
      'All folders were searched, but some filters could only be checked against part of the mailbox (see below), so a match may still exist'
    );
  } else if (searchAllFolders && answeredBySearchOnly) {
    suggestions.push(
      'Graph `$search` across all folders leaves out Deleted Items and Junk Email, so a match may still exist there (name the folder to search inside one)'
    );
  } else if (searchAllFolders) {
    suggestions.push(
      'All folders were already searched, so no message in this mailbox matches these filters'
    );
  } else {
    suggestions.push(
      'Try `searchAllFolders: true` to search across all folders, including Archive and Junk Email (mail from a new sender often lands in Junk)'
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

  // A narrowing pass that matched nothing saw only the page the winning
  // server-side filter returned — a much weaker basis for "none exists" than
  // the bounded client-side scan, so say so rather than implying otherwise.
  if (searchInfo.narrowedCandidates) {
    suggestions.push(
      `The other filters were applied locally to the ${searchInfo.narrowedCandidates} message${searchInfo.narrowedCandidates === 1 ? '' : 's'} the server-side filter returned, so a match beyond that page would not have been seen — raise \`count\`, or narrow with \`receivedAfter\``
    );
  }

  if (searchInfo.ignoredFilters?.length > 0) {
    suggestions.push(ignoredFiltersNote(searchInfo.ignoredFilters));
  }

  if (searchInfo.searchWindowUnreached) {
    suggestions.push(searchWindowNote(searchInfo));
  }

  if (filters.kqlQuery) {
    suggestions.push(
      '`searchExpression` is a Graph `$search`: it matches whole words or their beginnings. The structured filters (`from`, `to`, `subject`) match substrings'
    );
  }

  if (filters.query) {
    suggestions.push(
      '`query` was tried as a Graph `$search` (subject, body and sender) and as a subject match — try fewer words, or `subject` directly'
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
    hasMore: Boolean(response.hasMore || response['@odata.nextLink']),
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
    const droppedFilters = [
      ...suppliedTerms
        .filter((k) => !appliedTerms.includes(k))
        .map((k) => FILTER_LABELS[k] || k),
      ...(response._searchInfo.ignoredFilters || []).map(
        (k) => FILTER_LABELS[k] || k
      ),
    ];

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
      // A field-scoped `searchExpression` that personal accounts reject is
      // retried as OData filters, which is a rewrite of what the caller asked
      // for. Report the rewrite, so `raw-kql-translated` is inspectable rather
      // than something the caller has to take on trust. (#217)
      ...(response._searchInfo.kqlTranslatedTo && {
        kqlTranslatedTo: response._searchInfo.kqlTranslatedTo,
      }),
      // A `query` answered by `$search` is sorted newest first by us, within
      // the page Graph returned, not across the whole mailbox. (#261)
      ...(response._searchInfo.orderedWithinPage && {
        orderedWithinPage: true,
      }),
      // Rows were dropped by local narrowing while Graph had more to read,
      // so matches beyond those examined may exist. (#261 follow-up)
      ...(response._partialNarrowing && {
        narrowedCandidates: response._partialNarrowing.examined,
        partialCoverage: true,
      }),
      // `$search` never reached the date window; a fallback step answered.
      ...(response._searchInfo.searchWindowUnreached && {
        partialCoverage: true,
        searchWindowUnreached: true,
        searchResultsRead: response._searchInfo.searchWindowUnreached,
      }),
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
    } else if (response._searchInfo.orderedWithinPage) {
      const page = response._searchInfo.searchPageSize;
      const local = response._searchInfo.clientSideTerms || [];
      const filtered =
        local.length > 0
          ? `, filtered locally by ${local.map((k) => `\`${k}\``).join(', ')}`
          : '';
      const pages = response._searchInfo.searchPages || 1;
      const span = pages > 1 ? `across ${pages} pages` : 'within that page';
      searchNote = `\n\n_Search strategy: ${strategy} (Graph \`$search\` over subject, body and sender: ${page} message${page === 1 ? '' : 's'} returned${filtered}, sorted newest first ${span})_`;
    } else if (response._searchInfo.queryMatchedLocally) {
      searchNote = `\n\n_Search strategy: ${strategy} (\`from\`/\`to\`/\`subject\` and dates applied by Graph; \`query\` matched locally against subject, preview and sender)_`;
    } else {
      searchNote = `\n\n_Search strategy: ${strategy}_`;
    }

    const ignored = response._searchInfo.ignoredFilters || [];
    if (ignored.length > 0) {
      searchNote += `\n\n> **Not applied**: ${ignoredFiltersNote(ignored)}.`;
    }

    // A local scan that filled its budget did not see the whole mailbox, so
    // these results are a bounded sample rather than the complete set. #231
    // says so only when the search returns nothing; a truncated scan that
    // DID match is exactly as incomplete and reads as authoritative. On a
    // large archive that silently caps historical searches.
    if (response._searchInfo.searchWindowUnreached) {
      searchNote += `\n\n> **Partial coverage**: ${searchWindowNote(response._searchInfo)}`;
    }
    if (response._partialNarrowing) {
      const examined = response._partialNarrowing.examined;
      const next = response._partialNarrowing.capped
        ? `A filtered search reads at most ${NARROW_SCAN_LIMIT} messages, so narrow it: add words to \`query\` or a date window.`
        : 'Raise `count` (up to 50) to read further.';
      searchNote += `\n\n> **Partial coverage**: these were filtered locally from the first ${examined} message${examined === 1 ? '' : 's'} Graph returned, and more were available beyond them, so other matches may exist. ${next}`;
    }
    if (response._searchInfo.truncated) {
      const scanned = response._searchInfo.candidatesScanned;
      const limit = response._searchInfo.scanLimit;
      searchNote += `\n\n> **Partial coverage**: matched locally within the ${scanned} most recent messages, hitting the ${limit} scan limit — older matches were not seen. Narrow with \`receivedAfter\`/\`receivedBefore\` to search further back.`;
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
  // Optional: scope the lookup to a shared/delegated mailbox.
  const prefix = buildMailboxPrefix(args.sharedMailbox || args.email || null);

  if (!messageId) {
    return toolError(
      'Message-ID is required. Provide the full Message-ID header value (e.g., <abc123@example.com>)'
    );
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

    log.debug(`Searching for Message-ID: ${messageId}`);

    const response = await callGraphAPI(
      accessToken,
      'GET',
      `${prefix}/messages`,
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
      return authRequiredError();
    }

    return toolError(`Error searching by Message-ID: ${error.message}`);
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
  receivedFirstClauses,
};
