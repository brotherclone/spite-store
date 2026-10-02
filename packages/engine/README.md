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
