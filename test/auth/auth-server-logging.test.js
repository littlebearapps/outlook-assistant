/**
 * Browser auth server console output (#278). It may tell the user where to
 * sign in, but never prints the client secret, the CSRF state or an
 * authorisation code, and Azure error descriptions are redacted.
 *
 * Spawns `outlook-auth-server.js` (fixed port 3333); skipped if the port is
 * already taken on this machine.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');

const ENTRY = path.join(__dirname, '..', '..', 'outlook-auth-server.js');
const SECRET = 'super-secret-client-value';
const ADDRESS = 'jane.doe@example.com';

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
  });
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: 3333, path: urlPath }, (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      })
      .on('error', reject);
  });
}

/** Let the child's console output arrive. */
function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

let child;
let output = '';
let home;
let available = true;

beforeAll(async () => {
  available = await portFree(3333);
  if (!available) return;
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-auth-server-'));
  child = spawn(process.execPath, [ENTRY], {
    cwd: home, // no stray .env picked up by dotenv
    env: {
      ...process.env,
      HOME: home,
      OUTLOOK_CLIENT_ID: '11111111-2222-3333-4444-555555555555',
      OUTLOOK_CLIENT_SECRET: SECRET,
    },
  });
  const collect = (chunk) => {
    output += chunk.toString();
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`auth server did not start:\n${output}`)),
      10000
    );
    child.stdout.on('data', () => {
      if (output.includes('Authentication server running')) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}, 15000);

afterAll(() => {
  if (child) child.kill('SIGKILL');
  if (home) fs.rmSync(home, { recursive: true, force: true });
});

test('sign-in redirect is announced without the state or secret', async () => {
  if (!available) return;
  const res = await get('/auth');
  expect(res.statusCode).toBe(302);
  const state = new URL(res.headers.location).searchParams.get('state');
  await pause(100);
  expect(output).toMatch(/Redirecting to Microsoft sign-in/);
  expect(output).not.toContain(state);
  expect(output).not.toContain(SECRET);
});

test('an Azure error description is redacted', async () => {
  if (!available) return;
  const description = `AADSTS50020: User account ${ADDRESS} does not exist in tenant`;
  const res = await get(
    `/auth/callback?error=access_denied&error_description=${encodeURIComponent(description)}`
  );
  expect(res.statusCode).toBe(400);
  await pause(100);
  expect(output).toContain('AADSTS50020');
  expect(output).not.toContain(ADDRESS);
});

test('a callback with a code never prints the code', async () => {
  if (!available) return;
  const res = await get(
    '/auth/callback?code=0.AXoA-auth-code-value&state=bogus'
  );
  expect(res.statusCode).toBe(403);
  await pause(100);
  expect(output).not.toContain('0.AXoA-auth-code-value');
});
