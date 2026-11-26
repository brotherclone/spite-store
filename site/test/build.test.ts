import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { pieceFiles } from '../vite.config.js';

const site = join(import.meta.dirname, '..');
const repo = join(site, '..');
const AUDIO = /\.(wav|aif|aiff|flac|mp3|ogg|opus|m4a)$/i;

/** Every file under `dir`, as paths relative to it. */
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)))
    .sort();
}

const pieces = readdirSync(join(repo, 'pieces'), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((id) => {
    try {
      readFileSync(join(repo, 'pieces', id, 'manifest.json'));
      return true;
    } catch {
      return false;
    }
  });

let out: string;
beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'spite-site-build-'));
  await build({
    root: site,
    configFile: join(site, 'vite.config.ts'),
    logLevel: 'silent',
    build: { outDir: out, emptyOutDir: true },
  });
}, 120_000);

describe('production build', () => {
  it('emits every piece manifest byte for byte', () => {
    expect(pieces).toEqual(expect.arrayContaining(['placeholder', 'the-river-forgets-to-answer']));
    for (const id of pieces) {
      const built = readFileSync(join(out, 'pieces', id, 'manifest.json'));
      const source = readFileSync(join(repo, 'pieces', id, 'manifest.json'));
      expect(Buffer.compare(built, source), id).toBe(0);
    }
  });

  it('emits nothing else from pieces/', () => {
    const files = walk(join(out, 'pieces'));
    expect(files).toEqual(pieces.map((id) => join(id, 'manifest.json')).sort());
    expect(walk(out).filter((f) => AUDIO.test(f))).toEqual([]);
  });

  it('opens on The River Forgets to Answer by default', () => {
    const js = walk(out)
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(out, f), 'utf8'))
      .join('\n');
    expect(js.includes('the-river-forgets-to-answer'), 'default piece in the built JS').toBe(true);
  });
});

/** Runs the plugin's generateBundle over `dir`, returning the emitted files. */
function emitted(dir: string, origin?: string): Map<string, Buffer | string> {
  const files = new Map<string, Buffer | string>();
  const plugin = pieceFiles(dir, origin);
  const generate = plugin.generateBundle as unknown as (this: unknown) => void;
  generate.call({
    emitFile: (f: { fileName: string; source: Buffer | string }) =>
      void files.set(f.fileName, f.source),
    error: (message: string) => {
      throw new Error(message);
    },
  });
  return files;
}

describe('piece files from a frozen piece', () => {
  /** Runs the plugin's generateBundle over `dir`, returning the emitted files. */

  const dir = mkdtempSync(join(tmpdir(), 'spite-site-pieces-'));
  const manifest = Buffer.from('{ "id": "frozen" }\n');
  const versions = Buffer.from(
    `{\n  "versions": [{ "hash": "sha256:${'a'.repeat(64)}", "label": "v1" }]\n}\n`,
  );
  for (const id of ['frozen', 'unfrozen']) mkdirSync(join(dir, id));
  writeFileSync(join(dir, 'frozen', 'manifest.json'), manifest);
  writeFileSync(join(dir, 'frozen', 'versions.json'), versions);
  writeFileSync(join(dir, 'frozen', 'README.md'), '# notes');
  writeFileSync(join(dir, 'frozen', 'pack.json'), '{}');
  writeFileSync(join(dir, 'unfrozen', 'manifest.json'), manifest);

  it('emits the version list byte for byte', () => {
    const files = emitted(dir);
    expect(Buffer.compare(files.get('pieces/frozen/versions.json') as Buffer, versions)).toBe(0);
  });

  it('emits nothing else from pieces/', () => {
    expect([...emitted(dir).keys()].sort()).toEqual([
      'pieces/frozen/manifest.json',
      'pieces/frozen/versions.json',
      'pieces/unfrozen/manifest.json',
    ]);
  });
});

