# Proposal

## Why

A seed permalink means "this manifest, played by this engine". The engine already numbers the two things that decide what a seed sounds like: `TRACE_FORMAT` (how a seed becomes events) and `RENDER_FORMAT` (how events become samples). Manifests don't record either number. Once the engine changes, every shared link to The River would quietly play a different performance under the same URL. The River is now public, so the links are already spreading. They need protecting before the first format bump, not after.

## What Changes

- **Manifest:** a new optional top-level `engine` object, `{ "trace": <int>, "render": <int> }`, records the formats a piece was released with. Realization and rendering ignore it. `specVersion` stays `0.1`, the same way the `fallback` addition was handled.
- **Engine:** a pure compatibility check reports whether a manifest's pin matches the running engine's `TRACE_FORMAT` and `RENDER_FORMAT`, and if not, which number differs and in which direction (made with an older or a newer engine). An unpinned manifest is compatible.
- **New `spite pin` command:** reports whether a manifest is pinned to the current formats. With `--update`, it writes the current formats into the manifest and changes nothing else.
- **CLI refusal:** `spite realize`, `bounce`, `audition` and `fallback` refuse a manifest whose pin doesn't match, and name both versions. A new `--ignore-pin` flag lets an author hear the current engine's version anyway, with a warning. `fallback` has no such flag, because a fallback must be the pinned performance.
- **Player:** a pinned manifest that doesn't match the player's engine never plays generatively. If the manifest declares a fallback, the player plays it, with the new fallback reason `engine`. Otherwise it shows an error naming both versions, and play stays disabled.
- **Deployment:** the build fails if any piece it emits is unpinned. It warns, but still deploys, when a piece is pinned to formats other than the deployed engine's: that piece will play its fallback.
- **Pieces:** The River and the placeholder are pinned to trace 1 and render 1.

## Capabilities

### New Capabilities
- `engine-pinning`: what a manifest's engine pin means, the compatibility check, the `spite pin` command, and the `--ignore-pin` override.

### Modified Capabilities
- `music-manifest`: adds the optional `engine` field and its validation, and states that realization ignores it.
- `piece-audition`: `realize`, `bounce` and `audition` refuse a manifest pinned to other formats, unless given `--ignore-pin`.
- `fallback-recording`: `spite fallback` refuses a manifest pinned to other formats.
- `web-player`: a new `engine` fallback case and fallback reason, plus the error a mismatched manifest without a fallback shows.
- `site-deployment`: the build refuses unpinned pieces and warns about pieces pinned to other formats.
- `river-piece`: the manifest is pinned.

## Out of Scope

- Keeping old engine versions available so that a stranded piece still plays generatively. The fallback recording is the answer for a stranded piece.
- Per-feature or per-manifest compatibility (working out whether a format bump actually changes a given piece). Any difference in either number counts as a mismatch.
- Bumping `TRACE_FORMAT` or `RENDER_FORMAT`, or any change to realization, rendering, the trace format or golden snapshots.
- Pinning the stem files themselves. They are already pinned by content hash.
- Re-pinning policy beyond `spite pin --update`: no migration tooling, no record of a piece's earlier pins.
- A visible "made with engine N" label on the page beyond the mismatch messages.
- Changes to `spite validate`. It stays a schema check and doesn't compare the pin with the engine.

## Impact

- **Schema:** `schema/manifest.schema.json` gains `engine`, recorded in `schema/CHANGELOG.md` as a 0.1 addition, with valid and invalid examples.
- **Engine:** the `Manifest` type and `checkManifest` accept `engine`, and a new exported compatibility function. No change to realization or rendering.
- **CLI:** a new `pin` command, a shared pin check in the commands that realize, the `--ignore-pin` flag and usage text.
- **Player:** `element.ts` checks the pin after loading the manifest. `FallbackReason` gains `engine`. New browser tests.
- **Deployment:** `scripts/deploy-check.mjs` checks pins for every emitted piece.
- **Pieces:** `engine` added to `pieces/the-river-forgets-to-answer/manifest.json` and `pieces/placeholder/manifest.json`. Their traces and goldens are unchanged.
