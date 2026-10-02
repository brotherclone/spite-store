# audio-rendering Specification

## Purpose

Turns a realized event trace into audio: a stereo sample stream built from content-addressed stems. Output is sample-identical for the same manifest, seed and stems on every runtime, so a shared seed means the same sound, not just the same trace.

## Requirements

### Requirement: Stem audio format
A stem SHALL be a RIFF/WAVE file containing PCM audio at 48,000 Hz, with 1 or 2 channels, encoded as 16-bit integer, 24-bit integer, or 32-bit float. A mono stem SHALL be played identically on both output channels. A stem with any other sample rate, channel count or encoding SHALL be rejected with an error naming the stem's hash and the unsupported property. Stems are identified by the sha256 of the file's bytes, and a stem whose bytes do not hash to the requested value SHALL be rejected.

#### Scenario: Supported encodings decode
- **WHEN** the same waveform is supplied as 16-bit, 24-bit and float32 stereo WAV files at 48 kHz
- **THEN** each decodes and renders without error

#### Scenario: Mono is upmixed
- **WHEN** a clip's stem is a mono WAV file
- **THEN** the rendered left and right channels are identical for that clip's contribution

#### Scenario: Wrong sample rate rejected
- **WHEN** a stem is a 44,100 Hz WAV file
- **THEN** rendering fails with an error naming that stem's hash and its sample rate

#### Scenario: Hash mismatch rejected
- **WHEN** the file supplied for hash `H` does not hash to `H`
- **THEN** rendering fails with an error naming `H`

### Requirement: Bar timing
Output SHALL be 48,000 Hz stereo. A bar governed by tempo entry `{ bar: s, bpm, meter: [beats, unit] }` (the last entry at or before that bar) lasts `beats × (4 / unit) × 60 / bpm` seconds, which is `N / bpm` frames with `N = beats × (4 / unit) × 60 × 48000`. The start frame of bar `b` SHALL be `F(s) + round((b − s) × N / bpm)`, where `F(s)` is the start frame of bar `s` computed the same way from the previous entry, `F(0) = 0`, and rounding sends exact halves up. Rounding happens once per bar relative to the start of its tempo entry, so errors never accumulate across bars. Each event SHALL start at the start frame of its bar.

#### Scenario: Constant tempo
- **WHEN** a manifest has a single tempo entry of 120 bpm in 4/4
- **THEN** bar `b` starts at frame `96000 × b`

#### Scenario: Meter and tempo changes
- **WHEN** a manifest has `{ bar: 0, bpm: 90, meter: [4, 4] }` and `{ bar: 2, bpm: 120, meter: [6, 8] }`
- **THEN** bar 2 starts at frame 256000 and bar 3 starts at frame 328000

#### Scenario: No drift over long pieces
- **WHEN** a manifest at 97 bpm in 4/4 is rendered for 1,000 bars
- **THEN** each bar's start frame equals `round(b × 11520000 / 97)` exactly, with no accumulated rounding error

### Requirement: Mixing
Each event SHALL contribute its stem's samples, starting at its start frame, multiplied by the event's `gain`. Overlapping contributions SHALL be summed. Silence SHALL be rendered wherever no clip sounds.

#### Scenario: Gain applied
- **WHEN** a single event with gain 0.5 plays a stem whose samples are all 0.5
- **THEN** the rendered samples for that event's body are 0.25

#### Scenario: Silence between events
- **WHEN** a trace has events only at bars 0 and 4, and each clip has no tail and lasts one bar
- **THEN** every sample in bars 1 to 3 is 0

### Requirement: Tails and choke
A clip's body SHALL be the first `lengthBars` bars of its stem, measured from its start frame. Audio in the stem beyond the body is the clip's tail. A clip SHALL keep sounding, tail included, until either its stem ends or the same slot id starts its next event. In that case it SHALL be faded out linearly to silence over the 480 frames (10 ms) starting at the new event's start frame. Choke SHALL apply by slot id across section boundaries, and SHALL NOT apply between different slot ids. Exclusions SHALL constrain only clip bodies, so the tail of a clip may overlap a clip it excludes.

