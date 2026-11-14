# Proposal

## Why

The player downloads every stem a performance uses before it plays a note. A seed of _The River Forgets to Answer_ uses 21–23 stems, about 50–55 MB of WAV, yet only 6–8 of them (14–19 MB) sound in the first 13 seconds. On a phone that is a long silent wait before music that could have started after a third of the download. The River is public now, and this wait is the first thing a new listener meets.

## What Changes

- **Streaming start:** the player fetches stems in the order the performance first uses them, and enables play as soon as every stem that sounds at the current position is loaded. The rest keep loading during playback.
- **Late stems, listener's choice:** a new `late` attribute on `<spite-player>`, `wait` (the default) or `skip`, with a matching control in the player. Under `wait`, playback holds at the first frame that needs a stem still loading and resumes from exactly that frame when it arrives, so the output stays sample-identical to the offline render. Under `skip`, time keeps going and a clip whose stem hasn't arrived when it should start is left out for that whole occurrence. The status says so, and an event names each skipped clip.
- **Late failures:** if a stem fails (missing, wrong hash, undecodable) after playback has started, the player plays correctly up to the first frame that needs it, then stops. With a fallback, it switches to the fixed recording, paused. Without one, it shows the error. Failures before playback starts behave as today.
- **Readiness events:** `ready` now means "playable from the current position", and a new `loaded` event fires once every stem is in. Progress keeps counting stems loaded out of stems needed.
- **Length while loading:** the scrub bar and the structure view use the realized bars until every stem's length is known, then extend to the last tail.
- **Engine:** a render plan can be made before every stem is loaded. Voices whose stem is missing are marked pending, and the plan reports how far it can be rendered exactly. With every stem present it equals today's plan exactly.
- **Seeking under `wait`:** seeking to a position whose stems aren't loaded moves the playhead there, fetches those stems first, and holds until they arrive.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `web-player`: loading becomes streaming, plus the `late` attribute and control, holding and skipping, late failures, the `loaded` event, and the length known only once every stem is in. Sample identity is promised under `wait`, and under `skip` whenever nothing is skipped.
- `audio-rendering`: planning a render with some stems missing, and how far such a plan can be rendered exactly.

## Out of Scope

- Compressed stems (Opus, FLAC, MP3). They would cut the download further and are a separate change.
- Streaming within one stem (playing a stem before all of its bytes have arrived), HTTP range requests, and progressive decoding. The unit of loading stays one whole, hash-verified stem.
- Bandwidth estimation, adaptive prefetch, or waiting for a head start before enabling play.
- Offline playback, service workers, and caching beyond the browser's HTTP cache and the player's in-memory stem cache.
- Remembering the listener's `late` choice across visits, or adding it to seed links.
- Changes to the fallback recording, the trace, `TRACE_FORMAT`, `RENDER_FORMAT` or any golden snapshot. Streaming changes when samples are produced, never what they are.
- The CLI. `bounce` and `audition` render offline and keep loading every stem first.

## Impact

- **Engine:** a partial-plan function in `packages/engine/src/audio/render.ts`, with `planRender` rebuilt on it. The goldens must stay byte-identical.
- **Player:**
  - `loader.ts` becomes a prioritized, cancellable stem queue.
  - `element.ts` gains the `late` attribute and control, the `loaded` event, the buffering and skipped-clip status, and late-failure handling.
  - The worklet protocol gains messages for stems arriving mid-play and for the worklet reporting a hold or a skip.
  - `lanes.ts` redraws as lengths become known.
- **Tests:** the browser tests gain a throttled fake server, so arrival order and timing are controlled.
- **Site:** none required. The page embeds the player as before.
