// Regenerates fixtures/golden/ from the built engine. Run via `pnpm golden:update`.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TRACE_FORMAT, canonicalTrace, realize } from '@spite-store/engine';

const root = join(import.meta.dirname, '..');
const manifestPath = 'schema/examples/valid/minimal.json';
const manifest = JSON.parse(readFileSync(join(root, manifestPath), 'utf8'));
const durationBars = 64;

for (const seed of [0, 42, 'spite-store']) {
  const trace = realize(manifest, seed, { durationBars });
  const traceHash = createHash('sha256').update(canonicalTrace(trace)).digest('hex');
  const file = join(root, 'fixtures/golden', `minimal.${seed}.json`);
  const snapshot = {
    manifest: manifestPath,
    seed,
    durationBars,
    traceFormat: TRACE_FORMAT,
    traceHash,
    trace,
  };
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${file}  ${traceHash}  (${trace.length} events)`);
}

// Golden audio: the placeholder piece rendered with stems synthesized in memory.
const { RENDER_FORMAT, barFrame, decodeWav, renderWav, synthesizeStemWav } =
  await import('@spite-store/engine');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const placeholderPath = 'pieces/placeholder/manifest.json';
const placeholder = JSON.parse(readFileSync(join(root, placeholderPath), 'utf8'));
const recipes = JSON.parse(readFileSync(join(root, 'pieces/placeholder/recipes.json'), 'utf8'));
const stems = new Map();
for (const [id, recipe] of Object.entries(recipes)) {
  const bytes = synthesizeStemWav(recipe, id);
  const hash = `sha256:${sha(bytes)}`;
  if (placeholder.clips[id].hash !== hash) {
    throw new Error(
      `placeholder stem ${id} does not match its manifest hash; run pnpm stems:placeholder`,
    );
  }
  stems.set(hash, decodeWav(bytes, hash));
}
for (const seed of [0, 42, 'spite-store']) {
  const durationBars = 16;
  const { wav, frames, endBar } = renderWav(placeholder, seed, { durationBars }, stems);
  const bounds = Array.from({ length: endBar + 1 }, (_, b) => barFrame(placeholder, b)).concat(
    frames,
  );
  const barSha256 = bounds
    .slice(0, -1)
    .map((from, i) => sha(wav.subarray(44 + from * 4, 44 + bounds[i + 1] * 4)));
  const snapshot = {
    manifest: placeholderPath,
    seed,
    durationBars,
    renderFormat: RENDER_FORMAT,
    frames,
    wavSha256: sha(wav),
    barSha256,
  };
  const file = join(root, 'fixtures/golden', `placeholder.audio.${seed}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${file}  ${snapshot.wavSha256}  (${frames} frames)`);
}

// Float32 goldens: what the browser worklet outputs (each renderer sample rounded to float32).
const { planRender, realizeForRender, renderAll } = await import('@spite-store/engine');
for (const seed of [0, 42, 'spite-store']) {
  const durationBars = 16;
  const { events, endBar } = realizeForRender(placeholder, seed, { durationBars });
  const plan = planRender(placeholder, events, endBar, stems);
  const { left, right } = renderAll(plan, stems);
  const interleaved = new Float32Array(plan.totalFrames * 2);
  for (let f = 0; f < plan.totalFrames; f++) {
    interleaved[2 * f] = left[f];
    interleaved[2 * f + 1] = right[f];
  }
  const snapshot = {
    manifest: placeholderPath,
    seed,
    durationBars,
    renderFormat: RENDER_FORMAT,
    frames: plan.totalFrames,
    float32Sha256: sha(new Uint8Array(interleaved.buffer)),
  };
  const file = join(root, 'fixtures/golden', `placeholder.float32.${seed}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n');
  console.log(`${file}  ${snapshot.float32Sha256}`);
}
