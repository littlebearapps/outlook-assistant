/**
 * export and attachment downloads: an explicit savePath file is never
 * replaced unless `overwrite: true` is passed (and never for a dotfile or a
 * symlink), and every output path must sit inside the temp directory,
 * ~/Downloads, ~/Documents or OUTLOOK_EXPORT_DIR. Graph is mocked; these
 * assert on what lands on disk.
 */
jest.mock('../../utils/graph-api');
jest.mock('../../auth');

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleExportEmail,
  handleBatchExportEmails,
} = require('../../email/export');
const { handleExportConversation } = require('../../email/conversations');
const { handleDownloadAttachment } = require('../../email/attachments');
const { callGraphAPI } = require('../../utils/graph-api');
const { ensureAuthenticated } = require('../../auth');

const itSymlink = process.platform === 'win32' ? test.skip : test;

const MESSAGE = {
  id: 'msg-1',
  subject: 'Quarterly report',
  receivedDateTime: '2023-06-15T01:26:00Z',
  from: { emailAddress: { name: 'Alice', address: 'alice@corp.com' } },
  body: { contentType: 'text', content: 'hello' },
  hasAttachments: false,
};

const ENV_KEYS = ['OUTLOOK_EXPORT_DIR'];
let savedEnv;
let scratch;
let tmp;
let home;
let outside;

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  ensureAuthenticated.mockResolvedValue('test_token');
  callGraphAPI.mockResolvedValue(MESSAGE);

  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'oa-export-overwrite-'))
  );
  tmp = path.join(scratch, 'tmp');
  home = path.join(scratch, 'home');
  outside = path.join(scratch, 'outside');
  for (const dir of [tmp, home, outside]) fs.mkdirSync(dir);
  // os reads the real environment, not Jest's copy of process.env
  jest.spyOn(os, 'tmpdir').mockReturnValue(tmp);
  jest.spyOn(os, 'homedir').mockReturnValue(home);
  delete process.env.OUTLOOK_EXPORT_DIR;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  console.error.mockRestore();
  // os is shared with other test files in this worker: always restore
  os.tmpdir.mockRestore();
  os.homedir.mockRestore();
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('export target=message with an explicit savePath file', () => {
  test('writes a new file at exactly that path', async () => {
    const target = path.join(tmp, 'report.json');
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: target,
    });

    expect(result.isError).toBeUndefined();
    expect(result._meta.filePath).toBe(target);
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).id).toBe(MESSAGE.id);
  });

  test('refuses to replace an existing file by default and leaves it untouched', async () => {
    const target = path.join(tmp, 'report.json');
    fs.writeFileSync(target, 'keep me');

    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: target,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('already exists');
    expect(result.content[0].text).toContain('overwrite');
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, 'utf8')).toBe('keep me');
    expect(fs.readdirSync(tmp)).toEqual(['report.json']);
  });

  test('replaces an existing regular file with overwrite: true', async () => {
    const target = path.join(home, 'Documents', 'report.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'old');

    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: target,
      overwrite: true,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toMatch(/replaced/i);
    expect(JSON.parse(fs.readFileSync(target, 'utf8')).id).toBe(MESSAGE.id);
  });

  test.each([
    ['a dotfile', '.profile'],
    ['a file inside a dot-directory', 'settings.json'],
  ])(
    'refuses to replace %s even with overwrite: true',
    async (_label, name) => {
      // A dotted OUTLOOK_EXPORT_DIR can be written into, but nothing in a
      // dotted path is ever replaced.
      const base = path.join(outside, '.archive');
      process.env.OUTLOOK_EXPORT_DIR = base;
      const target = path.join(base, name);
      fs.mkdirSync(base, { recursive: true });
      fs.writeFileSync(target, 'keep me');

      const result = await handleExportEmail({
        id: MESSAGE.id,
        format: 'json',
        savePath: target,
        overwrite: true,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/dot/);
      expect(fs.readFileSync(target, 'utf8')).toBe('keep me');
    }
  );

  test('refuses a new dotfile below an allowed directory', async () => {
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: path.join(home, 'Documents', 'project', '.git', 'config'),
    });

    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(home, 'Documents', 'project'))).toBe(false);
  });

  itSymlink(
    'refuses to replace a symlink even with overwrite: true',
    async () => {
      const victim = path.join(outside, 'victim.txt');
      fs.writeFileSync(victim, 'keep me');
      const link = path.join(tmp, 'report.json');
      fs.symlinkSync(victim, link);

      const result = await handleExportEmail({
        id: MESSAGE.id,
        format: 'json',
        savePath: link,
        overwrite: true,
      });

      expect(result.isError).toBe(true);
      expect(fs.readFileSync(victim, 'utf8')).toBe('keep me');
    }
  );

  // The link and the file it points to are both inside an allowed
  // directory, so only the symlink rule can refuse this.
  describe('a savePath that is a symlink to a file inside an allowed directory', () => {
    let victim;
    let link;
    beforeEach(() => {
      if (process.platform === 'win32') return;
      victim = path.join(home, 'Documents', 'notes.txt');
      fs.mkdirSync(path.dirname(victim), { recursive: true });
      fs.writeFileSync(victim, 'keep me');
      link = path.join(tmp, 'report.json');
      fs.symlinkSync(victim, link);
    });

    itSymlink(
      'is refused without overwrite, naming the given path',
      async () => {
        const result = await handleExportEmail({
          id: MESSAGE.id,
          format: 'json',
          savePath: link,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain(`already exists: ${link}`);
        expect(result.content[0].text).not.toContain(victim);
        expect(callGraphAPI).not.toHaveBeenCalled();
        expect(fs.readFileSync(victim, 'utf8')).toBe('keep me');
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      }
    );

    itSymlink(
      'is refused with overwrite: true, naming the given path',
      async () => {
        const result = await handleExportEmail({
          id: MESSAGE.id,
          format: 'json',
          savePath: link,
          overwrite: true,
        });

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toMatch(/symbolic link/);
        expect(result.content[0].text).toContain(link);
        expect(result.content[0].text).not.toContain(victim);
        expect(fs.readFileSync(victim, 'utf8')).toBe('keep me');
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      }
    );
  });

  itSymlink(
    'a savePath symlink to a directory is still used as that directory',
    async () => {
      const realDir = path.join(tmp, 'real');
      fs.mkdirSync(realDir);
      fs.symlinkSync(realDir, path.join(tmp, 'alias'));

      const result = await handleExportEmail({
        id: MESSAGE.id,
        format: 'json',
        savePath: path.join(tmp, 'alias'),
      });

      expect(result.isError).toBeUndefined();
      expect(path.dirname(result._meta.filePath)).toBe(realDir);
    }
  );

  itSymlink(
    'names the given path when the file exists behind a symlinked folder',
    async () => {
      fs.mkdirSync(path.join(tmp, 'real'));
      fs.writeFileSync(path.join(tmp, 'real', 'report.json'), 'keep me');
      fs.symlinkSync(path.join(tmp, 'real'), path.join(tmp, 'alias'));
      const given = path.join(tmp, 'alias', 'report.json');

      const result = await handleExportEmail({
        id: MESSAGE.id,
        format: 'json',
        savePath: given,
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(`already exists: ${given}`);
    }
  );

  test('refuses a savePath outside the allowed directories before calling Graph', async () => {
    const target = path.join(outside, 'report.json');

    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: target,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OUTLOOK_EXPORT_DIR');
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.existsSync(target)).toBe(false);
  });

  test('allows a savePath inside OUTLOOK_EXPORT_DIR', async () => {
    process.env.OUTLOOK_EXPORT_DIR = outside;
    const target = path.join(outside, 'sub', 'report.json');

    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: target,
    });

    expect(result.isError).toBeUndefined();
    expect(fs.existsSync(target)).toBe(true);
  });

  test('refuses a savePath that climbs out with ..', async () => {
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: path.join(tmp, '..', 'outside', 'report.json'),
    });

    expect(result.isError).toBe(true);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  itSymlink('refuses a savePath through a symlinked directory', async () => {
    fs.symlinkSync(outside, path.join(tmp, 'link'));

    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: path.join(tmp, 'link', 'report.json'),
    });

    expect(result.isError).toBe(true);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('caller paths must be absolute or start with ~', () => {
  // Run from inside the temp base, so a relative path resolved against the
  // working directory would have been accepted.
  async function fromTmp(fn) {
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      return await fn();
    } finally {
      process.chdir(cwd);
    }
  }

  test('export savePath "~/Downloads/r.md" writes into the home Downloads folder', async () => {
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      savePath: '~/Downloads/r.md',
    });

    expect(result.isError).toBeUndefined();
    const target = path.join(home, 'Downloads', 'r.md');
    expect(result._meta.filePath).toBe(target);
    expect(fs.existsSync(target)).toBe(true);
  });

  test('export refuses a relative savePath before calling Graph', async () => {
    const result = await fromTmp(() =>
      handleExportEmail({
        id: MESSAGE.id,
        format: 'json',
        savePath: 'report.json',
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/must be absolute/);
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  test('target=messages refuses a relative outputDir', async () => {
    const result = await fromTmp(() =>
      handleBatchExportEmails({
        target: 'messages',
        emailIds: [MESSAGE.id],
        format: 'json',
        outputDir: 'exports',
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/must be absolute/);
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  test('target=conversation refuses a relative outputDir', async () => {
    const result = await fromTmp(() =>
      handleExportConversation({
        conversationId: 'conv-1',
        outputDir: 'exports',
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/must be absolute/);
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  test('attachments refuses a relative outputDir', async () => {
    const result = await fromTmp(() =>
      handleDownloadAttachment({
        messageId: 'm1',
        attachmentId: 'a1',
        outputDir: 'downloads',
      })
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/must be absolute/);
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  test('attachments expands a leading ~ in outputDir', async () => {
    callGraphAPI.mockResolvedValue({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBytes: Buffer.from('pdf').toString('base64'),
    });
    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir: '~/Downloads',
    });
    expect(result.isError).toBeUndefined();
    expect(fs.existsSync(path.join(home, 'Downloads', 'invoice.pdf'))).toBe(
      true
    );
  });
});

describe('export output directories are confined', () => {
  test('target=message with no savePath still writes to the temp directory', async () => {
    const result = await handleExportEmail({ id: MESSAGE.id, format: 'json' });

    expect(result.isError).toBeUndefined();
    expect(path.dirname(result._meta.filePath)).toBe(tmp);
  });

  test('target=message treats outputDir as a directory, even a new one', async () => {
    const dir = path.join(tmp, 'new-dir');
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: dir,
    });

    expect(result.isError).toBeUndefined();
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(path.dirname(result._meta.filePath)).toBe(dir);
  });

  test('target=message refuses an outputDir outside the allowed directories', async () => {
    const result = await handleExportEmail({
      id: MESSAGE.id,
      format: 'json',
      outputDir: outside,
    });

    expect(result.isError).toBe(true);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('target=messages refuses an outputDir outside, without creating it', async () => {
    const dir = path.join(outside, 'batch');
    const result = await handleBatchExportEmails({
      emailIds: [MESSAGE.id],
      format: 'json',
      outputDir: dir,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('OUTLOOK_EXPORT_DIR');
    expect(fs.existsSync(dir)).toBe(false);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  test('target=messages writes inside ~/Downloads', async () => {
    const dir = path.join(home, 'Downloads', 'mail');
    const result = await handleBatchExportEmails({
      emailIds: [MESSAGE.id],
      format: 'json',
      outputDir: dir,
    });

    expect(result.isError).toBeUndefined();
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  test('target=conversation refuses an outputDir outside, without creating it', async () => {
    const dir = path.join(outside, 'thread');
    const result = await handleExportConversation({
      conversationId: 'c1',
      format: 'markdown',
      outputDir: dir,
    });

    expect(result.isError).toBe(true);
    expect(fs.existsSync(dir)).toBe(false);
    expect(callGraphAPI).not.toHaveBeenCalled();
  });

  itSymlink(
    'target=conversation refuses an outputDir through a symlink',
    async () => {
      fs.symlinkSync(outside, path.join(tmp, 'link'));
      const result = await handleExportConversation({
        conversationId: 'c1',
        format: 'markdown',
        outputDir: path.join(tmp, 'link'),
      });

      expect(result.isError).toBe(true);
      expect(fs.readdirSync(outside)).toEqual([]);
    }
  );
});

describe('attachments download output directory is confined', () => {
  const fileAttachment = {
    '@odata.type': '#microsoft.graph.fileAttachment',
    name: 'invoice.pdf',
    contentType: 'application/pdf',
    contentBytes: Buffer.from('pdf').toString('base64'),
  };

  test('downloads to the temp directory by default', async () => {
    callGraphAPI.mockResolvedValue(fileAttachment);
    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
    });

    expect(result.isError).toBeUndefined();
    expect(fs.existsSync(path.join(tmp, 'invoice.pdf'))).toBe(true);
  });

  test('downloads into OUTLOOK_EXPORT_DIR', async () => {
    process.env.OUTLOOK_EXPORT_DIR = outside;
    callGraphAPI.mockResolvedValue(fileAttachment);
    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir: path.join(outside, 'att'),
    });

    expect(result.isError).toBeUndefined();
    expect(fs.existsSync(path.join(outside, 'att', 'invoice.pdf'))).toBe(true);
  });

  test.each([
    ['outside every allowed directory', () => path.join(outside, 'att')],
    ['climbing out with ..', () => path.join(tmp, '..', 'outside')],
    ['in a dot-directory', () => path.join(home, 'Documents', '.vscode')],
  ])('refuses an outputDir %s before calling Graph', async (_label, dirFn) => {
    callGraphAPI.mockResolvedValue(fileAttachment);
    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir: dirFn(),
    });

    expect(result.isError).toBe(true);
    expect(callGraphAPI).not.toHaveBeenCalled();
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  itSymlink('refuses an outputDir through a symlinked directory', async () => {
    callGraphAPI.mockResolvedValue(fileAttachment);
    fs.symlinkSync(outside, path.join(tmp, 'link'));

    const result = await handleDownloadAttachment({
      messageId: 'm1',
      attachmentId: 'a1',
      outputDir: path.join(tmp, 'link'),
    });

    expect(result.isError).toBe(true);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});

describe('export tool definition', () => {
  const { emailTools } = require('../../email');
  const exportTool = emailTools.find((t) => t.name === 'export');

  test('has an overwrite boolean, off by default', () => {
    const prop = exportTool.inputSchema.properties.overwrite;
    expect(prop.type).toBe('boolean');
    expect(prop.description).toMatch(/default: false/);
  });

  test('is marked destructive, since it can replace a file', () => {
    expect(exportTool.annotations.destructiveHint).toBe(true);
    expect(exportTool.annotations.readOnlyHint).toBe(false);
  });

  test('description stays within 1,024 characters', () => {
    expect(exportTool.description.length).toBeLessThanOrEqual(1024);
  });
});
