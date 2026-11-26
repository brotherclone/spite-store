import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { serveDev } from '../dev-serve.js';

const site = join(import.meta.dirname, '..');
const root = mkdtempSync(join(tmpdir(), 'spite-site-'));
const dirs = { piecesDir: join(root, 'pieces'), stemsDir: join(root, '.stems') };
mkdirSync(join(dirs.piecesDir, 'p'), { recursive: true });
mkdirSync(dirs.stemsDir);
const hex = 'ab'.repeat(32);
const bytes = Buffer.from([0x66, 0x4c, 0x61, 0x43, 0, 1, 2, 255]);
writeFileSync(join(dirs.stemsDir, `${hex}.flac`), bytes);
writeFileSync(join(dirs.stemsDir, `${hex}.wav`), Buffer.from('RIFF'));
const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 1, 2, 3]);
writeFileSync(join(dirs.stemsDir, `${hex}.mp3`), mp3);
writeFileSync(join(dirs.piecesDir, 'p', 'manifest.json'), '{"id":"p"}');
const frozen = Buffer.from('{\n  "id": "p"\n}\n');
writeFileSync(join(dirs.stemsDir, `${hex}.json`), frozen);
writeFileSync(join(root, 'secret.txt'), 'nope');

describe('development serving', () => {
  it('serves a stem by hash as audio/flac with its exact bytes', async () => {
    const r = await serveDev(`/stems/${hex}.flac`, dirs);
    expect(r).toMatchObject({ status: 200, type: 'audio/flac' });
    expect(Buffer.compare(r!.body as Buffer, bytes)).toBe(0);
  });

  it('answers a missing stem with 404 and the generation hint', async () => {
    const r = await serveDev(`/stems/${'cd'.repeat(32)}.flac`, dirs);
    expect(r?.status).toBe(404);
    expect(String(r!.body)).toContain('pnpm stems:placeholder');
    expect(String(r!.body)).toContain('spite pack');
  });

  it('does not serve WAV stems, even when .stems/ holds the file', async () => {
    expect((await serveDev(`/stems/${hex}.wav`, dirs))?.status).toBe(404);
    expect((await serveDev(`/stems/${'cd'.repeat(32)}.wav`, dirs))?.status).toBe(404);
  });

  it('serves a fallback recording by hash as audio/mpeg with its exact bytes', async () => {
    const r = await serveDev(`/stems/${hex}.mp3`, dirs);
    expect(r).toMatchObject({ status: 200, type: 'audio/mpeg' });
    expect(Buffer.compare(r!.body as Buffer, mp3)).toBe(0);
  });

  it('answers a missing fallback with 404 and the spite fallback hint', async () => {
    const r = await serveDev(`/stems/${'cd'.repeat(32)}.mp3`, dirs);
    expect(r?.status).toBe(404);
    expect(String(r!.body)).toContain('spite fallback');
  });

  it('serves a frozen manifest by hash as application/json with its exact bytes', async () => {
    const r = await serveDev(`/stems/${hex}.json`, dirs);
    expect(r).toMatchObject({ status: 200, type: 'application/json' });
    expect(Buffer.compare(r!.body as Buffer, frozen)).toBe(0);
  });

  it('answers a missing frozen manifest with 404 and the spite freeze hint', async () => {
    const r = await serveDev(`/stems/${'cd'.repeat(32)}.json`, dirs);
    expect(r?.status).toBe(404);
    expect(String(r!.body)).toContain('spite freeze');
  });

  it('serves pieces and rejects path traversal', async () => {
    const ok = await serveDev('/pieces/p/manifest.json', dirs);
    expect(ok).toMatchObject({ status: 200, type: 'application/json' });
    for (const path of [
      '/pieces/../secret.txt',
      '/pieces/%2e%2e/secret.txt',
      '/pieces/p/../../secret.txt',
    ]) {
      expect((await serveDev(path, dirs))?.status).toBe(403);
    }
  });

  it('ignores other paths', async () => {
    expect(await serveDev('/index.html', dirs)).toBeNull();
    expect(await serveDev('/stems/short.wav', dirs)).toBeNull();
  });
});

describe('track pages in development', () => {
  const V1 = 'a'.repeat(64);
  const pieces = mkdtempSync(join(tmpdir(), 'spite-site-dev-tracks-'));
  const trackDirs = { piecesDir: pieces, stemsDir: dirs.stemsDir };
  mkdirSync(join(pieces, 'river'));
  writeFileSync(
    join(pieces, 'river', 'manifest.json'),
    JSON.stringify({ id: 'river', title: 'The River Forgets to Answer' }),
  );
  writeFileSync(
    join(pieces, 'river', 'versions.json'),
    JSON.stringify({ versions: [{ hash: `sha256:${V1}`, label: 'v1' }] }),
  );
  const release = (title: string) =>
    JSON.stringify({
      credits: [{ name: 'A. Composer', role: 'composition' }],
      tracks: [
        {
          id: 'first-light',
          title,
          version: `sha256:${V1}`,
          seed: 'ox-bow',
          bars: 40,
          audio: `sha256:${'c'.repeat(64)}`,
          frames: 6_432_000,
        },
      ],
    });
  writeFileSync(join(pieces, 'river', 'release.json'), release('First Light'));
  const url = '/pieces/river/tracks/first-light/';

  it('serves the page as HTML, and reflects an edit to release.json on the next request', async () => {
    const first = await serveDev(url, trackDirs);
    expect(first).toMatchObject({ status: 200, type: 'text/html; charset=utf-8' });
    expect(String(first!.body)).toContain('<h1>First Light</h1>');
    writeFileSync(join(pieces, 'river', 'release.json'), release('First Light (Dawn)'));
    const second = await serveDev(url, trackDirs);
    expect(String(second!.body)).toContain('<h1>First Light (Dawn)</h1>');
    writeFileSync(join(pieces, 'river', 'release.json'), release('First Light'));
  });

  it('answers an unknown track with 404', async () => {
    expect((await serveDev('/pieces/river/tracks/nope/', trackDirs))?.status).toBe(404);
    expect((await serveDev('/pieces/elsewhere/tracks/first-light/', trackDirs))?.status).toBe(404);
  });

  it('serves the same HTML as the production build without an origin', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'spite-site-build-'));
    const saved = process.env.SPITE_PIECES_DIR;
    const savedOrigin = process.env.VITE_SITE_ORIGIN;
    process.env.SPITE_PIECES_DIR = pieces;
    delete process.env.VITE_SITE_ORIGIN;
    try {
      await build({
        root: site,
        configFile: join(site, 'vite.config.ts'),
        logLevel: 'silent',
        // Development mode, so .env.production's settings don't apply: no origin either way.
        mode: 'development',
        build: { outDir, emptyOutDir: true },
      });
    } finally {
      if (saved === undefined) delete process.env.SPITE_PIECES_DIR;
      else process.env.SPITE_PIECES_DIR = saved;
      if (savedOrigin !== undefined) process.env.VITE_SITE_ORIGIN = savedOrigin;
    }
    const built = readFileSync(join(outDir, 'pieces/river/tracks/first-light/index.html'), 'utf8');
    const served = await serveDev(url, trackDirs);
    expect(String(served!.body)).toBe(built);
  }, 120_000);
});
