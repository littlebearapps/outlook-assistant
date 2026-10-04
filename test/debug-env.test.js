/**
 * debug-env.js (local troubleshooting wrapper) lists the environment it was
 * started with, but must never print a value: secrets live there (#278).
 */
const { spawn } = require('child_process');
const path = require('path');

const ENTRY = path.join(__dirname, '..', 'debug-env.js');
const SECRET = 'super-secret-client-value';

test('lists variable names and lengths, never values', async () => {
  const child = spawn(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      USE_TEST_MODE: 'true',
      OUTLOOK_CLIENT_SECRET: SECRET,
    },
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  await new Promise((resolve) => {
    child.stderr.on('data', () => {
      if (stderr.includes('END DEBUG INFO')) resolve();
    });
    setTimeout(resolve, 5000);
  });
  child.kill('SIGKILL');

  expect(stderr).toContain(
    `OUTLOOK_CLIENT_SECRET: <set, ${SECRET.length} chars>`
  );
  expect(stderr).not.toContain(SECRET);
}, 10000);
