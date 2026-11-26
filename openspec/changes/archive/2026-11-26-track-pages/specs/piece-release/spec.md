# Spec Delta

## Purpose

Holds a piece's release metadata (who made it, and the named tracks cut from its frozen versions) in a file beside the manifest, so this information can change without creating a new version of the music.

## ADDED Requirements

### Requirement: Release file
A piece MAY have `pieces/<id>/release.json`, an object with optional `credits` and `tracks` arrays and no other fields. It SHALL be described by `schema/release.schema.json`. A piece without the file has no credits and no tracks.

#### Scenario: Minimal release file
- **WHEN** a piece's `release.json` is `{}`
- **THEN** it is valid, and the piece has no credits and no tracks

#### Scenario: Unknown top-level field
- **WHEN** a `release.json` has a `price` field
- **THEN** it is invalid, and the error names `/price`

### Requirement: Credits
Each credit SHALL be `{ "name": <non-empty string>, "role": <non-empty string> }` with no other fields. Credits keep their order. The same name MAY appear more than once with different roles.

#### Scenario: Credits accepted
- **WHEN** `credits` is `[{ "name": "A. Composer", "role": "composition" }, { "name": "B. Player", "role": "viola" }]`
- **THEN** the release file is valid and the credits keep that order

#### Scenario: Empty role
- **WHEN** a credit's `role` is `""`
- **THEN** the release file is invalid, and the error names that credit's `role`

### Requirement: Track entries
Each track SHALL have exactly `id` (matching `^[a-z0-9][a-z0-9_-]{0,63}$`, unique within the piece), `title` (a non-empty string), `version` (`sha256:<hex>`), `seed` (a non-empty string), `bars` (a positive integer), `audio` (`sha256:<hex>`) and `frames` (a positive integer).

#### Scenario: Track accepted
- **WHEN** a track has every field, with an id of `first-light`, `bars` 40 and `frames` 5,880,000
- **THEN** the release file is valid

#### Scenario: Duplicate track id
- **WHEN** two tracks share the id `first-light`
- **THEN** the release file is invalid, and the error names the second track's `id` and `first-light`

#### Scenario: Missing audio
- **WHEN** a track has no `audio` field
- **THEN** the release file is invalid, and the error names that track

### Requirement: Tracks reference recorded versions
Every track's `version` SHALL be the hash of a version recorded in the same piece's `versions.json`. A release file with tracks in a piece that has no `versions.json` SHALL be invalid.

#### Scenario: Unrecorded version
- **WHEN** a track's `version` is a hash that is not in the piece's `versions.json`
- **THEN** the release file is invalid, and the error names that track's `version` and says it isn't a recorded version

#### Scenario: Unfrozen piece with a track
- **WHEN** a piece has a track but no `versions.json`
- **THEN** the release file is invalid, and the error says the piece has no frozen versions

### Requirement: Release file errors
Any `spite` command that reads a `release.json` SHALL report every problem with the file path, a JSON Pointer and a plain-language message, in the format `spite validate` uses for manifests, and SHALL exit 1 when the file is invalid.

#### Scenario: Errors reported like manifest errors
- **WHEN** `spite publish` is run on a manifest whose sibling `release.json` has a track with `bars` 0
- **THEN** it prints the release file's path, `/tracks/0/bars` and a message saying a positive integer is expected, uploads nothing, and exits 1

#### Scenario: Schema and CLI agree
- **WHEN** each example under `schema/examples/release/{valid,invalid}/` is checked by the JSON Schema and by the CLI
- **THEN** both accept every valid example, and the CLI rejects every invalid one, including the ones that break the version rule, which the schema can't express
