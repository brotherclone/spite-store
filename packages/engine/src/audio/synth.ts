/**
 * Placeholder stem synthesis. Uses only exactly specified arithmetic (integer phase, linear
 * envelopes, Philox noise), so a recipe produces byte-identical WAV files on every runtime.
 * Meant for development and tests, not for music.
 */
import { createRandom } from '../random.js';
import { encodeWav16 } from './wav.js';

export type ClipRecipe =
  | {
      kind: 'clicks';
      frames: number;
      level: number;
      /** Frames between clicks. */
      every: number;
      /** Every n-th click (starting with the first) is accented. */
      accentEvery: number;
      clickFrames: number;
    }
  | {
      kind: 'tone';
      frames: number;
      level: number;
      wave: 'saw' | 'square' | 'triangle';
      /** Waveform period in frames. */
      period: number;
      channels?: 1 | 2;
      /** Added to the period of the right channel (stereo only). */
      detune?: number;
      attack?: number;
      /** Linear fade to silence over the last `release` frames. */
      release?: number;
    }
  | {
      kind: 'noise';
      frames: number;
      level: number;
      seed: string;
      /** Linear decay to silence over this many frames from the start. */
      decay: number;
      channels?: 1 | 2;
    };

const positiveInt = (v: unknown): boolean => Number.isSafeInteger(v) && (v as number) > 0;

function check(recipe: ClipRecipe, name: string): void {
  const fail = (what: string): never => {
    throw new Error(`recipe ${name}: ${what}`);
  };
  if (!positiveInt(recipe.frames)) fail('frames must be a positive integer');
  if (!(recipe.level >= 0 && recipe.level <= 1)) fail('level must be in [0, 1]');
  if (recipe.kind === 'clicks') {
    if (
      !positiveInt(recipe.every) ||
      !positiveInt(recipe.accentEvery) ||
      !positiveInt(recipe.clickFrames)
    ) {
      fail('every, accentEvery and clickFrames must be positive integers');
    }
  } else if (recipe.kind === 'tone') {
    if (!positiveInt(recipe.period)) fail('period must be a positive integer');
    if (!['saw', 'square', 'triangle'].includes(recipe.wave))
      fail(`unknown wave "${String(recipe.wave)}"`);
  } else if (recipe.kind === 'noise') {
    if (typeof recipe.seed !== 'string' || !positiveInt(recipe.decay))
      fail('noise needs a seed and a positive decay');
  } else {
    fail(`unknown kind "${String((recipe as { kind: unknown }).kind)}"`);
  }
}

function wave(shape: 'saw' | 'square' | 'triangle', n: number, period: number): number {
  const phase = n % period;
  if (shape === 'saw') return (2 * phase) / period - 1;
  if (shape === 'square') return 2 * phase < period ? 1 : -1;
  return 1 - 4 * Math.abs(phase / period - 0.5);
}

/** Synthesizes a recipe as one or two channels of samples in [-1, 1]. */
export function synthesizeClip(recipe: ClipRecipe, name = 'clip'): Float64Array[] {
  check(recipe, name);
  const { frames, level } = recipe;

  if (recipe.kind === 'clicks') {
    const out = new Float64Array(frames);
    for (let n = 0; n < frames; n++) {
      const index = Math.floor(n / recipe.every);
      const i = n - index * recipe.every;
      if (i >= recipe.clickFrames) continue;
      const accent = index % recipe.accentEvery === 0;
      const period = accent ? 12 : 24;
      const amplitude = (accent ? 1 : 0.5) * (1 - i / recipe.clickFrames);
      out[n] = level * amplitude * wave('square', i, period);
    }
    return [out];
  }

  if (recipe.kind === 'tone') {
    const channels = recipe.channels ?? 1;
    const attack = recipe.attack ?? 0;
    const release = recipe.release ?? 0;
    return Array.from({ length: channels }, (_, c) => {
      const period = recipe.period + (c === 1 ? (recipe.detune ?? 0) : 0);
      const out = new Float64Array(frames);
      for (let n = 0; n < frames; n++) {
        let env = 1;
        if (n < attack) env = n / attack;
        const left = frames - n;
        if (left < release) env = env * (left / release);
        out[n] = level * env * wave(recipe.wave, n, period);
      }
      return out;
    });
  }

  const random = createRandom(recipe.seed);
  const channels = recipe.channels ?? 1;
  return Array.from({ length: channels }, (_, c) => {
    const out = new Float64Array(frames);
    for (let n = 0; n < frames && n < recipe.decay; n++) {
      const white = random.draw(['noise', c], n) / 2147483648 - 1;
      out[n] = level * (1 - n / recipe.decay) * white;
    }
    return out;
  });
}

/** Synthesizes a recipe and encodes it as a canonical 16-bit 48 kHz WAV file. */
export function synthesizeStemWav(recipe: ClipRecipe, name = 'clip'): Uint8Array {
  return encodeWav16(synthesizeClip(recipe, name));
}
