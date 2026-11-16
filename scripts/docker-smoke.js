#!/usr/bin/env node
/**
 * Smoke-test a built Outlook Assistant image (or any stdio launch of the
 * server): send `initialize` and `tools/list` over stdio and check the server
 * name, the version and the tool count. CI runs it against `docker run -i`
 * after `docker build`, so a Dockerfile that drifts from the package (#320)
 * fails before the image is published anywhere (#336).
 *
 * Usage:
 *   node scripts/docker-smoke.js --image <tag> [--runtime "docker"]
 *   node scripts/docker-smoke.js -- <command> [args...]   e.g. `-- node index.js`
 * Options: --tools <n> (default 22), --timeout <ms> (default 30000).
 *
 * Node built-ins only: the CI job runs it without `npm ci`. No credentials
 * are needed; neither request reaches Microsoft Graph, and the container is
 * started with `--network none`.
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const SERVER_NAME = 'outlook-assistant';
const TOOL_COUNT = 22;
const DEFAULT_TIMEOUT_MS = 30000;
const CLEANUP_TIMEOUT_MS = 30000;

const REQUESTS = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'docker-smoke', version: '1' },
    },
  },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
];

/**
 * Parse the command line.
 * @param {string[]} argv - Arguments after the script name
 * @returns {{image?: string, runtime: string, command?: string[], tools: number, timeoutMs: number}}
 */
function parseArgs(argv) {
  const options = {
    runtime: 'docker',
    tools: TOOL_COUNT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      options.command = argv.slice(i + 1);
      break;
    }
    const value = argv[i + 1];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (arg === '--image') options.image = value;
    else if (arg === '--runtime') options.runtime = value;
    else if (arg === '--tools') options.tools = wholeNumber(arg, value);
    else if (arg === '--timeout') options.timeoutMs = wholeNumber(arg, value);
    else throw new Error(`unknown option: ${arg}`);
    i++;
  }
  if (options.image && options.command) {
    throw new Error('pass --image or a command after --, not both');
  }
  if (!options.image && (!options.command || options.command.length === 0)) {
    throw new Error('pass --image <tag>, or a command after --');
  }
  return options;
}

