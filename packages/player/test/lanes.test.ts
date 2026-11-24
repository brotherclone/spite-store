import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planRender, realizeTimeline, type Manifest, type Stem } from '@spite-store/engine';
import { describe, expect, it } from 'vitest';
import { layoutLanes, panLabel } from '../src/lanes.js';
import type { Performance } from '../src/loader.js';

const repo = join(import.meta.dirname, '../../..');
const placeholder = JSON.parse(
  readFileSync(join(repo, 'pieces/placeholder/manifest.json'), 'utf8'),
) as Manifest;

describe('panLabel', () => {
  it.each([
    [-0.6, 'L60'],
    [0.25, 'R25'],
    [0.004, 'C'],
    [0, 'C'],
    [-0.005, 'L1'],
    [1, 'R100'],
    [undefined, ''],
  ])('labels %s as %j', (pan, label) => {
    expect(panLabel(pan)).toBe(label);
  });
});

describe('lane blocks', () => {
  it('show each event position after the clip id, and nothing without a pan', () => {
    const piece = structuredClone(placeholder);
    const pans: Record<string, number> = { click: -0.6, bass: 0.25, hat: 0.004 };
    for (const section of piece.sections) {
      for (const slot of section.slots ?? []) {
        if (slot.id in pans) slot.pan = pans[slot.id];
      }
    }
    const { events, endBar, visits } = realizeTimeline(piece, 42, { durationBars: 16 });
    // One-frame stems are enough for a layout.
    const stems = new Map<string, Stem>(
      Object.values(piece.clips).map((c) => [
        c.hash,
        { frames: 1, channels: [new Float32Array(1)] },
      ]),
    );
    const perf = {
      manifest: piece,
      events,
      visits,
      endBar,
      plan: planRender(piece, events, endBar, stems),
      pending: [],
      final: true,
    } as unknown as Performance;
    const clipId = new Map(Object.entries(piece.clips).map(([id, c]) => [c.hash, id]));
    const { blocks } = layoutLanes(perf);
    expect(blocks).toHaveLength(events.length);
    const seen = new Set<string>();
    blocks.forEach((b, i) => {
      const e = events[i]!;
      const suffix = { click: ' · L60', bass: ' · R25', hat: ' · C' }[e.slot] ?? '';
      expect(b.label).toBe(clipId.get(e.clipHash)! + suffix);
      seen.add(e.slot);
    });
    expect([...seen].sort()).toEqual(['bass', 'click', 'hat', 'pad']);
  });
});
