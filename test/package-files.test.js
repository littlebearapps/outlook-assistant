/**
 * The npm package ships only what's listed in package.json `files`. A
 * root-level module that a shipped file requires, but that isn't listed,
 * passes every test here and then crashes the published server on start.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { files } = require('../package.json');

function rootRequires(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return [...src.matchAll(/require\('\.\/([^'/]+?)(?:\.js)?'\)/g)].map(
    (m) => `${m[1]}.js`
  );
}

describe('package files', () => {
  test('every root module required by a shipped root file is shipped', () => {
    const shipped = new Set(files);
    const queue = files.filter((f) => f.endsWith('.js'));
    const seen = new Set();
    while (queue.length) {
      const file = queue.shift();
      if (seen.has(file)) continue;
      seen.add(file);
      for (const dep of rootRequires(file)) {
        if (!fs.existsSync(path.join(ROOT, dep))) continue; // a directory
        expect({ file, dep, shipped: shipped.has(dep) }).toEqual({
          file,
          dep,
          shipped: true,
        });
        queue.push(dep);
      }
    }
  });
});

/**
 * The Docker image (used by the Glama listing) copies files one by one, so it
 * drifts from `files` unless something checks (#320: it lacked server.js,
 * tools.js and request-handler.js, so the image failed on start).
 */
function dockerCopySources() {
  const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
  const sources = [];
  for (const line of dockerfile.split('\n')) {
    const match = /^\s*COPY\s+(.+)$/i.exec(line);
    if (!match) continue;
    const parts = match[1].trim().split(/\s+/);
    if (parts.some((p) => p.startsWith('--from'))) continue;
    // The last token is the destination.
    sources.push(...parts.slice(0, -1).filter((p) => !p.startsWith('--')));
  }
  return sources.map((s) => s.replace(/\*$/, ''));
}

describe('Dockerfile (#320)', () => {
  const copied = new Set(dockerCopySources());
  const runtime = files.filter((f) => f.endsWith('.js') || f.endsWith('/'));

  test.each(runtime)(
    'copies %s, a runtime entry in package.json files',
    (entry) => {
      expect(copied.has(entry)).toBe(true);
    }
  );

  test('copies nothing that package.json files leaves out', () => {
    const allowed = new Set([...files, 'package.json', 'package-lock.json']);
    expect([...copied].filter((s) => !allowed.has(s))).toEqual([]);
  });
});
