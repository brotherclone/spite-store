import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { serveDev } from '../dev-serve.js';

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
