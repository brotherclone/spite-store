import { describe, expect, it } from 'vitest';
import minimal from '../../../schema/examples/valid/minimal.json' with { type: 'json' };
import {
  ENGINE_FORMATS,
  RENDER_FORMAT,
  TRACE_FORMAT,
  checkPin,
  describePinMismatch,
  type Manifest,
} from '../src/index.js';

const pinned = (engine?: { trace: number; render: number }): Manifest => {
  const m = structuredClone(minimal) as unknown as Manifest;
  if (engine) m.engine = engine;
  return m;
};

describe('checkPin', () => {
  it('uses the engine formats by default', () => {
    expect(ENGINE_FORMATS).toEqual({ trace: TRACE_FORMAT, render: RENDER_FORMAT });
  });

  it('accepts a matching pin', () => {
    expect(checkPin(pinned({ trace: 1, render: 1 }), { trace: 1, render: 1 })).toEqual([]);
    expect(checkPin(pinned({ ...ENGINE_FORMATS }))).toEqual([]);
  });

  it('accepts an unpinned manifest', () => {
    expect(checkPin(pinned())).toEqual([]);
    expect(checkPin(pinned(), { trace: 99, render: 99 })).toEqual([]);
  });

  it('reports a newer trace pin and leaves render out', () => {
    expect(checkPin(pinned({ trace: 2, render: 1 }), { trace: 1, render: 1 })).toEqual([
      { format: 'trace', pinned: 2, current: 1, made: 'newer' },
    ]);
  });

  it('reports an older pin against a later engine', () => {
    expect(checkPin(pinned({ trace: 1, render: 1 }), { trace: 2, render: 1 })).toEqual([
      { format: 'trace', pinned: 1, current: 2, made: 'older' },
    ]);
  });

  it('reports both formats, trace first', () => {
    expect(checkPin(pinned({ trace: 3, render: 1 }), { trace: 1, render: 2 })).toEqual([
      { format: 'trace', pinned: 3, current: 1, made: 'newer' },
      { format: 'render', pinned: 1, current: 2, made: 'older' },
    ]);
  });
});

describe('describePinMismatch', () => {
  it('names the format, both numbers and the direction', () => {
    expect(describePinMismatch({ format: 'trace', pinned: 2, current: 1, made: 'newer' })).toBe(
      'trace format 2, this engine has 1 (made with a newer engine)',
    );
    expect(describePinMismatch({ format: 'render', pinned: 1, current: 3, made: 'older' })).toBe(
      'render format 1, this engine has 3 (made with an older engine)',
    );
  });
});
