# Spec Delta

## MODIFIED Requirements

### Requirement: Pack command
`spite pack <manifest> --source <dir> [--stems <dir>] [--update]` SHALL read the pack file beside the manifest, resolve each source under `--source`, and write one stem per clip to the stems directory, `.stems/` by default, as `<hex>.flac`, where `<hex>` is the sha256 of the stem's bytes. Pack SHALL validate the manifest the same way `spite validate` does before doing anything else.

#### Scenario: Stems written by hash
- **WHEN** `spite pack` runs on a valid manifest and pack file whose sources are all present and valid
- **THEN** the stems directory holds one `<hex>.flac` per distinct stem, each file's sha256 equals its name, and no `.wav` stem is written

#### Scenario: Missing source
- **WHEN** a source named in the pack file does not exist under `--source`
- **THEN** pack names that source and its path, writes no stem, and exits 2

### Requirement: Source checks
Pack SHALL accept only sources that are RIFF/WAVE at 48,000 Hz with 1 or 2 channels, in 16-bit or 24-bit integer PCM. Either the plain or the extensible format header is allowed. Pack SHALL refuse 32-bit float sources, since a FLAC stem cannot hold them. Pack SHALL also check each source's sha256 against the pack file. Pack SHALL NOT resample, convert, dither or otherwise process audio.

#### Scenario: Wrong sample rate refused
- **WHEN** a source is a 44,100 Hz WAV
- **THEN** pack names the source and its sample rate, writes no stem, and exits 2

#### Scenario: Float source refused
- **WHEN** a source is a 32-bit float WAV
- **THEN** pack names the source, says float sources must be exported as 16- or 24-bit integer, writes no stem, and exits 2

#### Scenario: Changed source detected
- **WHEN** a source file's sha256 differs from the one recorded in the pack file and `--update` is not given
- **THEN** pack names the source with its expected and actual hashes, writes no stem, and exits 1

### Requirement: Canonical stem bytes
Each stem SHALL be the canonical FLAC encoding, as the stem codec defines it, of the source's sample frames for that clip. It SHALL keep the source's sample rate, channel count and bit depth, and decoding it SHALL give back exactly the source's integer samples for that range. Source metadata (such as broadcast, region and DAW chunks) SHALL NOT reach the stem, so a stem's hash depends only on its audio.

#### Scenario: Metadata does not change the hash
- **WHEN** two sources hold identical sample data but different metadata chunks, or one uses an extensible format header and the other a plain one, and the same range is packed from each
- **THEN** the two stems are byte-identical

#### Scenario: Samples copied exactly
- **WHEN** a 24-bit mono source is packed and the stem is decoded
- **THEN** its integer samples equal the source's samples for that range, and it decodes as 48 kHz, 1 channel, 24-bit

#### Scenario: Repeatable on any machine
- **WHEN** the same sources and pack file are packed twice, into different stems directories
- **THEN** every stem is byte-identical across the two runs

#### Scenario: River re-packed with the same audio
- **WHEN** the River is packed from its sources after this change
- **THEN** each new stem decodes to Float32 samples identical to its previous WAV stem's, and a bounce of seed `spite-store` for 64 bars is byte-identical to the bounce made from the WAV stems
