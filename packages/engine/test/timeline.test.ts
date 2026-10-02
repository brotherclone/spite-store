import { describe, expect, it } from 'vitest';
import { realize, realizeForRender, realizeTimeline } from '../src/index.js';
import { loadExample } from './helpers/manifests.js';

describe('realizeTimeline', () => {
  const m = loadExample('minimal.json');

  it.each([0, 42, 'spite-store'])('matches realize and realizeForRender for seed %s', (seed) => {
    for (const durationBars of [16, 64, 200]) {
      const timeline = realizeTimeline(m, seed, { durationBars });
      expect(timeline.events).toEqual(realize(m, seed, { durationBars }));
      expect(timeline.endBar).toBe(realizeForRender(m, seed, { durationBars }).endBar);
    }
  });

  it('reports contiguous visits covering every realized bar', () => {
    const { visits, endBar } = realizeTimeline(m, 42, { durationBars: 64 });
    expect(visits[0]).toMatchObject({ ordinal: 0, sectionId: 'intro', startBar: 0 });
    visits.forEach((v, i) => {
      expect(v.ordinal).toBe(i);
      expect(v.endBar).toBeGreaterThan(v.startBar);
      if (i > 0) expect(v.startBar).toBe(visits[i - 1]!.endBar);
    });
    expect(visits.at(-1)!.endBar).toBe(endBar);
  });
});
