import { describe, expect, it } from 'vitest';
import { advance, createState, realize, type TraceEvent } from '../src/index.js';
import { loadExample } from './helpers/manifests.js';

describe('serializable, resumable state', () => {
  it('chunked realization with JSON round trips equals one-shot', () => {
    const m = loadExample('minimal.json');
    let state = createState(m, 42, { durationBars: 64 });
    const events: TraceEvent[] = [];
    for (const until of [16, 32, 48, 64]) {
      const step = advance(m, state, until);
      events.push(...step.events);
      state = JSON.parse(JSON.stringify(step.state));
    }
    expect(events).toEqual(realize(m, 42, { durationBars: 64 }));
  });

  it('does not modify the state it is given', () => {
    const m = loadExample('minimal.json');
    const state = createState(m, 1, { durationBars: 64 });
    const before = JSON.stringify(state);
    advance(m, state, 32);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('refuses to resume against a different manifest', () => {
    const m = loadExample('minimal.json');
    const { state } = advance(m, createState(m, 42, { durationBars: 64 }), 16);
    const other = { ...m, title: 'Something else' };
    expect(() => advance(other, state, 32)).toThrow(/different manifest/);
  });
});
