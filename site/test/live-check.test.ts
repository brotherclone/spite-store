import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '../..');
const hexOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

// Three content-addressed files: a stem, a frozen manifest and a track, each over 200 bytes.
const stem = Buffer.from('stem '.repeat(100));
const frozen = Buffer.from(JSON.stringify({ frozen: 'x'.repeat(300) }));
const track = Buffer.from('track '.repeat(100));
const files = new Map([
  [`${hexOf(stem)}.flac`, stem],
  [`${hexOf(frozen)}.json`, frozen],
  [`${hexOf(track)}.flac`, track],
]);

/** A pieces directory with one piece whose stem, frozen version and track are the files above. */
function pieces() {
  const dir = mkdtempSync(join(tmpdir(), 'spite-live-'));
  mkdirSync(join(dir, 'river'));
  const w = (name: string, data: unknown) =>
    writeFileSync(join(dir, 'river', name), JSON.stringify(data));
  w('manifest.json', { id: 'river', clips: { drone: { hash: `sha256:${hexOf(stem)}` } } });
  w('versions.json', { versions: [{ hash: `sha256:${hexOf(frozen)}`, label: 'v1' }] });
  w('release.json', {
    tracks: [{ id: 'first', audio: `sha256:${hexOf(track)}` }],
  });
  return dir;
}

describe('scripts/live-check.mjs', () => {
  let server: Server;
  let origin: string;
  /** honest: ranges served correctly. poisoning: the first response per URL is cached and replayed. */
  let mode: 'honest' | 'poisoning' = 'honest';
  let trackDisposition = 'attachment';
  const cache = new Map<
    string,
    { status: number; headers: Record<string, string>; body: Buffer }
  >();
  const requested: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '';
      requested.push(url);
      const name = url.replace(/^\/stems\//, '').replace(/\?.*$/, '');
      const bytes = files.get(name);
      if (!bytes) {
        res.statusCode = 404;
        return res.end();
      }
      const cached = mode === 'poisoning' ? cache.get(url) : undefined;
      if (cached) {
        res.writeHead(cached.status, cached.headers);
        return res.end(cached.body);
      }
      const headers: Record<string, string> = {
        'content-disposition':
          name === `${hexOf(track)}.flac` ? trackDisposition : `inline; filename="${name}"`,
      };
      const range = /bytes=(\d+)-(\d+)/.exec(req.headers.range ?? '');
      const response = range
        ? {
            status: 206,
            headers: {
              ...headers,
              'content-range': `bytes ${range[1]}-${range[2]}/${bytes.length}`,
            },
            body: bytes.subarray(Number(range[1]), Number(range[2]) + 1),
          }
        : { status: 200, headers, body: bytes };
      cache.set(url, response);
      res.writeHead(response.status, response.headers);
      res.end(response.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
  beforeEach(() => {
    mode = 'honest';
    trackDisposition = 'attachment';
    cache.clear();
    requested.length = 0;
  });

  const run = (args: string[], env: Record<string, string> = {}) =>
    new Promise<{ code: number; out: string }>((resolve) =>
      execFile(
        process.execPath,
        [join(repo, 'scripts/live-check.mjs'), ...args],
        { cwd: repo, env: { ...process.env, SPITE_PIECES_DIR: pieces(), ...env } },
        (error, stdout, stderr) =>
          resolve({ code: error ? (error.code as number) : 0, out: stdout + stderr }),
      ),
    );

  it('passes when the proxy serves ranges honestly, probing every file under ?probe= only', async () => {
    const r = await run([origin]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`ok  river  stem drone  ${hexOf(stem)}.flac`);
    expect(r.out).toContain(`ok  river  v1  ${hexOf(frozen)}.json`);
    expect(r.out).toContain(`ok  river  track:first  ${hexOf(track)}.flac`);
    expect(requested).toHaveLength(6);
    expect(requested.every((u) => /\?probe=[0-9a-f]{16}$/.test(u))).toBe(true);
  });

  it('fails on an edge cache that replays a stored 206, naming each file', async () => {
    mode = 'poisoning';
    const r = await run([origin]);
    expect(r.code).toBe(1);
    for (const name of files.keys()) {
      expect(r.out).toMatch(
        new RegExp(`${name}  plain request after a range request answered 206`),
      );
    }
    expect(r.out).toContain('serving a stored partial response as the whole file');
  });

  it("fails on a track served with a filename, which overrides the page's download name", async () => {
    trackDisposition = `inline; filename="${hexOf(track)}.flac"`;
    const r = await run([origin]);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(
      /track:first {2}\S+ {2}served with Content-Disposition "inline; filename=/,
    );
    expect(r.out).toContain(`ok  river  stem drone`);
  });

  it('fails naming a file the proxy does not serve', async () => {
    files.delete(`${hexOf(frozen)}.json`);
    const r = await run([origin]);
    files.set(`${hexOf(frozen)}.json`, frozen);
    expect(r.code).toBe(1);
    expect(r.out).toContain(
      `river  v1  ${hexOf(frozen)}.json  range request answered 404, not 206`,
    );
  });

  it('exits 2 without an origin', async () => {
    const r = await run([]);
    expect(r.code).toBe(2);
    expect(r.out).toContain('usage:');
  });
});
