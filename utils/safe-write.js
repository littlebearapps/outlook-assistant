/**
 * Safe output writes, shared by attachment download, message export and
 * conversation export.
 *
 * Every output path is first confined (confineOutputPath) to the system temp
 * directory, ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR, with no dotfile
 * or dot-directory below them. Caller paths must be absolute or start with
 * `~`; relative paths are refused rather than resolved against the server's
 * working directory.
 *
 * Every file the server names itself is written with exclusive create (`wx`),
 * so an existing file is never overwritten and a planted symlink — even a
 * dangling one — is never followed. A clash gets a `-1`, `-2`, … suffix
 * instead, and the result is always confined to `outputDir`.
 *
 * A file path the caller names (export savePath) is also created exclusively;
 * it replaces an existing file only with `overwrite: true`, and never a
 * symlink, a hard-linked file or anything in a dotted path (writeExplicitFile).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * A refused output path. The message says what was refused and why; nextStep
 * says what to do instead. Handlers turn it into a tool error.
 */
class OutputPathError extends Error {
  constructor(message, nextStep) {
    super(message);
    this.name = 'OutputPathError';
    this.nextStep = nextStep;
  }
}

/**
 * Resolve a path to where it really is: `..` is resolved, and the longest
 * existing prefix goes through realpath (so symlinked directories are
 * followed); the not-yet-existing remainder is appended as is.
 * @param {string} target
 * @returns {string} Absolute path
 */
