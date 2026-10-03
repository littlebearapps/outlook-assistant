/**
 * Safe output writes, shared by attachment download, message export and
 * conversation export.
 *
 * Every file the server names itself is written with exclusive create (`wx`),
 * so an existing file is never overwritten and a planted symlink — even a
 * dangling one — is never followed. A clash gets a `-1`, `-2`, … suffix
 * instead, and the result is always confined to `outputDir`.
 */
const fs = require('fs');
const path = require('path');

const MAX_ATTEMPTS = 1000;

/**
 * Like fs.existsSync, but a dangling symlink counts as existing (existsSync
 * follows the link and reports false).
 * @param {string} candidate
 * @returns {boolean}
 */
function pathEntryExists(candidate) {
  try {
    fs.lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build `<base>[-N][.ext]` inside `root`, refusing anything that would land
 * outside it. Names are built from sanitised parts, but confine defensively.
 * @param {string} root - Resolved target directory
 * @param {string} base - Name without extension
 * @param {string} ext - Extension with its leading dot, or ''
 * @param {number} suffix - 0 for the plain name, else the collision number
 * @returns {string}
 */
function candidatePath(root, base, ext, suffix) {
  const name = suffix === 0 ? `${base}${ext}` : `${base}-${suffix}${ext}`;
  const candidate = path.join(root, name);
  if (path.dirname(candidate) !== root) {
    throw new Error('Refusing to write file outside outputDir');
  }
  return candidate;
}

/**
 * Claim a not-yet-used path in `outputDir`: the plain name, else `-1`, `-2`, …
 * until the name is free both on disk and among the paths already claimed in
 * this batch.
 *
 * Silent overwrite is the dangerous part of the batch-export collision defect:
 * the exporter reported `Successful N / Failed 0` while messages vanished.
 * Never overwrite — disambiguate instead, and let the caller reconcile via the
 * paths returned.
 *
 * The claim is synchronous, so it is atomic with respect to the event loop and
 * safe under the batch exporter's 4-way concurrency.
 *
 * @param {string} outputDir - Target directory
 * @param {string} base - Filename without extension
 * @param {string} extension - Extension without a leading dot ('' for none)
 * @param {Set<string>} claimed - Paths already claimed by this batch
 * @returns {string} - An unused absolute path, now claimed
 */
function claimUniquePath(outputDir, base, extension, claimed) {
  const root = path.resolve(outputDir);
  const ext = extension ? `.${extension}` : '';
  for (let suffix = 0; suffix < MAX_ATTEMPTS; suffix++) {
    const candidate = candidatePath(root, base, ext, suffix);
    if (!claimed.has(candidate) && !pathEntryExists(candidate)) {
      claimed.add(candidate);
      return candidate;
    }
  }
  throw new Error(`Too many files named ${base}${ext} in ${root}`);
}

/**
 * Best-effort removal of a file this call created before its write failed
 * (e.g. ENOSPC/EIO), so no truncated file is left under the claimed name.
 * Only called for non-EEXIST errors: with EEXIST the entry isn't ours.
 * @param {string} candidate
 */
function removePartialFile(candidate) {
  try {
    fs.unlinkSync(candidate);
  } catch {
    // Already gone (ENOENT) or not removable; the original error matters more.
  }
}

/**
 * Claim a unique name in `outputDir` and write `data` to it exclusively. The
 * `wx` flag fails on any existing entry — including a dangling symlink planted
 * after the claim — so a write never overwrites a file or follows a link; on
 * EEXIST the next suffix is claimed instead. Any other write error removes the
 * partly written file before it is rethrown.
 * @param {string} outputDir - Target directory (must already exist)
 * @param {string} base - Filename without extension (already sanitised)
 * @param {string} extension - Extension without a leading dot ('' for none)
 * @param {Set<string>|null} claimed - Paths already claimed by this batch
 * @param {string|Buffer} data - File contents
 * @param {string} [encoding] - Encoding for string data
 * @returns {string} - Absolute path actually written
 */
function writeClaimedFile(outputDir, base, extension, claimed, data, encoding) {
  const seen = claimed || new Set();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = claimUniquePath(outputDir, base, extension, seen);
    try {
      fs.writeFileSync(candidate, data, { encoding, flag: 'wx' });
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        removePartialFile(candidate);
        throw error;
      }
    }
  }
  throw new Error(`Too many files named ${base} in ${outputDir}`);
}

/**
 * Create a new, empty directory `<base>` (or `<base>-N`) inside `outputDir`.
 * A non-recursive mkdir fails on any existing entry, so an export never writes
 * into a directory it didn't just create — including a symlink pointing out of
 * `outputDir`.
 * @param {string} outputDir - Parent directory (must already exist)
 * @param {string} base - Directory name (already sanitised)
 * @returns {string} - Absolute path of the directory created
 */
function makeClaimedDir(outputDir, base) {
  const root = path.resolve(outputDir);
  for (let suffix = 0; suffix < MAX_ATTEMPTS; suffix++) {
    const candidate = candidatePath(root, base, '', suffix);
    try {
      fs.mkdirSync(candidate);
      return candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`Too many directories named ${base} in ${root}`);
}

module.exports = {
  writeClaimedFile,
  makeClaimedDir,
};
