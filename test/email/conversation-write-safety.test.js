/**
 * `export target=conversation` must write like every other export (#258): an
 * existing file or a planted symlink at the target name is never overwritten
 * or followed — the export gets a `-1` name instead and the original is left
 * untouched. Mirrors test/email/export-collision.test.js.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleExportConversation } = require('../../email/conversations');
const { callGraphAPI, callGraphAPIRaw } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const itSymlink = process.platform === 'win32' ? test.skip : test;
const BASE = '2026-09-30_Hello_conversation';

let scratchDir;
let outputDir;

function exportAs(format) {
  return handleExportConversation({
    conversationId: 'c1',
    format,
    outputDir,
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('test_token');
  callGraphAPI.mockResolvedValue({
    value: [
      {
        id: 'm1',
        subject: 'Hello',
        from: { emailAddress: { name: 'Sam', address: 'sam@example.com' } },
        toRecipients: [{ emailAddress: { address: 'me@example.com' } }],
        receivedDateTime: '2026-09-30T00:00:00Z',
        body: { contentType: 'text', content: 'hi there' },
      },
    ],
  });
  callGraphAPIRaw.mockResolvedValue('Subject: Hello\r\n\r\nhi there\r\n');
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-conv-write-'));
  outputDir = path.join(scratchDir, 'out');
  fs.mkdirSync(outputDir);
});

afterEach(() => {
  console.error.mockRestore();
  fs.rmSync(scratchDir, { recursive: true, force: true });
});

describe('conversation export — safe writes', () => {
  const singleFile = [
    ['markdown', 'md'],
    ['json', 'json'],
    ['html', 'html'],
    ['csv', 'csv'],
    ['mbox', 'mbox'],
  ];

  test.each(singleFile)(
    'does not overwrite an existing %s file',
    async (format, ext) => {
      const existing = path.join(outputDir, `${BASE}.${ext}`);
      fs.writeFileSync(existing, 'do not clobber me', 'utf8');

      const result = await exportAs(format);

      expect(fs.readFileSync(existing, 'utf8')).toBe('do not clobber me');
      expect(result._meta.files).toEqual([
        path.join(outputDir, `${BASE}-1.${ext}`),
      ]);
      expect(fs.readFileSync(result._meta.files[0], 'utf8')).not.toBe(
        'do not clobber me'
      );
    }
  );

  itSymlink.each(singleFile)(
    'does not follow a dangling symlink at the %s target',
    async (format, ext) => {
      const victim = path.join(scratchDir, 'victim.txt');
      const link = path.join(outputDir, `${BASE}.${ext}`);
      fs.symlinkSync(victim, link);

      const result = await exportAs(format);

      expect(fs.existsSync(victim)).toBe(false);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(result._meta.files).toEqual([
        path.join(outputDir, `${BASE}-1.${ext}`),
      ]);
    }
  );

  test('a second export of the same conversation gets a -1 name', async () => {
    const first = await exportAs('markdown');
    const firstContent = fs.readFileSync(first._meta.files[0], 'utf8');
    const second = await exportAs('markdown');

    expect(first._meta.files).toEqual([path.join(outputDir, `${BASE}.md`)]);
    expect(second._meta.files).toEqual([path.join(outputDir, `${BASE}-1.md`)]);
    expect(fs.readFileSync(first._meta.files[0], 'utf8')).toBe(firstContent);
  });

  test('eml export never writes into an existing directory', async () => {
    const existingDir = path.join(outputDir, BASE);
    fs.mkdirSync(existingDir);
    const decoy = path.join(existingDir, '1_2026-09-30_Sam.eml');
    fs.writeFileSync(decoy, 'do not clobber me', 'utf8');

    const result = await exportAs('eml');

    expect(fs.readFileSync(decoy, 'utf8')).toBe('do not clobber me');
    expect(fs.readdirSync(existingDir)).toEqual(['1_2026-09-30_Sam.eml']);
    expect(result._meta.files).toEqual([
      path.join(outputDir, `${BASE}-1`, '1_2026-09-30_Sam.eml'),
    ]);
  });

  itSymlink(
    'eml export does not follow a symlinked directory out of outputDir',
    async () => {
      const elsewhere = path.join(scratchDir, 'elsewhere');
      fs.mkdirSync(elsewhere);
      fs.symlinkSync(elsewhere, path.join(outputDir, BASE));

      const result = await exportAs('eml');

      expect(fs.readdirSync(elsewhere)).toEqual([]);
      expect(path.dirname(path.dirname(result._meta.files[0]))).toBe(outputDir);
    }
  );
});
