## Why

A piece can be realized, rendered and auditioned from the command line, but listeners can't hear one. The product's core experience, a shareable seed that means the same performance in anyone's browser, needs a player. The renderer was built to run in an AudioWorklet, and the real-browser determinism check was deferred to this change. Most of the remaining MVP items (seed permalinks, the live structure view, loading stems by hash in the browser) also live in the player.

## What Changes

- Implement `<spite-player>` as a framework-free web component (vanilla DOM plus canvas, no runtime dependencies besides the bundled engine). It is configured by attributes: `src` (manifest URL), `stems` (stem base URL), `seed` and `bars`.
- Play **finite performances**. A performance is (manifest, seed, bars), realized and planned up front, so seeking is exact and immediate. With no `seed`, the player picks a random, pronounceable seed and shows it.
- Load in the browser: fetch the manifest, validate and realize it, then fetch only the stems the performance uses. Each stem is verified against its sha256 and decoded with the engine's own WAV decoder (not the browser's), then playback is enabled. Progress and failures (missing stem, hash mismatch, invalid manifest) are shown in the element.
- Run the engine renderer inside an AudioWorklet at 48 kHz stereo. Realization and planning stay on the main thread.
- Controls: play/pause, seed field and reroll, length, scrub bar, and copy link. Changes are announced with a `seedchange` event so a host page can keep its URL in sync.
- Add a **live structure view**: a canvas lane view with a section band, one row per slot, clip bodies and tails, and a moving playhead. Clicking it seeks.
- Make the local site a single page for the placeholder piece with seed permalinks (`?seed=…&bars=…`). Its dev server serves pieces and locally generated stems by hash.
- Define the browser determinism promise at the worklet output: every output sample equals the renderer's sample rounded to float32. Add float32 golden snapshots, and an automated check that Chromium, Firefox and WebKit all reproduce them bit for bit (`pnpm test:browser`, Vitest browser mode with Playwright).

## Capabilities

### New Capabilities

- `web-player`: The `<spite-player>` element: attributes, loading and stem verification, playback (play, pause, seek, ending), seeds and links, controls, the structure view, error states, and sample identity across browser engines.
- `player-site`: The local site page: seed permalinks in the page URL and serving pieces and stems for development.

### Modified Capabilities

- `audio-rendering`: Adds float32 output snapshots. A float32 rendering of a performance (each sample rounded to float32) has golden hashes alongside the 16-bit WAV hashes.

## Out of Scope

- Endless or open-ended playback, and performances whose length isn't fixed before playback starts.
- Streaming loads (starting playback before every needed stem has arrived), caching, and offline playback.
- Hosting, CDNs, uploads, and any production deployment of the site.
- A site framework (Next.js, Astro or similar). The site stays a single Vite page.
- Real stems from any piece, the AUD fallback file, and `spite pack`.
- Mobile layout polish and accessibility beyond keyboard-operable native controls and labelled buttons.
- Anything after the worklet output: OS or device resampling, output latency and volume are outside the determinism promise.
- Changes to the trace, decision paths, `TRACE_FORMAT` or `RENDER_FORMAT`.

## Impact

- `packages/player`: real implementation, a separate worklet entry, the engine bundled in, and a browser test suite.
- `packages/engine`: a pure helper that realizes with section visits (today the CLI's `realizeByBar`), used by both the CLI and the player. There are no behavior changes.
- `packages/cli`: switches to the engine helper. Output is unchanged.
- `site/`: page markup, Vite config with dev middleware, and URL syncing.
- New dev dependencies: `@vitest/browser`, `playwright` (the browser binaries are a one-time local download). New root script `test:browser`, kept out of `pnpm test`.
- New golden fixtures `fixtures/golden/placeholder.float32.<seed>.json`, and `golden:update` writes them.
