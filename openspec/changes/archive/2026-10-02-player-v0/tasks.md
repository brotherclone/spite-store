## 1. Engine additions

- [x] 1.1 Add `renderBlockInto` (caller-owned float64 scratch buffers) and make `renderBlock` a wrapper over it, per design D2. Verify the existing render and golden audio tests pass unchanged, and a new test shows `renderBlockInto` in 128-frame quanta equals `renderAll`.
- [x] 1.2 Move the CLI's `realizeByBar` into the engine as `realizeTimeline` (D3) and switch `spite realize` and `spite audition` to it. Verify its events equal `realize` for the golden seeds, and that the existing CLI tests pass with unchanged output.
- [x] 1.3 Add float32 golden snapshots to `golden:update` (D9) and an engine Node test that recomputes them. Include the `Math.fround(0.1)` per-sample scenario. Verify `pnpm test` passes and the existing trace and audio goldens are unchanged.

## 2. Player core

- [x] 2.1 Restructure `packages/player` builds: two self-contained browser ESM entries (`index`, `worklet`) bundling the engine, the engine moved to `devDependencies`, and a local worklet-globals declaration file (D6). Verify `pnpm build` emits `dist/index.js` and `dist/worklet.js` with no bare `@spite-store/engine` imports, and `pnpm typecheck` passes.
- [x] 2.2 Implement the worklet processor (D1, D2): protocol `load`/`ready`/`play`/`pause`/`seek`/`position`/`ended`, silence until loaded or while paused, a voice cursor, no per-quantum allocation. Verify by inspection that `process()` allocates nothing, and through the browser tests in group 4.
- [x] 2.3 Implement the loader (D4, D5): fetch and `checkManifest`, `realizeTimeline`, parallel fetch of only the needed stems with `crypto.subtle` verification and `decodeWav`, collected errors with clip ids, progress callbacks, and a decoded-stem cache per element. Verify with browser tests in group 4.
- [x] 2.4 Implement the audio graph (D1): lazy 48 kHz `AudioContext`, worklet node with `outputChannelCount: [2]`, a GainNode with 10 ms ramps for play, pause and seek, an interpolated position, and the `ended` handling with restart-from-start on play. Verify with browser tests in group 4, and a manual listen in Chrome.

## 3. Element and UI

- [x] 3.1 Implement `<spite-player>` attributes and lifecycle (D7): `src`, `stems`, `seed`, `bars`, reload on change, the `bars` validation error, the random pronounceable seed reflected to the attribute, and `seedchange`/`ended`/`error` events. Verify with browser tests in group 4.
- [x] 3.2 Implement controls in shadow DOM: play/pause, seed field, reroll, bars field, scrub bar, copy link, status line with progress and errors, `part` names and CSS custom properties. Verify keyboard operation manually, and copy link and reroll through browser tests.
- [x] 3.3 Implement the canvas structure view (D7): section band, sorted slot rows, body and tail blocks with clip labels, DPR-aware resize, playhead animation, click-to-seek. Verify with a browser test that block and row counts match the plan and a click at bar 5 seeks to bar 5's frame.

## 4. Browser tests

- [x] 4.1 Add Vitest browser mode with the Playwright provider (`packages/player/vitest.browser.config.ts`, chromium, firefox and webkit, headless), the root `test:browser` script, and dev dependencies. Install the browsers. Verify a trivial browser test runs in all three.
- [x] 4.2 Add the determinism browser test (D9): in-page stem synthesis with hash checks, OfflineAudioContext through the real worklet for seeds `0`, `42` and `"spite-store"`, compared with the float32 goldens, plus the seek-at-bar-8 slice comparison. Verify it passes in all three engines. Also verify that a deliberate one-line renderer tweak fails it (then revert, and confirm the Node goldens also catch it).
- [x] 4.3 Add element browser tests with a stubbed `fetch`: minimal embed enabling play, invalid `bars`, only needed stems fetched (count and progress), hash mismatch, invalid manifest, trace equal to `spite realize --json`, random seed shape and reproducibility, reroll firing `seedchange`, copy link URL, attribute change reloading, lanes counts and click-to-seek, and `ended` firing once. Verify they pass in all three engines.

## 5. Site

- [x] 5.1 Add `site/dev-serve.ts` middleware (pieces with traversal rejection; stems by hex with the 404 hint) and wire it into `site/vite.config.ts` with `optimizeDeps.exclude`. Add a `site` Vitest project with unit tests for 200 exact bytes, 404 with the hint, and traversal rejection. Verify `pnpm test` includes and passes them.
- [x] 5.2 Implement the page and URL sync (`applyQuery`, `followPlayer` with `replaceState`). Unit-test them with fakes for permalink opening, URL following reroll, and unchanged history length. Verify `pnpm --filter site build` succeeds, and manually: `pnpm stems:placeholder`, `pnpm --filter site dev`, open `?seed=hello&bars=16`, play, seek, reroll, copy link.

## 6. Docs and integration

- [x] 6.1 Write `packages/player/README.md` (embed snippet, attributes, events, parts and custom properties, what the determinism promise covers) and update the root README (site dev loop, `test:browser` and the one-time `playwright install`). Verify the embed snippet works as written in the dev site.
- [x] 6.2 From a clean checkout on Node 24, run `pnpm install && pnpm build && pnpm stems:placeholder && pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm test:browser`. Verify everything passes, no audio file is tracked, and `openspec validate player-v0 --strict` passes. Do a manual listen in Safari if available.
