# Spec Delta

## MODIFIED Requirements

### Requirement: Publish command
`spite publish <manifest...> [--stems <dir>]` SHALL upload, for every named manifest, the file of every clip in its catalogue, of its fallback (if any), and of every track in the `release.json` beside it (if any), stored by name `<hex>.flac` (or `<hex>.mp3` for an MP3 fallback). It SHALL upload every catalogued clip, not only those some seed uses. It SHALL read files from the stems directory, which defaults to `.stems/`.

#### Scenario: First publish
- **WHEN** `spite publish pieces/the-river-forgets-to-answer/manifest.json` is run with all 24 stems and the fallback in `.stems/` and an empty store
- **THEN** 25 files are uploaded, a summary reports 25 uploaded and 0 already present, and it exits 0

#### Scenario: Several manifests share a stem
- **WHEN** two named manifests reference the same hash
- **THEN** that file is uploaded at most once

#### Scenario: Re-publishing after the switch to FLAC
- **WHEN** the River has been re-packed as FLAC and is published to a store that holds its earlier WAV stems and its fallback
- **THEN** 24 `.flac` files are uploaded, the fallback is reported as already present, and no `.wav` file is uploaded or removed

#### Scenario: Track audio published
- **WHEN** the River's `release.json` records the track `first-light` and `spite publish` is run on its manifest with that track's FLAC in `.stems/` and every other file already in the store
- **THEN** exactly one file, `<audio-hex>.flac`, is uploaded and the summary names it as `track:first-light`

#### Scenario: Invalid release file
- **WHEN** a named manifest's sibling `release.json` is invalid
- **THEN** it prints the release file's errors, uploads nothing, and exits 1

### Requirement: Local files verified before upload
Before uploading anything, `spite publish` SHALL check that every referenced file exists locally and that its sha256 equals its hash. If any is missing or doesn't match, it SHALL name each one's clip id (or `fallback`, or `track:<id>` for a track) and hash, upload nothing, and exit 2.

#### Scenario: Missing local stem
- **WHEN** `spite publish` is run and one referenced stem is absent from the stems directory
- **THEN** it names that clip id and hash, uploads nothing, and exits 2

#### Scenario: Corrupt local stem
- **WHEN** a file in the stems directory does not hash to its name
- **THEN** it names that clip id and hash as a mismatch, uploads nothing, and exits 2

#### Scenario: Missing local track
- **WHEN** a recorded track's FLAC is absent from the stems directory
- **THEN** it names `track:<id>` and the audio hash, uploads nothing, and exits 2

### Requirement: Reachability check
`spite publish --check <base-url> <manifest...>` SHALL upload nothing and need no credential. For each referenced file, including the audio of every track in the manifest's sibling `release.json`, it SHALL request `<base-url><name>`. It SHALL list every file that is not reachable with a 2xx status, by clip id (or `fallback`, or `track:<id>`) and hash, and exit 1 if there are any, or 0 if all are reachable. A network error SHALL count as unreachable. An invalid sibling `release.json` SHALL be reported and SHALL make it exit 1.

#### Scenario: All reachable
- **WHEN** `--check` is run after a successful publish of the same manifests
- **THEN** it reports every file as reachable and exits 0

#### Scenario: One missing
- **WHEN** `--check` is run and one referenced hash is absent from the store
- **THEN** it names that clip id and hash and exits 1

#### Scenario: Track audio missing
- **WHEN** `--check` is run and a recorded track's audio is absent from the store
- **THEN** it names `track:<id>` and the audio hash, and exits 1

#### Scenario: Invalid release file fails the check
- **WHEN** `--check` is run on a manifest whose sibling `release.json` names an unrecorded version
- **THEN** it prints the release file's error and exits 1

#### Scenario: Usage
- **WHEN** `spite publish` is run with no manifests, or `--check` without a URL
- **THEN** it prints usage and exits 2
