# Spec Delta

## Purpose

Renders a named, fixed performance of a frozen version to a 24-bit FLAC whose bytes are reproducible on any machine, and records it as a track in the piece's release file.

## ADDED Requirements

### Requirement: Track command
`spite track <manifest> --id <id> --version <label> --seed <seed> --bars <n> --title <title> [--stems <dir>] [--update]` SHALL resolve the label in the piece's `versions.json`, render the frozen manifest `<dir>/<hex>.json` for that seed and length, and write the audio to `<dir>/<audio-hex>.flac`. It SHALL print the audio hash, the duration and the size. `--stems` defaults to `.stems/`.

#### Scenario: Track written by hash
- **WHEN** `spite track pieces/the-river-forgets-to-answer/manifest.json --id first-light --version v1 --seed ox-bow --bars 40 --title "First Light"` is run with the frozen `v1` manifest and its stems in `.stems/`
- **THEN** it writes `.stems/<audio-hex>.flac`, the file's sha256 is `<audio-hex>`, and it prints `sha256:<audio-hex>`

#### Scenario: Renders the frozen version, not the working manifest
- **WHEN** the working manifest has changed since `v1` was frozen and `spite track --version v1` is run
- **THEN** the audio is rendered from `v1`'s stored manifest, and is identical to the audio from a run made before the change

### Requirement: Track audio format
The track audio SHALL be the render `spite bounce` would make of the frozen manifest for the same seed and bars (tails included), with each float sample clipped to [-1, 1], multiplied by 8,388,607 and rounded half up to a 24-bit integer. It SHALL be encoded by the engine's FLAC encoder as 48 kHz, 2-channel, 24-bit FLAC.

#### Scenario: Same render as bounce
- **WHEN** a track's FLAC is decoded, each sample is divided by 8,388,607 and quantized with the bounce's 16-bit rule, and `spite bounce` is run on the frozen manifest with the same seed and bars
- **THEN** the length in frames is equal, and every resulting sample is within 1 of the bounce WAV's sample

#### Scenario: Quantization rule
- **WHEN** the float samples -1.5, -1, 0, 0.5 and 1 are quantized for a track
- **THEN** they become -8,388,607, -8,388,607, 0, 4,194,304 and 8,388,607

### Requirement: Track audio is reproducible
The same frozen version, seed and bars SHALL produce byte-identical track audio on every runtime, in Node and in a context with only standard ECMAScript globals.

#### Scenario: Same bytes in a bare context
- **WHEN** the `minimal.json` example with the portability test's ramp stems is rendered for seed `42` and 16 bars and encoded as track audio, in Node and in the bare-context portability harness
- **THEN** both FLAC byte streams have the same sha256

#### Scenario: Same bytes on a second run
- **WHEN** `spite track` is run twice with the same arguments
- **THEN** both runs print the same audio hash

### Requirement: Recording the track
With `--update`, `spite track` SHALL add the track to `release.json` (creating the file if absent) with its `id`, `title`, `version` (the hash for the label), `seed`, `bars`, `audio` and `frames`, leave every other field and track unchanged, and exit 0. If a track with that id exists with the same version, seed, bars and audio, only its title SHALL be updated.

#### Scenario: New track recorded
- **WHEN** `spite track ... --id first-light --version v1 --seed ox-bow --bars 40 --title "First Light" --update` is run on a piece with no `release.json`
- **THEN** `release.json` is created with one track holding those values, `version` is `v1`'s hash, and the file passes release-file validation

#### Scenario: Retitling
- **WHEN** a recorded track is run again with the same id, version, seed and bars and a new `--title`, with `--update`
- **THEN** only that track's `title` changes

### Requirement: Recorded tracks are immutable
`spite track` SHALL refuse, writing nothing to `release.json` and exiting 1, when a track with the given id is already recorded with a different version, seed, bars or audio. It SHALL print the recorded values and the new ones.

#### Scenario: Changing a track's seed
- **WHEN** `first-light` is recorded with seed `ox-bow` and `spite track --id first-light --seed eddy --update` is run
- **THEN** it prints both seeds, leaves `release.json` byte-identical, and exits 1

### Requirement: Checking a recorded track
Without `--update`, `spite track` SHALL exit 0 when `release.json` already records the track with the same version, seed, bars, audio, frames and title. Otherwise it SHALL print the difference, leave `release.json` unchanged and exit 1.

#### Scenario: Current track
- **WHEN** `spite track` is run without `--update`, with the arguments of a recorded track and the same stems
- **THEN** it prints that the track is up to date and exits 0

#### Scenario: Unrecorded track
- **WHEN** `spite track` is run without `--update` for an id not in `release.json`
- **THEN** it prints the new track's values, leaves `release.json` unchanged and exits 1

### Requirement: Track input checks
Before writing anything, `spite track` SHALL exit 2 on usage errors (any required option missing, or a malformed `--id` or `--bars`). It SHALL exit 1 when the label isn't recorded, when the existing `release.json` is invalid, or when the frozen manifest's pin doesn't match the running engine (no `--ignore-pin`). It SHALL exit 2, naming what to run, when the frozen manifest isn't in the stems directory or doesn't hash to its name, or when a stem the seed uses is missing.

#### Scenario: Unknown label
- **WHEN** `spite track --version v9` is run on a piece whose versions are `v1` and `v2`
- **THEN** it names `v9`, writes nothing, and exits 1

#### Scenario: Frozen manifest not local
- **WHEN** `v1`'s `<hex>.json` is not in the stems directory
- **THEN** it names the hash and says to run `spite freeze` or copy the file from the store, writes nothing, and exits 2

#### Scenario: Missing stem
- **WHEN** a stem the seed uses is absent from the stems directory
- **THEN** it names the clip id and hash, writes nothing, and exits 2

#### Scenario: No title
- **WHEN** `spite track` is run without `--title`
- **THEN** it prints usage and exits 2
