import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { sha256, spite, tempDir } from './helpers.js';
import { buildWav, noiseBytes } from './wav-fixtures.js';

const zero = `sha256:${'0'.repeat(64)}`;
const BAR = 48000; // 240 BPM in 4/4

let dir: string;
let sources: string;
let manifestFile: string;
let packFile: string;

function writePiece(): void {
  dir = tempDir();
  sources = tempDir();
  manifestFile = join(dir, 'manifest.json');
  packFile = join(dir, 'pack.json');
  const manifest = {
    specVersion: '0.1',
    id: 'packed',
    title: 'Packed',
    tempo: [{ bar: 0, bpm: 240, meter: [4, 4] }],
    clips: { 'a-1': { hash: zero, lengthBars: 1 }, 'a-2': { hash: zero, lengthBars: 1 } },
    start: 's',
    sections: [
      {
        id: 's',
        lengthBars: 1,
        slots: [
          {
            id: 'a',
            pool: [
              { clip: 'a-1', weight: 1 },
              { clip: 'a-2', weight: 1 },
            ],
          },
        ],
      },
    ],
  };
  const pack = {
    sources: { a: { file: 'Take/A close.wav', sha256: zero } },
    clips: {
      'a-1': { source: 'a', startBar: 0, bars: 2 },
      'a-2': { source: 'a', startBar: 2, bars: 2 },
    },
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(packFile, JSON.stringify(pack, null, 2) + '\n');
  mkdirSync(join(sources, 'Take'));
  writeSource();
}

function writeSource(salt = 0): void {
  const wav = buildWav({
    samples: noiseBytes(5 * BAR, 3, salt),
    extensible: true,
    before: [['bext', new Uint8Array(602).fill(1)]],
  });
  writeFileSync(join(sources, 'Take', 'A close.wav'), wav);
}

const pack = (...extra: string[]) => spite('pack', manifestFile, '--source', sources, ...extra);
const clips = () => JSON.parse(readFileSync(manifestFile, 'utf8')).clips;

beforeEach(writePiece);

describe('spite pack', () => {
  it('updates hashes on purpose, then verifies with the files byte-unchanged', async () => {
    const stems = tempDir();
    const first = await pack('--stems', stems, '--update');
    expect(first.code).toBe(0);
    expect(first.stdout).toMatch(/2 stem\(s\) written/);
    const { 'a-1': a1, 'a-2': a2 } = clips();
    expect(a1.hash).not.toBe(zero);
    expect(a1.hash).not.toBe(a2.hash);
    for (const file of readdirSync(stems)) {
      expect(`${sha256(readFileSync(join(stems, file)))}.wav`).toBe(file);
    }
    expect(readdirSync(stems).sort()).toEqual(
      [a1.hash, a2.hash].map((h: string) => `${h.slice(7)}.wav`).sort(),
    );

    const before = [readFileSync(manifestFile), readFileSync(packFile)];
    const second = await pack('--stems', stems);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('all 2 clip hashes match');
    expect([readFileSync(manifestFile), readFileSync(packFile)]).toEqual(before);
  });

  it('reports a changed slice, and --update fixes it', async () => {
    await pack('--stems', tempDir(), '--update');
    const p = JSON.parse(readFileSync(packFile, 'utf8'));
    p.clips['a-2'].startBar = 3;
    writeFileSync(packFile, JSON.stringify(p, null, 2) + '\n');
    const stale = await pack('--stems', tempDir());
    expect(stale.code).toBe(1);
    expect(stale.stderr).toMatch(/^clip a-2 {2}expected sha256:[0-9a-f]{64} {2}actual sha256:/m);
    expect((await pack('--stems', tempDir(), '--update')).code).toBe(0);
    expect((await pack('--stems', tempDir())).code).toBe(0);
  });

  it('refuses a changed source without writing stems', async () => {
    await pack('--stems', tempDir(), '--update');
    writeSource(99);
    const stems = tempDir();
    const r = await pack('--stems', stems);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /^source "a" {2}Take\/A close\.wav {2}expected sha256:\S+ {2}actual sha256:/m,
    );
    expect(readdirSync(stems)).toEqual([]);
  });

  it('names a missing source and exits 2', async () => {
    const stems = tempDir();
    const r = await spite('pack', manifestFile, '--source', tempDir(), '--stems', stems);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/source "a" {2}missing \(.*Take\/A close\.wav\)/);
    expect(readdirSync(stems)).toEqual([]);
  });

  it('refuses a pack file that does not cover the catalogue', async () => {
    const p = JSON.parse(readFileSync(packFile, 'utf8'));
    delete p.clips['a-2'];
    writeFileSync(packFile, JSON.stringify(p));
    const r = await pack('--stems', tempDir());
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('clip "a-2" has no pack entry');
  });

  it('writes identical bytes on every run', async () => {
    const [x, y] = [tempDir(), tempDir()];
    await pack('--stems', x, '--update');
    await pack('--stems', y);
    const files = readdirSync(x).sort();
    expect(readdirSync(y).sort()).toEqual(files);
    for (const f of files) expect(readFileSync(join(y, f))).toEqual(readFileSync(join(x, f)));
  });

  it('needs --source', async () => {
    expect((await spite('pack', manifestFile)).code).toBe(2);
  });
});
