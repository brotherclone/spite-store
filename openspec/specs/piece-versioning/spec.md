# piece-versioning Specification

## Purpose

Freezes a piece into immutable, content-addressed versions, so a seed link or a track that names a version keeps meaning one performance however the piece's working manifest changes afterwards.

## Requirements

### Requirement: Version identity
A version SHALL be identified by `sha256:<hex>`, the sha256 of the frozen manifest's exact bytes. Two manifests are the same version only when their bytes are identical. The stored file for a version SHALL be named `<hex>.json`.

#### Scenario: Identity is the byte hash
- **WHEN** a manifest file whose bytes hash to `<hex>` is frozen
- **THEN** its version is `sha256:<hex>` and the stored file is `<hex>.json` with exactly those bytes

#### Scenario: Reformatting makes a new version
- **WHEN** a frozen manifest is reformatted (whitespace or key order only) and frozen again
- **THEN** a second version with a different hash is recorded, and the first is unchanged

### Requirement: Same version, same performance
Realizing and rendering a version SHALL give exactly the trace and audio that the same manifest bytes gave as a working manifest, for every seed and length. Freezing SHALL NOT change any engine decision path, `TRACE_FORMAT` or `RENDER_FORMAT`.

#### Scenario: Trace unchanged by freezing
- **WHEN** The River's working manifest is frozen and the frozen file is realized with seed `hello` for 64 bars
- **THEN** its `traceHash` equals that of the working manifest realized with seed `hello` for 64 bars before freezing

#### Scenario: Bounce unchanged by freezing
- **WHEN** `spite bounce` is run on the stored `<hex>.json` and on the working manifest it was frozen from, with the same seed, bars and stems
- **THEN** the two WAV files are byte-identical

### Requirement: Version list
A piece's frozen versions SHALL be recorded in `pieces/<id>/versions.json` as `{ "versions": [ { "hash": "sha256:<hex>", "label": "<label>" }, ... ] }`, oldest first. The last entry SHALL be the piece's latest version. A piece without the file, or with an empty list, is unfrozen.

#### Scenario: Latest is last
- **WHEN** a piece's `versions.json` lists `v1` then `v2`
- **THEN** its latest version is `v2`

#### Scenario: No file means unfrozen
- **WHEN** a piece directory has no `versions.json`
- **THEN** the piece has no frozen versions

### Requirement: Version labels
Every recorded version SHALL have a label matching `^[a-z0-9][a-z0-9._-]{0,31}$` that is unique within the piece. A label SHALL NOT be `working`, and SHALL NOT be 64 hex digits. A version's label SHALL never change once recorded, and a label SHALL never be reused within a piece.

#### Scenario: Reserved label refused
- **WHEN** `spite freeze --label working` is run
- **THEN** it says `working` is reserved, records nothing, uploads nothing and exits 2

#### Scenario: Duplicate label refused
- **WHEN** `spite freeze --label v1` is run on a changed manifest for a piece that already has `v1`
- **THEN** it says `v1` is taken, records nothing, uploads nothing and exits 1

### Requirement: Freeze command
`spite freeze <manifest> [--label <l>] [--stems <dir>]` SHALL write the manifest's bytes to `<dir>/<hex>.json`, upload every stem, fallback and the manifest file the store lacks, and then append the version to the piece's `versions.json`. It SHALL print the hash and label and exit 0.

#### Scenario: First freeze
- **WHEN** `spite freeze pieces/the-river-forgets-to-answer/manifest.json` is run with every stem and the fallback in `.stems/` and a credential set
- **THEN** `.stems/<hex>.json` exists, the store holds `<hex>.json`, `versions.json` lists `{ "hash": "sha256:<hex>", "label": "v1" }`, and it exits 0

#### Scenario: Automatic labels count up
- **WHEN** a piece with versions `v1` and `v2` is frozen again after an edit, without `--label`
- **THEN** the new version is labelled `v3`

#### Scenario: Chosen label
- **WHEN** a changed manifest is frozen with `--label first-light`
- **THEN** the new entry's label is `first-light`

### Requirement: Freezing is idempotent
Freezing a manifest whose hash is already recorded SHALL leave `versions.json` byte-identical, upload only files the store lacks, print the existing label and exit 0. With `--label` naming a different label than the recorded one, it SHALL instead exit 1 and record nothing.

#### Scenario: Second freeze records nothing
- **WHEN** `spite freeze` is run twice on the same unchanged manifest
- **THEN** the second run leaves `versions.json` byte-identical, uploads nothing, prints `v1`, and exits 0

#### Scenario: Relabelling refused
- **WHEN** a manifest recorded as `v1` is frozen again with `--label final`
- **THEN** it says the version is already labelled `v1`, changes nothing and exits 1

