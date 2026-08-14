/**
 * Shared, path-aware, ambiguity-aware mail-folder resolver. (#216)
 *
 * Replaces the two top-level-only resolvers (`getFolderIdByName` in
 * email/folder-utils.js and `resolveFolderName` in folder/stats.js) that could
 * not address nested folders. Accepts, in priority order:
 *   1. an explicit folder ID (never guessed from a name),
 *   2. a well-known alias (inbox, archive, sent, ...),
 *   3. a folder PATH like "Triage/Delete" or "Inbox/Clients/Acme"
 *      (case-insensitive, traversed segment-by-segment via childFolders),
 *   4. a bare display name (unique top-level match wins for back-compat;
 *      otherwise the whole tree is searched, with ambiguity reported).
 *
 * Returns `{ id, displayName, parentId, path }`. Throws a caller-friendly Error
 * on not-found or ambiguity (listing candidate paths + IDs).
 *
 * `/` is the path separator, so a folder whose display name literally contains
 * `/` cannot be addressed by path — use its folderId (documented on the tool).
 *
 * Every function takes an optional `mailbox` (a shared/delegated mailbox email
 * address). It only changes the Graph path prefix — `me` vs `users/{mailbox}` —
 * so the same resolution logic reaches custom subfolders and localized folder
 * names in a shared mailbox exactly as it does in the signed-in account.
 */
const { callGraphAPI } = require('../utils/graph-api');
const { buildMailboxPrefix } = require('../utils/mailbox');

// Alias → Graph well-known folder name (usable directly as a path segment).
const WELL_KNOWN = {
  inbox: 'inbox',
  drafts: 'drafts',
  sent: 'sentitems',
  sentitems: 'sentitems',
  'sent items': 'sentitems',
  deleted: 'deleteditems',
  deleteditems: 'deleteditems',
  'deleted items': 'deleteditems',
  junk: 'junkemail',
  junkemail: 'junkemail',
  'junk email': 'junkemail',
  spam: 'junkemail',
  archive: 'archive',
  outbox: 'outbox',
};

// NB: mailFolder has no selectable `wellKnownName` property (Graph 400s on it,
// verified against consumer accounts) — well-known folders are addressed by
// name in the URL, not via a returned field.
const FOLDER_SELECT = 'id,displayName,parentFolderId,childFolderCount';
// Safety caps against pathological/looping nesting when walking the tree for a
// bare-name search. Beyond these we refuse to guess and ask for a path/ID.
const MAX_TREE_DEPTH = 20;
const MAX_TREE_REQUESTS = 200;

function notFoundError(spec) {
  return new Error(
    `Folder "${spec}" not found. Use \`folders\` action=list to see folders ` +
      `(with IDs and full paths), pass a folder path like "Parent/Child", or a folderId.`
  );
}

function ambiguousError(spec, candidates) {
  const shown = candidates.slice(0, 20);
  const lines = shown
    .map((c) => `  - ${c.path}  (folderId: ${c.id})`)
    .join('\n');
  const more =
    candidates.length > shown.length
      ? `\n  … and ${candidates.length - shown.length} more`
      : '';
  return new Error(
    `Folder "${spec}" is ambiguous — ${candidates.length} folders match:\n${lines}${more}\n` +
      `Disambiguate with a folder path (e.g. "Parent/Child") or a folderId.`
  );
}

/**
 * List child folders of `parentId` (or top-level when null), following
 * @odata.nextLink so folders with many children resolve completely.
 * @returns {Promise<Array<{id, displayName, parentFolderId, childFolderCount}>>}
 */
async function listChildFolders(
  accessToken,
  parentId,
  select = FOLDER_SELECT,
  mailbox = null
) {
  const prefix = buildMailboxPrefix(mailbox);
  const all = [];
  let path = parentId
    ? `${prefix}/mailFolders/${parentId}/childFolders`
    : `${prefix}/mailFolders`;
  let params = { $top: 100, $select: select };
  // Follow pagination; nextLink already encodes params. Guard against a
  // repeated/malformed nextLink so a bad server response can't loop forever.
  const seen = new Set();
  while (path) {
    if (seen.has(path)) {
      throw new Error(
        'Graph returned a repeated folder pagination link — aborting to avoid a loop.'
      );
    }
    seen.add(path);
    const resp = await callGraphAPI(accessToken, 'GET', path, null, params);
    if (Array.isArray(resp.value)) {
      all.push(...resp.value);
    }
    path = resp['@odata.nextLink'] || null;
    params = {};
  }
  return all;
}

function toRecord(folder, path) {
  return {
    id: folder.id,
    displayName: folder.displayName,
    parentId: folder.parentFolderId || null,
    path: path || folder.displayName,
  };
}

async function resolveWellKnown(accessToken, alias, mailbox) {
  const resp = await callGraphAPI(
    accessToken,
    'GET',
    `${buildMailboxPrefix(mailbox)}/mailFolders/${WELL_KNOWN[alias]}`,
    null,
    { $select: FOLDER_SELECT }
  );
  return toRecord(resp, resp.displayName);
}

async function resolveById(accessToken, id, mailbox) {
  const resp = await callGraphAPI(
    accessToken,
    'GET',
    `${buildMailboxPrefix(mailbox)}/mailFolders/${id}`,
    null,
    { $select: FOLDER_SELECT }
  );
  return toRecord(resp, resp.displayName);
}

/**
 * Build a flat list of every folder with its full path, breadth-first.
 * Accepts an already-fetched top-level list to avoid re-fetching.
 */
