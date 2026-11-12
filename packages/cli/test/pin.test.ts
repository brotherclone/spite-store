import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENGINE_FORMATS } from '@spite-store/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { root, spite, tempDir } from './helpers.js';

const placeholder = join(root, 'pieces/placeholder/manifest.json');

/** Trace 99 is newer than any engine this test runs against. */
const NEWER = { trace: 99, render: ENGINE_FORMATS.render };

/** Writes a copy of the placeholder manifest with `engine` set as given (removed when undefined). */
function copy(engine?: unknown, text?: (json: string) => string): string {
  const m = JSON.parse(readFileSync(placeholder, 'utf8'));
  delete m.engine;
  if (engine !== undefined) m.engine = engine;
  const file = join(tempDir(), 'manifest.json');
  const json = JSON.stringify(m, null, 2) + '\n';
  writeFileSync(file, text ? text(json) : json);
  return file;
}

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
});

describe('commands refuse a mismatched pin', () => {
  it.each([
    ['realize', (f: string) => ['realize', f, '--seed', '1']],
    ['bounce', (f: string, out: string) => ['bounce', f, '--seed', '1', '-o', out]],
    ['audition', (f: string, out: string) => ['audition', f, '--no-play', '-o', out]],
  ])('%s exits 1, names both formats and writes nothing', async (_, args) => {
    const out = join(tempDir(), 'out.wav');
    const r = await spite(...args(copy(NEWER), out));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(
      `/engine/trace  trace format 99, this engine has ${ENGINE_FORMATS.trace}`,
    );
    expect(r.stderr).toContain('made with a newer engine');
    expect(r.stderr).toContain('--ignore-pin');
    expect(r.stdout).toBe('');
    expect(existsSync(out)).toBe(false);
  });

  it('plays an unpinned manifest with no warning', async () => {
    const out = join(tempDir(), 'out.wav');
    const r = await spite('bounce', copy(), '--seed', '42', '--bars', '16', '-o', out);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    expect(existsSync(out)).toBe(true);
  });

  it('bounce --ignore-pin warns and writes the WAV', async () => {
    const out = join(tempDir(), 'out.wav');
    const r = await spite(
      'bounce',
      copy(NEWER),
      '--seed',
      '42',
      '--bars',
      '16',
      '-o',
      out,
      '--ignore-pin',
    );
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/^warning: .*trace format 99/m);
    expect(existsSync(out)).toBe(true);
  });

  it('--ignore-pin changes nothing for a compatible manifest', async () => {
    const file = copy({ ...ENGINE_FORMATS });
    const plain = await spite('realize', file, '--seed', '42', '--json');
    const ignored = await spite('realize', file, '--seed', '42', '--json', '--ignore-pin');
    expect(plain.code).toBe(0);
    expect(ignored.stdout).toBe(plain.stdout);
    expect(plain.stderr + ignored.stderr).toBe('');
  });
});

describe('spite fallback refuses a mismatched pin', () => {
  it('writes no MP3, leaves the manifest unchanged and exits 1', async () => {
    const file = copy(NEWER);
    const before = readFileSync(file, 'utf8');
    const stems = tempDir();
    const r = await spite('fallback', file, '--seed', '1', '--stems', stems, '--update');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('trace format 99');
    expect(r.stderr).not.toContain('--ignore-pin');
    expect(readdirSync(stems)).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('does not accept --ignore-pin', async () => {
    const r = await spite('fallback', copy(NEWER), '--seed', '1', '--ignore-pin');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });
});

describe('spite pin', () => {
  it('exits 0 for a manifest pinned to the current formats', async () => {
    const file = copy({ ...ENGINE_FORMATS });
    const before = readFileSync(file, 'utf8');
    const r = await spite('pin', file);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('(current)');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('exits 1 for an unpinned manifest and leaves it alone', async () => {
    const file = copy();
    const before = readFileSync(file, 'utf8');
    const r = await spite('pin', file);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('not pinned');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('exits 1 for a mismatched pin, printing both formats', async () => {
    const file = copy(NEWER);
    const before = readFileSync(file, 'utf8');
    const r = await spite('pin', file);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`trace format 99, this engine has ${ENGINE_FORMATS.trace}`);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('exits 1 on an invalid manifest, printing the pointer', async () => {
    const r = await spite('pin', 'schema/examples/invalid/dangling-transition.json');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('/sections/2/next/1/to');
  });

  it('--update pins an unpinned manifest after specVersion and changes nothing else', async () => {
    const file = copy();
    const before = JSON.parse(readFileSync(file, 'utf8'));
    const r = await spite('pin', file, '--update');
    expect(r.code, r.stderr).toBe(0);
    expect(r.stderr).toBe('');
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(after.engine).toEqual(ENGINE_FORMATS);
    const keys = Object.keys(after);
    expect(keys[keys.indexOf('specVersion') + 1]).toBe('engine');
    delete after.engine;
    expect(after).toEqual(before);
    expect((await spite('validate', file)).code).toBe(0);
    expect((await spite('pin', file)).code).toBe(0);
  });

  it('--update keeps the formatting of every other field', async () => {
    // The committed placeholder keeps small objects on one line; pinning must not reflow them.
    const committed = readFileSync(placeholder, 'utf8');
    const unpinned = committed.replace(/^ *"engine": .*\n/m, '');
    expect(unpinned).not.toBe(committed);
    const dir = tempDir();
    copyFileSync(join(root, '.prettierrc'), join(dir, '.prettierrc')); // the repo's print width
    const file = join(dir, 'manifest.json');
    writeFileSync(file, unpinned);
    const r = await spite('pin', file, '--update');
    expect(r.code, r.stderr).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(committed);
  });

  it('--update re-pins with a warning about existing links', async () => {
    const file = copy(NEWER);
    const r = await spite('pin', file, '--update');
    expect(r.code).toBe(0);
    expect(r.stderr).toMatch(/^warning: .*re-pinned from trace 99.*different performance/m);
    expect(JSON.parse(readFileSync(file, 'utf8')).engine).toEqual(ENGINE_FORMATS);
  });

  it('--update leaves an already current manifest byte-identical', async () => {
    // Deliberately unformatted, so a rewrite would show.
    const file = copy({ ...ENGINE_FORMATS }, (json) => json.replace('\n', '\n\n'));
    const before = readFileSync(file, 'utf8');
    const r = await spite('pin', file, '--update');
    expect(r.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it.each([
    ['no manifest', ['pin']],
    ['two manifests', ['pin', placeholder, placeholder]],
    ['an unknown flag', ['pin', placeholder, '--nope']],
  ])('prints usage and exits 2 with %s', async (_, args) => {
    const r = await spite(...args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });
});
