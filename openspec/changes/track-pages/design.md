# Design

## Context

See `proposal.md` for why. This change builds on `freeze-piece-versions`: `versions.json`, frozen manifests stored as `<hex>.json` in `.stems/` and the store, the `version` URL parameter, and that change's delta text for the site requirements it shares with this one. It should be applied and archived after that change.

The current state that shapes the approach:

- **Rendering.** `packages/cli/src/render.ts` `renderSeedWav` realizes, loads stems, plans and renders to `Float64Array` left and right, then calls `encodeWav16`. `quantize16` in `engine/src/audio/wav.ts` clips, scales by 32,767 and rounds half up with `Math.floor(x + 0.5)`.
- **FLAC.** `engine/src/audio/flac.ts` `encodeFlac(channels: Int32Array[], bits: 16 | 24)` is integer-only and spec'd (`stem-codec`) to give byte-identical output on every runtime. Today only `spite pack` uses it, for stems.
- **Publishing.** `collectFiles(manifests)` builds the `{ name, hash, owners, contentType }` list that both upload and `--check` use. `scripts/deploy-check.mjs` runs `spite publish --check` on every piece's manifest.
- **Site.** The site is a single `index.html` plus `src/main.ts`. Build plugins in `vite.config.ts` emit manifest assets in `generateBundle`. The dev middleware `serveDev` answers `/pieces/**` from disk. The site depends only on the player; schema validation (Ajv and `@spite-store/schema`) lives in the CLI.

## Goals / Non-Goals

**Goals:**
- Track audio whose bytes anyone can reproduce, with every byte-producing step inside the engine's portable code.
- Track pages as plain static HTML, rendered by one function used by both the build and the dev server.
- No new hosting configuration and no new deploy-check step.

**Non-Goals:**
- Templating or UI frameworks. A track page is one template literal.
- Tags inside the FLAC (see proposal, Out of Scope).

## Decisions

### 1. The track encoder lives in the engine
Add `quantize24(x)` beside `quantize16` (clip to [-1, 1], `Math.floor(clipped * 8388607 + 0.5)`) and `encodeTrackFlac(left, right)`, which quantizes into `Int32Array`s and calls `encodeFlac(…, 24)`. The CLI gains `renderSeed(manifest, seed, bars, stemsDir)`, which returns the float channels; `renderSeedWav` becomes a thin wrapper around it, so `bounce` and `fallback` keep their exact bytes.
**Determinism:** realization and rendering are unchanged, and no seeded decision path is touched. Quantization uses one multiplication, one addition and `Math.floor` per sample, all exactly specified IEEE operations with no transcendental maths, and the clip comes before scaling. Keeping `quantize24` and `encodeTrackFlac` in the engine puts them under the engine's lint rules and its bare-context portability test. That test is what earns the spec's "byte-identical on every runtime" claim.
**Alternative rejected:** ffmpeg FLAC (`-sample_fmt s32 -bits_per_raw_sample 24`). It's simpler to write, but its bytes depend on the ffmpeg build, which would throw away the reason for choosing FLAC.

### 2. `release.json` is separate from `versions.json`
They have different writers and lifecycles. `versions.json` is written only by `spite freeze` and must stay append-only. `release.json` is partly hand-written (credits) and partly written by `spite track`, and its titles can be edited. Merging them would put an append-only promise inside a file that people edit by hand.

### 3. A track stores the version hash; pages show the label
`version` holds `sha256:<hex>`, which can be checked on its own and survives any confusion about labels. The page and the live link look up the label in `versions.json`; labels never change (see the `freeze-piece-versions` spec), so the lookup is stable. The CLI takes `--version <label>` because that's what the originator types.

### 4. `frames` is recorded, not derived at build time
The build runs on Vercel without stems, so it can't render to learn a track's length. `spite track` records the frame count it rendered, and the page derives `m:ss` from it. `frames` is also part of the exact staleness check, so a renderer change that alters tail length shows up as a stale track.