function resolveReal(target) {
  const absolute = path.resolve(target);
  const missing = [];
  let current = absolute;
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch (error) {
      const parent = path.dirname(current);
      if (error.code !== 'ENOENT' || parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Expand a leading `~` to the home directory.
 * @param {string} p
 * @returns {string}
 */
function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * The directories exports and downloads may write into, each resolved to
 * where it really is. Read on every call, so env changes apply at once.
 * @returns {Array<{label: string, dir: string}>}
 */
function allowedOutputBases() {
  const home = os.homedir();
  const bases = [
    { label: 'the system temp directory', dir: os.tmpdir() },
    { label: '~/Downloads', dir: path.join(home, 'Downloads') },
    { label: '~/Documents', dir: path.join(home, 'Documents') },
  ];
  const exportDir = (process.env.OUTLOOK_EXPORT_DIR || '').trim();
  if (exportDir) {
    bases.push({
      label: 'OUTLOOK_EXPORT_DIR',
      dir: path.resolve(expandHome(exportDir)),
    });
  }
  return bases.flatMap((base) => {
    try {
      return [{ ...base, dir: resolveReal(base.dir) }];
    } catch {
      return []; // Unresolvable (e.g. unreadable): not usable as a base
    }
  });
}

/**
 * Path segments of `child` below `parent`, or null if it is not inside.
 * @param {string} parent - Resolved directory
 * @param {string} child - Resolved path
 * @returns {string[]|null}
 */
function segmentsBelow(parent, child) {
  const rel = path.relative(parent, child);
  if (rel === '') return [];
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    return null;
  }
  return rel.split(path.sep);
}

/**
 * Resolve an output file or directory and check it may be written: it must
 * be inside an allowed base, with no dotfile or dot-directory below that
 * base. Callers must write to the returned path, not the one passed in.
 * @param {string} target - Path from the caller: absolute, or starting
 *   with `~`/`~/` for the home directory. Anything else is refused.
 * @returns {string} The resolved path
 * @throws {OutputPathError}
 */
function confineOutputPath(target) {
  const absolute = typeof target === 'string' ? expandHome(target) : target;
  if (typeof absolute !== 'string' || !path.isAbsolute(absolute)) {
    throw new OutputPathError(
      `Refusing to write to ${JSON.stringify(target)}: output paths must be absolute (or start with ~/ for the home directory). A relative path would land in the server's working directory.`,
      'Pass an absolute path, or omit the path to use the system temp directory.'
    );
  }
  let resolved;
  try {
    resolved = resolveReal(absolute);
  } catch (error) {
    throw new OutputPathError(
      `Cannot use output path ${JSON.stringify(target)}: ${error.message}`,
      'Pass a plain absolute path, or omit the path to use the system temp directory.'
    );
  }
  const bases = allowedOutputBases();
  let dotted = false;
  for (const base of bases) {
    const below = segmentsBelow(base.dir, resolved);
    if (!below) continue;
    if (!below.some((segment) => segment.startsWith('.'))) return resolved;
    dotted = true;
  }

  const baseList = bases.map((b) => `${b.label} (${b.dir})`).join(', ');
  if (dotted) {
    throw new OutputPathError(
      `Refusing to write to ${resolved}: exports and attachment downloads never write to a dotfile or into a dot-directory (a name starting with ".").`,
      `Choose a path without a dot-prefixed name inside one of: ${baseList}.`
    );
  }
  const exportDirNote = process.env.OUTLOOK_EXPORT_DIR
    ? ''
    : ' OUTLOOK_EXPORT_DIR is not set.';
  throw new OutputPathError(
    `Refusing to write to ${resolved}: exports and attachment downloads can only write inside ${baseList}.${exportDirNote}`,
    'Choose a path inside one of those directories, or ask the user to set OUTLOOK_EXPORT_DIR to an absolute directory in the MCP server env and restart the server.'
  );
}

/**
 * Whether any segment of a resolved path starts with a dot.
 * @param {string} resolved
 * @returns {boolean}
 */
function hasDotSegment(resolved) {
  return resolved.split(path.sep).some((segment) => segment.startsWith('.'));
}

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

/**
 * The refusal for an explicit file path that already exists.
 * @param {string} filePath
 * @returns {OutputPathError}
 */
function fileExistsError(filePath) {
  return new OutputPathError(
    `File already exists: ${filePath}. Nothing was written.`,
    'Pass overwrite: true to replace it, choose a different savePath, or pass a directory as savePath so a new, unique file name is used.'
  );
}

/**
 * Write `data` to a file path the caller chose (already confined). A new file
 * is created exclusively. An existing one is replaced only with
 * `overwrite: true`, and only if it is a regular file with a single link and
 * no segment of its path starts with a dot. The replacement is written to a
 * temporary file beside it and renamed over it, so a link swapped in after
 * the check is replaced, not followed.
 * @param {string} filePath - Resolved target path
 * @param {string|Buffer} data - File contents
 * @param {{overwrite?: boolean, encoding?: string}} [options]
 * @returns {{path: string, replaced: boolean}}
 * @throws {OutputPathError} When the file exists and may not be replaced
 */
function writeExplicitFile(
  filePath,
  data,
  { overwrite = false, encoding } = {}
) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  try {
    fs.writeFileSync(filePath, data, { encoding, flag: 'wx' });
    return { path: filePath, replaced: false };
  } catch (error) {
    if (error.code !== 'EEXIST') {
      removePartialFile(filePath);
      throw error;
    }
  }

  if (!overwrite) throw fileExistsError(filePath);
  if (hasDotSegment(filePath)) {
    throw new OutputPathError(
      `Refusing to replace ${filePath}: files that are dotfiles or inside a dot-directory are never replaced, even with overwrite: true. Nothing was written.`,
      'Choose a different savePath, or pass a directory so a new, unique file name is used.'
    );
  }
  const stat = fs.lstatSync(filePath);
  let problem = null;
  if (stat.isSymbolicLink()) problem = 'it is a symbolic link';
  else if (!stat.isFile()) problem = 'it is not a regular file';
  else if (stat.nlink > 1) problem = 'it has other hard links';
  if (problem) {
    throw new OutputPathError(
      `Refusing to replace ${filePath}: ${problem}. Nothing was written.`,
      'Choose a different savePath, or pass a directory so a new, unique file name is used.'
    );
  }

  const temp = path.join(
    dir,
    `.${path.basename(filePath)}.${crypto.randomBytes(6).toString('hex')}.tmp`
  );
  try {
    fs.writeFileSync(temp, data, { encoding, flag: 'wx' });
    fs.renameSync(temp, filePath);
  } catch (error) {
    removePartialFile(temp);
    throw error;
  }
  return { path: filePath, replaced: true };
}

module.exports = {
  writeClaimedFile,
  makeClaimedDir,
  writeExplicitFile,
  confineOutputPath,
  allowedOutputBases,
  fileExistsError,
  pathEntryExists,
  OutputPathError,
};
