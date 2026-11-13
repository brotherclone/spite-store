# Tasks

## 1. Engine: partial plans

- [x] 1.1 Add `planRenderPartial` and `PartialPlan` to `packages/engine/src/audio/render.ts` (D1), exported from `index.ts`, and rebuild `planRender` on it while keeping its `Missing stem` error. Verify with engine tests for every "Planning with missing stems" scenario: full plans deep-equal for placeholder seeds `0`, `42` and `spite-store`; frames before the horizon byte-identical to the full render for at least three stem subsets, including bar-0 stems only; nothing present gives horizon 0; and a partial length of at least the realized bars with `final` false. Verify `pnpm lint` passes the engine's determinism rules and `git diff fixtures/golden` is empty.

## 2. Player: mixer and worklet

- [x] 2.1 Move the worklet's playback logic into a pure `Mixer` in `packages/player/src/mixer.ts` (D2) with the new protocol messages in `protocol.ts`, and leave `worklet.ts` as a thin wrapper. Verify with the existing browser sample-identity tests unchanged and passing in all three engines.
- [x] 2.2 Implement wait mode, skip mode, `late` switching, `blocked`/`stopped` and seek clearing skips in `Mixer`. Verify with Node unit tests driving 128-frame blocks: wait mode with stems delivered at chosen blocks reproduces the float32 golden for placeholder seed `42` with held blocks removed; skip mode with no late stems matches wait mode; skip mode with one late stem matches the full render without that voice, even when the stem arrives mid-occurrence; a blocked frame stops output exactly there; seeking clears skips; switching to skip mid-hold releases the hold; and no allocation happens in `process` in steady state (the output buffers are reused).

## 3. Player: streaming loads and the element

- [x] 3.1 Replace `loadPerformance` with the prioritized, cancellable `streamPerformance` queue (D3): first-use order, ties by hash, 4 at a time (overridable for tests), `AbortController` on reload, decoded stems cached. Verify with browser tests using a gated fake server: "Only needed stems are fetched" still passes; "Fetched in order of first use" with a queue width of 1; and a reload mid-load aborts the outstanding requests.
- [x] 3.2 Wire streaming into `element.ts` (D4): `ready` when the current position is playable, `loaded` once everything is in, replanning and sending `stems` on each arrival, the final length on `loaded`, the buffering and skipped status lines, and the `waiting`, `playing` and `skipped` events. Verify with browser tests for "Play before every stem is in", "Hold and resume", "Seeking ahead of the loaded stems", "Late clip left out" (event detail and status count), "Length becomes final", and the existing "Ending" scenario with stems arriving during playback.
- [x] 3.3 Add the `late` attribute and the `part="late"` control (D4). Verify with browser tests for "Changing late keeps playing" (no reload, no new stem request), "Control sets the attribute", and an invalid value behaving as `wait`.
- [x] 3.4 Handle stem failures during playback (D4): `error`, `blocked` at the first voice using the failed stem, then fallback mode paused (position kept only when the fallback's seed and bars match), or the error with play disabled. Verify with browser tests for "Plays up to the failed stem, then falls back" and "No fallback", plus the existing hash-mismatch scenarios still behaving as before when the failure comes before the first play.
- [x] 3.5 Draw pending and skipped clips in `lanes.ts` (D5), with `--spite-pending` and `--spite-skipped`. Verify with a browser test for "Pending clips drawn" (pending state on a held-back stem's block, then a redraw with its tail), and that "Lanes match the plan" still passes.
- [x] 3.6 Add the mid-render worklet test, "Stems arriving mid-render match": the real worklet in an `OfflineAudioContext`, stems delivered with `suspend()`. Verify it passes in every engine that supports offline `suspend()`. If an engine doesn't, stop and report which, instead of skipping it silently (see the design's risks).
- [x] 3.7 Document streaming, the `late` attribute and control, and the `loaded`, `waiting`, `playing` and `skipped` events in `packages/player/README.md`, including what each `late` mode promises. Verify `pnpm format:check` passes.

## 4. Release

- [x] 4.1 Run the full suite: `pnpm test`, `pnpm test:browser`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check`, all passing, with `git diff fixtures/golden` empty.
- [ ] 4.2 Verify on a preview deployment with the browser's network throttled (DevTools "Fast 4G"): the River's play button enables before progress reaches the total; under `wait`, playback holds and resumes if it catches up; with the control set to skip, the status counts skipped clips. Then merge into `develop` and `master`, and confirm production serves the new player.

## Workflow follow-up

- Archive the change with `/opsx:archive` once every task is done.
