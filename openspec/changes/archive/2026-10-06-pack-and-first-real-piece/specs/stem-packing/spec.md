# Spec Delta

## Purpose

Turns bar ranges of an author's source recordings into canonical, content-addressed stems, and keeps a manifest's clip hashes in step with them, so real audio can enter a piece without ever being committed.

## ADDED Requirements

### Requirement: Pack file
A piece that uses recorded audio SHALL have a pack file (`pack.json` beside its manifest). It names each source recording by a path relative to a source directory, together with that file's sha256. For every clip, it gives a source, a start bar and a length in bars. The pack file SHALL contain no absolute paths.

#### Scenario: Pack file covers the catalogue
- **WHEN** a pack file is checked against its manifest
- **THEN** every clip in the manifest has exactly one pack entry, every pack entry names a clip in the manifest, and every entry names a declared source

#### Scenario: Mismatched pack file refused
- **WHEN** a pack entry names an unknown clip or source, or a manifest clip has no pack entry
- **THEN** `spite pack` names each problem and exits 2 without writing any stem

### Requirement: Pack command
`spite pack <manifest> --source <dir> [--stems <dir>] [--update]` SHALL read the pack file beside the manifest, resolve each source under `--source`, and write one stem per clip to the stems directory, `.stems/` by default, as `<hex>.wav`, where `<hex>` is the sha256 of the stem's bytes. Pack SHALL validate the manifest the same way `spite validate` does before doing anything else.

#### Scenario: Stems written by hash
- **WHEN** `spite pack` runs on a valid manifest and pack file whose sources are all present and valid
- **THEN** the stems directory holds one `<hex>.wav` per distinct stem, and each file's sha256 equals its name

#### Scenario: Missing source
- **WHEN** a source named in the pack file does not exist under `--source`
- **THEN** pack names that source and its path, writes no stem, and exits 2

### Requirement: Source checks
Pack SHALL accept only sources that are RIFF/WAVE at 48,000 Hz with 1 or 2 channels, in 16-bit integer, 24-bit integer or 32-bit float PCM. Either the plain or the extensible format header is allowed. Pack SHALL also check each source's sha256 against the pack file. Pack SHALL NOT resample, convert, dither or otherwise process audio.

#### Scenario: Wrong sample rate refused
- **WHEN** a source is a 44,100 Hz WAV
- **THEN** pack names the source and its sample rate, writes no stem, and exits 2

#### Scenario: Changed source detected
- **WHEN** a source file's sha256 differs from the one recorded in the pack file and `--update` is not given
- **THEN** pack names the source with its expected and actual hashes, writes no stem, and exits 1

### Requirement: Bar-exact slicing
A clip's stem SHALL be the source's sample frames from the start frame of its start bar up to, but not including, the start frame of the bar `bars` later. Both frames SHALL be computed from the manifest's tempo map exactly as the renderer computes bar starts. The range SHALL lie wholly within the source's audio, and `bars` SHALL be at least the clip's `lengthBars`.

#### Scenario: Frames at 63 BPM in 7/8
- **WHEN** a manifest has a single tempo entry of 63 BPM in 7/8, and a clip is packed from start bar 5 with `bars` 5
- **THEN** its stem holds exactly source frames 800,000 to 1,599,999 (800,000 frames)

#### Scenario: Range past the end refused
- **WHEN** a pack entry's range ends after the last frame of its source
- **THEN** pack names the clip and the source's length in frames, writes no stem, and exits 2

#### Scenario: Body longer than slice refused
- **WHEN** a pack entry's `bars` is less than its clip's `lengthBars`
- **THEN** pack names the clip, writes no stem, and exits 2

### Requirement: Canonical stem bytes
Each stem SHALL be a RIFF/WAVE file containing only a plain (non-extensible) `fmt ` chunk and a `data` chunk. It SHALL keep the source's sample rate, channel count and encoding, and SHALL copy the sample bytes unchanged. Source metadata (such as broadcast, region and DAW chunks) SHALL NOT reach the stem, so a stem's hash depends only on its audio.

#### Scenario: Metadata does not change the hash
- **WHEN** two sources hold identical sample data but different metadata chunks, or one uses an extensible format header and the other a plain one, and the same range is packed from each
- **THEN** the two stems are byte-identical

#### Scenario: Samples copied exactly
- **WHEN** a 24-bit mono source is packed and the stem is decoded
- **THEN** its sample bytes equal the source's bytes for that range, and it decodes as 48 kHz, 1 channel, 24-bit

#### Scenario: Repeatable on any machine
- **WHEN** the same sources and pack file are packed twice, into different stems directories
- **THEN** every stem is byte-identical across the two runs

### Requirement: Hash verification and update
After writing stems, pack SHALL compare each clip's stem hash with the hash in the manifest. If every hash matches, it SHALL report the number of stems written and exit 0. If any differ, it SHALL list each clip id with its expected and actual hash and exit 1. With `--update`, it SHALL rewrite the manifest's clip hashes and the pack file's source hashes to the current values and exit 0. A file SHALL be rewritten only when one of its hashes changes.

#### Scenario: Hashes match
- **WHEN** pack runs on unchanged sources whose hashes are already recorded
- **THEN** it exits 0 and leaves the manifest and pack file byte-for-byte unchanged

#### Scenario: Deliberate update
- **WHEN** a pack entry's start bar is changed and pack runs with `--update`
- **THEN** that clip's hash in the manifest is rewritten, and a following run without `--update` exits 0
