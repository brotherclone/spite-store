# Spec Delta

## MODIFIED Requirements

### Requirement: Reproducible generation
`pnpm stems:placeholder` SHALL synthesize every clip's stem from its recipe as 48 kHz audio, encode it as a canonical FLAC stem, and write it to `.stems/<hex>.flac`, where `<hex>` is the sha256 of the file's bytes. Generation SHALL be deterministic and use only arithmetic whose results ECMAScript specifies exactly, so the same recipe produces identical bytes on every machine and runtime. `.stems/` SHALL be ignored by git.

#### Scenario: Same bytes everywhere
- **WHEN** the placeholder stems are generated twice, including once inside a context with only standard ECMAScript globals
- **THEN** every stem's bytes are identical across the runs

#### Scenario: Not tracked
- **WHEN** stems have been generated and the repository's tracked files are listed
- **THEN** no file under `.stems/` is tracked, and `git check-ignore` matches `.stems/`

#### Scenario: Same samples as before
- **WHEN** the placeholder stems are generated after this change
- **THEN** each decodes to the same samples its WAV stem held before this change, and the placeholder's golden audio snapshots are unchanged

### Requirement: Hash verification
Generation SHALL compare each stem's hash with the hash its clip declares in the placeholder manifest. If every hash matches, it SHALL report the number of stems written and exit 0. If any differs, it SHALL list each mismatching clip id with the expected and actual hash and exit 1. Generation SHALL accept an explicit `--update` flag that rewrites the manifest's hashes to the generated values. This is the only supported way to change them after editing a recipe.

#### Scenario: Hashes match
- **WHEN** `pnpm stems:placeholder` is run on an unmodified checkout
- **THEN** it exits 0 and `.stems/` contains one FLAC file per clip, named by its hash

#### Scenario: Recipe drift detected
- **WHEN** a recipe is edited without `--update` and generation is run
- **THEN** it names that clip with its expected and actual hash and exits 1

#### Scenario: Deliberate update
- **WHEN** a recipe is edited and generation is run with `--update`
- **THEN** the manifest's hash for that clip is rewritten, and a subsequent run without `--update` exits 0
