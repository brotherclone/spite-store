## Context

- `packages/player` is a placeholder custom element with no dependencies, built by tsdown with `lib: ["ES2022", "DOM"]`.
- `site/` is a Vite page that imports it.
- The engine already has everything the player needs to run: `checkManifest`, `realizeForRender`, `planRender`, `renderBlock` (state `{ v, frame }`, plan is plain JSON), `decodeWav`, `synthesizeStemWav`.
- Section visits per bar are computed today by the CLI's `realizeByBar` helper (`packages/cli/src/commands/sections.ts`), which steps `advance` one bar at a time.
- The engine never hashes. Golden audio is checked in Node only.

See proposal.md for motivation and the specs (`web-player`, `player-site`, and the `audio-rendering` addition) for required behavior.

## Goals / Non-Goals

**Goals:**
- A player whose audio thread runs the exact renderer used in Node, with the browser promise stated and tested at the worklet output.
- An embeddable element: one ES module plus one worklet module, no framework, no runtime dependencies beyond the bundled engine.
- Seeking and the structure view built directly from the render plan, so what you see is what plays.

**Non-Goals:**
- Low-latency or glitch-free playback guarantees on slow devices beyond reasonable care (no allocation per audio callback).
- Visual design beyond a clean, functional default. Styling hooks are CSS custom properties and `::part`.

## Decisions

### D1. Thread split and message protocol

```
 main thread                                   audio thread
 <spite-player>                                SpiteProcessor (AudioWorkletProcessor)
  load(): fetch manifest -> checkManifest
          realizeTimeline -> events, visits
          fetch + verify + decodeWav stems
          planRender -> plan
  play(): ensure AudioContext(48 kHz)
          addModule(worklet.js) once
          node = AudioWorkletNode(..., {outputChannelCount:[2]})
          port.post {type:'load', plan, stems} --->  keep plan, stems; state = {v,1 frame:0}
                                          <---  {type:'ready'}
          port.post {type:'play'}         --->  process(): renderBlockInto(..., 128) -> outputs
                                          <---  {type:'position', frame}  (every 1,536 frames ~ 31/s)
          port.post {type:'seek', frame}  --->  state.frame = frame
          port.post {type:'pause'}        --->  output silence, frame frozen
                                          <---  {type:'ended'}  (frame reached plan.totalFrames)
  node -> GainNode (10 ms ramps for pause/seek/resume) -> destination
```

- Realization and planning run on the main thread once per performance, at authoring sizes in a few milliseconds. The audio thread only mixes.
- Stems cross to the worklet as `Float32Array` channel buffers in the `transfer` list. Decoded stems are already float32 (audio-rendering D3), so nothing is copied or converted.
- Pause, resume and seek fades are a `GainNode` ramp (`linearRampToValueAtTime`, 10 ms) **after** the worklet. The worklet's output never includes fades, which keeps the sample-identity promise simple: worklet output equals `fround(renderer)` always. On pause, the main thread ramps down, waits 10 ms, then posts `pause`. On seek it ramps down, posts `seek`, then ramps up.
- `AudioContext` is created on the first play (user-gesture rules). Loading, verifying and planning happen before it exists, so the load progress is real.

### D2. No allocation on the audio thread: `renderBlockInto` (determinism)

`renderBlock` allocates two `Float64Array`s per call, which would be 750 allocations per second in a worklet. The engine gains `renderBlockInto(plan, stems, state, frames, left: Float64Array, right: Float64Array) -> RenderState`, which zeroes and fills caller-owned scratch buffers. `renderBlock` becomes a thin wrapper around it, so both share one mixing loop and produce identical samples.

The worklet then copies `left[i]` into `outputs[0][0][i]`, which rounds each sample to float32 (ECMAScript `ToFloat32`, round-to-nearest-even, identical everywhere). Accumulation stays in float64 exactly as in Node. **Accumulating directly into the float32 output was rejected**: it would round after every voice, giving `fround(fround(a)+b)` instead of `fround(a+b)`, which is a different and weaker promise.

