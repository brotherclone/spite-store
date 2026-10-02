import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { decodeWav, synthesizeClip, synthesizeStemWav, type ClipRecipe } from '../../src/index.js';

const recipes: Record<string, ClipRecipe> = {
  clicks: {
    kind: 'clicks',
    frames: 96000,
    level: 0.6,
    every: 24000,
    accentEvery: 4,
    clickFrames: 480,
  },
  saw: {
    kind: 'tone',
    frames: 48000,
    level: 0.3,
    wave: 'saw',
    period: 109,
    channels: 2,
    detune: 1,
    attack: 480,
    release: 9600,
  },
  square: { kind: 'tone', frames: 4800, level: 0.3, wave: 'square', period: 200 },
  triangle: { kind: 'tone', frames: 4800, level: 0.3, wave: 'triangle', period: 97 },
  noise: { kind: 'noise', frames: 24000, level: 0.4, seed: 'hat', decay: 4800, channels: 2 },
};

const sha = (b: Uint8Array) =>
  createHash('sha256')
    .update(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
    .digest('hex');

describe('placeholder synthesis', () => {
  it.each(Object.entries(recipes))('%s produces a valid, bounded stem', (name, recipe) => {
    const channels = synthesizeClip(recipe, name);
    for (const ch of channels) {
      expect(ch.length).toBe(recipe.frames);
      expect(ch.every((v) => v >= -1 && v <= 1)).toBe(true);
      expect(ch.some((v) => v !== 0)).toBe(true);
    }
    const stem = decodeWav(synthesizeStemWav(recipe, name), name);
    expect(stem.frames).toBe(recipe.frames);
  });

  it('shapes envelopes and tails as specified', () => {
    const [saw] = synthesizeClip(recipes.saw!);
    expect(saw![0] === 0).toBe(true);
    expect(saw![47999]).not.toBe(0);
    const [noise] = synthesizeClip(recipes.noise!);
    expect(noise!.subarray(4800).every((v) => v === 0)).toBe(true);
  });

  it('produces the same bytes in a bare ECMAScript context', () => {
    const context = createContext({});
    runInContext(
      readFileSync(join(import.meta.dirname, '../../dist/engine.iife.js'), 'utf8'),
      context,
    );
    for (const [name, recipe] of Object.entries(recipes)) {
      const bytes = runInContext(
        `SpiteEngine.synthesizeStemWav(${JSON.stringify(recipe)}, ${JSON.stringify(name)})`,
        context,
      ) as Uint8Array;
      expect(sha(bytes)).toBe(sha(synthesizeStemWav(recipe, name)));
    }
  });

  it('rejects malformed recipes', () => {
    expect(() => synthesizeClip({ ...recipes.square!, period: 0 } as ClipRecipe, 'bad')).toThrow(
      /recipe bad/,
    );
    expect(() => synthesizeClip({ kind: 'sine', frames: 1, level: 1 } as never, 'bad')).toThrow(
      /unknown kind/,
    );
  });
});
