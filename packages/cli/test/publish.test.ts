import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { publishCommand } from '../src/commands/publish.js';
import type { StemStore } from '../src/publish.js';
import { root, sha256, spite, tempDir } from './helpers.js';

const river = join(root, 'pieces/the-river-forgets-to-answer/manifest.json');
const placeholder = join(root, 'pieces/placeholder/manifest.json');

type Clips = Record<string, { hash: string }>;
const clipsOf = (file: string) => JSON.parse(readFileSync(file, 'utf8')).clips as Clips;
const hex = (hash: string) => hash.slice('sha256:'.length);

/** Copies a manifest's stems from .stems/ into `dir`. */
function copyStems(manifest: string, dir: string) {
  for (const { hash } of Object.values(clipsOf(manifest))) {
    copyFileSync(join(root, '.stems', `${hex(hash)}.wav`), join(dir, `${hex(hash)}.wav`));
  }
}

/**
 * A copy of the River's manifest whose clips and fallback point at stand-in files written to `dir`,
 * so the test needs none of the real recordings.
 */
function riverWithFallback(dir: string): string {
  const write = (bytes: Buffer, ext: string) => {
    const hash = `sha256:${sha256(bytes)}`;
    writeFileSync(join(dir, `${hex(hash)}.${ext}`), bytes);
    return hash;
  };
  const manifest = JSON.parse(readFileSync(river, 'utf8'));
  for (const id of Object.keys(manifest.clips)) {
    manifest.clips[id].hash = write(Buffer.from(`stand-in stem ${id}`), 'wav');
  }
  manifest.fallback = {
    hash: write(Buffer.from('stand-in fallback'), 'mp3'),
    type: 'audio/mpeg',
    seed: 'spite-store',
    bars: 64,
  };
  const file = join(tempDir(), 'manifest.json');
  writeFileSync(file, JSON.stringify(manifest));
  return file;
}

/** An in-memory store that records every put. */
function memoryStore(initial: string[] = []) {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  for (const name of initial) files.set(name, { bytes: new Uint8Array(), contentType: '' });
  const puts: string[] = [];
  const store: StemStore = {
    has: async (name) => files.has(name),
    put: async (name, bytes, contentType) => {
      if (files.has(name)) throw new Error(`${name} already exists`);
      puts.push(name);
      files.set(name, { bytes, contentType });
    },
  };
  return { store, files, puts };
}

/** Runs the command in-process, capturing its output. */
async function publish(argv: string[], deps: Parameters<typeof publishCommand>[1] = {}) {
  const out: string[] = [];
  const err: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void err.push(a.join(' ')));
  const code = await publishCommand(argv, { env: { BLOB_READ_WRITE_TOKEN: 'test' }, ...deps });
  return { code, stdout: out.join('\n'), stderr: err.join('\n') };
}

afterEach(() => {
  vi.restoreAllMocks();
});

let stems: string;
beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'scripts/stems-placeholder.mjs')], { cwd: root });
  stems = tempDir();
  copyStems(placeholder, stems);
});

describe('spite publish: collection and local checks', () => {
  it('uploads a stem two manifests share only once', async () => {
    const other = JSON.parse(readFileSync(placeholder, 'utf8'));
    other.id = 'other';
    const otherFile = join(tempDir(), 'manifest.json');
    writeFileSync(otherFile, JSON.stringify(other));
    const { store, puts } = memoryStore();
    const r = await publish([placeholder, otherFile, '--stems', stems], {
      store: async () => store,
    });
    expect(r.code, r.stderr).toBe(0);
    const unique = new Set(Object.values(clipsOf(placeholder)).map((c) => c.hash)).size;
    expect(puts).toHaveLength(unique);
    expect(new Set(puts).size).toBe(unique);
  });

  it('names a missing local stem, uploads nothing and exits 2', async () => {
    const { store, puts } = memoryStore();
    const partial = tempDir();
    copyStems(placeholder, partial);
    const [id, { hash }] = Object.entries(clipsOf(placeholder))[0]!;
    const missing = join(partial, `${hex(hash)}.wav`);
    execFileSync('rm', [missing]);
    const r = await publish([placeholder, '--stems', partial], { store: async () => store });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(id);
    expect(r.stderr).toContain(hash);
    expect(r.stderr).toContain('missing');
    expect(puts).toEqual([]);
  });

  it('names a corrupt local stem as a mismatch, uploads nothing and exits 2', async () => {
    const { store, puts } = memoryStore();
    const corrupt = tempDir();
    copyStems(placeholder, corrupt);
    const [id, { hash }] = Object.entries(clipsOf(placeholder))[0]!;
    writeFileSync(join(corrupt, `${hex(hash)}.wav`), 'garbage');
    const r = await publish([placeholder, '--stems', corrupt], { store: async () => store });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(new RegExp(`${id}.*${hash}.*does not match`));
    expect(puts).toEqual([]);
  });

  it('without BLOB_READ_WRITE_TOKEN says so, uploads nothing and exits 2', async () => {
    const { store, puts } = memoryStore();
    const r = await publish([placeholder, '--stems', stems], {
      store: async () => store,
      env: {},
    });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('BLOB_READ_WRITE_TOKEN');
    expect(puts).toEqual([]);
  });

  it('never prints the token', async () => {
    const { store } = memoryStore();
    const secret = 'vercel_blob_rw_SECRET123';
    const r = await publish([placeholder, '--stems', stems], {
      store: async () => store,
      env: { BLOB_READ_WRITE_TOKEN: secret },
    });
    expect(r.stdout + r.stderr).not.toContain(secret);
  });

  it('exits 1 on an invalid manifest and uploads nothing', async () => {
    const { store, puts } = memoryStore();
    const r = await publish(
      [join(root, 'schema/examples/invalid/dangling-transition.json'), '--stems', stems],
      { store: async () => store },
    );
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('/sections/2/next/1/to');
    expect(puts).toEqual([]);
  });

  it.each([
    ['no manifests', ['publish']],
    ['--check without a URL', ['publish', '--check', placeholder]],
    ['an unknown flag', ['publish', placeholder, '--nope']],
  ])('prints usage and exits 2 with %s', async (_, args) => {
    const r = await spite(...args);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Usage: spite');
  });
});

