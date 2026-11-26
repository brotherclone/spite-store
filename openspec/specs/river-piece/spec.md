# river-piece Specification

## Purpose

Defines the first real piece, *The River Forgets to Answer*: a string quartet whose four instruments each draw from three recorded variations of one phrase, with close and room mics in separate slots that stay on the same take.

## Requirements

### Requirement: Piece files
The repository SHALL contain the piece at `pieces/the-river-forgets-to-answer/` with a valid manifest (`manifest.json`, id `the-river-forgets-to-answer`), a pack file (`pack.json`), and a README. The manifest SHALL declare a fallback rendered from seed `spite-store` for 64 bars, and SHALL be pinned to the engine formats it was released with, trace 1 and render 1. The README SHALL say where the source recordings come from, how to pack them, how to regenerate and publish the fallback, and that the recordings are cleared for publishing. No audio SHALL be committed.

#### Scenario: Manifest is valid
- **WHEN** `spite validate pieces/the-river-forgets-to-answer/manifest.json` is run
- **THEN** it exits 0

#### Scenario: Pack file matches the manifest
- **WHEN** the pack file is checked against the manifest
- **THEN** every clip has exactly one pack entry, and every entry's `bars` is at least that clip's `lengthBars`

#### Scenario: Fallback declared
- **WHEN** the manifest is inspected
- **THEN** its `fallback` has `type` `audio/mpeg`, `seed` `spite-store` and `bars` 64

#### Scenario: Pinned to its release formats
- **WHEN** the manifest is inspected
- **THEN** its `engine` is `{ "trace": 1, "render": 1 }`, and stays so when the engine's formats change

### Requirement: Timing and material
The manifest SHALL have a single tempo entry of 63 BPM in 7/8. It SHALL have eight slots, one per instrument and mic among violin 1, violin 2, viola and cello, each with a close and a room mic. Each slot's pool SHALL hold that instrument and mic's three phrase variations as 4-bar clips. Each clip SHALL be packed from a 5-bar range starting at bar 0, 5 or 10 of its source, so the bar after the phrase is its tail.

#### Scenario: Pools per slot
- **WHEN** the manifest's sections are inspected
- **THEN** each of the eight slots has a pool of exactly three clips, all from the same instrument and mic, each with `lengthBars` 4

#### Scenario: Tails come from the recording
- **WHEN** the pack file is inspected
- **THEN** every entry has `bars` 5 and a start bar of 0, 5 or 10

### Requirement: Close and room stay on the same take
Whenever an instrument's close and room slots both sound at the same bar, they SHALL play the same variation. Each slot SHALL still enter independently, so either mic may sound alone.

#### Scenario: Take lock across seeds
- **WHEN** the piece is realized for 64 bars with each of the seeds `0` to `199`
- **THEN** in no trace is an instrument's close clip body sounding during a bar in which that instrument's room clip body from a different variation is sounding

#### Scenario: Mics enter independently
- **WHEN** the piece is realized for 64 bars with each of the seeds `0` to `199`
- **THEN** at least one trace has a visit where an instrument's close slot sounds and its room slot is silent, and at least one has a visit where the reverse holds

### Requirement: Finite form
Every performance of the piece SHALL end on its own, before 64 bars, for any seed.

#### Scenario: Ends before 64 bars
- **WHEN** the piece is realized for 200 bars with each of the seeds `0` to `199`
- **THEN** every trace's last event is before bar 64

### Requirement: Golden trace snapshots
The repository SHALL hold golden trace snapshots in `fixtures/golden/` for the piece at 64 bars with seeds `0`, `42` and `"spite-store"`, in the same format as the existing trace snapshots. They SHALL be checked by the test suite without needing any stems.

#### Scenario: Snapshots match without audio
- **WHEN** the test suite runs on a checkout with no `.stems/` directory
- **THEN** each of the three realizations hashes to the value recorded in its snapshot

#### Scenario: Drift detected
- **WHEN** a manifest or engine change alters any event for one of the golden seeds
- **THEN** the golden test fails and names the seed and the first differing event

### Requirement: Stereo placement
Each of the piece's eight slots SHALL have a fixed `pan` in standard quartet seating as seen from the audience: both violins left of centre, viola and cello right of centre, each instrument's close and room slots on the same side, and no slot beyond ±0.8. The values SHALL be chosen by the author by auditioning and recorded in the README. Placement SHALL change no clip choice: the engine pin stays trace 1 and render 1.

#### Scenario: Seating
- **WHEN** the manifest is inspected
- **THEN** every slot has a numeric `pan` with `|pan| ≤ 0.8`, the `vio1-*` and `vio2-*` slots are negative, the `viola-*` and `cello-*` slots are positive, and the engine pin is `{ "trace": 1, "render": 1 }`

#### Scenario: Same clip choices as the centred release
- **WHEN** the placed piece is realized for 64 bars with seeds `0`, `42` and `"spite-store"`
- **THEN** removing the `pan` fields from each trace yields exactly the centred release's trace for that seed, and every event's `pan` is its slot's value

#### Scenario: Golden traces carry the placement
- **WHEN** the River's golden trace snapshots are inspected after the re-release
- **THEN** every event has a `pan` field, and the test suite passes without any stems

### Requirement: Placed fallback
The piece's fallback SHALL be re-rendered from the placed manifest, still seed `spite-store` for 64 bars, and published before the placed manifest is deployed, so the fallback sounds like the performance the player would play.

#### Scenario: New fallback declared and published
- **WHEN** the manifest is inspected after the re-release and `spite publish --check` is run against the store
- **THEN** the `fallback` hash differs from the centred release's, its seed is `spite-store` and its bars 64, and the check finds every stem and the new fallback

#### Scenario: Fallback is placed, not centred
- **WHEN** the new fallback is decoded
- **THEN** the RMS of its left minus right channel is at least a tenth of the RMS of left plus right (the centred release's mono stems gave identical channels)
