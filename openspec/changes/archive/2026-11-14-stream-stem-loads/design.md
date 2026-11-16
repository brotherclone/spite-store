# Design

## Context

- **Loading today:** `loadPerformance` (`packages/player/src/loader.ts`) realizes the performance, fetches every needed stem in parallel, verifies and decodes each one, then calls `planRender`. Only then does the element enable play. `EngineNode.load` sends the plan and every stem to the worklet in one `load` message.
- **The plan needs stem lengths:** `planRender` (`packages/engine/src/audio/render.ts`) uses each stem's frame count for its voice's `end` (its tail) and for `totalFrames`. Chokes depend only on the next event's start frame, which the trace gives.
- **The renderer:** `renderBlockInto` sums the voices overlapping a block, in plan order. It looks up a voice's stem only after checking that the voice overlaps the block, so a zero-length voice is never read.
- **Measured on the River:** a seed uses 21–23 stems, 50–55 MB, of which 6–8 (14–19 MB) sound at bar 0. The next new stem is first used about 13 s in.

## Goals / Non-Goals

**Goals:**

- Start playing once the stems sounding at the start are in, and keep loading in the background.
- Under `late="wait"`, the output stays sample-identical to the offline render, whatever the arrival order. Held time is silence that isn't part of the render.
- Under `late="skip"`, never stall. Leave out exactly the clip occurrences that started before their stem arrived, and say so.
- Keep the engine's determinism rules intact. No change to the trace, the goldens, `RENDER_FORMAT`, or `renderBlockInto`'s arithmetic.

**Non-Goals:**

- Faster transfer (compression, range requests, CDN tuning), and any estimate of bandwidth.

## Decisions

### D1. A partial plan: pending voices are zero-length, and the horizon is exact

New in the engine:

```ts
export interface PartialPlan {
  plan: RenderPlan;        // pending voices have end === start: they render nothing
  pending: number[];       // indexes of voices whose stem is missing, ascending
  horizon: number;         // start of the first pending voice, or plan.totalFrames if none
  final: boolean;          // pending.length === 0
}
export function planRenderPartial(
  manifest: Manifest, events: readonly TraceEvent[], endBar: number,
  stems: ReadonlyMap<string, Stem>,
): PartialPlan;
```

- **`planRender` becomes a thin wrapper:** it calls `planRenderPartial` and throws `Missing stem <hash>` when anything is pending, as it does today. Voices, chokes and `totalFrames` come from the same code, so the full plan is byte-for-byte what it was. The goldens and a deep-equality test check this.
- **Why zero-length voices:** `renderBlockInto` already skips a voice that doesn't overlap the block, before it looks up the stem. Rendering a partial plan therefore never touches a missing stem, and needs no change to the renderer.
- **Why the horizon is exact:** voices are sorted by start frame. Every voice that starts before the horizon has its stem, and no voice starting at or after the horizon contributes to an earlier frame. So frames before the horizon are the full render's frames.
- **Length while partial:** `totalFrames` is the larger of the end of the realized bars and the known voice ends. It is a lower bound until `final` is true.
- **Determinism:** the partial planner is pure and follows the engine's lint rules. Its output depends only on (manifest, events, endBar, which stems are present). Arrival timing never reaches the engine.

### D2. The main thread replans on every arrival; the worklet keeps the skips

When a stem arrives, the main thread calls `planRenderPartial` again (cheap: one pass over the voices) and sends the worklet a `stems` message with the new plan, horizon and `final` flag, plus the new stem, transferred. Protocol additions:

```ts
| { type: 'load'; plan; horizon; final; stems }               // replaces today's load
| { type: 'stems'; plan; horizon; final; stems: StemTransfer[] }
| { type: 'late'; mode: 'wait' | 'skip' }
| { type: 'blocked'; frame: number }                           // a failed stem: stop here
// worklet -> main
| { type: 'waiting'; frame } | { type: 'playing'; frame }
| { type: 'skipped'; voice: number }
| { type: 'stopped'; frame }                                   // reached the blocked frame
```

The playback logic moves out of `worklet.ts` into a pure `Mixer` class (`packages/player/src/mixer.ts`). It has no AudioWorklet globals, so Node can unit-test it. `worklet.ts` becomes a thin wrapper.

- **Wait mode:**
  - A block renders `min(n, horizon − frame)` frames and outputs silence for the rest.
  - The frame counter stops at the horizon. On reaching it, the mixer reports `waiting` once.
  - When a `stems` message moves the horizon past the held frame, the mixer reports `playing` and carries on.
  - It never ends while `final` is false.
- **Skip mode:**
  - Before rendering a block, every pending voice whose start lies inside the block is added to `skipped`, and `skipped` is reported once per voice.
  - Every incoming plan is applied with skipped voices forced to zero length. A stem that arrives mid-occurrence therefore can't fade in a clip that should have started earlier.
  - The horizon is ignored.
  - At the plan's length the mixer ends. Every pending voice starts before that length, so all of them have been skipped by then.
- **Seek:** clears `skipped` in both modes.
- **Switching mode:** applies from the next block. A voice already skipped stays skipped, and a held wait mode switched to skip releases the hold.
- **Blocked:** a `blocked` frame is a hard horizon in both modes. On reaching it, the mixer stops and reports `stopped`.

The mixer allocates only when a message arrives, which is rare, never per block. The steady-state rule "no allocation per audio callback" still holds.

