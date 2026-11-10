# Proposal

## Why

Everything built so far (engine, audition, player) has only ever played synthesized placeholder stems. The MVP goal is to release a real White track as an aleatoric piece, and the first real recording is ready: a string quartet session for *The River Forgets to Answer*, with three variations of one 4-bar phrase per instrument, each recorded on close and room mics. To use it, recordings need a repeatable way into the content-addressed stem store. Today `spite pack` is a stub.

## What Changes

- Implement `spite pack`. It reads a committed pack file that says which bar ranges of which source recordings become which clips. It cuts those ranges at exact bar-start frames, writes each one as a minimal canonical WAV to `.stems/<sha256>.wav`, and checks the hashes against the manifest. `--update` rewrites the hashes on purpose, mirroring `pnpm stems:placeholder`.
- Pack copies sample bytes without changing them and drops all metadata chunks (Logic's `bext`, `regn` and others). The same audio therefore always produces the same stem hash, whatever the source file's metadata or machine.
- Add the first real piece at `pieces/the-river-forgets-to-answer/`: a manifest (63 BPM, 7/8), a pack file and a README. Each of the four instruments has a close slot and a room slot, and each slot draws from that instrument's three phrase variations. Exclusions keep a room mic on the same take as its close mic whenever both play.
- Add golden trace snapshots and a take-lock test for the piece. These run in CI without the audio, because realization needs no stems.
- Let the site choose a piece with a `piece` query parameter, defaulting to the placeholder. The missing-stem response now also points to `spite pack`.

## Out of Scope

- Committing any audio. Source recordings stay outside the repo, and stems stay in the git-ignored `.stems/`.
- Sample-rate or format conversion, resampling, dithering, loudness normalization, fades or any other processing in pack. Sources must already be 48 kHz WAV in an encoding the renderer accepts.
- Detecting segments or trimming silence automatically. Bar ranges are written by hand in the pack file.
- Panning or stereo placement. The schema has none, so mono stems play centred. Adding pan is a separate schema change.
- A schema-level "linked slots" feature. Take-locking uses existing exclusions.
- The track's MIDI-only parts (bass, chords, drums, melody), and bouncing them to audio.
- The AUD fallback, streaming loads, hosting or deployment, and publishing the piece anywhere beyond the local site.
- Changes to the manifest schema, the engine's realization rules or the renderer.

## Capabilities

### New Capabilities
- `stem-packing`: the `spite pack` command, which turns bar ranges of source recordings into canonical, content-addressed stems and verifies or updates a manifest's clip hashes.
- `river-piece`: the committed piece *The River Forgets to Answer*: its manifest, pack file, take-locking between close and room mics, and golden trace snapshots.

### Modified Capabilities
- `player-site`: the page can load any piece under `pieces/` with a `piece` query parameter, and the missing-stem 404 mentions `spite pack` as well as `pnpm stems:placeholder`.

## Impact

- `packages/cli`: new `pack` command replacing the stub, a canonical WAV writer for sliced PCM, updated usage text and README, and a missing-stems hint that mentions pack.
- `packages/engine`: no behaviour change. Pack reuses its WAV parsing and bar-timing functions, which may need exporting if they are internal.
- `pieces/the-river-forgets-to-answer/`: new manifest, `pack.json` and README.
- `fixtures/golden/`: new trace snapshots for the piece. `pnpm golden:update` is extended to include them.
- `site/`: piece selection from the URL, and the 404 message.
- No new runtime dependencies.
