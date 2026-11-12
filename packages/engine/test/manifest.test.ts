import { describe, expect, it } from 'vitest';
import minimal from '../../../schema/examples/valid/minimal.json' with { type: 'json' };
import { checkManifest, type Manifest } from '../src/manifest.js';

const base = (): Manifest => structuredClone(minimal) as unknown as Manifest;

function errorsFor(mutate: (m: Manifest) => void) {
  const m = base();
  mutate(m);
  return checkManifest(m);
}

describe('checkManifest', () => {
  it('accepts the minimal example', () => {
    expect(checkManifest(base())).toEqual([]);
  });

  it('rejects an unknown start section', () => {
    expect(errorsFor((m) => (m.start = 'nowhere'))).toEqual([
      { pointer: '/start', message: expect.stringContaining('nowhere') },
    ]);
  });

  it('rejects a dangling transition, naming source and target', () => {
    const errors = errorsFor((m) => (m.sections[0]!.next![0]!.to = 'coda'));
    expect(errors).toEqual([
      { pointer: '/sections/0/next/0/to', message: expect.stringMatching(/intro.*coda/) },
    ]);
  });

  it('rejects a pool reference to an unknown clip, naming section, slot and clip', () => {
    const errors = errorsFor((m) => (m.sections[1]!.slots![1]!.pool[0]!.clip = 'ghost'));
    expect(errors).toEqual([
      {
        pointer: '/sections/1/slots/1/pool/0/clip',
        message: expect.stringMatching(/verse.*bass.*ghost/),
      },
    ]);
  });

  it('rejects an exclusion of an unknown clip', () => {
    const errors = errorsFor((m) => (m.clips['kick-b']!.excludes = ['ghost']));
    expect(errors).toEqual([
      { pointer: '/clips/kick-b/excludes/0', message: expect.stringContaining('ghost') },
    ]);
  });

  it('rejects duplicate section ids', () => {
    const errors = errorsFor((m) => m.sections.push({ id: 'verse', lengthBars: 1 }));
    expect(errors).toEqual([
      { pointer: '/sections/3/id', message: expect.stringContaining('verse') },
    ]);
  });

  it('rejects duplicate slot ids within a section', () => {
    const errors = errorsFor((m) => (m.sections[1]!.slots![2]!.id = 'drums'));
    expect(errors).toEqual([
      { pointer: '/sections/1/slots/2/id', message: expect.stringContaining('drums') },
    ]);
  });

  it('allows the same slot id in different sections', () => {
    expect(errorsFor((m) => (m.sections[2]!.slots![1]!.id = 'drums'))).toEqual([]);
  });

  it('rejects a tempo map that does not start at bar 0', () => {
    expect(errorsFor((m) => (m.tempo[0]!.bar = 4))).toEqual([
      { pointer: '/tempo/0/bar', message: expect.stringContaining('bar 0') },
    ]);
  });

  it('rejects non-increasing tempo bars', () => {
    const errors = errorsFor((m) =>
      m.tempo.push({ bar: 8, bpm: 100, meter: [4, 4] }, { bar: 8, bpm: 120, meter: [4, 4] }),
    );
    expect(errors.map((e) => e.pointer)).toEqual(['/tempo/2/bar']);
  });

  it('rejects all-zero pool weights', () => {
    const errors = errorsFor((m) => m.sections[0]!.slots![1]!.pool.forEach((p) => (p.weight = 0)));
    expect(errors).toEqual([
      { pointer: '/sections/0/slots/1/pool', message: expect.stringContaining('0') },
    ]);
  });

  it('rejects envelope endpoints other than 0 and 1', () => {
    const errors = errorsFor(
      (m) =>
        (m.envelope = [
          { at: 0.1, value: 1 },
          { at: 0.9, value: 1 },
        ]),
    );
    expect(errors.map((e) => e.pointer)).toEqual(['/envelope/0/at', '/envelope/1/at']);
  });

  it('rejects non-increasing envelope breakpoints', () => {
    const errors = errorsFor(
      (m) =>
        (m.envelope = [
          { at: 0, value: 1 },
          { at: 0.5, value: 1 },
          { at: 0.5, value: 0 },
          { at: 1, value: 0 },
        ]),
    );
    expect(errors.map((e) => e.pointer)).toEqual(['/envelope/2/at']);
  });

  it('reports structural problems instead of crashing', () => {
    expect(checkManifest(null)).toEqual([{ pointer: '', message: expect.any(String) }]);
    expect(checkManifest({ ...base(), sections: 'nope' }).map((e) => e.pointer)).toEqual([
      '/sections',
    ]);
    expect(
      errorsFor((m) => ((m.clips['kick-a'] as { hash: string }).hash = 'sha256:ABC')).map(
        (e) => e.pointer,
      ),
    ).toEqual(['/clips/kick-a/hash']);
  });
});

describe('checkManifest: fallback', () => {
  const fallback = {
    hash: 'sha256:' + 'ab'.repeat(32),
    type: 'audio/mpeg',
    seed: 'spite-store',
    bars: 64,
  } as const;
  const withFallback = (f: unknown) => checkManifest({ ...base(), fallback: f });

  it('accepts a valid fallback', () => {
    expect(withFallback(fallback)).toEqual([]);
  });

  it.each([
    ['a file name as hash', { ...fallback, hash: 'fallback.mp3' }, '/fallback/hash'],
    ['an unsupported type', { ...fallback, type: 'audio/ogg' }, '/fallback/type'],
    ['zero bars', { ...fallback, bars: 0 }, '/fallback/bars'],
    ['a missing seed', { hash: fallback.hash, type: fallback.type, bars: 64 }, '/fallback/seed'],
    ['an unknown field', { ...fallback, url: 'https://example.test/a.mp3' }, '/fallback'],
    ['a non-object', 'fallback.mp3', '/fallback'],
  ])('rejects %s', (_, f, expected) => {
    expect(withFallback(f).map((e) => e.pointer)).toEqual([expected]);
  });

  it('names the unknown field', () => {
    expect(withFallback({ ...fallback, url: 'x' })[0]!.message).toContain('"url"');
  });
});

describe('checkManifest: engine', () => {
  const withEngine = (e: unknown) => checkManifest({ ...base(), engine: e });

  it('accepts a pin to the current formats', () => {
    expect(withEngine({ trace: 1, render: 1 })).toEqual([]);
  });

  it('accepts a pin to formats this engine does not have', () => {
    expect(withEngine({ trace: 7, render: 3 })).toEqual([]);
  });

  it.each([
    ['a zero trace', { trace: 0, render: 1 }, '/engine/trace'],
    ['a string render', { trace: 1, render: '1' }, '/engine/render'],
    ['a missing render', { trace: 1 }, '/engine/render'],
    ['an unknown field', { trace: 1, render: 1, version: '1.0' }, '/engine'],
    ['a non-object', 1, '/engine'],
  ])('rejects %s', (_, e, expected) => {
    expect(withEngine(e).map((x) => x.pointer)).toEqual([expected]);
  });

  it('names the unknown field', () => {
    expect(withEngine({ trace: 1, render: 1, version: 'x' })[0]!.message).toContain('"version"');
  });
});