describe('spite publish: uploads', () => {
  it('first publish of the River uploads 24 stems and its fallback', async () => {
    const dir = tempDir();
    const manifest = riverWithFallback(dir);
    const { store, files } = memoryStore();
    const r = await publish([manifest, '--stems', dir], { store: async () => store });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('25 uploaded, 0 already present');
    expect(files.size).toBe(25);
    const types = [...files.values()].map((f) => f.contentType);
    expect(types.filter((t) => t === 'audio/wav')).toHaveLength(24);
    expect(types.filter((t) => t === 'audio/mpeg')).toHaveLength(1);
  });

  it('a second run uploads nothing', async () => {
    const { store } = memoryStore();
    const first = await publish([placeholder, '--stems', stems], { store: async () => store });
    expect(first.code).toBe(0);
    const second = await publish([placeholder, '--stems', stems], { store: async () => store });
    expect(second.code).toBe(0);
    expect(second.stdout).toMatch(/^0 uploaded, \d+ already present$/m);
  });

  it('never replaces a stored file', async () => {
    const name = `${hex(Object.values(clipsOf(placeholder))[0]!.hash)}.wav`;
    const { store, files, puts } = memoryStore([name]);
    const before = files.get(name);
    const r = await publish([placeholder, '--stems', stems], { store: async () => store });
    expect(r.code).toBe(0);
    expect(puts).not.toContain(name);
    expect(files.get(name)).toBe(before);
  });

  it('reports a failed upload and exits 1', async () => {
    const { store } = memoryStore();
    const failing: StemStore = {
      has: store.has,
      put: async () => {
        throw new Error('network down');
      },
    };
    const r = await publish([placeholder, '--stems', stems], { store: async () => failing });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('network down');
  });
});

describe('spite publish --check', () => {
  let server: Server;
  let base: string;
  const present = new Set<string>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      const name = (req.url ?? '').replace(/^\/stems\//, '');
      res.statusCode = req.method === 'HEAD' && present.has(name) ? 200 : 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stems/`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const allPlaceholder = () =>
    Object.values(clipsOf(placeholder)).map(({ hash }) => `${hex(hash)}.wav`);

  it('exits 0 when every file is reachable', async () => {
    for (const name of allPlaceholder()) present.add(name);
    const r = await spite('publish', '--check', base, placeholder);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('reachable');
  });

  it('names an unreachable file and exits 1', async () => {
    for (const name of allPlaceholder()) present.add(name);
    const [id, { hash }] = Object.entries(clipsOf(placeholder))[0]!;
    present.delete(`${hex(hash)}.wav`);
    const r = await spite('publish', '--check', base, placeholder);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(id);
    expect(r.stderr).toContain(hash);
  });

  it('counts a refused connection as unreachable', async () => {
    const r = await spite('publish', '--check', 'http://127.0.0.1:9/stems/', placeholder);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unreachable');
  });

  it('needs no token', async () => {
    for (const name of allPlaceholder()) present.add(name);
    const r = await spite('publish', '--check', base, placeholder);
    expect(r.code).toBe(0);
  });
});

describe('@vercel/blob is loaded lazily', () => {
  it('appears only as a dynamic import in the built CLI', () => {
    const bin = readFileSync(join(root, 'packages/cli/dist/bin.js'), 'utf8');
    expect(bin).toMatch(/import\(["']@vercel\/blob["']\)/);
    expect(bin).not.toMatch(/^import .*["']@vercel\/blob["']/m);
  });
});
