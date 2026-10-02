# @spite-store/engine

Turns a music manifest and a seed into a reproducible event trace. Pure TypeScript, zero runtime
dependencies, no DOM and no Node APIs: the same bundle runs in Node and in an AudioWorklet and
produces bit-identical results.

## Usage

Build first (`pnpm --filter @spite-store/engine build`), then from the repo root:

```js
import { readFileSync } from 'node:fs';
import { checkManifest, realize, advance, createState } from '@spite-store/engine';

const manifest = JSON.parse(readFileSync('schema/examples/valid/minimal.json', 'utf8'));
console.log(checkManifest(manifest)); // [] when valid

// One shot: every event for 64 bars.
const trace = realize(manifest, 'spite-store', { durationBars: 64 });
console.log(trace.slice(0, 3)); // [{ bar, beat, slot, clipHash, gain }, ...]

// Chunked: the state is plain JSON and can be stored or sent between chunks.
let state = createState(manifest, 'spite-store', { durationBars: 64 });
const first = advance(manifest, state, 16);
state = JSON.parse(JSON.stringify(first.state));
const rest = advance(manifest, state, 64);
console.log(first.events.length + rest.events.length === trace.length); // true
```

## API

| Export                                          | Purpose                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `realize(manifest, seed, { durationBars })`     | The full trace, ordered by bar, then slot id.                                      |
| `createState(manifest, seed, { durationBars })` | Validates the manifest and returns the initial state.                              |
| `advance(manifest, state, untilBar)`            | Realizes up to `untilBar`; returns `{ events, state }` without mutating the input. |
| `checkManifest(manifest)`                       | Structural and semantic checks; returns `{ pointer, message }[]`.                  |
| `createRandom(seed)`                            | The seeded decision source: `draw`, `rand`, `chance`, `range`, `weightedPick`.     |
| `canonicalTrace(events)`                        | Fixed-key-order JSON of a trace; `traceHash` is its sha256.                        |
| `manifestFingerprint(manifest)`                 | Key-order-independent id of a manifest, stored in the state.                       |
| `TRACE_FORMAT`                                  | Version of the realization rules (see below).                                      |

A seed is a string or a non-negative safe integer; `42` and `"42"` are the same seed.

## Randomness

Every random value is `Philox4x32-10(key = hash(seed), counter = [hash(path), drawIndex / 4, 0])`,
word `drawIndex % 4`. Nothing carries state between draws, so a value depends only on
(seed, decision path, draw index). Draw order is irrelevant, and adding a decision never shifts
existing ones. Only exactly specified arithmetic is used (integer ops, `Math.imul`, `+ - * /`,
comparisons), and ESLint bans `Math.random`, `Date`, `Intl`, locale methods and transcendental
`Math.*` in `src/`.

## Decision paths

These paths are the stable contract. Changing them changes what every shared seed means.

| Decision     | Path                                                    |
| ------------ | ------------------------------------------------------- |
| Next section | `["v", visitOrdinal, "next"]`                           |
| Slot entry   | `["v", visitOrdinal, "s", slotId, "enter"]`             |
| Clip pick    | `["v", visitOrdinal, "s", slotId, "pick", pickOrdinal]` |

`visitOrdinal` counts section visits from 0. `pickOrdinal` counts pick attempts within the slot's
visit, including one-bar rests forced by exclusions. Weighted choices sum their candidates in
code-unit order of id (transition targets, clip ids), so declaration order never matters.

## `traceFormat` bump policy

`TRACE_FORMAT` (and the state's `v`) is bumped by any change that alters the trace for an existing
(manifest, seed, durationBars). That covers the PRNG, the path or seed encoding, the decision
paths, ordering rules, or the realization rules. A bump means existing shared seeds now sound
different. Ship it deliberately, together with `pnpm golden:update`. Changes that leave every trace
identical (refactors, new optional manifest features that existing manifests don't use) do not bump
it, and the golden tests prove that.

## Audio rendering

The engine also turns a trace into audio, with the same determinism promise: the same manifest,
seed, duration and stems give **identical samples** on every runtime.

```js
import { readFileSync } from 'node:fs';
import { decodeWav, renderWav } from '@spite-store/engine';

const manifest = JSON.parse(readFileSync('pieces/placeholder/manifest.json', 'utf8'));
// Stems keyed by clip hash; run `pnpm stems:placeholder` first to create .stems/.
const stems = new Map(
  Object.values(manifest.clips).map((c) => [
    c.hash,
    decodeWav(readFileSync(`.stems/${c.hash.slice(7)}.wav`), c.hash),
  ]),
);
const { wav, frames } = renderWav(manifest, 42, { durationBars: 16 }, stems);
console.log(wav.byteLength, frames); // a 16-bit 48 kHz stereo WAV file
```

| Export                                               | Purpose                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `renderWav(manifest, seed, { durationBars }, stems)` | Realize, render and encode in one call.                                                    |
| `realizeForRender(manifest, seed, opts)`             | The trace plus `endBar`, the bar after the last realized bar.                              |
| `planRender(manifest, events, endBar, stems)`        | Voices with start, choke and end frames, plus the total length. Plain JSON.                |
| `renderBlock(plan, stems, state, frames)`            | Renders the next block. State is `{ v, frame }`, so any block size gives the same samples. |
| `renderAll(plan, stems)`                             | One-pass render.                                                                           |
| `barFrame(manifest, bar)`                            | Start frame of a bar (48 kHz).                                                             |
| `decodeWav(bytes, name)` / `encodeWav16(channels)`   | Stem decoding (PCM 16/24, float32, 48 kHz, mono or stereo) and canonical 16-bit output.    |
| `synthesizeStemWav(recipe)`                          | Placeholder stem synthesis (development only).                                             |
| `RENDER_FORMAT`                                      | Version of the rendering rules (see below).                                                |

**Timing.** Within a tempo entry `{ bar: s, bpm, meter: [beats, unit] }`, bar `b` starts at
`F(s) + round((b - s) * beats * (4/unit) * 60 * 48000 / bpm)`, rounding halves up. Errors never
accumulate across bars.

**Tails and choke.** A stem may be longer than its clip's `lengthBars`; the rest is its tail. A
clip sounds until its stem ends or until the **same slot id** starts its next clip, which fades it
out linearly over 480 frames (10 ms). Different slot ids never choke each other, tails ring across
section boundaries, and after the last bar every tail rings out. Exclusions constrain clip bodies
only, so a tail may briefly overlap a clip it excludes. Because slot ids act as voices, reusing a
slot id in two sections for unrelated material makes them choke each other.

**Mixing.** Each output frame is the sum, in trace order, of `sample * gain * fade` over the voices
sounding at that frame, computed in doubles. Output clips to [-1, 1] and rounds `x * 32767` half up,
with no dither.

### `RENDER_FORMAT` bump policy

Bump `RENDER_FORMAT` for any change that alters rendered samples for an existing (manifest, seed,
stems), such as timing, choke, mixing or encoding, and regenerate the golden audio with
`pnpm golden:update`. Bumping `TRACE_FORMAT` implies new audio too, so regenerate both.