describe('track pages', () => {
  const V1 = 'a'.repeat(64);
  const track = (id: string, audio: string) => ({
    id,
    title: id === 'eddy' ? 'Eddy' : 'First Light',
    version: `sha256:${V1}`,
    seed: id,
    bars: 40,
    audio: `sha256:${audio}`,
    frames: 6_432_000,
  });
  /** A temp pieces dir with one frozen piece whose release.json is `release`. */
  function piecesWith(release: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'spite-site-tracks-'));
    mkdirSync(join(dir, 'river'));
    writeFileSync(
      join(dir, 'river', 'manifest.json'),
      JSON.stringify({ id: 'river', title: 'The River Forgets to Answer' }),
    );
    writeFileSync(
      join(dir, 'river', 'versions.json'),
      JSON.stringify({ versions: [{ hash: `sha256:${V1}`, label: 'v1' }] }),
    );
    writeFileSync(join(dir, 'river', 'release.json'), JSON.stringify(release));
    return dir;
  }
  const release = {
    credits: [{ name: 'A. Composer', role: 'composition' }],
    tracks: [track('first-light', 'c'.repeat(64)), track('eddy', 'd'.repeat(64))],
  };

  it('emits a page per track and nothing else under tracks/', () => {
    const files = emitted(piecesWith(release));
    expect([...files.keys()].filter((f) => f.includes('/tracks/')).sort()).toEqual([
      'pieces/river/tracks/eddy/index.html',
      'pieces/river/tracks/first-light/index.html',
    ]);
    const page = String(files.get('pieces/river/tracks/first-light/index.html'));
    expect(page).toContain('<h1>First Light</h1>');
    expect(page).toContain('The River Forgets to Answer');
    expect(page).toContain('A. Composer');
  });

  it('never emits release.json', () => {
    expect([...emitted(piecesWith(release)).keys()].sort()).toEqual([
      'pieces/river/manifest.json',
      'pieces/river/tracks/eddy/index.html',
      'pieces/river/tracks/first-light/index.html',
      'pieces/river/versions.json',
    ]);
  });

  it('fails on a duplicate track id, naming the file and the id', () => {
    const dir = piecesWith({
      tracks: [track('first-light', 'c'.repeat(64)), track('first-light', 'd'.repeat(64))],
    });
    expect(() => emitted(dir)).toThrow(join(dir, 'river', 'release.json'));
    expect(() => emitted(dir)).toThrow('"first-light"');
  });

  it('fails on a track whose version is not recorded', () => {
    const dir = piecesWith({
      tracks: [{ ...track('eddy', 'd'.repeat(64)), version: `sha256:${'e'.repeat(64)}` }],
    });
    expect(() => emitted(dir)).toThrow("isn't a recorded version");
  });

  it('leaves out og:url without an origin', () => {
    const page = String(emitted(piecesWith(release)).get('pieces/river/tracks/eddy/index.html'));
    expect(page).not.toContain('og:url');
  });

  it('uses VITE_SITE_ORIGIN in a production build', async () => {
    const dir = piecesWith(release);
    const outDir = mkdtempSync(join(tmpdir(), 'spite-site-build-'));
    const saved = { origin: process.env.VITE_SITE_ORIGIN, pieces: process.env.SPITE_PIECES_DIR };
    process.env.VITE_SITE_ORIGIN = 'https://example.test';
    process.env.SPITE_PIECES_DIR = dir;
    try {
      await build({
        root: site,
        configFile: join(site, 'vite.config.ts'),
        logLevel: 'silent',
        build: { outDir, emptyOutDir: true },
      });
    } finally {
      for (const [key, value] of [
        ['VITE_SITE_ORIGIN', saved.origin],
        ['SPITE_PIECES_DIR', saved.pieces],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    for (const id of ['first-light', 'eddy']) {
      const page = readFileSync(join(outDir, 'pieces/river/tracks', id, 'index.html'), 'utf8');
      const url = /<meta property="og:url" content="([^"]*)"/.exec(page)?.[1];
      expect(url).toBe(`https://example.test/pieces/river/tracks/${id}/`);
    }
  }, 120_000);
});
