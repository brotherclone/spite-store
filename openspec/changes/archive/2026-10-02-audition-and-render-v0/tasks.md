## 1. Timing and WAV I/O (engine)

- [x] 1.1 Add `packages/engine/src/audio/timing.ts`: `SAMPLE_RATE`, `CHOKE_FRAMES`, and `barFrame(manifest, bar)` per design D2 (per-entry exact frames, round half up). Verify unit tests cover the constant-tempo, meter-and-tempo-change and 1,000-bar no-drift scenarios from the `audio-rendering` spec.
- [x] 1.2 Add `audio/wav.ts`: `decodeWav` (PCM 16/24, float32, WAVE_FORMAT_EXTENSIBLE, mono or stereo, 48 kHz only, unknown chunks skipped) and `encodeWav16` (canonical header, clip, round half up, no dither). Verify tests cover each supported encoding, mono, wrong rate, wrong channel count, unsupported format, clipping (1.7 → 32767, -2.0 → -32767) and a round trip through an independent parse of the header fields.

## 2. Renderer (engine)

- [x] 2.1 Add `audio/render.ts` per design D4: `realizeForRender`, `planRender` (voices, choke by slot id, piece end and tail ring-out), `createRenderState`, `renderBlock`, `renderAll`, plus `RENDER_FORMAT`. Export them from the engine index. Verify with small inline stems that tests cover each `audio-rendering` scenario for mixing, gain, silence, tails and choke, different slots, section-crossing tails, piece ending and silent endings.
- [x] 2.2 Add block and serialization tests: renders in 128-frame blocks and in 1,000-frame blocks with a JSON round trip of the state equal the one-pass render, and 10 repeated renders hash identically. Verify they pass.
- [x] 2.3 Extend the `node:vm` portability test to render through the IIFE bundle and compare sample hashes with Node. Verify that `pnpm lint` passes with the new files under the engine restrictions, and that the existing trace goldens are unchanged.

## 3. Placeholder piece and stems

- [x] 3.1 Add `audio/synth.ts` (clicks, tone with saw/square/triangle, and noise via Philox; linear envelopes; integer phase; 16-bit quantization) per design D6, exported as placeholder utilities. Verify a test synthesizes every recipe kind, and that the bytes match between Node and the bare `node:vm` context.
- [x] 3.2 Author `pieces/placeholder/manifest.json` and `recipes.json` meeting the `placeholder-stems` spec: at least 3 slots, at least 2 sections, a clip with a tail of at least one bar, a counting-click clip, a sustained pad, a 4/4-to-3/4 change, and an exclusion pair. Verify `spite validate` accepts it and a test checks that recipes and clips correspond one to one.
- [x] 3.3 Add `scripts/stems-placeholder.mjs` and the `stems:placeholder` root script (verify mode and `--update`), and add `.stems/` to `.gitignore`. Run `--update` once to set the manifest hashes. Verify a plain run then exits 0, that editing a recipe makes it exit 1 naming the clip with expected and actual hashes (then revert the edit), and that `git check-ignore .stems/` matches.

## 4. Golden audio

- [x] 4.1 Extend `golden:update` to write `fixtures/golden/placeholder.audio.{0,42,spite-store}.json` (16 bars, frames, WAV sha256, per-bar sha256), synthesizing stems in memory. Add the golden audio test, which on mismatch names the seed and the first differing bar. Verify `pnpm test` passes, and that a deliberate one-line renderer tweak fails with that message (then revert the tweak).

## 5. CLI

- [x] 5.1 Add `args.ts` (flags, repeatable `--seed`, booleans, unknown-flag rejection) and `stems.ts` (resolve `<dir>/<hex>.wav`, verify sha256, decode, and report every missing or invalid stem at once). Move `validate` into `commands/validate.ts` without behavior changes. Verify the existing CLI tests still pass.
- [x] 5.2 Implement `spite realize` (readable output with section markers, and `--json` canonical trace). Verify `execFile` tests cover the readable-trace scenario, and that `--json` hashes to `fixtures/golden/minimal.42.json`'s `traceHash`.
- [x] 5.3 Implement `spite bounce`. Verify tests cover output equal to the seed 42 golden audio hash, a missing stem (exit 2, names clip and hash, no file written), an invalid manifest (exit 1), bad arguments (exit 2), and the default `.stems/` directory.
- [x] 5.4 Implement `spite audition` (reel, seed selection, summaries, temp or `--out` file, `afplay` on macOS, `--no-play`). Verify tests (always `--no-play`) cover the default reel layout with 96,000-frame gaps, chosen seeds in order, conflicting seed options (exit 2) and byte-identical repeated reels. Manually check that `pnpm exec spite audition pieces/placeholder/manifest.json` plays on macOS.
- [x] 5.5 Add `messages.ts` per design D9 and use it in validation output. Verify a test runs every invalid example and asserts that no message contains a regular expression, and that the hash, id and specVersion messages name their values as the modified `music-manifest` spec requires.

## 6. Docs and integration

- [x] 6.1 Update `packages/engine/README.md` (rendering API, timing rule, tails and choke, `RENDER_FORMAT` bump policy), `packages/cli/README.md` (realize, bounce, audition, stems directory) and the root `README.md` (`pnpm stems:placeholder`, then `spite audition`). Verify the documented commands run as written.
- [x] 6.2 From a clean checkout on Node 24, run `pnpm install && pnpm build && pnpm stems:placeholder && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test`. Verify everything passes, no audio file is tracked, and `openspec validate audition-and-render-v0 --strict` passes.
