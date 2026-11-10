import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

  it('caches manifests for at most five minutes', () => {
    expect(Number(/max-age=(\d+)/.exec(cacheFor('/pieces/(.*)'))?.[1])).toBeLessThanOrEqual(300);
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

  beforeAll(async () => {
    server = createServer((req, res) => {
      const name = (req.url ?? '').replace(/^\/stems\//, '');
      requested.push(name);
      res.statusCode = name === missing ? 404 : 200;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stems/`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const run = () =>
    new Promise<{ code: number; out: string }>((resolve) =>
      execFile(
        process.execPath,
        [join(repo, 'scripts/deploy-check.mjs')],
        { cwd: repo, env: { ...process.env, SPITE_STEMS_BASE: base } },
        (error, stdout, stderr) =>
          resolve({ code: error ? (error.code as number) : 0, out: stdout + stderr }),
      ),
    );

  it('passes when every piece file is in the store', async () => {
    missing = null;
    const r = await run();
    expect(r.code, r.out).toBe(0);
    const river = JSON.parse(
      readFileSync(join(repo, 'pieces/the-river-forgets-to-answer/manifest.json'), 'utf8'),
    );
    const someRiverStem = (Object.values(river.clips)[0] as { hash: string }).hash.slice(7);
    expect(requested).toContain(`${someRiverStem}.wav`);
  });

  it('fails naming a missing hash', async () => {
    const placeholder = JSON.parse(
      readFileSync(join(repo, 'pieces/placeholder/manifest.json'), 'utf8'),
    );
    const hash = (Object.values(placeholder.clips)[0] as { hash: string }).hash;
    missing = `${hash.slice(7)}.wav`;
    const r = await run();
    expect(r.code).toBe(1);
    expect(r.out).toContain(hash);
  });
});
