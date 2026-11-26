# Design

## Context

- **The renderer is centre-only.** `renderBlockInto` (`packages/engine/src/audio/render.ts`) adds `stem.channels[0] × g` to the left and `(channels[1] ?? channels[0]) × g` to the right, where `g = voice.gain × fade`. A mono stem therefore lands identically in both channels, and the River's stems are all mono.
- **The player doesn't mix on its own.** The worklet's mixer calls the engine's `renderBlockInto`, so anything the engine renders, the browser renders.
- **Events carry everything the renderer needs.** `TraceEvent` is `{ bar, beat, slot, clipHash, gain }`, and `gain` is already the product of static clip and slot gains. `canonicalTrace` writes the fields in a fixed order, and `traceHash` is the sha256 of that string.
- **Random draws are keyed by path.** `random.draw(path, i)` is counter-based on `(seed, pathHash(path), i)`. The clip pick uses `['v', visitOrdinal, 's', slotId, 'pick', pickOrdinal]`. A draw on a new path can't change any existing draw.
- **The schema changelog's rule** is that a change which alters how an existing manifest validates or realizes bumps `specVersion`. Purely additive fields (`fallback`, `engine`) were "0.1 additions".
- **The engine ignores unknown slot properties.** `checkStructure` checks the known slot fields but not extra ones, while the JSON Schema has `additionalProperties: false`. A player from before this change would play a `pan` manifest centred, without complaint.
- **The engine forbids transcendental math** (`Math.sin`, `Math.cos`, `**` and the like), so a pan law has to use plain arithmetic.

## Goals / Non-Goals

**Goals:**
- Every existing manifest, seed and set of stems renders byte-identically, so no format bump and no golden regenerated except the River's.
- The pan law is exact arithmetic that gives identical samples in every runtime.
- A drawn pan adds variety without moving any existing decision.

**Non-Goals:**
- A perceptually ideal pan law. The law is chosen for exactness and backward identity; see D1.
- A way to keep the centred River playable. The re-release replaces it.

## Decisions

### D1. A linear balance law with unity at the centre

The near side stays at gain 1 and the far side falls linearly: `L = p > 0 ? 1 − p : 1` and `R = p < 0 ? 1 + p : 1`. In the inner loop the left contribution is `l[i] × (g × L)` and the right is `r[i] × (g × R)`. At the centre, `g × 1` is exactly `g` in IEEE arithmetic, so the samples are bit-identical to today's `l[i] × g`. That is why `RENDER_FORMAT` and every golden audio snapshot stay as they are.

Alternatives considered:
- **Equal-power with a −3 dB centre** (`cos`/`sin` of the angle). This turns every centred voice down by 3 dB, which changes every existing render and needs a `RENDER_FORMAT` bump that strands both pieces. It also needs `sin`/`cos`, so a committed lookup table.
- **Equal-power normalised to 0 dB at the centre.** Existing renders are kept, but a hard-panned voice gets +3 dB (√2) on its near side. A mix balanced in the centre can then clip when panned, and it still needs the table.
- **Linear balance** (chosen). It is exact, needs no table, and is identical at the centre. No pan setting can raise a channel above its unpanned level, so placing a piece can't make it clip.

The cost is that perceived loudness falls as a voice moves outwards: the power goes from 2 at the centre to 1 at hard pan, about −3 dB. At the River's planned ±0.6 that is about −2.4 dB for the outer instruments. This is accepted and documented, and an author who minds raises the slot's `gain`.

### D2. Pan travels on the event

`pan` is copied, or drawn, into the `TraceEvent`, and from there into the render plan's `Voice`, the same way `gain` is. The renderer never looks back at the manifest.
- **Slot ids aren't enough.** A slot id can appear in several sections with different pans, and the renderer only sees slot ids.
- **A drawn pan is a decision**, so it belongs in the trace, which is what is hashed and compared.

On the `Voice`, an absent pan stays absent, so the structure view can tell it apart from a declared `pan: 0`. The renderer treats it as 0, which gives exact unity on both sides.

### D3. The field is present only when declared, and the trace format stays 1

`canonicalTrace` appends `,"pan":<value>` after `gain` only when the event has `pan`. An event from a slot without `pan` serializes exactly as now, so every existing `traceHash` is unchanged.

`TRACE_FORMAT` is defined as bumped when a change alters the trace for an existing (manifest, seed). No existing manifest can contain `pan`: the JSON Schema rejects it, and `spite validate` runs the schema first. So no existing trace changes, and there is no bump.

A slot that declares `"pan": 0` carries `pan: 0`. The author declared it, and the rule "present when declared" is simpler than special-casing zero.

### D4. A drawn pan uses its own path and 101 steps (affects determinism)

