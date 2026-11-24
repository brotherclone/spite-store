import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'vite';
import { beforeAll, describe, expect, it } from 'vitest';
import { pieceManifests } from '../vite.config.js';

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

describe('piece files from a frozen piece', () => {
  /** Runs the plugin's generateBundle over `dir`, returning the emitted files. */
  function emitted(dir: string): Map<string, Buffer> {
    const files = new Map<string, Buffer>();
    const plugin = pieceManifests(dir);
    const generate = plugin.generateBundle as unknown as (this: unknown) => void;
    generate.call({
      emitFile: (f: { fileName: string; source: Buffer }) => void files.set(f.fileName, f.source),
    });
    return files;
  }

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
    expect(Buffer.compare(files.get('pieces/frozen/versions.json')!, versions)).toBe(0);
  });

  it('emits nothing else from pieces/', () => {
    expect([...emitted(dir).keys()].sort()).toEqual([
      'pieces/frozen/manifest.json',
      'pieces/frozen/versions.json',
      'pieces/unfrozen/manifest.json',
    ]);
  });
});
