## Why

The engine produces a deterministic event trace, but nothing turns a trace into sound, so nobody can yet hear whether a piece's rules make music. The first thing an author needs is to *audition* a piece: hear many seeds back to back and judge the rules by ear. The deterministic scheduler that makes that possible is the same core the browser player and the fixed-audio (AUD) fallback will need later, so it should be built now, block-based and portable, and held to the same determinism standard as the trace.

## What Changes

- Add a pure, block-based **audio renderer** to the engine. It turns a trace, the manifest's tempo map and decoded stems into 48 kHz stereo samples. The output is **sample-identical** for the same (manifest, seed, stems) on every runtime. It renders in arbitrary block sizes with a serializable state, so it can run unchanged in an AudioWorklet later.
- Define timing: bars map to frames through a meter-aware tempo map, with one defined rounding point per bar.
- Define tail behavior. A stem file may be longer than its clip's `lengthBars`; the extra audio is the clip's tail. A tail rings until the **same slot id** starts its next clip, then is choked with a 10 ms linear fade. Tails ring across section boundaries and ring out after the piece ends. Exclusions apply to clip bodies only.
- Add WAV stem decoding (PCM 16/24-bit or float32, 48 kHz, mono or stereo) and 16-bit WAV output (hard clip, no dither).
- Add **placeholder stems**: a committed placeholder piece (`pieces/placeholder/`) with a synthesis recipe per clip. `pnpm stems:placeholder` generates byte-identical WAVs on any machine into a local content-addressed store (`.stems/<sha256>.wav`, gitignored) and verifies every hash against the manifest.
- Add CLI commands:
  - `spite realize`: readable or JSON trace for a seed.
  - `spite bounce`: render one seed to a WAV.
  - `spite audition`: render a reel of several seeds, with 2 s of silence between them, and play it with `afplay` where available.
  - Stems resolve by hash from `--stems <dir>` (default `.stems/`).
- Make `spite validate` messages plain English instead of raw schema-library output, for example no bare regular expressions.
- Add golden audio hashes for the placeholder piece alongside the golden traces.

## Capabilities

### New Capabilities

- `audio-rendering`: Turning a realized trace into samples: stem format, bar-to-frame timing, mixing, tails and choke, piece ending, output format, block rendering, and sample-identical determinism with golden audio hashes.
- `piece-audition`: The authoring commands for hearing and inspecting a piece: `spite realize`, `spite bounce`, `spite audition`, and how stems are resolved by content hash.
- `placeholder-stems`: The reproducible placeholder piece and its generated stems, whose content hashes must match the committed manifest on any machine.

### Modified Capabilities

- `music-manifest`: The `CLI validate command` requirement now requires plain-language messages that name the offending value.

## Out of Scope

- Browser or real-time playback, `<spite-player>`, and the site. The renderer is built to be reused there but is only run from Node in this change.
- Stem formats other than WAV (FLAC, Opus, MP3), resampling, and channel counts above 2.
- Per-clip or per-slot tail settings and any other manifest schema change. `specVersion` stays `0.1`.
- Sub-bar timing (events still start on downbeats), tempo ramps, swing.
- Dither, loudness normalization, limiting, and effects.
- Hosted or remote stem storage, uploads, and `spite pack`.
- Real stems from any actual piece, including the White project.
- Changes to `schema/examples/valid/minimal.json` or its golden traces.

## Impact

- `packages/engine`: new rendering, timing and WAV modules, all subject to the engine's existing determinism lint rules and zero-dependency rule.
- `packages/cli`: new `realize`, `bounce` and `audition` commands that replace the stubs, and reworded validation messages. `audition` shells out to `afplay` on macOS only.
- New `pieces/placeholder/` (manifest and synthesis recipes), a stem-generation script, a `stems:placeholder` root script, and `.stems/` added to `.gitignore`.
- New golden audio fixtures in `fixtures/golden/`.
- No changes to the trace, decision paths or `TRACE_FORMAT`. Existing golden traces must still pass unchanged.
