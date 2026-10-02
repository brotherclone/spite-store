import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { root, sha256, spite, tempDir } from './helpers.js';

const piece = 'pieces/placeholder/manifest.json';

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
});

describe('spite bounce', () => {
  it('renders the golden audio for seed 42, reading stems from .stems/ by default', async () => {
    const out = join(tempDir(), 'out.wav');
    const r = await spite('bounce', piece, '--seed', '42', '--bars', '16', '-o', out);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/out\.wav {2}\d+\.\d\d s {2}\d+ events/);
    const golden = JSON.parse(
      readFileSync(join(root, 'fixtures/golden/placeholder.audio.42.json'), 'utf8'),
    );
    expect(sha256(readFileSync(out))).toBe(golden.wavSha256);
  });

  it('names missing stems and writes nothing', async () => {
    const out = join(tempDir(), 'out.wav');
    const r = await spite(
      'bounce',
      piece,
      '--seed',
      '1',
      '--bars',
      '16',
      '-o',
      out,
      '--stems',
      tempDir(),
    );
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/stem count {2}sha256:[0-9a-f]{64} {2}missing/);
    expect(existsSync(out)).toBe(false);
  });

  it('exits 1 on an invalid manifest', async () => {
    const out = join(tempDir(), 'out.wav');
    const r = await spite(
      'bounce',
      'schema/examples/invalid/dangling-transition.json',
      '--seed',
      '1',
      '-o',
      out,
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('/sections/2/next/1/to');
    expect(existsSync(out)).toBe(false);
  });

  it.each([
    ['no seed', ['-o', 'x.wav']],
    ['no output', ['--seed', '1']],
    ['zero bars', ['--seed', '1', '--bars', '0', '-o', 'x.wav']],
    ['unknown flag', ['--seed', '1', '-o', 'x.wav', '--loud']],
  ])('prints usage and exits 2 with %s', async (_, args) => {
    const r = await spite('bounce', piece, ...args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });
});
