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
