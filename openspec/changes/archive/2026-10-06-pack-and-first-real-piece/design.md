# Design

## Context

- The source session is 8 mono WAVs exported from Logic: violin 1, violin 2, viola and cello, each on a close and a room mic. All are 48 kHz 24-bit PCM with an extensible `fmt ` header and Logic metadata chunks (`JUNK`, `bext`, `minf`, `elm1`, `regn`, `umid`, `DGDA`, `LGWV`).
- Each file holds exactly 2,400,000 frames, which is 15 bars at 63 BPM in 7/8. One bar is `7 × (4/8) × 60 × 48000 / 63` = 160,000 frames, a whole number.
- Every file holds three takes, which are variations on one phrase. They start at bars 0, 5 and 10 (0 s, 16.67 s and 33.33 s) and sound for about 13.4 to 14.1 s, which is the 4-bar phrase (13.33 s) plus about half a second of ring-out. Silence follows until the next 5-bar line. The takes line up across all eight files.
- The engine already exports what pack needs: `barFrame(manifest, bar)` (bar starts that are integer and drift-free), `decodeWav` (which accepts extensible headers and skips unknown chunks) and `validateManifest`/`checkManifest` (through the CLI's `loadManifest`).
- `pnpm stems:placeholder` (`scripts/stems-placeholder.mjs`) sets the precedent pack follows: write `.stems/<hex>.wav`, compare with the manifest, and rewrite hashes with `--update`.
- Exclusions apply at pick time and include clips picked earlier at the same bar by slots that come earlier in slot-id order. They constrain bodies only, never tails (see `piece-realization`, `audio-rendering`).

See proposal.md for motivation, and the specs (`stem-packing`, `river-piece`, `player-site`) for required behaviour.

## Goals / Non-Goals

**Goals:**
- Getting real audio into `.stems/` is one command, can be repeated byte for byte, and fails loudly when a source changes.
- The first real piece is audible through `spite audition` and the local site with no change to the engine, schema or renderer.
- Everything that can be tested without the audio is tested in CI: pack against synthetic WAVs, and the piece against traces.

**Non-Goals:**
- A general pack DSL (globs, naming templates, automatic segment detection). Entries are explicit, one per clip.
- Final mix decisions. The gains and probabilities here are starting points, tuned by ear during implementation.

## Decisions

### D1. The pack file is per piece, committed and relative

`pieces/<id>/pack.json`:

```json
{
  "sources": {
    "cello-close": { "file": "Maria/Cello close.wav", "sha256": "…" },
    "cello-room":  { "file": "Maria/Cello room.wav",  "sha256": "…" }
  },
  "clips": {
    "cello-close-1": { "source": "cello-close", "startBar": 0,  "bars": 5 },
    "cello-close-2": { "source": "cello-close", "startBar": 5,  "bars": 5 },
    "cello-close-3": { "source": "cello-close", "startBar": 10, "bars": 5 }
  }
}
```

The real sources are under `…/The River Forgets to Answer (…)/Collaborations`, which is passed as `--source`. File paths are relative to it, so the repo never records a home directory. Recording each source's sha256 catches a re-export or a swapped file before it silently produces new stems.

*Alternatives:* putting slicing fields on manifest clips was rejected because the manifest is the published product format and shouldn't carry authoring paths. A naming convention with no pack file was rejected as too implicit, and bar ranges still have to live somewhere.

### D2. Bars, not seconds or frames, in the pack file *(determinism)*

Slice boundaries are `barFrame(manifest, startBar)` and `barFrame(manifest, startBar + bars)`, the same integer function the renderer uses to place events. The slice boundaries and the playback grid therefore can't disagree, and at 63 BPM in 7/8 every boundary lands on a whole frame (0, 800,000 and 1,600,000). If the tempo map ever changes, the slices move with it and the hashes change. That shows up as a hash mismatch, never as a silent mismatch between the audio and the grid.

*Alternative:* frame offsets in the pack file are exact but duplicate the tempo map, and would let audio drift from the grid.

### D3. Canonical WAV output, bytes copied *(determinism)*

Pack walks the RIFF chunks itself, because it needs byte offsets, which `decodeWav` doesn't return. It reads the format (unwrapping the extensible header to its subformat), applies the same acceptance rules as the renderer, and copies `data` bytes `[startFrame × blockAlign, endFrame × blockAlign)` unchanged into a new file with exactly two chunks: a 16-byte plain `fmt ` (format 1 for integer PCM, 3 for float) and `data`. There's no floating-point arithmetic and no sample decoding on this path, so the bytes are identical on every machine. Each written stem is then passed through the engine's `decodeWav` as a self-check that the renderer will accept it.

Dropping metadata keeps hashes stable across re-exports that only change timestamps or paths. It also keeps machine paths and session data in Logic's chunks out of anything that gets published.

### D4. Close and room locked by exclusions, not a schema feature *(seeded decision paths)*

Each room clip excludes the close clips of the other two variations of its instrument: `cello-room-1` excludes `cello-close-2` and `cello-close-3`, and so on, which is 16 exclusion pairs. Slot ids are named `<instrument>-close` and `<instrument>-room`, so in code-unit order each close slot picks before its room slot at the same bar. When the close slot sounds, the room slot's only eligible clip is the matching take. When the close slot didn't enter, the room slot picks freely. It works the other way too: when a room body is still sounding, a close pick is constrained. The section layout below means that never happens mid-phrase.

This depends on two things the test suite pins down through the `river-piece` take-lock scenario:
- **Slot-id order.** Renaming slots so that room sorts before close would make the close slot the constrained one. That's still consistent, but it changes every trace.
- **No `noRepeat` on room slots.** Otherwise the window could remove the matching take. Exclusions would then leave no candidate and the room slot would rest for a bar, making it late and mid-phrase. Close slots carry `noRepeat: 1`. The room slots follow them through the lock.

*Alternative:* a schema-level `link`/`follow` slot attribute is cleaner, but it changes the schema, realization rules and goldens for a need one piece has today. Revisit if a second piece needs it.

### D5. Form

- Section `phrase`: 4 bars, all eight slots, `maxVisits: 8`. Transitions: `phrase` weight 2, `breath` weight 1.
- Section `breath`: 1 bar, no slots, transition to `phrase` weight 1.

Every clip is 4 bars long, so each slot picks once per visit, on the visit's first bar. After the 8th phrase, only `breath` is eligible, and after that nothing is, so the piece ends within 40 bars (`river-piece` finite form). A `breath` lets the previous phrase's ring-out sound unchoked. Back-to-back phrases choke it with the standard 10 ms fade, which is the expected behaviour of a slot.

Starting values, tuned by ear during implementation: close slots `enter` 0.8, `noRepeat` 1, `gain` 0.5. Room slots `enter` 0.5, `gain` 0.4. No envelope. Changing these changes traces, so the goldens are generated only after tuning.

### D6. Site piece selection

`?piece=<id>` is accepted only if it matches the manifest id pattern (`^[a-z0-9][a-z0-9_-]{0,63}$`), so it can't escape `/pieces/`. The page sets the player's `src` before applying seed and bars. `followPlayer` already edits the existing query, so `piece` survives rerolls. The test just pins that down.

### D7. Updating files without a formatter dependency

`--update` changes only the hash strings. Pack rewrites the manifest and pack file with `JSON.stringify(…, null, 2)`, and runs Prettier on them when the CLI can resolve it (it can inside this workspace). Prettier stays out of the CLI's runtime dependencies. Files without hash changes are never rewritten.

## Risks / Trade-offs

- [The sum of eight mic tracks clips, since the renderer hard-clips at ±1] → Gains start at 0.4 to 0.5. Implementation bounces seeds 0 to 19 and checks for full-scale samples before setting the final gains.
- [Everything is mono and centred, with no pan in the schema] → Accepted for v0, and listed out of scope. Room mics still add depth. If centred strings sound wrong, a pan schema change is the follow-up.
- [Mixing variations across instruments (violin take 1 against cello take 3) may clash] → That's the aleatoric premise, but it's untested on this material. If it fails musically, a follow-up can lock instruments together with the same exclusion technique (D4) without changing the schema.
- [A phrase starting slightly late, like violin 1's take 2 at about 16.8 s] → Slicing is by bar, so the late start is preserved as performed. Nothing is trimmed.
- [Pickups or breaths before a bar line would be cut] → None are in this session, where the audio starts at the bar. If a future session has them, D2 can grow a pre-roll in bars.
- [Real stems are absent in CI, so audio regressions on this piece go unseen] → Trace goldens cover realization, the placeholder audio goldens cover the renderer, and pack is tested on synthetic WAVs. Hearing the real piece stays a manual check.
- [Collaborator recordings] → Nothing is committed or published by this change. Publishing the piece needs the collaborator's agreement, which comes before any hosting work.

## Migration Plan

Nothing to migrate. Existing pieces, goldens and commands are unchanged. The only behaviour change is that `spite pack` is no longer a stub and returns real results instead of exit 2.