To cut per-quantum work, voices in the plan are already in start order. The worklet keeps a cursor so each quantum scans only voices that could overlap it. That is a pure optimization over the same summation order: voices are still summed in plan order per frame.

### D3. Section timeline in the engine

The CLI's `realizeByBar` moves into the engine as `realizeTimeline(manifest, seed, { durationBars }) -> { events, endBar, visits: [{ ordinal, sectionId, startBar, endBar }] }`, implemented with `createState`/`advance` exactly as today. Both the CLI (`realize`, `audition`) and the player use it. CLI output is unchanged, and the existing CLI tests confirm that. There are no decision-path or `TRACE_FORMAT` changes, and the events are identical to `realize`.

### D4. Manifest validation in the browser

The player validates with the engine's `checkManifest` (structural plus semantic), not Ajv. That avoids bundling a JSON Schema library, and the engine checks are already the authoritative pre-realization gate. Messages are the engine's `{ pointer, message }` list. The plain-language Ajv messages remain a CLI feature.

### D5. Stem loading and verification

```
needed = unique(events.map(e => e.clipHash))       -- only what this performance plays
for each hash (in parallel, Promise.all with per-item settle):
  bytes = fetch(stems + hex + '.wav')               -- 404 -> "missing"
  crypto.subtle.digest('SHA-256', bytes) == hex     -- else "hash mismatch"
  decodeWav(bytes, hash)                            -- else decoder message
progress: "k / n" updated as each settles
```

All failures are collected and shown together, with clip ids per hash (as the CLI does). The `stems` base URL is resolved against `document.baseURI`. A per-element cache of decoded stems by hash means rerolls on the same piece only fetch new hashes.

### D6. Packaging

- tsdown builds two browser ESM entries: `dist/index.js` (the element) and `dist/worklet.js` (the processor). Both **bundle the engine** (`noExternal: ['@spite-store/engine']`), so each file is self-contained. A worklet module can't resolve bare specifiers, and an embed should need nothing else. The engine moves to `devDependencies`.
- The element loads the worklet with `new URL('./worklet.js', import.meta.url)`, which works from a CDN, a plain `<script type="module">` and Vite.
- In the site, Vite's dependency pre-bundling would rewrite `import.meta.url`, so `optimizeDeps.exclude: ['@spite-store/player']`.
- Worklet globals (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, `currentFrame`) aren't in TypeScript's DOM lib. A small local declaration file in the player package covers them, rather than adding a types dependency.

### D7. Element structure and UI

- Shadow DOM. The controls are native elements: buttons, `<input>` for seed and bars, and `<input type="range">` for the scrub bar, which makes them keyboard-operable for free. Then a `<canvas>` for the lanes and a status line for progress and errors. Parts are exposed via `part="…"`, and colors use CSS custom properties (`--spite-accent` and others).
- **Random seed:** four syllables, each consonant from `bcdfghjklmnprstvz` and vowel from `aeiou`, picked with `crypto.getRandomValues`. Modulo bias is irrelevant because this only picks *which* seed, never what a seed plays. The engine's lint ban on ambient randomness doesn't apply to the player package, and the seed only enters the engine as an ordinary string.
- **Structure view:** time is mapped linearly from frames to x across the full render (including tails). The section band is drawn from `visits` (via `barFrame`). Rows are slot ids sorted in code-unit order, and blocks come from plan voices: body `[start, barFrame(bar + lengthBars))` solid, tail `[bodyEnd, end)` at 35% opacity. The canvas is redrawn on resize (`ResizeObserver`, devicePixelRatio-aware) and on each animation frame while playing. The playhead is interpolated from the last `position` message plus `AudioContext.currentTime` elapsed. Clicking maps x to a frame and seeks there.
- **Events:** `seedchange` (`{ seed, bars }`), `ended`, and `error` (`{ messages }`). The element never touches the host page URL itself. The site does that (D8).
- **Copy link:** `new URL(location.href)`, set the `seed` and `bars` params, `navigator.clipboard.writeText`.

