# Tasks

## 1. Engine: 24-bit track encoding

- [x] 1.1 In `packages/engine/src/audio/wav.ts`, add `quantize24` beside `quantize16` (clip, ×8,388,607, `Math.floor(x + 0.5)`), and add `encodeTrackFlac(left, right)`, which quantizes into `Int32Array`s and calls `encodeFlac(…, 24)`. Export both from the engine index (D1). Verify with engine unit tests for the "Quantization rule" scenario (-1.5, -1, 0, 0.5, 1), a round trip through `decodeFlac` that returns the quantized integers exactly, and `pnpm lint` passing the engine's determinism rules.
- [x] 1.2 Extend `packages/engine/test/portability.test.ts`: render `minimal.json` with `rampStems` for seed `42` and 16 bars, call `encodeTrackFlac` in Node and through the IIFE bundle in a bare context, and compare sha256. Verify "Same bytes in a bare context" passes after `pnpm build`. Add a line on track encoding to the engine README.

## 2. Release file: schema and validation

- [x] 2.1 Add `schema/release.schema.json` (Draft 2020-12, closed objects: `credits[]` `{name, role}`, `tracks[]` with `id`, `title`, `version`, `seed`, `bars`, `audio`, `frames`) and `schema/examples/release/{valid,invalid}/`, each example with a sibling fixture `versions.json`. Valid: `{}`, credits only, one track, two tracks. Invalid: unknown top-level field, empty role, duplicate track id, missing audio, `bars` 0, unrecorded version, tracks without `versions.json`. Add a "release file" entry to `schema/CHANGELOG.md`. Verify that the schema compiles with Ajv2020 in strict mode, and that `pnpm format:check` passes.
- [x] 2.2 Add `packages/cli/src/release.ts` with `loadRelease(pieceDir)`: none, `{ credits, tracks }`, or errors as `{ pointer, message }` in `spite validate`'s plain-language style. It runs the schema, then unique ids and recorded versions (D5), using `freeze-piece-versions`' `parseVersions`. Verify with `packages/cli/test/release.test.ts`, which runs every example under `schema/examples/release/` and covers every `piece-release` scenario, including the exact pointer `/tracks/0/bars` for `bars` 0.

## 3. `spite track`

- [x] 3.1 Split `packages/cli/src/render.ts` into `renderSeed` (float channels and frame count) and `renderSeedWav` (unchanged bytes), as in D1. Verify that `bounce.test.ts`, `fallback.test.ts` and the golden audio tests pass with `git diff fixtures/golden` empty.
- [x] 3.2 Add `packages/cli/src/commands/track.ts`, registered in `bin.ts` and `USAGE`. It parses arguments (exit 2 on usage errors), resolves `--version` through `versions.json` (exit 1 if unknown), loads and hash-checks `<stems>/<hex>.json` (exit 2 if missing or mismatched, naming `spite freeze`), checks the pin with no override (exit 1), loads `release.json` (exit 1 if invalid), renders, encodes with `encodeTrackFlac`, and writes `<stems>/<audio-hex>.flac`. Verify with `packages/cli/test/track.test.ts`, which uses the placeholder frozen into a temp stems dir, for "Track written by hash", "Same bytes on a second run", "Renders the frozen version, not the working manifest", and every "Track input checks" scenario (each asserting that nothing is written).
- [x] 3.3 Implement recording and checking: `--update` creates or extends `release.json` (two-space JSON, trailing newline, other fields untouched), retitles in place, and refuses any change to version, seed, bars or audio. Without `--update`, compare exactly. Verify with `track.test.ts` for "New track recorded" (the result passes `loadRelease`), "Retitling", "Changing a track's seed" (file byte-identical), "Current track" and "Unrecorded track". Also verify "Same render as bounce" by decoding the FLAC, converting to 16-bit and comparing with `spite bounce` of the frozen manifest within ±1 per sample.
- [x] 3.4 Document `spite track` in `packages/cli/README.md`. Add a "Tracks and credits" section to `pieces/README.md` covering `release.json`, hand-written credits, the immutability of recorded tracks, and that `spite publish` ships track audio. Verify that the documented commands match `spite --help`.

## 4. Publishing track audio

