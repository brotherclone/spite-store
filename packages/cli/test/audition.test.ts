import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { root, spite, tempDir } from './helpers.js';

const piece = 'pieces/placeholder/manifest.json';
const GAP_BYTES = 96000 * 4; // 96,000 stereo 16-bit frames

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
});

/** PCM data of a single-seed bounce. */
async function bounceData(seed: string, bars: number): Promise<Buffer> {
  const out = join(tempDir(), 'b.wav');
  const r = await spite('bounce', piece, '--seed', seed, '--bars', String(bars), '-o', out);
  expect(r.code).toBe(0);
  return readFileSync(out).subarray(44);
}

function expectReel(reel: Buffer, parts: Buffer[]): void {
  const gap = Buffer.alloc(GAP_BYTES);
  const expected = Buffer.concat(parts.flatMap((p, i) => (i === 0 ? [p] : [gap, p])));
  expect(reel.readUInt32LE(40)).toBe(expected.length);
  expect(Buffer.compare(reel.subarray(44), expected)).toBe(0);
}

describe('spite audition', () => {
  it('renders seeds 0-3 for 16 bars, 2 seconds apart, with a summary per seed', async () => {
    const out = join(tempDir(), 'reel.wav');
    const r = await spite('audition', piece, '--no-play', '--out', out);
    expect(r.code).toBe(0);
    const seedLines = r.stdout.split('\n').filter((l) => /seed "\d"/.test(l));
    expect(seedLines.map((l) => /seed "(\d)"/.exec(l)![1])).toEqual(['0', '1', '2', '3']);
    for (const line of seedLines)
      expect(line).toMatch(/\d+:\d\d\.\d {2}seed "\d" {2}\d+ events {2}intro\(4\)/);
    expect(r.stdout).toContain(out);
    const parts = await Promise.all(['0', '1', '2', '3'].map((s) => bounceData(s, 16)));
    expectReel(readFileSync(out), parts);
  });

  it('uses the chosen seeds in order', async () => {
    const out = join(tempDir(), 'reel.wav');
    const r = await spite(
      'audition',
      piece,
      '--seed',
      'spite',
      '--seed',
      '7',
      '--bars',
      '8',
      '--no-play',
      '--out',
      out,
    );
    expect(r.code).toBe(0);
    expectReel(readFileSync(out), [await bounceData('spite', 8), await bounceData('7', 8)]);
  });

  it('rejects --seeds together with --seed', async () => {
    const r = await spite('audition', piece, '--seeds', '3', '--seed', '1', '--no-play');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });

  it('writes byte-identical reels on repeated runs, including to a temporary file', async () => {
    const a = await spite('audition', piece, '--seeds', '2', '--bars', '4', '--no-play');
    const b = await spite('audition', piece, '--seeds', '2', '--bars', '4', '--no-play');
    const path = (r: { stdout: string }) =>
      /(\S+\.wav)/.exec(r.stdout.trim().split('\n').at(-1)!)![1]!;
    expect(path(a)).toBe(path(b));
    const c = join(tempDir(), 'c.wav');
    await spite('audition', piece, '--seeds', '2', '--bars', '4', '--no-play', '--out', c);
    expect(Buffer.compare(readFileSync(path(a)), readFileSync(c))).toBe(0);
  });

  it('reports missing stems with exit 2', async () => {
    const r = await spite('audition', piece, '--no-play', '--stems', tempDir());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('missing');
  });
});
