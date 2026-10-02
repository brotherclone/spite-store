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
const bytes = Buffer.from([82, 73, 70, 70, 0, 1, 2, 255]);
writeFileSync(join(dirs.stemsDir, `${hex}.wav`), bytes);
writeFileSync(join(dirs.piecesDir, 'p', 'manifest.json'), '{"id":"p"}');
writeFileSync(join(root, 'secret.txt'), 'nope');

describe('development serving', () => {
  it('serves a stem by hash with its exact bytes', async () => {
    const r = await serveDev(`/stems/${hex}.wav`, dirs);
    expect(r?.status).toBe(200);
    expect(Buffer.compare(r!.body as Buffer, bytes)).toBe(0);
  });

  it('answers a missing stem with 404 and the generation hint', async () => {
    const r = await serveDev(`/stems/${'cd'.repeat(32)}.wav`, dirs);
    expect(r?.status).toBe(404);
    expect(String(r!.body)).toContain('pnpm stems:placeholder');
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