### D3. A prioritized, cancellable stem queue

`loadPerformance` becomes `streamPerformance`. It realizes the trace, then builds a queue of the needed hashes, ordered by the first event that uses each (bar, then hash).

- **Fetching:** at most 4 requests run at once. Each stem is verified and decoded as today, and decoded stems go into the player's cache.
- **Callbacks:** the queue calls `onStem(hash)` for each arrival, `onFailure(messages)` for each failure, and `onComplete` once everything is in.
- **Cancelling:** a new load aborts in-flight requests with an `AbortController`. Stems already decoded stay cached.
- **No reordering on seek:** frame `f` is exactly renderable only once every voice starting at or before `f` has its stem (D1). An earlier stem's tail length is unknown until it arrives, so any of them could still be sounding at `f`. Those stems are exactly the ones the first-use order already puts first. Seeking ahead therefore needs no reordering; it just holds until the queue gets there. This keeps the queue simple and the result exact. The spec scenario "requested before any stem first used later" is what the default order gives.

### D4. Readiness, failures and the element

- **`ready`:** fires when the current position is playable: the horizon is past position 0, or the plan is final. This is the same condition in both modes, so `skip` doesn't start in silence before anything has arrived.
- **`loaded`:** fires on `onComplete`. At that point the scrub bar's maximum and the time display switch to the final `totalFrames`.
- **Status line:**
  - while loading: `stems 7 / 23`
  - holding: `Buffering… stems 9 / 23`
  - skip mode, after skips: `3 clips skipped (arrived late)`
- **New events:**
  - `waiting` and `playing` mirror the worklet's reports.
  - `skipped` carries `{ slot, clipHash, bar }`, mapped from the voice index through the plan.
- **Failures before the first play:** they collect into a `LoadError` and keep today's behaviour, with no change to the existing tests.
- **Failures after the first play:**
  - The element fires `error` with the stem's message.
  - It computes the start frame of the first voice using that stem, and sends `blocked` with that frame.
  - On `stopped`, it enters fallback mode, paused, with reason `stems`. The position is kept when the fallback's seed and bars equal the performance's, and set to 0 otherwise, since the recording is a different performance. Without a fallback, it shows the error and disables play.
- **The `late` attribute:**
  - It is observed, but not one of the attributes that trigger a reload. Changing it sends `{ type: 'late' }`.
  - The control is a checkbox, `part="late"`, labelled "Don't wait for late stems". It sets the attribute.
  - The default is `wait`, so the exact-performance promise holds unless the listener opts out.

### D5. Lanes draw pending and skipped clips

`Lanes.setPerformance` takes the partial plan plus the pending and skipped sets.

- **Pending voices:** drawn from `start` to `start + lengthBars` of their clip, with the `pending` part state. Their tail isn't known yet.
- **Skipped voices:** drawn with the `skipped` state.
- **Redrawing:** the element redraws on each `stems` update and on each `skipped` report.
- **Styling:** custom properties `--spite-pending` and `--spite-skipped` follow the existing styling-hook pattern.

### D6. Tests

- **Engine (Node):**
  - The partial plan equals the full plan when every stem is present: placeholder seeds `0`, `42` and `spite-store`.
  - Frames before the horizon are byte-identical to the full render, with several subsets of stems present.
  - With nothing present, the horizon is 0.
- **Mixer (Node, no audio):**
  - Drive `Mixer.process` with 128-frame blocks, delivering stems at chosen block numbers.
  - Wait mode: the concatenated output with held blocks removed equals the full render rounded to float32, and therefore the float32 golden.
  - Skip mode with no late stems: identical to wait mode.
  - Skip mode with a late stem: equals the full render of the plan without the skipped voice.
  - Also: blocked frames, seek clearing skips, and switching mode mid-hold.
- **Browser:**
  - A fake server whose stem responses are gated per hash and released by the test.
  - `ready` comes before `loaded`.
  - Request order with concurrency 1, via a test-only queue width.
  - The status line and events for hold, resume and skip.
  - A late failure with and without a fallback.
  - The `late` control.
  - "Stems arriving mid-render" runs through the real worklet in an `OfflineAudioContext`, with `suspend()` to deliver stems mid-render (see Risks).

## Risks / Trade-offs

- **`OfflineAudioContext.suspend()` support.** Delivering stems in the middle of an offline render needs `suspend()` at a frame. If one browser engine lacks it, that browser can't run the mid-render worklet test. The mixer tests in Node cover the same logic exactly, and the worklet wrapper adds no arithmetic. If this happens during implementation, I'll report which engine it affects rather than silently dropping the scenario.
- **The first wait is still 14–19 MB of WAV for the River.** Streaming removes about two thirds of the wait, not all of it. Compressed stems are the next lever, and they're out of scope here.
- **Seeking far ahead under `wait` holds until every earlier stem is in.** That follows from exactness: earlier tails could reach the sought frame. It can be a long hold on a slow connection. `skip` mode is the listener's way out.
- **Skip mode output depends on the network.** Two listeners of the same seed can hear different things, which is exactly what the listener opted into. It is always reported through the status line and `skipped` events, never silent. The exact-performance promise is stated for `wait`, and for `skip` when nothing is skipped.
- **A longer scrub bar.** The bar's length grows once the final tails are known. A listener can see the end move by a few seconds, which is a cosmetic cost of not knowing tails up front.