### Requirement: Freeze input checks
Before writing or uploading anything, `spite freeze` SHALL validate the manifest as `spite validate` does (exit 1), require its `id` to equal its directory name (exit 1), require a pin matching the running engine (exit 1, no `--ignore-pin`), and verify every stem and the fallback locally as `spite publish` does (exit 2).

#### Scenario: Unpinned manifest
- **WHEN** `spite freeze` is run on a manifest without `engine`
- **THEN** it says the piece is not pinned, writes and uploads nothing, and exits 1

#### Scenario: Mismatched pin
- **WHEN** `spite freeze` is run on a manifest pinned to trace 2 while the engine's trace format is 1
- **THEN** it prints both trace formats, writes and uploads nothing, and exits 1

#### Scenario: Id does not match directory
- **WHEN** `spite freeze pieces/river/manifest.json` is run on a manifest whose `id` is `the-river-forgets-to-answer`
- **THEN** it names both, writes and uploads nothing, and exits 1

#### Scenario: Missing local stem
- **WHEN** `spite freeze` is run and a catalogued stem is absent from the stems directory
- **THEN** it names the clip id and hash, writes and uploads nothing, and exits 2

### Requirement: Freeze credentials and failed uploads
`spite freeze` SHALL read the store credential from `BLOB_READ_WRITE_TOKEN` as `spite publish` does, exiting 2 without writing when it is unset. The version SHALL be appended to `versions.json` only after the manifest file and every file it references are in the store. If any upload fails, `versions.json` SHALL stay unchanged and it SHALL exit 1.

#### Scenario: No credential
- **WHEN** `spite freeze` is run without `BLOB_READ_WRITE_TOKEN`
- **THEN** it names `BLOB_READ_WRITE_TOKEN`, uploads nothing, leaves `versions.json` unchanged and exits 2

#### Scenario: Upload fails
- **WHEN** a stem upload fails during `spite freeze`
- **THEN** it names the failed file, `versions.json` is unchanged, and it exits 1

### Requirement: Version list validity
Any command that reads a `versions.json` SHALL reject it, naming the file and the problem, when it is not valid JSON, has fields other than `versions` (or `hash` and `label` in an entry), has a malformed hash or label, or repeats a hash or a label.

#### Scenario: Repeated hash
- **WHEN** a `versions.json` lists the same hash under `v1` and `v2`
- **THEN** reading it fails with a message naming the file and the repeated hash

#### Scenario: Unknown field
- **WHEN** a `versions.json` entry has a `date` field
- **THEN** reading it fails with a message naming the file and `date`

### Requirement: Freeze check
`spite freeze --check <base-url> <manifest...>` SHALL need no credential and upload nothing. For every version in each piece's `versions.json` it SHALL fetch `<base-url><hex>.json`, check that its bytes hash to `<hex>`, that it is a valid manifest whose `id` is the piece's, and that its stems and fallback are reachable. It SHALL list every failure and exit 1 if any, otherwise 0.

#### Scenario: All versions reachable
- **WHEN** `--check` is run after a successful freeze
- **THEN** it reports each version as reachable and exits 0

#### Scenario: Frozen manifest missing from the store
- **WHEN** `versions.json` names a hash whose `<hex>.json` is not in the store
- **THEN** it names the piece, label and hash, and exits 1

#### Scenario: Stored bytes do not match
- **WHEN** the store returns bytes for `<hex>.json` that don't hash to `<hex>`
- **THEN** it names the piece, label and hash as a mismatch, and exits 1

#### Scenario: Unfrozen piece
- **WHEN** `--check` is run on a piece with no `versions.json`
- **THEN** it reports the piece as unfrozen and does not fail because of it

#### Scenario: Stranded version warns
- **WHEN** a recorded version is pinned to formats other than the running engine's
- **THEN** the check prints a warning naming the piece, label and formats, and does not fail because of it

### Requirement: Version resolution
A version reference for a piece SHALL resolve as follows: a recorded label, to that version; 64 lowercase hex digits, to the version with that hash (recorded or not); `working`, to the working manifest; no reference, to the latest version, or to the working manifest when the piece is unfrozen. An unknown label SHALL be an error, never a different version.

#### Scenario: Label resolves
- **WHEN** a piece's `versions.json` records `v1` as `sha256:<hex>` and the reference is `v1`
- **THEN** it resolves to `<hex>.json`

#### Scenario: Hash resolves without the list
- **WHEN** the reference is a 64-hex hash not in `versions.json`
- **THEN** it resolves to `<hex>.json`

#### Scenario: Unknown label
- **WHEN** the reference is `v9` and the piece records only `v1` and `v2`
- **THEN** resolution fails naming the piece and `v9`

#### Scenario: Unfrozen piece without reference
- **WHEN** a piece has no `versions.json` and no reference is given
- **THEN** it resolves to `/pieces/<id>/manifest.json`
