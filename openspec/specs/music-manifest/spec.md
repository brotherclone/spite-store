# music-manifest Specification

## Purpose

Defines the music manifest: the versioned document an author publishes to describe an aleatoric piece. It also defines how a manifest is checked for validity before the engine realizes it.

## Requirements

### Requirement: Versioned JSON Schema
The manifest format SHALL be defined by a JSON Schema (draft 2020-12) published at `schema/manifest.schema.json`. A manifest SHALL declare `specVersion: "0.1"`, and any other value SHALL be invalid. Every change to the schema SHALL be recorded in `schema/CHANGELOG.md`.

#### Scenario: Unknown version rejected
- **WHEN** a manifest that is otherwise valid declares `specVersion: "9.9"`
- **THEN** validation fails and reports the `specVersion` field

### Requirement: Audio referenced by content hash
A manifest SHALL reference audio only by sha256 content hash, written as `sha256:` followed by 64 lowercase hex characters. It SHALL NOT contain URLs, file paths, or embedded audio data. No audio files SHALL be committed to the repository.

#### Scenario: Malformed hash rejected
- **WHEN** a clip's hash is `sha256:ABC` or `stems/kick.wav`
- **THEN** validation fails and reports that clip's hash field

#### Scenario: Repository holds no audio
- **WHEN** the repository's tracked files are listed
- **THEN** none has an audio extension (`.wav`, `.aif`, `.aiff`, `.flac`, `.mp3`, `.ogg`, `.opus`, `.m4a`) and the ignore rules exclude those extensions

### Requirement: Tempo map
A manifest SHALL contain a tempo map: a non-empty list of `{ bar, bpm, meter }` entries. The first entry SHALL be at bar 0, bars SHALL strictly increase, `bpm` SHALL be positive, and `meter` SHALL be `[beats, unit]` with positive integer beats and a power-of-two unit.

#### Scenario: Tempo map not starting at bar 0
- **WHEN** a manifest's first tempo entry is at bar 4
- **THEN** validation fails and reports the tempo map

#### Scenario: Non-increasing tempo bars
- **WHEN** two tempo entries are both at bar 8
- **THEN** validation fails

### Requirement: Clip catalogue
A manifest SHALL declare its clips in a catalogue keyed by clip id. Each clip SHALL have a content hash, a positive integer `lengthBars`, and an optional linear `gain` (≥ 0, default 1). It MAY list `excludes`: ids of other clips it must never sound alongside.

#### Scenario: Exclusion of unknown clip
- **WHEN** a clip's `excludes` lists an id that is not in the catalogue
- **THEN** validation fails and names the missing clip id

### Requirement: Sections and slots
A manifest SHALL declare one or more sections, each with a unique id and a positive integer `lengthBars`. Each section SHALL contain zero or more slots. A slot SHALL have an id that is unique within its section, an entry probability in [0, 1] (default 1), an optional linear `gain` (default 1), an optional `noRepeat` window (non-negative integer, default 0), and a non-empty clip pool of `{ clip, weight }` entries with non-negative weights summing to more than 0.

#### Scenario: Pool references unknown clip
- **WHEN** a slot's pool names a clip id that is not in the catalogue
- **THEN** validation fails and names the section, the slot and the missing clip id

#### Scenario: All-zero pool weights
- **WHEN** every entry in a slot's pool has weight 0
- **THEN** validation fails and reports that slot

#### Scenario: Duplicate ids
- **WHEN** two sections share an id, or two slots in the same section share an id
- **THEN** validation fails and names the duplicated id

### Requirement: Identifier syntax
Every section, slot and clip id SHALL match `^[a-z0-9][a-z0-9_-]{0,63}$`. These ids form decision paths and appear in event traces.

#### Scenario: Invalid identifier
- **WHEN** a slot id is `Drums Loop`
- **THEN** validation fails and reports that id

### Requirement: Section transition graph
A manifest SHALL name a `start` section. Each section MAY list outgoing transitions `{ to, weight }` with non-negative weights, and MAY set `maxVisits` (a positive integer). Every `start` and `to` reference SHALL name an existing section.

#### Scenario: Dangling transition
- **WHEN** a transition's `to` names a section that does not exist
- **THEN** validation fails and names the source section and the missing target

#### Scenario: Unknown start section
- **WHEN** `start` names a section that does not exist
- **THEN** validation fails

### Requirement: Form envelope
A manifest MAY include a form envelope: a list of at least two `{ at, value }` breakpoints. Each `at` and `value` SHALL be in [0, 1], the first `at` SHALL be 0, the last SHALL be 1, and `at` SHALL strictly increase.

#### Scenario: Envelope missing endpoints
- **WHEN** an envelope's breakpoints run from `at: 0.1` to `at: 0.9`
- **THEN** validation fails and reports the envelope

### Requirement: Example manifests
The repository SHALL include example manifests under `schema/examples/valid/` and `schema/examples/invalid/`. Every valid example SHALL pass validation. Every invalid example SHALL fail validation with the reason its file name or embedded description gives. A minimal valid example SHALL exist at `schema/examples/valid/minimal.json`.

#### Scenario: Examples agree with the validator
- **WHEN** the example test suite validates every file under `schema/examples/`
- **THEN** every file in `valid/` passes and every file in `invalid/` fails for its stated reason

### Requirement: CLI validate command
`spite validate <file...>` SHALL check each named manifest against the schema and the semantic rules above. It SHALL print each error with the file, a JSON Pointer to the offending location, and a message. It SHALL exit 0 when every file is valid, 1 when any file is invalid, and 2 on usage errors or unreadable/unparseable files.

#### Scenario: Valid manifest
- **WHEN** `spite validate schema/examples/valid/minimal.json` is run
- **THEN** it reports the file as valid and exits 0

#### Scenario: Invalid manifest
- **WHEN** `spite validate` is run on a manifest with a dangling transition
- **THEN** it prints the file, a JSON Pointer to that transition and a message, and exits 1

#### Scenario: Unparseable input
- **WHEN** `spite validate` is run on a file that is not JSON, or on a path that does not exist
- **THEN** it prints an error that names the file and exits 2

#### Scenario: No arguments
- **WHEN** `spite validate` is run with no files
- **THEN** it prints usage and exits 2
