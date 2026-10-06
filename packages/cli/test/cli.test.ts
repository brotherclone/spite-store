import { readdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, spite } from './helpers.js';

const examples = 'schema/examples';

describe('spite validate', () => {
  it('accepts the minimal manifest', async () => {
    const r = await spite('validate', `${examples}/valid/minimal.json`);
    expect(r).toMatchObject({ code: 0 });
    expect(r.stdout).toContain(`${examples}/valid/minimal.json  valid`);
  });

  it('reports a dangling transition with file, pointer and message', async () => {
    const file = `${examples}/invalid/dangling-transition.json`;
    const r = await spite('validate', file);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain(
      `${file}  /sections/2/next/1/to  section "bridge" transitions to unknown section "coda"`,
    );
  });

  it('exits 2 for a file that is not JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'spite-'));
    const file = join(dir, 'broken.json');
    writeFileSync(file, '{ not json');
    const r = await spite('validate', file);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(file);
  });

  it('exits 2 for a missing file', async () => {
    const r = await spite('validate', 'nope/missing.json');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('nope/missing.json  error: no such file');
  });

  it('prints usage and exits 2 with no files', async () => {
    const r = await spite('validate');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });

  it('exits 1 when any of several files is invalid', async () => {
    const r = await spite(
      'validate',
      `${examples}/valid/minimal.json`,
      `${examples}/invalid/unknown-start-section.json`,
    );
    expect(r.code).toBe(1);
  });

  it.each(readdirSync(join(root, examples, 'valid')))('valid/%s exits 0', async (file) => {
    expect((await spite('validate', `${examples}/valid/${file}`)).code).toBe(0);
  });

  it.each(readdirSync(join(root, examples, 'invalid')))('invalid/%s exits 1', async (file) => {
    const r = await spite('validate', `${examples}/invalid/${file}`);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^${examples}/invalid/${file}  \\S+  .+`, 'm'));
  });
});

describe('spite usage', () => {
  it('lists pack in the help', async () => {
    const r = await spite('--help');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('pack <manifest.json> --source <dir>');
  });

  it('rejects unknown commands', async () => {
    expect((await spite('frobnicate')).code).toBe(2);
    expect((await spite()).code).toBe(2);
  });
});
