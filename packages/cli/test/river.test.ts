import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { realize, type Manifest } from '@spite-store/engine';
import { describe, expect, it } from 'vitest';
import { validateManifest } from '../src/validate.js';

// These tests need no stems: realization works from the manifest alone.
const dir = join(import.meta.dirname, '../../../pieces/the-river-forgets-to-answer');
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const manifest = read('manifest.json') as Manifest;
const pack = read('pack.json');
const INSTRUMENTS = ['cello', 'viola', 'vio1', 'vio2'];
const seeds = Array.from({ length: 200 }, (_, i) => i);

const clipByHash = new Map(Object.entries(manifest.clips).map(([id, c]) => [c.hash, id]));
/** `vio1-room-2` -> ['vio1', 'room', '2'] */
const parts = (hash: string) => clipByHash.get(hash)!.split('-') as [string, string, string];

describe('The River Forgets to Answer', () => {
  it('is a valid manifest at 63 BPM in 7/8', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.tempo).toEqual([{ bar: 0, bpm: 63, meter: [7, 8] }]);
  });

  it('packs every clip from a 5-bar range at bar 0, 5 or 10', () => {
    expect(Object.keys(pack.clips).sort()).toEqual(Object.keys(manifest.clips).sort());
    for (const [id, entry] of Object.entries(pack.clips) as [string, Record<string, unknown>][]) {
      expect(entry.bars).toBe(5);
      expect([0, 5, 10]).toContain(entry.startBar);
      expect(entry.bars as number).toBeGreaterThanOrEqual(manifest.clips[id]!.lengthBars);
    }
  });

  it('has eight slots, each with one instrument and mic’s three 4-bar variations', () => {
    const slots = new Map(manifest.sections.flatMap((s) => s.slots ?? []).map((s) => [s.id, s]));
    expect([...slots.keys()].sort()).toEqual(
      INSTRUMENTS.flatMap((i) => [`${i}-close`, `${i}-room`]).sort(),
    );
    for (const [id, slot] of slots) {
      expect(slot.pool.map((p) => p.clip).sort()).toEqual([1, 2, 3].map((n) => `${id}-${n}`));
      for (const p of slot.pool) expect(manifest.clips[p.clip]!.lengthBars).toBe(4);
    }
  });

  it('keeps close and room on the same take whenever both sound', () => {
    for (const seed of seeds) {
      const sounding = new Map<string, string>(); // `${bar}/${instrument}/${mic}` -> variation
      for (const e of realize(manifest, seed, { durationBars: 64 })) {
        const [instrument, mic, variation] = parts(e.clipHash);
        for (let bar = e.bar; bar < e.bar + 4; bar++) {
          sounding.set(`${bar}/${instrument}/${mic}`, variation);
        }
      }
      for (const [key, variation] of sounding) {
        if (!key.endsWith('/close')) continue;
        const room = sounding.get(key.replace(/close$/, 'room'));
        if (room !== undefined) expect(room, `seed ${seed} at ${key}`).toBe(variation);
      }
    }
  });

  it('lets each mic sound without the other', () => {
    let closeAlone = false;
    let roomAlone = false;
    for (const seed of seeds) {
      const visits = new Map<number, Set<string>>();
      for (const e of realize(manifest, seed, { durationBars: 64 })) {
        const [instrument, mic] = parts(e.clipHash);
        if (!visits.has(e.bar)) visits.set(e.bar, new Set());
        visits.get(e.bar)!.add(`${instrument}-${mic}`);
      }
      for (const playing of visits.values()) {
        for (const i of INSTRUMENTS) {
          closeAlone ||= playing.has(`${i}-close`) && !playing.has(`${i}-room`);
          roomAlone ||= playing.has(`${i}-room`) && !playing.has(`${i}-close`);
        }
      }
    }
    expect(closeAlone).toBe(true);
    expect(roomAlone).toBe(true);
  });

  it('always ends before bar 64', () => {
    for (const seed of seeds) {
      const trace = realize(manifest, seed, { durationBars: 200 });
      expect(trace.at(-1)!.bar, `seed ${seed}`).toBeLessThan(64);
    }
  });
});