### 5. Release validation: one JSON Schema, two thin checkers
`schema/release.schema.json` expresses everything except "ids are unique" and "versions are recorded". The CLI's `release.ts` and the site's build plugin each run the schema with Ajv and then those two rules in code, and both are tested against `schema/examples/release/{valid,invalid}/` (each example sits beside a fixture `versions.json`). The site gains dev dependencies on `@spite-store/schema` and `ajv`, which are build-time only and never shipped to the browser.
**Alternative rejected:** having the site build call the CLI. Vercel's build order already runs `publish --check` (which validates release files) before the site build, but `pnpm --filter site build` on its own must also refuse a bad file (spec), and a subprocess just to parse JSON is heavier than a second ~30-line checker.

### 6. Track pages are emitted assets, not Vite pages
`site/src/track-page.ts` exports `renderTrackPage({ pieceId, pieceTitle, track, label, credits, origin? }) → string`: a complete HTML document with inline CSS and no script, with every interpolated value passed through one `escapeHtml`. The build plugin (an extension of `pieceManifests`, renamed `pieceFiles`) emits `pieces/<id>/tracks/<track-id>/index.html` through `emitFile`. The dev middleware matches `/pieces/<id>/tracks/<track-id>/` before its static `/pieces/` handler, reads the files fresh on every request, and returns the same string. It is not a Vite multi-page input, because those need HTML files on disk before the build and would pull every page through Vite's HTML pipeline for no benefit.
The piece title comes from the working `manifest.json`, because the frozen manifest isn't in the repo at build time. A piece's name is metadata about the piece rather than part of the frozen performance, so using the current name is acceptable.

### 7. `publish` reads the sibling `release.json`
`collectFiles` takes each manifest's path, loads `release.json` (and `versions.json`, for validation) from the same directory, and adds each track's `<audio-hex>.flac` with the owner `track:<id>` and the type `audio/flac`. The deploy check already runs `publish --check` on every piece, so track audio and release validity are covered with no change to `scripts/deploy-check.mjs`. `spite track` itself doesn't upload: like `pack` and `fallback`, it writes locally and `publish` ships the result, which keeps a single credential-using path.

### 8. Directory URLs on Vercel
Pages are emitted as `…/tracks/<track-id>/index.html`, and Vercel's static output serves `…/tracks/<track-id>/` from them. Whether `…/tracks/<track-id>` (no slash) is served or redirected depends on Vercel defaults. The integration task checks this on a preview. If it 404s, add `"trailingSlash": true` to `vercel.json`. That is a one-line, hosting-only fix that doesn't change the specified URL.

## Risks / Trade-offs

- [24-bit FLAC is large (about 20 MB for 2 minutes), and the page streams it] → `preload="metadata"` means nothing downloads until play is pressed. A lossy streaming copy is out of scope, and can be added later as a second file without changing the track's identity.
- [Some browsers may not play 24-bit FLAC in `<audio>`] → Current Chromium, Firefox and Safari do. The integration task checks all three on a preview. The download works regardless.
- [`og:audio` is ignored by most link unfurlers] → It's harmless. Title and description carry the preview.
- [A track pinned to a version later stranded by an engine format bump] → The FLAC stays valid, because it's a recording. Re-running `spite track` would refuse on the pin, and its check reports that rather than "stale". The live link plays the version's fallback, as for any stranded version.
- [Two checkers for one file] → Both run against the same example files in tests, so drift shows up as a failing test.

## Migration Plan

No migration: no piece has a `release.json`, so the build and publish behave exactly as before until one is added. Rollback means reverting the code; a committed `release.json` would then just be ignored.

## Open Questions

- What to put in `site/.env.production`'s `VITE_SITE_ORIGIN`. This means the production domain, which can be filled in when The River ships its first track. Until then, pages leave out the absolute-URL tags (spec).