#### Scenario: Tail rings until the slot's next clip
- **WHEN** slot `drums` plays a 1-bar clip whose stem lasts 3 bars at bar 0, and its next event is at bar 2
- **THEN** the first clip is heard at full gain through the end of bar 1 and is silent from 480 frames after bar 2's start frame

#### Scenario: Different slots do not choke each other
- **WHEN** slot `a` plays a clip with a long tail and slot `b` starts a clip while that tail is still ringing
- **THEN** slot `a`'s tail continues unchanged

#### Scenario: Tails cross section boundaries
- **WHEN** a clip's tail extends past the end of its section visit and the next section has no event in that slot id
- **THEN** the tail rings into the next section until its stem ends

### Requirement: Piece ending
A render SHALL cover every bar the realization produced, so its length is at least the start frame of the bar after the last realized bar. It SHALL then continue until every sounding clip's stem has ended, and SHALL stop there. Silence SHALL NOT be trimmed or added beyond those bounds.

#### Scenario: Tails ring out after the end
- **WHEN** a piece ends after bar 7 and the last clip's tail extends 1.5 bars past the start of bar 8
- **THEN** the render's length is the start frame of bar 8 plus 1.5 bars of frames, and the tail is not faded

#### Scenario: Silent ending kept
- **WHEN** a piece's last bars have no sounding clips
- **THEN** the render still lasts until the start frame of the bar after the last realized bar

### Requirement: Output encoding
Rendered audio SHALL be encodable as a 16-bit stereo 48 kHz PCM WAV file. Each sample SHALL be clipped to [-1, 1], multiplied by 32767, and rounded to the nearest integer with exact halves going up. No dither SHALL be applied.

#### Scenario: Clipping
- **WHEN** overlapping clips sum to sample values of 1.7 and -2.0
- **THEN** the encoded samples are 32767 and -32767

#### Scenario: Valid WAV
- **WHEN** a render is encoded and the file is decoded by an independent WAV reader
- **THEN** it reads as 2 channels, 48,000 Hz, 16-bit, with the expected frame count

### Requirement: Sample-identical rendering
Rendering the same manifest, seed, duration and stems SHALL produce identical samples every time, on every supported runtime, with no ambient randomness, time or locale. Rendering in blocks of any size, including with the render state passed through a JSON round trip between blocks, SHALL produce exactly the same samples as rendering in one pass.

#### Scenario: Repeated renders
- **WHEN** the placeholder piece is rendered 10 times with seed `"spite"` for 16 bars
- **THEN** all 10 encoded WAV files have the same sha256

#### Scenario: Block size is irrelevant
- **WHEN** the placeholder piece is rendered with seed `42` for 16 bars in blocks of 128 frames, in blocks of 1,000 frames with a JSON round trip of the state between blocks, and in one pass
- **THEN** all three produce identical samples

#### Scenario: Runs without a DOM
- **WHEN** the built engine renders the placeholder piece in a JavaScript context that provides only standard ECMAScript globals
- **THEN** the samples hash to the same value as in Node

### Requirement: Golden audio snapshots
The repository SHALL hold golden audio hashes in `fixtures/golden/` for the placeholder piece rendered for 16 bars with seeds `0`, `42` and `"spite-store"`. Each snapshot SHALL record the seed, duration, frame count, the sha256 of the encoded WAV, and the sha256 of each bar's encoded samples. A changed render SHALL fail the test suite until the snapshot is regenerated on purpose, and the failure SHALL name the seed and the first bar whose samples differ.

#### Scenario: Snapshots match
- **WHEN** the test suite runs with freshly generated placeholder stems
- **THEN** each of the three renders hashes to the value recorded in its golden snapshot

#### Scenario: Drift detected
- **WHEN** a renderer change alters any sample for one of the golden seeds
- **THEN** the golden audio test fails and names the seed and the first bar whose samples differ
