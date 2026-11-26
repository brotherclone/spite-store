import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { loadRelease, type LoadedRelease } from '../src/release.js';

const examples = join(import.meta.dirname, '../../../schema/examples/release');
const list = (kind: string) => readdirSync(join(examples, kind)).sort();
const schema: object = createRequire(import.meta.url)('@spite-store/schema/release.schema.json');
const schemaValid = new Ajv2020({ strict: true }).compile(schema);

const A = `sha256:${'a'.repeat(64)}`;
const C = `sha256:${'c'.repeat(64)}`;
const E = `sha256:${'e'.repeat(64)}`;
const versions = { versions: [{ hash: A, label: 'v1' }] };
const track = (extra: object = {}) => ({
  id: 'first-light',
  title: 'First Light',
  version: A,
  seed: 'ox-bow',
  bars: 40,
  audio: C,
  frames: 5_880_000,
  ...extra,
});

/** A temp piece dir holding `release` (and `versions`, if given). */
function piece(release: unknown, withVersions: object | null = versions): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  writeFileSync(join(dir, 'release.json'), JSON.stringify(release));
  if (withVersions) writeFileSync(join(dir, 'versions.json'), JSON.stringify(withVersions));
  return dir;
}
const errorsOf = (r: LoadedRelease) => {
  if (!('errors' in r)) throw new Error('expected errors');
  return r.errors;
};
const text = (r: LoadedRelease) =>
  errorsOf(r)
    .map((e) => `${e.pointer}  ${e.message}`)
    .join('\n');

describe('release examples', () => {
  it.each(list('valid'))('schema and CLI accept valid/%s', (name) => {
    const dir = join(examples, 'valid', name);
    expect(schemaValid(JSON.parse(readFileSync(join(dir, 'release.json'), 'utf8')))).toBe(true);
    expect(loadRelease(dir)).toHaveProperty('release');
  });
  it.each(list('invalid'))('CLI rejects invalid/%s', (name) => {
    expect(loadRelease(join(examples, 'invalid', name))).toHaveProperty('errors');
  });
});

describe('release file', () => {
  it('a piece without the file has none', () => {
    expect(loadRelease(mkdtempSync(join(tmpdir(), 'release-')))).toEqual({ none: true });
  });

  it('{} has no credits and no tracks', () => {
    expect(loadRelease(piece({}, null))).toMatchObject({ release: { credits: [], tracks: [] } });
  });

  it('names an unknown top-level field', () => {
    expect(errorsOf(loadRelease(piece({ price: 5 }, null)))).toEqual([
      { pointer: '/price', message: 'unknown property "price"' },
    ]);
  });

  it('keeps credits in order', () => {
    const credits = [
      { name: 'A. Composer', role: 'composition' },
      { name: 'B. Player', role: 'viola' },
      { name: 'A. Composer', role: 'cello' },
    ];
    expect(loadRelease(piece({ credits }, null))).toMatchObject({ release: { credits } });
  });

  it("names an empty credit's role", () => {
    const r = loadRelease(piece({ credits: [{ name: 'A', role: '' }] }, null));
    expect(errorsOf(r)[0]!.pointer).toBe('/credits/0/role');
  });

  it('accepts a track', () => {
    expect(loadRelease(piece({ tracks: [track()] }))).toMatchObject({
      release: { tracks: [track()] },
    });
  });

  it('names the second of two tracks with the same id', () => {
    const r = loadRelease(piece({ tracks: [track(), track({ audio: E })] }));
    expect(errorsOf(r)).toEqual([
      { pointer: '/tracks/1/id', message: expect.stringContaining('"first-light"') },
    ]);
  });

  it('names a track with no audio', () => {
    const rest: Partial<ReturnType<typeof track>> = track();
    delete rest.audio;
    const r = loadRelease(piece({ tracks: [rest] }));
    expect(errorsOf(r)).toEqual([
      { pointer: '/tracks/0', message: 'missing required property "audio"' },
    ]);
  });

  it('reports bars 0 at /tracks/0/bars as needing a positive integer', () => {
    const r = loadRelease(piece({ tracks: [track({ bars: 0 })] }));
    expect(errorsOf(r)).toEqual([
      { pointer: '/tracks/0/bars', message: 'expected a positive integer, got 0' },
    ]);
  });

  it('names an unrecorded version', () => {
    const r = loadRelease(piece({ tracks: [track({ version: E })] }));
    expect(errorsOf(r)[0]!.pointer).toBe('/tracks/0/version');
    expect(text(r)).toContain("isn't a recorded version");
  });

  it('refuses tracks in an unfrozen piece', () => {
    expect(text(loadRelease(piece({ tracks: [track()] }, null)))).toContain('no frozen versions');
  });

  it('allows credits without versions', () => {
    expect(loadRelease(piece({ credits: [{ name: 'A', role: 'b' }] }, null))).toHaveProperty(
      'release',
    );
  });

  it('reports text that is not JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-'));
    writeFileSync(join(dir, 'release.json'), '{ "tracks": [');
    expect(text(loadRelease(dir))).toContain('not valid JSON');
  });

  it('reports an invalid versions.json', () => {
    const r = loadRelease(piece({ tracks: [track()] }, { versions: 'nope' }));
    expect(text(r)).toContain('versions.json is invalid');
  });
});
