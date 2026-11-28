import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '../..');
const vercel = JSON.parse(readFileSync(join(repo, 'vercel.json'), 'utf8')) as {
  buildCommand: string;
  outputDirectory: string;
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const cacheFor = (source: string) =>
  vercel.headers.find((h) => h.source === source)?.headers.find((h) => h.key === 'Cache-Control')
    ?.value ?? '';

describe('vercel.json', () => {
  it('rewrites /stems/:file to the store, exactly once', () => {
    const stems = vercel.rewrites.filter((r) => r.source === '/stems/:file');
    expect(stems).toHaveLength(1);
    expect(stems[0]!.destination).toMatch(/^https:\/\/.+\/stems\/:file$/);
  });

  it('caches stems for a year, immutably', () => {
    const value = cacheFor('/stems/(.*)');
    expect(value).toContain('immutable');
    expect(Number(/max-age=(\d+)/.exec(value)?.[1])).toBeGreaterThanOrEqual(31_536_000);
  });

  it("keeps Vercel's edge from caching proxied stems", () => {
    const values = vercel.headers
      .filter((h) => new RegExp(`^${h.source}$`).test(`/stems/${'ab'.repeat(32)}.flac`))
      .flatMap((h) => h.headers)
      .filter((h) => h.key === 'Vercel-CDN-Cache-Control')
      .map((h) => h.value);
    expect(values).toContain('no-store');
  });

  it('caches manifests for at most five minutes', () => {
    expect(Number(/max-age=(\d+)/.exec(cacheFor('/pieces/(.*)'))?.[1])).toBeLessThanOrEqual(300);
  });

  /** The Cache-Control a path gets: the value of the first header rule whose source matches it. */
  const cacheOf = (path: string) => {
    const rule = vercel.headers.find((h) => new RegExp(`^${h.source}$`).test(path));
    return rule?.headers.find((h) => h.key === 'Cache-Control')?.value ?? '';
  };
  const maxAge = (value: string) => Number(/max-age=(\d+)/.exec(value)?.[1]);

  it('caches frozen manifests for a year, immutably, under the stems rule', () => {
    const value = cacheOf(`/stems/${'ab'.repeat(32)}.json`);
    expect(value).toContain('immutable');
    expect(maxAge(value)).toBeGreaterThanOrEqual(31_536_000);
  });

  it('caches version lists for at most five minutes, under the pieces rule', () => {
    const value = cacheOf('/pieces/the-river-forgets-to-answer/versions.json');
    expect(value).not.toBe('');
    expect(maxAge(value)).toBeLessThanOrEqual(300);
  });

  it('checks the stem store before building the site, and serves site/dist', () => {
    const steps = vercel.buildCommand.split('&&').map((s) => s.trim());
    expect(steps.indexOf('node scripts/deploy-check.mjs')).toBeGreaterThan(-1);
    expect(steps.indexOf('node scripts/deploy-check.mjs')).toBeLessThan(
      steps.indexOf('pnpm --filter site build'),
    );
    expect(vercel.outputDirectory).toBe('site/dist');
  });
});

describe('scripts/deploy-check.mjs', () => {
  let server: Server;
  let base: string;
  let missing: string | null = null;
  const requested: string[] = [];
  /** Files served with their bytes; anything else answers 200 with no body unless `missing`. */
  const served = new Map<string, string>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      const name = (req.url ?? '').replace(/^\/stems\//, '');
      requested.push(name);
      res.statusCode = name === missing ? 404 : 200;
      res.end(name !== missing && req.method === 'GET' ? served.get(name) : undefined);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stems/`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const run = (env: Record<string, string> = {}) =>
    new Promise<{ code: number; out: string }>((resolve) =>
      execFile(
        process.execPath,
        [join(repo, 'scripts/deploy-check.mjs')],
        { cwd: repo, env: { ...process.env, SPITE_STEMS_BASE: base, ...env } },
        (error, stdout, stderr) =>
          resolve({ code: error ? (error.code as number) : 0, out: stdout + stderr }),
      ),
    );

  it('passes when every piece file is in the store', async () => {
    missing = null;
    // A frozen version is checked against its hash, so serve each piece's working manifest under
    // its own hash: that is the frozen manifest of a piece frozen since its last edit.
    for (const entry of readdirSync(join(repo, 'pieces'), { withFileTypes: true })) {
      const file = join(repo, 'pieces', entry.name, 'manifest.json');
      if (!entry.isDirectory() || !existsSync(file)) continue;
      const text = readFileSync(file, 'utf8');
      served.set(`${createHash('sha256').update(text).digest('hex')}.json`, text);
    }
    const r = await run();
    expect(r.code, r.out).toBe(0);
    const river = JSON.parse(
      readFileSync(join(repo, 'pieces/the-river-forgets-to-answer/manifest.json'), 'utf8'),
    );
    const someRiverStem = (Object.values(river.clips)[0] as { hash: string }).hash.slice(7);
    expect(requested).toContain(`${someRiverStem}.flac`);
    expect(requested.some((name: string) => name.endsWith('.wav'))).toBe(false);
  });

  it('fails naming a missing hash', async () => {
    const placeholder = JSON.parse(
      readFileSync(join(repo, 'pieces/placeholder/manifest.json'), 'utf8'),
    );
    const [id, clip] = Object.entries(placeholder.clips)[0] as [string, { hash: string }];
    const hash = clip.hash;
    missing = `${hash.slice(7)}.flac`;
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.out).toContain(hash);
    expect(r.out).toContain(id);
  });

  it('fails when vercel.json lets the edge cache store stems, saying why', async () => {
    missing = null;
    const unsafe = structuredClone(vercel);
    for (const rule of unsafe.headers)
      rule.headers = rule.headers.filter((h) => h.key !== 'Vercel-CDN-Cache-Control');
    const dir = mkdtempSync(join(tmpdir(), 'spite-vercel-'));
    writeFileSync(join(dir, 'vercel.json'), JSON.stringify(unsafe));
    const r = await run({ SPITE_VERCEL_JSON: join(dir, 'vercel.json') });
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/\/stems\/(ab)+\.flac doesn't get "Vercel-CDN-Cache-Control: no-store"/);
    expect(r.out).toContain('206');
  });

  describe('engine pins', () => {
    const placeholder = JSON.parse(
      readFileSync(join(repo, 'pieces/placeholder/manifest.json'), 'utf8'),
    );
    const fallback = {
      hash: (Object.values(placeholder.clips)[0] as { hash: string }).hash,
      type: 'audio/mpeg',
      seed: 'spite-store',
      bars: 16,
    };
    /** A temporary pieces directory holding one copy of the placeholder per given variant. */
    function pieces(variants: Record<string, { engine?: unknown; fallback?: unknown }>): string {
      const dir = mkdtempSync(join(tmpdir(), 'spite-pieces-'));
      for (const [id, v] of Object.entries(variants)) {
        const m = { ...placeholder, id };
        delete m.engine;
        delete m.fallback;
        if (v.engine !== undefined) m.engine = v.engine;
        if (v.fallback !== undefined) m.fallback = v.fallback;
        mkdirSync(join(dir, id));
        writeFileSync(join(dir, id, 'manifest.json'), JSON.stringify(m));
      }
      return dir;
    }

    it('fails on an unpinned piece, naming it', async () => {
      missing = null;
      const r = await run({
        SPITE_PIECES_DIR: pieces({ pinned: { engine: { trace: 1, render: 1 } }, loose: {} }),
      });
      expect(r.code).toBe(1);
      expect(r.out).toMatch(/loose\/manifest\.json {2}not pinned/);
      expect(r.out).not.toMatch(/pinned\/manifest\.json {2}not pinned/);
    });

    it('warns, but passes, for a stranded piece with a fallback', async () => {
      missing = null;
      const r = await run({
        SPITE_PIECES_DIR: pieces({ stranded: { engine: { trace: 99, render: 1 }, fallback } }),
      });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toMatch(
        /warning: .*stranded\/manifest\.json {2}trace format 99, this engine has 1/,
      );
      expect(r.out).toContain('will play its fallback recording');
    });

    it('warns, but passes, for a stranded piece without a fallback', async () => {
      missing = null;
      const r = await run({
        SPITE_PIECES_DIR: pieces({ stranded: { engine: { trace: 99, render: 1 } } }),
      });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain('will not play');
    });

    it('passes with no pin warning when every piece is pinned to the current formats', async () => {
      missing = null;
      const r = await run({ SPITE_PIECES_DIR: pieces({ a: { engine: { trace: 1, render: 1 } } }) });
      expect(r.code, r.out).toBe(0);
      expect(r.out).not.toContain('warning');
    });
  });

  describe('frozen versions', () => {
    const placeholder = readFileSync(join(repo, 'pieces/placeholder/manifest.json'), 'utf8');
    const hexOf = (text: string) => createHash('sha256').update(text).digest('hex');

    /** A temporary pieces directory with the placeholder frozen as v1, and its version list. */
    function frozenPieces(versions?: (hex: string) => string) {
      const dir = mkdtempSync(join(tmpdir(), 'spite-pieces-'));
      mkdirSync(join(dir, 'placeholder'));
      writeFileSync(join(dir, 'placeholder', 'manifest.json'), placeholder);
      const hex = hexOf(placeholder);
      const list =
        versions?.(hex) ??
        JSON.stringify({ versions: [{ hash: `sha256:${hex}`, label: 'v1' }] }, null, 2) + '\n';
      writeFileSync(join(dir, 'placeholder', 'versions.json'), list);
      return { dir, hex };
    }

    it('passes for a frozen piece whose files are all in the store', async () => {
      missing = null;
      const { dir, hex } = frozenPieces();
      served.set(`${hex}.json`, placeholder);
      const r = await run({ SPITE_PIECES_DIR: dir });
      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain(`reachable  placeholder  v1  sha256:${hex}`);
    });

    it('fails on a recorded version missing from the store, naming piece, label and hash', async () => {
      const { dir, hex } = frozenPieces();
      missing = `${hex}.json`;
      const r = await run({ SPITE_PIECES_DIR: dir });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`placeholder  v1  sha256:${hex}`);
      missing = null;
    });

    it('fails on a version list that repeats a label, naming the file and the label', async () => {
      missing = null;
      const other = `sha256:${'a'.repeat(64)}`;
      const { dir, hex } = frozenPieces((h) =>
        JSON.stringify({
          versions: [
            { hash: `sha256:${h}`, label: 'v1' },
            { hash: other, label: 'v1' },
          ],
        }),
      );
      served.set(`${hex}.json`, placeholder);
      const r = await run({ SPITE_PIECES_DIR: dir });
      expect(r.code).toBe(1);
      expect(r.out).toContain(join(dir, 'placeholder', 'versions.json'));
      expect(r.out).toContain('repeated label "v1"');
    });

    it('fails on a track whose audio is missing from the store, naming track:<id>', async () => {
      const { dir, hex } = frozenPieces();
      served.set(`${hex}.json`, placeholder);
      const audio = 'f'.repeat(64);
      writeFileSync(
        join(dir, 'placeholder', 'release.json'),
        JSON.stringify({
          tracks: [
            {
              id: 'first-light',
              title: 'First Light',
              version: `sha256:${hex}`,
              seed: 'ox-bow',
              bars: 40,
              audio: `sha256:${audio}`,
              frames: 5_880_000,
            },
          ],
        }),
      );
      missing = `${audio}.flac`;
      const r = await run({ SPITE_PIECES_DIR: dir });
      expect(r.code).toBe(1);
      expect(r.out).toContain(`track:first-light  sha256:${audio}`);
      missing = null;
      expect((await run({ SPITE_PIECES_DIR: dir })).code).toBe(0);
    });
  });
});