async function buildTree(accessToken, topLevel, mailbox = null) {
  const top =
    topLevel || (await listChildFolders(accessToken, null, undefined, mailbox));
  const out = [];
  const visited = new Set();
  const queue = top.map((f) => ({ folder: f, path: f.displayName, depth: 1 }));
  let requests = 0;
  // Index-based iteration (no O(n^2) shift); visited-set defends against
  // cyclic/duplicate API data.
  for (let i = 0; i < queue.length; i++) {
    const { folder, path, depth } = queue[i];
    if (visited.has(folder.id)) {
      continue;
    }
    visited.add(folder.id);
    out.push(toRecord(folder, path));
    if (folder.childFolderCount > 0) {
      // Refuse to return a "unique" bare-name result from a truncated scan —
      // a match could exist in the unexplored remainder. Ask for a path/ID.
      if (depth >= MAX_TREE_DEPTH) {
        throw new Error(
          `Folder tree exceeds the ${MAX_TREE_DEPTH}-level resolution limit — ` +
            'use an explicit folder path or folderId.'
        );
      }
      if (++requests > MAX_TREE_REQUESTS) {
        throw new Error(
          'Folder tree is too large to search by bare name — ' +
            'use an explicit folder path or folderId.'
        );
      }
      const children = await listChildFolders(
        accessToken,
        folder.id,
        undefined,
        mailbox
      );
      for (const child of children) {
        queue.push({
          folder: child,
          path: `${path}/${child.displayName}`,
          depth: depth + 1,
        });
      }
    }
  }
  return out;
}

function matchName(folders, name) {
  const lower = name.toLowerCase();
  return folders.filter((f) => f.displayName.toLowerCase() === lower);
}

/**
 * Resolve a bare display name: a unique top-level match wins (fast path,
 * back-compat); otherwise search the whole tree, reporting ambiguity.
 */
async function resolveByName(accessToken, name, mailbox) {
  const top = await listChildFolders(accessToken, null, undefined, mailbox);
  const topMatches = matchName(top, name);
  if (topMatches.length === 1) {
    return toRecord(topMatches[0], topMatches[0].displayName);
  }
  if (topMatches.length > 1) {
    throw ambiguousError(
      name,
      topMatches.map((m) => ({ id: m.id, path: m.displayName }))
    );
  }
  // Not top-level — search nested folders.
  const tree = await buildTree(accessToken, top, mailbox);
  const matches = matchName(tree, name);
  if (matches.length === 0) {
    throw notFoundError(name);
  }
  if (matches.length > 1) {
    throw ambiguousError(name, matches);
  }
  return matches[0];
}

/**
 * Resolve a path (segments already split/trimmed) by traversing childFolders.
 */
async function resolvePath(accessToken, segments, mailbox) {
  let current;
  const first = segments[0];
  if (WELL_KNOWN[first.toLowerCase()]) {
    current = await resolveWellKnown(accessToken, first.toLowerCase(), mailbox);
  } else {
    const top = await listChildFolders(accessToken, null, undefined, mailbox);
    const matches = matchName(top, first);
    if (matches.length === 0) {
      throw notFoundError(first);
    }
    if (matches.length > 1) {
      throw ambiguousError(
        first,
        matches.map((m) => ({ id: m.id, path: m.displayName }))
      );
    }
    current = toRecord(matches[0], matches[0].displayName);
  }

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const children = await listChildFolders(
      accessToken,
      current.id,
      undefined,
      mailbox
    );
    const matches = matchName(children, seg);
    if (matches.length === 0) {
      throw notFoundError(`${current.path}/${seg}`);
    }
    if (matches.length > 1) {
      throw ambiguousError(
        `${current.path}/${seg}`,
        matches.map((m) => ({
          id: m.id,
          path: `${current.path}/${m.displayName}`,
        }))
      );
    }
    current = {
      id: matches[0].id,
      displayName: matches[0].displayName,
      parentId: current.id,
      path: `${current.path}/${matches[0].displayName}`,
    };
  }
  return current;
}

/**
 * Resolve a folder from a name/path and/or explicit ID.
 * @param {string} accessToken
 * @param {{name?: string, id?: string, mailbox?: string|null}} spec
 * @returns {Promise<{id: string, displayName: string, parentId: string|null, path: string}>}
 *   `path` is the full slash-separated path when resolved by name/path/alias;
 *   when resolved by ID it is the folder's display name only (ancestors are not
 *   fetched).
 */
async function resolveFolder(accessToken, spec = {}) {
  const mailbox = spec.mailbox || null;
  const id = (spec.id || '').trim();
  if (id) {
    return resolveById(accessToken, id, mailbox);
  }
  const name = (spec.name || '').trim();
  if (!name) {
    throw new Error('A folder name, path, or folderId is required.');
  }
  if (name.includes('/')) {
    // Trim each segment and drop leading/trailing empties ("/Inbox/" is fine),
    // but reject INTERIOR empty segments ("A//B") so a typo can't silently
    // collapse to a real folder — important for the destructive delete path.
    const segments = name.split('/').map((s) => s.trim());
    while (segments.length && segments[0] === '') {
      segments.shift();
    }
    while (segments.length && segments[segments.length - 1] === '') {
      segments.pop();
    }
    if (segments.length === 0) {
      throw new Error(`Invalid folder path "${spec.name}".`);
    }
    if (segments.some((s) => s === '')) {
      throw new Error(
        `Invalid folder path "${spec.name}": empty path segment.`
      );
    }
    if (segments.length === 1) {
      return resolveFolder(accessToken, { name: segments[0], mailbox });
    }
    return resolvePath(accessToken, segments, mailbox);
  }
  if (WELL_KNOWN[name.toLowerCase()]) {
    return resolveWellKnown(accessToken, name.toLowerCase(), mailbox);
  }
  return resolveByName(accessToken, name, mailbox);
}

module.exports = {
  WELL_KNOWN,
  resolveFolder,
  listChildFolders,
  buildTree,
};