For a range `{ min, max }`, the pan is drawn only when the pick chose a clip. The draw is `random.draw(['v', visitOrdinal, 's', slotId, 'pan', pickOrdinal])`, and then:
- `k = draw % 101`
- `pan = min + (max − min) × k / 100`

**Why this path:**
- It reuses the pick's keys (visit ordinal, slot id and pick ordinal), so it follows the "Decision-path stability" requirement: it depends on stable ids, never declaration order.
- The `'pan'` label keeps it disjoint from `'pick'`, so adding, removing or changing a range moves no other draw. The spec's strip-the-`pan`-fields scenarios check exactly this against the minimal goldens.
- No draw is made for a pick that chose no clip. That event doesn't exist, so the trace has nothing to carry.

**Why 101 steps:** positions at 1% of the range keep golden JSON and lane labels readable. Modulo bias is `2³² mod 101` extra chances in 2³², which is negligible. The result is computed with `+`, `−`, `×` and `/` on doubles, so it is identical everywhere.

Alternative: a continuous `rand() × (max − min)`. It is equally deterministic, but it gives traces full of 17-digit decimals for no audible gain.

### D5. A 0.1 addition, not a `specVersion` 0.2

This follows the changelog's own rule and the `fallback` and `engine` precedent. Bumping to 0.2 would make every engine before this one reject every manifest, including ones without `pan`, for no benefit. The changelog entry says that a manifest using `pan` doesn't validate with an older validator.

### D6. The engine rejects unknown slot properties

`checkStructure` gains the same key allowlist for slots that `fallback` and `engine` already have. This can't fix engines that are already deployed. It does mean the next slot field is refused by a player that predates it, rather than played wrong. Every manifest in the repo already passes the schema, so nothing existing breaks.

### D7. The label, not a new lane layout

The structure view appends the position to each block's label (`vio1-close-2 · L60`). Rows stay ordered by slot id. Ordering rows by position was considered, but rows are per slot id across sections, and a drawn pan differs from block to block.

### D8. Placing the River: fixed positions, chosen by ear, gains untouched

The starting point is classic seating seen from the audience:

| Slot | Close | Room |
| --- | --- | --- |
| Violin 1 | −0.6 | −0.3 |
| Violin 2 | −0.25 | −0.15 |
| Viola | +0.25 | +0.15 |
| Cello | +0.6 | +0.3 |

The room mics are narrower because they carry the hall, not the instrument. The author bounces two or three width variants of seed `spite-store` (for example ×0.75, ×1 and ×1.25 of these values), listens, and picks. The chosen values go in the manifest and the README.

Slot gains are left alone. The strip-the-`pan`-fields check against the centred goldens then proves that placement changed no clip choice. A level adjustment, if wanted, is a separate change.

## Risks / Trade-offs

- **[A player from before this change ignores `pan`]** → The site serves the player bundle and the manifests from the same deployment, so a fresh page never mixes them. A tab left open across the deploy loads its manifest when it loads the piece, which is with the bundle it already has; at worst that tab plays centred until reloaded. Embeds on other sites are out of scope. D6 closes this for future fields.
- **[The River gets quieter]** → About −2.4 dB for the outer instruments at ±0.6, and less for the inner ones. It is heard during the audition step. The fallback is re-rendered from the same placed manifest, so the fallback and the generative render still match each other.
- **[The balance law drops one channel of a stereo stem at hard pan]** → Documented in the spec scenario and the engine README. No piece hard-pans a stereo stem today. True stereo panning is out of scope.
- **[The River's seed links change sound]** → Clip choices are proven unchanged by the strip check, so a shared seed is still recognisably the same performance, now placed. This is the re-release the proposal describes.
- **[The fallback and the placed manifest are deployed out of order]** → `deploy-check` refuses a build whose manifest names a fallback the store doesn't have. Publishing comes before pushing.

## Migration Plan

1. Engine: the slot key allowlist, `pan` validation, the pan on events and in `canonicalTrace`, the draw, the `Voice` pan and the pan law. Every golden must pass unregenerated.
2. Schema: the JSON Schema `pan`, examples and the changelog entry. Then the player's lane label, and the panned placeholder variant in the Node and browser tests.
3. River: bounce the width variants, the author picks, write the `pan` values, regenerate the River's goldens and check them with the strip script. Then `spite fallback … --seed spite-store --bars 64 --update` and `spite publish`.
4. Push for a preview, listen in each browser, then merge into `develop` and `master`.
5. **Rollback:** redeploy the previous build. Its manifest names the centred fallback, which is still in the immutable store.

## Open Questions

- **The River's exact positions.** They are settled by ear in step 3. The spec constrains only the sides and the ±0.8 bound, so the values don't affect the specs or the tasks.
