/**
 * scripts/docker-smoke.js sends `initialize` and `tools/list` to a stdio
 * launch of the server and checks the name, version and tool count. CI runs it
 * against the built Docker image (#336); here it runs against the local
 * server process and small fake servers, with no container runtime.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  SERVER_NAME,
  TOOL_COUNT,
  parseArgs,
  containerCommand,
  checkResponses,
  runSmoke,
} = require('../../scripts/docker-smoke');
const config = require('../../config');
const { TOOLS } = require('../../tools');
const pkg = require('../../package.json');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'docker-smoke.js');
const NODE = process.execPath;

/** A stdio "server" that answers both requests with the given values. */
function fakeServer({ name = SERVER_NAME, version = pkg.version, tools = 22 }) {
  const source = `
    let buffer = '';
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\\n')) !== -1) {
        const message = JSON.parse(buffer.slice(0, i));
        buffer = buffer.slice(i + 1);
        if (message.id === 1) {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { serverInfo: { name: ${JSON.stringify(name)}, version: ${JSON.stringify(version)} } } }));
        }
        if (message.id === 2) {
          console.log(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: Array.from({ length: ${tools} }, (_, n) => ({ name: 't' + n })) } }));
        }
      }
    });
    process.stdin.on('end', () => process.exit(0));
  `;
  return [NODE, '-e', source];
}

const options = (command, extra = {}) => ({
  runtime: 'docker',
  tools: TOOL_COUNT,
  timeoutMs: 20000,
  command,
  ...extra,
});

describe('docker-smoke constants', () => {
  test('match the server it checks', () => {
    expect(SERVER_NAME).toBe(config.SERVER_NAME);
    expect(TOOL_COUNT).toBe(TOOLS.length);
  });
});

describe('parseArgs', () => {
  test('an image uses docker by default', () => {
    expect(parseArgs(['--image', 'oa:ci'])).toEqual({
      image: 'oa:ci',
      runtime: 'docker',
      tools: 22,
      timeoutMs: 30000,
    });
  });

  test('takes a runtime, a tool count and a timeout', () => {
    expect(
      parseArgs([
        '--image',
        'oa:ci',
        '--runtime',
        'podman --root /x',
        '--tools',
        '23',
        '--timeout',
        '5000',
      ])
    ).toMatchObject({
      runtime: 'podman --root /x',
      tools: 23,
      timeoutMs: 5000,
    });
  });

  test('everything after -- is the command', () => {
    expect(parseArgs(['--', 'node', 'index.js', '--flag']).command).toEqual([
      'node',
      'index.js',
      '--flag',
    ]);
  });

  test.each([
    [[]],
    [['--']],
    [['--image']],
    [['--image', 'oa:ci', '--', 'node', 'index.js']],
    [['--tools', '0', '--image', 'oa:ci']],
    [['--tools', 'many', '--image', 'oa:ci']],
    [['--volume', '/x', '--image', 'oa:ci']],
  ])('refuses %j', (argv) => {
    expect(() => parseArgs(argv)).toThrow();
  });
});

describe('containerCommand', () => {
  const { command, cleanup } = containerCommand(
    'podman --root /x --runroot /y',
    'oa:ci',
    'oa-smoke-1'
  );

  test('runs the image over stdio with no network, removed on exit', () => {
    expect(command).toEqual([
      'podman',
      '--root',
      '/x',
      '--runroot',
      '/y',
      'run',
      '-i',
      '--rm',
      '--network',
      'none',
      '--name',
      'oa-smoke-1',
      'oa:ci',
    ]);
  });

  test('passes no ports, volumes or environment', () => {
    for (const flag of ['-p', '--publish', '-v', '--volume', '-e', '--env']) {
      expect(command).not.toContain(flag);
    }
  });

  test('removes the container by name afterwards', () => {
    expect(cleanup).toEqual([
      'podman',
      '--root',
      '/x',
      '--runroot',
      '/y',
      'rm',
      '-f',
      'oa-smoke-1',
    ]);
  });
});

