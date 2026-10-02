import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/validate.js';

const dir = join(import.meta.dirname, '../../../pieces/placeholder');
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'));

describe('placeholder piece', () => {
  it('is a valid manifest', () => {
    expect(validateManifest(read('manifest.json'))).toEqual([]);
  });

  it('has exactly one recipe per clip', () => {
    expect(Object.keys(read('recipes.json')).sort()).toEqual(
      Object.keys(read('manifest.json').clips).sort(),
    );
  });

  it('covers the features audio rendering needs', () => {
    const m = read('manifest.json');
    const recipes = read('recipes.json');
    const slots = new Set(
      m.sections.flatMap((s: { slots: { id: string }[] }) => s.slots.map((x) => x.id)),
    );
    expect(slots.size).toBeGreaterThanOrEqual(3);
    expect(m.sections.length).toBeGreaterThanOrEqual(2);
    expect(m.tempo.length).toBeGreaterThanOrEqual(2);
    expect(
      Object.values(m.clips).some((c) => (c as { excludes?: string[] }).excludes?.length),
    ).toBe(true);
    // pad-long's stem lasts at least one 4/4 bar (96000 frames) beyond its body.
    expect(
      recipes['pad-long'].frames - m.clips['pad-long'].lengthBars * 96000,
    ).toBeGreaterThanOrEqual(96000);
    expect(recipes.count.kind).toBe('clicks');
  });
});
