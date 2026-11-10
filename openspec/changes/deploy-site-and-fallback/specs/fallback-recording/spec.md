# Spec Delta

## Purpose

Produces a piece's fallback recording: one fixed performance, rendered from a chosen seed, encoded to a compressed format, stored by content hash and recorded in the manifest, for listeners whose browsers can't play the generative version.

## ADDED Requirements

### Requirement: Fallback command
`spite fallback <manifest> --seed <seed> [--bars <n>] [--stems <dir>] [--update]` SHALL render the piece for that seed exactly as `spite bounce` does, encode the render to MP3 (48 kHz stereo, 256 kbps constant bit rate), and write the file to `<dir>/<hex>.mp3`, where `<hex>` is the sha256 of the MP3 bytes. `--bars` defaults to 64 and `--stems` to `.stems/`. It SHALL print the hash, the duration and the size.

#### Scenario: Fallback written by hash
- **WHEN** `spite fallback pieces/the-river-forgets-to-answer/manifest.json --seed spite-store` is run with all stems present
- **THEN** it writes `.stems/<hex>.mp3`, the file's sha256 is `<hex>`, and it prints `sha256:<hex>`

#### Scenario: Same render as bounce
- **WHEN** `spite fallback` and `spite bounce` are run with the same manifest, seed and bars
- **THEN** the audio given to the encoder is byte-identical to the WAV that `spite bounce` writes

### Requirement: Recording the fallback in the manifest
With `--update`, `spite fallback` SHALL set the manifest's `fallback` field to the new file's hash, `type` `audio/mpeg`, the seed and the bars, leave every other field unchanged, and exit 0. Without `--update`, it SHALL exit 0 if the manifest's `fallback` already names the same hash, seed and bars, and otherwise print the difference, leave the manifest unchanged and exit 1.

#### Scenario: Update writes the field
- **WHEN** `spite fallback <manifest> --seed spite-store --bars 64 --update` is run
- **THEN** the manifest's `fallback` is `{ "hash": "sha256:<hex>", "type": "audio/mpeg", "seed": "spite-store", "bars": 64 }`, the manifest still passes `spite validate`, and no other field changed

#### Scenario: Stale fallback reported
- **WHEN** the manifest's `fallback` names seed `a` and `spite fallback` is run with `--seed b` and no `--update`
- **THEN** it prints the recorded and new seed and hash, leaves the manifest unchanged, and exits 1

### Requirement: Encoder dependency
`spite fallback` SHALL use the `ffmpeg` executable on `PATH` to encode. If `ffmpeg` is absent, or can't encode MP3, it SHALL say that `ffmpeg` with MP3 support is required, write nothing, and exit 2. No other `spite` command SHALL need `ffmpeg`.

#### Scenario: No ffmpeg
- **WHEN** `spite fallback` is run with no `ffmpeg` on `PATH`
- **THEN** it prints a message naming `ffmpeg`, writes no file, leaves the manifest unchanged, and exits 2

### Requirement: Fallback input checks
`spite fallback` SHALL validate the manifest the same way `spite validate` does, and check its stems the same way `spite bounce` does, before encoding anything. It SHALL exit 1 on an invalid manifest, and 2 on usage errors or missing stems, writing nothing in either case.

#### Scenario: Missing stem
- **WHEN** `spite fallback` is run with a stems directory that lacks a stem the seed uses
- **THEN** it names that clip id and hash, writes no file, and exits 2

#### Scenario: No seed
- **WHEN** `spite fallback` is run without `--seed`
- **THEN** it prints usage and exits 2

### Requirement: Encoded bytes are outside the determinism promise
The render given to the encoder SHALL be deterministic, like any bounce. The encoded MP3's bytes are not promised to be reproducible across `ffmpeg` versions. The manifest's hash SHALL pin the exact file that was published, and the fallback SHALL be described to listeners as a fixed recording of its seed, not as the generative performance.

#### Scenario: Re-encoding with another ffmpeg
- **WHEN** the same seed is re-encoded with a different `ffmpeg` version and the MP3 hash changes
- **THEN** `spite fallback` without `--update` reports the new hash and exits 1, and the previously recorded file stays valid for its recorded hash