### D8. Site

- `site/index.html` holds one `<spite-player src="/pieces/placeholder/manifest.json" stems="/stems/">`.
- `site/src/main.ts` holds `applyQuery(player, url)` and `followPlayer(player, history, location)`. These are small pure-ish functions, so they can be unit-tested in Node with fakes. `history.replaceState` keeps the history length unchanged.
- `site/vite.config.ts` adds a dev-only plugin. `configureServer` middleware maps `/pieces/*` to `../pieces` (with path-traversal rejection) and `/stems/<64 hex>.wav` to `../.stems`, with a 404 body that mentions `pnpm stems:placeholder`. The middleware logic lives in `site/dev-serve.ts` so it can be unit-tested. `optimizeDeps.exclude` is set per D6.
- A `site` Vitest project (Node environment) runs these unit tests inside `pnpm test`.

### D9. Float32 goldens and the browser test (determinism)

- `pnpm golden:update` additionally writes `fixtures/golden/placeholder.float32.<seed>.json`: `{ manifest, seed, durationBars: 16, renderFormat, frames, float32Sha256 }`. The hash covers `Float32Array` interleaved L/R little-endian bytes of `renderAll`'s output. An engine Node test recomputes them.
- `pnpm test:browser` runs `vitest --config packages/player/vitest.browser.config.ts`: Vitest browser mode with the Playwright provider, headless, with instances for `chromium`, `firefox` and `webkit`. It needs `pnpm exec playwright install chromium firefox webkit` once; the README documents this.
- Test flow, in each browser:
  1. Synthesize the placeholder stems in-page with `synthesizeStemWav`. This is the same bytes by construction, and the test asserts each hash with `crypto.subtle`, so no stem files are served.
  2. Realize and plan with the same player modules the element uses.
  3. `new OfflineAudioContext(2, plan.totalFrames, 48000)`, `addModule(dist/worklet.js)`, connect the worklet node directly to the destination (no GainNode), post `load` and await `ready`, post `play`, then `startRendering()`.
  4. Hash the interleaved float32 result and compare with the golden.

  The seek scenario renders with a `seek` to bar 8 posted before rendering, and compares against the corresponding slice of the uninterrupted render.
- Element behaviors are browser tests too, stubbing `fetch` to serve synthesized stems so requests can be counted and a bad hash injected: only needed stems fetched, hash-mismatch and invalid-manifest errors, trace equality with the CLI, seed shape, reroll, copy link, and lanes block count.

## Risks / Trade-offs

- [An OfflineAudioContext may begin pulling quanta before the `ready` round trip completes] → The test only calls `startRendering()` after `ready`, and the processor outputs silence until it has a plan. A frame counter in the processor (not `currentFrame`) is what's compared.
- [WebKit's Playwright build is not Safari] → It's the closest automatable proxy, and it shares JavaScriptCore and the Web Audio implementation lineage. A manual Safari check is listed in the tasks.
- [Browsers may ignore `sampleRate: 48000` or resample to the device] → Resampling happens after the worklet, outside the promise. If construction with 48 kHz throws (very old browsers), the element shows an error rather than silently playing at the wrong rate.
- [Bundling the engine into two files duplicates about 15 KB] → Acceptable. A shared chunk would break the "one self-contained worklet file" property.
- [Main-thread jank delays position messages] → The playhead is interpolated from `AudioContext.currentTime`, so the visual drifts at most one message interval. The audio itself isn't affected.
- [Playwright browser downloads are large] → Kept out of `pnpm test`. `test:browser` is an explicit opt-in step.

## Migration Plan

Additive. The CLI's private `realizeByBar` is replaced by the engine's `realizeTimeline` with identical output. The player package's dependency layout changes (engine moves to `devDependencies` because it is bundled). There are no trace or render changes, and no format bumps.

## Open Questions

- Visual styling beyond the functional default (palette, typography) can be decided once the player is in front of real pieces. It doesn't change behavior or structure.
