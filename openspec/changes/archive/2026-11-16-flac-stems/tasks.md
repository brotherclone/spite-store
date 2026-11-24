# Tasks

## 1. Engine: FLAC decoder

- [x] 1.1 Add `decodeFlac(bytes, name): Stem` in `packages/engine/src/audio/flac.ts` (D3), exported from `index.ts`: STREAMINFO checks, all subframe types, stereo modes, wasted bits, RICE/RICE2 with escapes, LPC with exact `Math.floor(sum / 2 ** shift)`, and the CRC-8, CRC-16 and sample-count checks. Verify with engine unit tests for "Accepted stem streams" and "Corrupt streams rejected" (a 44.1 kHz, an 8-bit and a 20-bit stream, a WAV, a flipped byte, a truncated stream and a wrong sample count), each error naming the stem. Also verify that `pnpm lint` passes the engine's determinism rules.
- [x] 1.2 Add the "Reads the reference encoder's output" test: encode generated 16- and 24-bit mono and stereo signals with `flac -0`, `-5` and `-8` into a temporary directory, decode them with `decodeFlac`, and compare with `decodeWav` of the source. Skip it with a logged reason when `flac` is not on `PATH`. Verify it passes locally with flac 1.5.0.

## 2. Engine: canonical encoder

- [x] 2.1 Add `encodeFlac(channels: Int32Array[], bits: 16 | 24): Uint8Array` to `flac.ts` with exactly the rules in D2: block size, subframe choice and tie order, wasted bits, partition and Rice search, RICE/RICE2, stereo mode choice, and the STREAMINFO fields. Verify with "Lossless round trip" tests (silence, alternating extremes, seeded white noise from the engine's PRNG, and a sine, at 16 and 24 bits, mono and stereo, with lengths 1, 4,095, 4,096 and 4,097), every decoded sample equal to the input.
- [x] 2.2 Pin the encoder's output: record the sha256 of each committed synthetic test signal's encoding in the codec tests, and run the same encodes inside the standard-globals-only context used by `portability.test.ts`. Verify that "Encoder output is pinned" and "Same bytes on every runtime" pass, and that `flac --test` accepts every output when the tool is installed.
- [x] 2.3 Replace `synthesizeStemWav` with `synthesizeStem` in `packages/engine/src/audio/synth.ts` (D5): `synthesizeClip`, then `quantize16`, then `encodeFlac(…, 16)`. Update `test/helpers/placeholder.ts`, `synth.test.ts` and `packages/player/test/mixer.test.ts` to decode with `decodeFlac`. Verify the engine and mixer tests pass with every golden audio and float32 snapshot unchanged (`git diff fixtures/golden` empty).

## 3. CLI: pack, stem lookup and publish

- [x] 3.1 Change pack (D5): read each clip's frame range into `Int32Array` channels, encode it with `encodeFlac` at the source's depth, decode it and compare with the input before writing (a hard error on mismatch), and write `<hex>.flac`. Refuse float32 sources with the spec's message. Update `wavslice.ts`, `pack.ts` and their tests. Verify the "Pack command", "Source checks" and "Canonical stem bytes" scenarios as CLI tests on generated WAV sources, including metadata and extensible-header independence, exact samples for 24-bit mono, repeatability across two stems directories, and a float source exiting 2.
- [x] 3.2 Change `packages/cli/src/stems.ts` to look up `<dir>/<hex>.flac` and decode with `decodeFlac`, and update the usage text and error hints. Verify the "Stem resolution by content hash" scenarios, including "Only a WAV stem present" exiting 2, and that `bounce` of the placeholder for seed `42` still matches its golden audio hash.
- [x] 3.3 Change `publish.ts` to name stems `<hex>.flac` with content type `audio/flac`, keeping MP3 fallbacks as they are. Verify with `publish.test.ts` against its fake store: stored names, the content type, the "Re-publishing after the switch to FLAC" scenario (24 uploaded, the fallback already present, no `.wav` touched), and `--check` requesting `.flac` names.
- [x] 3.4 Update `packages/cli/README.md` (pack writes FLAC, float sources refused) and `schema/CHANGELOG.md` (stem files are FLAC, no schema change). Verify `pnpm format:check` passes.

## 4. Site and player

- [x] 4.1 Change `site/dev-serve.ts` and `vite.config.ts` to serve `/stems/<hex>.flac` as `audio/flac` and stop serving `.wav`. Verify with `site/test/dev-serve.test.ts` covering every "Development serving of pieces and stems" scenario, including "WAV stems not served".
- [x] 4.2 Change `scripts/deploy-check.mjs` and `site/test/deploy.test.ts` so the reachability check requests `<hex>.flac`. Verify the deploy tests pass, including a missing `.flac` failing the build and naming the clip.
- [x] 4.3 Change `packages/player/src/loader.ts` to fetch `<stems><hex>.flac` and decode with `decodeFlac`, and update the `stemsBase` doc comment and `packages/player/README.md`. Verify with browser tests in Chromium, Firefox and WebKit: "Only needed stems are fetched" (`.flac` URLs only), "Undecodable stem", the existing hash-mismatch and fallback scenarios, and "Same samples in every browser from FLAC" against the placeholder's float32 golden for seed `42`.
- [x] 4.4 Add the "Same samples on every runtime" decoder test: decode the placeholder's FLAC stems in Node and in all three browsers, and compare the sha256 of each channel's Float32 samples. Verify it passes in all four.

## 5. Re-hash the pieces

- [x] 5.1 Run `pnpm stems:placeholder -- --update` to rewrite the placeholder's clip hashes, then run it again without `--update`. Verify the second run exits 0 and writes only `.flac` files, and that the golden audio snapshots are unchanged.
- [x] 5.2 Before re-packing, bounce the River's seed `spite-store` for 64 bars from the existing WAV stems and keep the file in the scratchpad. To bounce from WAV after task 3.2 lands, use a build from `develop`.
- [x] 5.3 Run `spite pack pieces/the-river-forgets-to-answer/manifest.json --source <…>/Collaborations --update`. Verify that `pack.json` is byte-identical (sources unchanged), every new stem decodes to Float32 samples identical to its old WAV stem's (matched by clip id), and a new 64-bar bounce of `spite-store` is byte-identical to the one from 5.2.
- [x] 5.4 Run `pnpm golden:update`, and check with a one-off script that each River golden trace, with old hashes mapped to new ones by clip id, is identical to its previous version (D6). Also check that `minimal.*.json` and every `placeholder.*.json` are unchanged. Add re-hashing stems to the reasons in `fixtures/golden/README.md`. Verify `pnpm test` passes.

## 6. Measure and release

- [x] 6.1 Measure the River before and after, for seeds `0`, `42` and `spite-store`: bytes of the stems first used at bar 0, bytes of all stems the seed uses, and total catalogue bytes, in WAV and FLAC. Also measure `decodeFlac` time per MB of FLAC in Chromium, Firefox and WebKit, on the River's largest stem. Record the results in a "Measured" section of `design.md`. Verify the catalogue is at most 60% of its WAV size ("Smaller than WAV on recorded audio"). If any browser decodes slower than about 50 ms per MB, note the Worker follow-up there.
- [x] 6.2 Run the full suite: `pnpm test`, `pnpm test:browser`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check`. Verify all pass and that the golden audio and float32 snapshots are unchanged since the start of the change.
- [x] 6.3 Publish: `node --env-file=.env.local packages/cli/bin/spite.js publish pieces/*/manifest.json`. Verify the summary reports the new `.flac` stems uploaded, the fallbacks already present and no WAV touched, and that `spite publish --check pieces/*/manifest.json` exits 0.
- [x] 6.4 Verify on a preview deployment: in each browser, the River and the placeholder play, stem requests are `/stems/<hex>.flac` with `Content-Type: audio/flac`, and the first-wait bytes shown in DevTools match 6.1. Then merge into `develop` and `master`, and confirm production requests `.flac` stems.

## Workflow follow-up

- Archive the change with `/opsx:archive` once every task is done.
