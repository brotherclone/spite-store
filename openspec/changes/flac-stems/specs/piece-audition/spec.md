# Spec Delta

## MODIFIED Requirements

### Requirement: Stem resolution by content hash
Commands that render audio SHALL look up each clip's stem by hash in a stems directory, given by `--stems <dir>` and defaulting to `.stems/` in the current working directory. The file for hash `sha256:<hex>` SHALL be `<dir>/<hex>.flac`. Before rendering, the command SHALL check every clip the render needs. If any are missing or invalid, it SHALL list each one's clip id and hash, render nothing, and exit 2.

#### Scenario: Missing stem
- **WHEN** `spite bounce` is run with a stems directory that lacks the file for one clip
- **THEN** it names that clip id and hash, writes no output file, and exits 2

#### Scenario: Default stems directory
- **WHEN** `pnpm stems:placeholder` has been run and `spite bounce pieces/placeholder/manifest.json --seed 1 -o out.wav` is run from the repo root without `--stems`
- **THEN** stems are read from `.stems/` and the command exits 0

#### Scenario: Only a WAV stem present
- **WHEN** the stems directory holds `<hex>.wav` but not `<hex>.flac` for a clip
- **THEN** the command names that clip id and hash as missing, writes no output file, and exits 2
