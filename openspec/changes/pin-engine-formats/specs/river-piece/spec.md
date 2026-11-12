# Spec Delta

## MODIFIED Requirements

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