- [x] 4.1 Extend `collectFiles` in `packages/cli/src/publish.ts` to take manifest paths, load each sibling `release.json` with `loadRelease`, and add each track's `<audio-hex>.flac` with the owner `track:<id>` (D7). Make `publish` and `publish --check` print release errors and exit 1 before reading or uploading files. Verify with `publish.test.ts` for "Track audio published", "Invalid release file", "Missing local track", "Track audio missing" and "Invalid release file fails the check", plus every existing publish scenario unchanged.
- [x] 4.2 Verify with `site/test/deploy.test.ts` (a local server and a temp pieces dir) that a piece whose track audio is absent from the store fails `scripts/deploy-check.mjs` naming `track:<id>`, with no change to the script.

## 5. Track pages

- [x] 5.1 Add `site/src/track-page.ts` with `escapeHtml` and `renderTrackPage(...)` (D6): the document head with title, description and Open Graph tags (leaving out `og:url` and `og:audio` without an origin), the details block, credits, `audio` with `preload="metadata"`, the download link named `<piece-id>--<track-id>.flac` with the format note, and the live link with `version`, `seed` and `bars`. Inline CSS matching the player page, no script. Verify with `site/test/track-page.test.ts` for "Details shown" (`2:14` from 6,432,000 frames), "Markup in a title is text", "Audio element", "Download named for the track", "Preview tags present" and "No origin configured".
- [x] 5.2 Add a site-side release checker (Ajv with `@spite-store/schema/release.schema.json`, plus unique ids and recorded versions), and add `ajv` and `@spite-store/schema` as site dev dependencies (D5). Verify with a site test that runs every `schema/examples/release/` example and agrees with the CLI on valid and invalid.
- [x] 5.3 In `site/vite.config.ts`, extend the build plugin to emit `pieces/<id>/tracks/<track-id>/index.html` for every track, fail the build on an invalid `release.json`, and read `VITE_SITE_ORIGIN` through `loadEnv`. Verify with `site/test/build.test.ts`, using a temp pieces dir with a frozen fixture piece, for "Track pages emitted", "Invalid release file fails the build", "Nothing else from pieces" (no `release.json` in `dist`) and "Production origin used".
- [x] 5.4 In `site/dev-serve.ts`, serve `/pieces/<id>/tracks/<track-id>/` with `renderTrackPage`, reading files fresh on each request, ahead of the static `/pieces/` handler; an unknown track gets a 404. Verify with `site/test/dev-serve.test.ts` for "Dev page reflects edits", "Unknown track", and "Same HTML as the build" (compared with the 5.3 build output without an origin).
- [x] 5.5 Verify "Player page unaffected by track pages" by running the existing `url.test.ts` with a fixture piece that has tracks, and check that the player-page tests still pass unchanged.

## 6. Integration

- [x] 6.1 Using a scratch copy of the placeholder (temp pieces and stems dirs, not `pieces/`): freeze it, cut a track with `spite track --update`, run the dev server against it, and open the track page in Chromium, Firefox and WebKit. Check that the FLAC plays, the download saves `<piece>--<track>.flac` with the recorded hash, and the live link opens the player on the same version, seed and bars ("Live link plays the same performance": compare the trace hash with `spite realize` on the frozen manifest). Don't commit anything to `pieces/`.
- [x] 6.2 Push the branch for a preview deployment, after confirming with the author. Check on the preview that `/pieces/<id>/tracks/<track-id>/` and the version without the trailing slash both reach the page; if the latter 404s, add `"trailingSlash": true` to `vercel.json` and recheck (D8). The preview has no real tracks unless one was published, so use a test fixture piece published to the store only with the author's approval, or skip the audio check and verify the routing alone.
- [x] 6.3 Run `pnpm test`, `pnpm test:browser`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check`, and verify that all pass with `git diff fixtures/golden` empty.

## Workflow follow-up

- Apply after `freeze-piece-versions` is implemented, and archive after it, because this change's delta specs build on that change's text for `player-site` and `site-deployment`.
- Set `VITE_SITE_ORIGIN` in `site/.env.production` when The River's first track ships.
- Cutting The River's first track is a release step for after `slot-pan` and a freeze, not a task here.
- Archive with `/opsx:archive` once every task is done.