function wholeNumber(name, value) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a whole number above 0`);
  }
  return Number(value);
}

/**
 * The launch command for an image: no network, no volumes, removed on exit.
 * @param {string} runtime - e.g. `docker`, or `podman --root /x --runroot /y`
 * @param {string} image - Image tag
 * @param {string} name - Container name, so it can be removed afterwards
 * @returns {{command: string[], cleanup: string[]}}
 */
function containerCommand(runtime, image, name) {
  const base = runtime.trim().split(/\s+/);
  return {
    command: [
      ...base,
      'run',
      '-i',
      '--rm',
      '--network',
      'none',
      '--name',
      name,
      image,
    ],
    cleanup: [...base, 'rm', '-f', name],
  };
}

/**
 * Check the two responses against what the package says it is.
 * @param {object|undefined} init - JSON-RPC response to `initialize`
 * @param {object|undefined} list - JSON-RPC response to `tools/list`
 * @param {{name: string, version: string, tools: number}} expected
 * @returns {string[]} - Problems found; empty when the server is as expected
 */
function checkResponses(init, list, expected) {
  const problems = [];
  if (!init) problems.push('no response to initialize');
  else if (init.error) {
    problems.push(`initialize failed: ${JSON.stringify(init.error)}`);
  } else {
    const info = init.result?.serverInfo || {};
    if (info.name !== expected.name) {
      problems.push(
        `server name is ${JSON.stringify(info.name)}, expected ${JSON.stringify(expected.name)}`
      );
    }
    if (info.version !== expected.version) {
      problems.push(
        `server version is ${JSON.stringify(info.version)}, expected ${JSON.stringify(expected.version)}`
      );
    }
  }
  if (!list) problems.push('no response to tools/list');
  else if (list.error) {
    problems.push(`tools/list failed: ${JSON.stringify(list.error)}`);
  } else {
    const tools = list.result?.tools;
    const count = Array.isArray(tools) ? tools.length : 0;
    if (count !== expected.tools) {
      problems.push(
        `tools/list returned ${count} tools, expected ${expected.tools}`
      );
    }
  }
  return problems;
}

/**
 * Start `command`, send the requests and collect the two responses. Resolves
 * once both have arrived, the process has exited, or the timeout has passed.
 * @param {string[]} command - Program and arguments
 * @param {{timeoutMs?: number, env?: object}} [options]
 * @returns {Promise<{init?: object, list?: object, stderr: string, exitCode: number|null, timedOut: boolean, spawnError?: string}>}
 */
function exchange(command, { timeoutMs = DEFAULT_TIMEOUT_MS, env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: env || process.env,
    });
    const outcome = { stderr: '', exitCode: null, timedOut: false };
    let buffer = '';
    let settled = false;
    let exitTimer;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(exitTimer);
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      resolve(outcome);
    };
    const timer = setTimeout(() => {
      outcome.timedOut = true;
      finish();
    }, timeoutMs);

    child.on('error', (error) => {
      outcome.spawnError = error.message;
      finish();
    });
    child.on('exit', (code) => {
      outcome.exitCode = code;
      finish();
    });
    child.stdin.on('error', () => {}); // the process may already be gone
    child.stderr.on('data', (chunk) => {
      outcome.stderr = (outcome.stderr + chunk.toString()).slice(-4000);
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === 1) outcome.init = message;
        if (message.id === 2) outcome.list = message;
      }
      if (outcome.init && outcome.list && !exitTimer) {
        // The server exits when stdin closes; give it a moment to do so, so
        // a container is gone before the cleanup command runs.
        child.stdin.end();
        exitTimer = setTimeout(finish, 3000);
      }
    });

    child.stdin.write(`${REQUESTS.map((r) => JSON.stringify(r)).join('\n')}\n`);
  });
}

/**
 * Run the whole check.
 * @param {ReturnType<typeof parseArgs>} options
 * @param {{version: string}} pkg - package.json
 * @returns {Promise<{ok: boolean, problems: string[], summary: string, stderr: string}>}
 */
async function runSmoke(options, pkg) {
  const expected = {
    name: SERVER_NAME,
    version: pkg.version,
    tools: options.tools,
  };
  const launch = options.image
    ? containerCommand(
        options.runtime,
        options.image,
        `outlook-assistant-smoke-${process.pid}`
      )
    : { command: options.command };

  let result;
  try {
    result = await exchange(launch.command, { timeoutMs: options.timeoutMs });
  } finally {
    if (launch.cleanup) {
      // Bounded, so a runtime that hangs on `rm` cannot hold the job open.
      spawnSync(launch.cleanup[0], launch.cleanup.slice(1), {
        stdio: 'ignore',
        timeout: options.cleanupTimeoutMs ?? CLEANUP_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
    }
  }

  const problems = [];
  if (result.spawnError) {
    problems.push(`could not start ${launch.command[0]}: ${result.spawnError}`);
  }
  if (result.timedOut) {
    problems.push(`no complete answer within ${options.timeoutMs} ms`);
  }
  problems.push(...checkResponses(result.init, result.list, expected));

  const info = result.init?.result?.serverInfo || {};
  const count = result.list?.result?.tools?.length ?? 0;
  return {
    ok: problems.length === 0,
    problems,
    summary: `${info.name || '?'} ${info.version || '?'}, ${count} tools`,
    stderr: result.stderr,
  };
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`docker-smoke: ${error.message}`);
    console.error(
      'usage: docker-smoke.js --image <tag> [--runtime docker] | -- <command> [args...]'
    );
    process.exit(2);
  }
  const pkg = require(path.join(__dirname, '..', 'package.json'));
  const result = await runSmoke(options, pkg);
  if (result.ok) {
    console.log(`Smoke test passed: ${result.summary}`);
    return;
  }
  console.error('Smoke test FAILED:');
  for (const problem of result.problems) console.error(`  - ${problem}`);
  if (result.stderr) {
    console.error('--- last server stderr ---');
    console.error(result.stderr.trimEnd());
  }
  process.exit(1);
}

if (require.main === module) {
  main();
}

module.exports = {
  SERVER_NAME,
  TOOL_COUNT,
  parseArgs,
  containerCommand,
  checkResponses,
  exchange,
  runSmoke,
};
