# Tasks

## 1. Manifest: the `pan` field

- [x] 1.1 In `packages/engine/src/manifest.ts`, add `pan?: number | { min: number; max: number }` to `Slot` and check it in `checkStructure`: a number in [-1, 1], or an object with exactly `min` and `max` in [-1, 1] and `min ≤ max`. Add the slot key allowlist (`id`, `enter`, `gain`, `noRepeat`, `pool`, `pan`) with an `unknown slot property "<key>"` message (D6). Verify with `manifest.test.ts` cases for every "Slot pan field" and "Unknown slot properties rejected" scenario, including that every manifest under `schema/examples/valid/` and `pieces/` still passes the engine check.
- [x] 1.2 Add `pan` to the slot in `schema/manifest.schema.json` (`oneOf` a number in [-1, 1], or a closed `{ min, max }` object). Add the valid examples `pan-fixed.json` and `pan-range.json`, and invalid examples for out of range, inverted range and an unknown range field. The schema can't express `min ≤ max`, so the inverted example is rejected by the engine check, as other semantic rules are. Add "### 0.1 addition: `pan`" to `schema/CHANGELOG.md` (D5). Verify the "Engine and schema agree" scenario through `spite validate` on each example, and that `pnpm format:check` passes.

## 2. Realization: pan on events

- [x] 2.1 In `packages/engine/src/realize.ts`, add an optional `pan` to `TraceEvent`. A fixed slot `pan` is copied onto each event. For a range, draw on `['v', visitOrdinal, 's', slotId, 'pan', pickOrdinal]` only when a clip is picked, then compute `min + (max − min) × (draw % 101) / 100` (D4). Have `canonicalTrace` append `"pan"` after `gain` only when present (D3). Verify with `realize.test.ts` for every "Pan in the trace" and "Drawn pan" scenario. The strip-the-`pan`-fields checks run against the minimal goldens for seeds `0`, `42` and `"spite-store"`, and the resume check splits at bar 30. Also verify that `golden.test.ts` passes with `git diff fixtures/golden` empty.
- [x] 2.2 Add the drawn-pan manifest to the bare-context portability test, so `portability.test.ts` realizes it with only standard ECMAScript globals and gets the same trace hash as Node. Verify that the test passes and that `pnpm lint` passes the engine's determinism rules.

## 3. Rendering: the pan law

- [x] 3.1 In `packages/engine/src/audio/render.ts`, add an optional `pan` to `Voice`, copied from the event in `planRenderPartial` and left absent when the event has none; the renderer treats absent as 0. In `renderBlockInto`, add `l[i] × (g × L)` and `r[i] × (g × R)` with the balance factors from D1. Update the engine README's rendering notes, including that a hard-panned stereo stem loses one channel. Verify with render tests for "Mono stem panned left" and "Stereo stem panned hard right", "Centre and absent pan render the same samples" against the placeholder's golden audio and float32 snapshots for seed `42`, and "Golden audio unchanged" (`git diff fixtures/golden` empty after `pnpm test`).
- [x] 3.2 Add a panned placeholder variant as a test fixture, `packages/engine/test/fixtures/placeholder-panned.json`: the placeholder's manifest with fixed pans on some slots and a range on one, including at least one stereo stem panned. Verify "Panned render is the same everywhere": the float32 sha256 for 16 bars with seed `42` is equal in Node and in the bare context (engine tests), and in Chromium, Firefox and WebKit (a browser test in `packages/player/test-browser/determinism.test.ts`).

## 4. Player: the structure view

- [x] 4.1 In `packages/player/src/lanes.ts`, append the position to a block's label when its voice has a pan: `L`/`R` and the rounded percentage, or `C` (D7). Panned voices carry their pan into the plan the lanes read; voices without one stay unlabelled. Update `packages/player/README.md`. Verify "Positions labelled" with a lanes unit test using pans −0.6, 0.25, 0.004 and none, and "Panned piece is sample-identical in the browser" with the 3.2 browser test.

## 5. Place the River

- [x] 5.1 Before changing the River, save its current manifest and its three golden traces to the scratchpad as the centred release. Then bounce seed `spite-store` for 64 bars with the D8 positions scaled ×0.75, ×1 and ×1.25, and give the three WAVs to the author to audition. Pause until the author picks a set of positions; do not choose for them. Verify that the chosen values meet "Seating" (violins negative, viola and cello positive, close and room on the same side, `|pan| ≤ 0.8`).
- [x] 5.2 Write the chosen fixed `pan` values into the River's eight slots, leaving gains, pools and the engine pin unchanged. Run `pnpm golden:update`. Check with a one-off script that each new River trace, with its `pan` fields removed, equals the centred release's trace, and that every event's `pan` is its slot's value ("Same clip choices as the centred release"). Check that `minimal.*` and every `placeholder.*` snapshot is unchanged. Record the positions in the River's README, rerun its peak check (seeds 0–19, 64 bars) and update the figures. Verify that `pnpm test` passes.
- [x] 5.3 Run `pnpm exec spite fallback pieces/the-river-forgets-to-answer/manifest.json --seed spite-store --update`. Verify the "Fallback is placed, not centred" scenario on the new MP3 (RMS of L−R at least a tenth of RMS of L+R, decoded with ffmpeg), and that `spite fallback` without `--update` then exits 0.

## 6. Release

- [x] 6.1 Run the full suite: `pnpm test`, `pnpm test:browser`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check`. Verify that all pass, and that the only changed golden files are the River's three traces.
- [x] 6.2 Publish with `node --env-file=.env.local packages/cli/bin/spite.js publish pieces/*/manifest.json`, after confirming with the author. Verify that the summary uploads only the new fallback (every stem already present), and that `node scripts/deploy-check.mjs` exits 0 ("New fallback declared and published").
- [ ] 6.3 Push for a preview, after confirming with the author. In Chromium, Firefox and WebKit, verify that the River plays placed (the author listens), its lane labels show the positions, and the placeholder is unchanged. Then merge into `develop` and `master` and confirm production serves the placed River.

## Workflow follow-up

- Archive the change with `/opsx:archive` once every task is done.
