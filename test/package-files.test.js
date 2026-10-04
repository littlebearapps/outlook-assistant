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