describe('checkResponses', () => {
  const expected = { name: 'outlook-assistant', version: '3.14.2', tools: 22 };
  const init = (serverInfo) => ({ id: 1, result: { serverInfo } });
  const list = (n) => ({
    id: 2,
    result: { tools: Array.from({ length: n }, () => ({})) },
  });
  const good = init({ name: 'outlook-assistant', version: '3.14.2' });

  test('no problems when name, version and tool count match', () => {
    expect(checkResponses(good, list(22), expected)).toEqual([]);
  });

  test.each([
    [init({ name: 'other', version: '3.14.2' }), list(22), 'server name'],
    [
      init({ name: 'outlook-assistant', version: '3.14.1' }),
      list(22),
      'server version',
    ],
    [good, list(21), 'returned 21 tools, expected 22'],
    [good, list(0), 'returned 0 tools'],
    [good, { id: 2, result: {} }, 'returned 0 tools'],
    [undefined, list(22), 'no response to initialize'],
    [good, undefined, 'no response to tools/list'],
    [{ id: 1, error: { code: -32603 } }, list(22), 'initialize failed'],
    [good, { id: 2, error: { code: -32601 } }, 'tools/list failed'],
  ])('reports a problem (%#)', (i, l, text) => {
    const problems = checkResponses(i, l, expected);
    expect(problems.join('\n')).toContain(text);
  });
});

describe('runSmoke', () => {
  let home;
  let savedHome;
  beforeAll(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-smoke-'));
    savedHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterAll(() => {
    process.env.HOME = savedHome;
    fs.rmSync(home, { recursive: true, force: true });
  });

  test('passes against the real server started from this checkout', async () => {
    const result = await runSmoke(
      options([NODE, path.join(ROOT, 'index.js')]),
      pkg
    );

    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(`outlook-assistant ${pkg.version}, 22 tools`);
  }, 30000);

  test('fails when the server reports another version', async () => {
    const result = await runSmoke(
      options(fakeServer({ version: '0.0.1' })),
      pkg
    );

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('server version is "0.0.1"');
  }, 30000);

  test('fails when a tool is missing', async () => {
    const result = await runSmoke(options(fakeServer({ tools: 21 })), pkg);

    expect(result.ok).toBe(false);
    expect(result.problems).toEqual([
      'tools/list returned 21 tools, expected 22',
    ]);
  }, 30000);

  test('fails when the process dies on start, and keeps its stderr', async () => {
    const result = await runSmoke(
      options([
        NODE,
        '-e',
        'console.error("Cannot find module \'./server\'"); process.exit(1)',
      ]),
      pkg
    );

    expect(result.ok).toBe(false);
    expect(result.problems).toContain('no response to initialize');
    expect(result.stderr).toContain("Cannot find module './server'");
  }, 30000);

  test('fails when the program cannot be started', async () => {
    const result = await runSmoke(options(['/nonexistent/oa-runtime']), pkg);

    expect(result.ok).toBe(false);
    expect(result.problems.join('\n')).toContain('could not start');
  }, 30000);

  test('fails when nothing answers before the timeout', async () => {
    const result = await runSmoke(
      options([NODE, '-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 500 }),
      pkg
    );

    expect(result.ok).toBe(false);
    expect(result.problems[0]).toBe('no complete answer within 500 ms');
  }, 30000);
});

describe('docker-smoke CLI', () => {
  const env = { ...process.env, HOME: os.tmpdir() };

  test('exits 0 and prints one line for a healthy server', () => {
    const out = execFileSync(
      NODE,
      [SCRIPT, '--', NODE, path.join(ROOT, 'index.js')],
      {
        encoding: 'utf8',
        env,
      }
    );
    expect(out.trim()).toBe(
      `Smoke test passed: outlook-assistant ${pkg.version}, 22 tools`
    );
  }, 30000);

  test('exits 1 with the problems for an unhealthy one', () => {
    const run = spawnSync(NODE, [SCRIPT, '--', ...fakeServer({ tools: 3 })], {
      encoding: 'utf8',
      env,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('tools/list returned 3 tools, expected 22');
  }, 30000);

  test('exits 2 on bad usage', () => {
    const run = spawnSync(NODE, [SCRIPT], { encoding: 'utf8', env });
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('usage:');
  });
});

describe('packaging and CI wiring', () => {
  test('the script is not part of the published package', () => {
    expect(pkg.files.some((f) => f.startsWith('scripts'))).toBe(false);
  });

  test('uses Node built-ins only, so CI can run it without npm ci', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const required = [...source.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map(
      (m) => m[1]
    );
    expect(required.sort()).toEqual(['child_process', 'path']);
  });

  test('the CI workflow builds the image and runs this script against it', () => {
    const ci = fs.readFileSync(
      path.join(ROOT, '.github', 'workflows', 'ci.yml'),
      'utf8'
    );
    const job = ci.slice(ci.indexOf('\n  docker:'));
    expect(ci).toContain('\n  docker:');
    expect(job).toMatch(/docker build .*-t outlook-assistant:ci/);
    expect(job).toContain(
      'node scripts/docker-smoke.js --image outlook-assistant:ci'
    );
    expect(job.split(/\n {2}[a-z-]+:\n/)[0]).not.toContain('secrets.');
  });
});
