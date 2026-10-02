## Purpose

Gives authors command-line tools to inspect and hear a piece: print a seed's trace, render one seed to a file, and audition many seeds back to back, with stems resolved by content hash from a local directory.

## ADDED Requirements

### Requirement: Stem resolution by content hash
Commands that render audio SHALL look up each clip's stem by hash in a stems directory, given by `--stems <dir>` and defaulting to `.stems/` in the current working directory. The file for hash `sha256:<hex>` SHALL be `<dir>/<hex>.wav`. Before rendering, the command SHALL check every clip the render needs. If any are missing or invalid, it SHALL list each one's clip id and hash, render nothing, and exit 2.

#### Scenario: Missing stem
- **WHEN** `spite bounce` is run with a stems directory that lacks the file for one clip
- **THEN** it names that clip id and hash, writes no output file, and exits 2

#### Scenario: Default stems directory
- **WHEN** `pnpm stems:placeholder` has been run and `spite bounce pieces/placeholder/manifest.json --seed 1 -o out.wav` is run from the repo root without `--stems`
- **THEN** stems are read from `.stems/` and the command exits 0

### Requirement: Manifest input checks
`spite realize`, `spite bounce` and `spite audition` SHALL validate the manifest the same way `spite validate` does before doing anything else. They SHALL print validation errors in the same format and exit 1 on an invalid manifest, and exit 2 on usage errors or an unreadable or unparseable file.

#### Scenario: Invalid manifest
- **WHEN** `spite bounce` is run on a manifest with a dangling transition
- **THEN** it prints the file, the JSON Pointer and the message, writes no output, and exits 1

#### Scenario: Bad arguments
- **WHEN** `spite bounce` is run without `--seed`, with `--bars 0`, or with an unknown flag
- **THEN** it prints usage and exits 2

### Requirement: Realize command
`spite realize <manifest> --seed <seed> [--bars <n>] [--json]` SHALL print the trace of the manifest for that seed, with `--bars` defaulting to 64. Seeds given on the command line are strings, so `--seed 42` is the seed `"42"` (identical to `42`). By default the output SHALL be human-readable: a header with the seed, the bar count, the event count and the bar at which the piece ended (if it ended early), then one line per bar that has events, showing the bar, the section, and each event's slot and clip id. A new section visit SHALL be marked on the line of its first bar. With `--json` it SHALL print exactly the canonical trace JSON used for golden trace hashes.

#### Scenario: Readable trace
- **WHEN** `spite realize schema/examples/valid/minimal.json --seed 42 --bars 16` is run
- **THEN** it exits 0 and prints one line per bar with events, naming clips by id rather than hash

#### Scenario: JSON matches the golden trace
- **WHEN** `spite realize schema/examples/valid/minimal.json --seed 42 --bars 64 --json` is run
- **THEN** the sha256 of its output (without the trailing newline) equals the `traceHash` in `fixtures/golden/minimal.42.json`

### Requirement: Bounce command
`spite bounce <manifest> --seed <seed> [--bars <n>] -o <out.wav> [--stems <dir>]` SHALL render the piece for that seed as specified by audio rendering and write a 16-bit stereo 48 kHz WAV file to `<out.wav>`. `--bars` defaults to 64. It SHALL print the output path, the duration in seconds and the event count, then exit 0.

#### Scenario: Bounce matches the renderer
- **WHEN** `spite bounce pieces/placeholder/manifest.json --seed 42 --bars 16 -o out.wav` is run with generated placeholder stems
- **THEN** it exits 0 and the sha256 of `out.wav` equals the golden audio hash for seed `42`

### Requirement: Audition command
`spite audition <manifest> [--seeds <k>] [--seed <seed>]... [--bars <n>] [--stems <dir>] [--out <file.wav>] [--no-play]` SHALL render several seeds of the piece into a single "reel" WAV: each seed's full render (tails included), in order, separated by exactly 2 seconds (96,000 frames) of silence. With no `--seed` flags it SHALL use seeds `0` through `k - 1`, where `--seeds` defaults to 4. One or more `--seed` flags SHALL select exactly those seeds in the order given, and SHALL NOT be combined with `--seeds`. `--bars` defaults to 16. Before playing, it SHALL print, for each seed, its start time in the reel, its event count and a one-line summary of its section sequence. The reel SHALL be written to `--out`, or to a temporary file when `--out` is omitted, and its path printed. On macOS it SHALL then play the reel with `afplay` and exit when playback ends. With `--no-play`, or on platforms without `afplay`, it SHALL only write and print the path.

#### Scenario: Default reel
- **WHEN** `spite audition pieces/placeholder/manifest.json --no-play --out reel.wav` is run with generated stems
- **THEN** it exits 0, prints four seed summaries for seeds 0 to 3, and `reel.wav` is the four 16-bar renders joined by 96,000 frames of silence each

#### Scenario: Chosen seeds
- **WHEN** `spite audition pieces/placeholder/manifest.json --seed spite --seed 7 --no-play --out reel.wav` is run
- **THEN** the reel contains the render for seed `"spite"` followed by the render for seed `"7"`

#### Scenario: Conflicting seed options
- **WHEN** `--seeds 3` and `--seed 1` are both given
- **THEN** it prints usage and exits 2

#### Scenario: Reproducible reel
- **WHEN** the same audition command is run twice with `--no-play`
- **THEN** both reel files are byte-identical
