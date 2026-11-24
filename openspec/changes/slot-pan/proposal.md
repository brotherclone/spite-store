# Proposal

## Why

Every voice in a piece plays in the centre: the manifest has no way to place a slot in the stereo field, and the renderer adds each stem equally to both channels. *The River Forgets to Answer* is a string quartet, and the pack change accepted a centred quartet for v0 on the condition that a pan schema change would follow if it sounded wrong. The work since then has changed how the River loads, not how it sounds. Placing its four instruments is the most direct improvement to the one released piece. It also gives placement a home before symbolic layers add more voices.

## What Changes

- **Manifest:** a slot may have an optional `pan`. It is either a fixed position in [-1, 1] (−1 hard left, 0 centre, 1 hard right) or a range `{ "min": a, "max": b }` from which each pick draws a position. This is a 0.1 addition like `fallback` and `engine`, not a `specVersion` bump, because every existing manifest validates, realizes and renders exactly as before.
- **Realization:** an event from a slot with a pan carries `pan`. A fixed pan is copied; a range is drawn once per pick on its own decision path, so no existing decision moves. Events from slots without a pan carry no `pan` field, so the traces and `traceHash` of every existing manifest are unchanged. `TRACE_FORMAT` stays 1.
- **Rendering:** a balance pan law in which the centre is exactly unity and only the far side is turned down. A centred or unpanned event renders the same samples as today, so `RENDER_FORMAT` stays 1 and every golden audio and float32 snapshot is unchanged. Mono and stereo stems use the same law.
- **Validation hardening:** the engine's own structural check rejects unknown slot properties, as the JSON Schema already does. From now on, an engine that doesn't know a slot field refuses it instead of ignoring it.
- **Structure view:** a clip block from an event with a pan shows its position after the clip id (for example `L60`, `C`, `R25`).
- **The River:** its eight slots get fixed positions in standard quartet seating, chosen by the author by auditioning. This is a re-release in sound: every seed keeps its clip choices, but it is placed. Its golden traces gain `pan` fields, and its fallback MP3 is re-rendered and re-published so it matches the placed render.

## Capabilities

### New Capabilities

None. Placement belongs to the slot, the event and the mixer, which existing capabilities already own.

### Modified Capabilities

- `music-manifest`: slots gain the optional `pan` field and its validation, and unknown slot properties are rejected.
- `piece-realization`: events from panned slots carry `pan`; a range is drawn on a new, separate decision path; the trace of a manifest without pan is unchanged.
- `audio-rendering`: mixing applies the balance pan law, with unpanned and centred events rendering exactly as before.
- `web-player`: the structure view shows a block's pan position.
- `river-piece`: the quartet is placed in the stereo field, and the fallback matches the placed render.

## Impact

- **Engine:** `manifest.ts` (the `Slot` type and structural checks), `realize.ts` (the `TraceEvent` type, the pan draw and `canonicalTrace`), `audio/render.ts` (`Voice` and `renderBlockInto`) and the engine README.
- **Schema:** `schema/manifest.schema.json`, new valid and invalid examples, and a "0.1 addition: `pan`" entry in `schema/CHANGELOG.md`.
- **Player:** `lanes.ts` for the label only. Mixing goes through the engine's `renderBlockInto`, so the worklet needs no change.
- **The River:** `pieces/the-river-forgets-to-answer/manifest.json`, its three golden traces, a new fallback (`spite fallback`, then `spite publish`) and its README.
- **Unchanged:** `TRACE_FORMAT`, `RENDER_FORMAT`, the engine pins, the stems, and every golden snapshot except the River's traces.

## Out of Scope

- **True stereo panning of stereo stems:** moving a stereo stem's right channel into the left side, or stereo width controls. A stereo stem is balanced, and hard-panning it drops one side.
- **Pan on individual clips**, pan that moves during a clip (automation), and pan envelopes over the form.
- **Pan laws other than the balance law,** including equal-power and −3 dB-centre laws, or a per-piece choice of law.
- **Other spatial effects:** reverb, delay, surround or binaural rendering.
- **Placing the placeholder piece.** It stays centred, and so do its goldens.
- **Remembering the old centred River.** Its seed links play the placed performance after the re-release, and the old fallback stays in the immutable store but is no longer referenced.
- **Bumping `specVersion`, `TRACE_FORMAT` or `RENDER_FORMAT`.**
