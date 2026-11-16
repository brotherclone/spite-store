# Spec Delta

## MODIFIED Requirements

### Requirement: Stem audio format
A stem SHALL be a FLAC file as accepted by the stem codec: 48,000 Hz, 1 or 2 channels, 16-bit or 24-bit integer samples. It SHALL be decoded by the engine's FLAC decoder. A mono stem SHALL be played identically on both output channels. A stem with any other sample rate, channel count or depth, or any file that is not FLAC, SHALL be rejected with an error naming the stem's hash and the unsupported property. Stems are identified by the sha256 of the file's bytes, and a stem whose bytes do not hash to the requested value SHALL be rejected.

#### Scenario: Supported encodings decode
- **WHEN** the same waveform is supplied as 16-bit and 24-bit stereo FLAC files at 48 kHz
- **THEN** each decodes and renders without error

#### Scenario: Mono is upmixed
- **WHEN** a clip's stem is a mono FLAC file
- **THEN** the rendered left and right channels are identical for that clip's contribution

#### Scenario: Wrong sample rate rejected
- **WHEN** a stem is a 44,100 Hz FLAC file
- **THEN** rendering fails with an error naming that stem's hash and its sample rate

#### Scenario: WAV stem rejected
- **WHEN** the file supplied for a stem is a RIFF/WAVE file
- **THEN** rendering fails with an error naming that stem's hash and saying it is not FLAC

#### Scenario: Hash mismatch rejected
- **WHEN** the file supplied for hash `H` does not hash to `H`
- **THEN** rendering fails with an error naming `H`

#### Scenario: Same render as WAV stems
- **WHEN** the placeholder piece is rendered for seeds `0`, `42` and `"spite-store"` from its FLAC stems
- **THEN** each render hashes to the value already recorded in its golden audio snapshot, unchanged by this change
