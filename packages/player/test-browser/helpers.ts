import {
  decodeWav,
  planRender,
  realizeForRender,
  synthesizeStemWav,
  type ClipRecipe,
  type Manifest,
  type RenderPlan,
  type Stem,
} from '@spite-store/engine';
import manifestJson from '../../../pieces/placeholder/manifest.json';
import recipesJson from '../../../pieces/placeholder/recipes.json';
import { EngineNode } from '../src/audio.js';

export const placeholder = manifestJson as unknown as Manifest;
export const recipes = recipesJson as unknown as Record<string, ClipRecipe>;
export const workletUrl = new URL('../dist/worklet.js', import.meta.url).href;

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Placeholder stem files synthesized in the page (byte-identical to `pnpm stems:placeholder`). */
export async function placeholderStemFiles(): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const [id, recipe] of Object.entries(recipes)) {
    const bytes = synthesizeStemWav(recipe, id);
    const hash = `sha256:${await sha256Hex(bytes)}`;
    if (hash !== placeholder.clips[id]!.hash)
      throw new Error(`synthesized stem ${id} has hash ${hash}`);
    files.set(hash, bytes);
  }
  return files;
}

export async function placeholderStems(): Promise<Map<string, Stem>> {
  const stems = new Map<string, Stem>();
  for (const [hash, bytes] of await placeholderStemFiles()) stems.set(hash, decodeWav(bytes, hash));
  return stems;
}

export function planFor(seed: string | number, bars: number, stems: Map<string, Stem>): RenderPlan {
  const { events, endBar } = realizeForRender(placeholder, seed, { durationBars: bars });
  return planRender(placeholder, events, endBar, stems);
}

/**
 * Renders `frames` frames of a plan through the real worklet in an OfflineAudioContext, starting
 * at `fromFrame`. Rendering only starts after the worklet acknowledges seek and play.
 */
export async function renderThroughWorklet(
  plan: RenderPlan,
  stems: Map<string, Stem>,
  fromFrame = 0,
  frames = plan.totalFrames - fromFrame,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(2, frames, 48000);
  const engine = await EngineNode.create(context, workletUrl);
  engine.node.connect(context.destination);
  await engine.load(plan, stems, { transfer: false });
  const acknowledged = (expectPlaying: boolean) =>
    new Promise<void>((resolve) => {
      engine.onPosition = (_frame, playing) => {
        if (playing === expectPlaying) resolve();
      };
    });
  if (fromFrame > 0) {
    const seeked = acknowledged(false);
    engine.seek(fromFrame);
    await seeked;
  }
  const started = acknowledged(true);
  engine.play();
  await started;
  const buffer = await context.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);
  const out = new Float32Array(frames * 2);
  for (let f = 0; f < frames; f++) {
    out[2 * f] = left[f]!;
    out[2 * f + 1] = right[f]!;
  }
  return out;
}
