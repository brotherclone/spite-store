# stem-codec Specification

## Purpose

Defines the FLAC stem format: which FLAC streams are accepted, how the engine decodes them exactly, and how the canonical encoder turns samples into the same bytes on every runtime, so a stem's content hash depends only on its audio.

## Requirements

### Requirement: Accepted stem streams
A stem SHALL be a FLAC stream: the `fLaC` marker, a STREAMINFO block first, any further metadata blocks, then audio frames. It SHALL be 48,000 Hz, 1 or 2 channels, 16 or 24 bits per sample, with a known total sample count. Any other stream SHALL be rejected with an error naming the stem and the property that is unsupported.

#### Scenario: 24-bit mono accepted
- **WHEN** a 48 kHz, 1-channel, 24-bit FLAC stream is decoded
- **THEN** it decodes as 1 channel with the sample count from STREAMINFO

#### Scenario: Wrong sample rate rejected
- **WHEN** a 44,100 Hz FLAC stream is decoded
- **THEN** decoding fails with an error naming the stem and the rate 44,100 Hz

#### Scenario: Unsupported depth rejected
- **WHEN** an 8-bit or 20-bit FLAC stream is decoded
- **THEN** decoding fails with an error naming the stem and its bits per sample

#### Scenario: Not FLAC
- **WHEN** a RIFF/WAVE file is decoded as a stem
- **THEN** decoding fails with an error saying it is not a FLAC stream

### Requirement: Exact decoding
The decoder SHALL handle every subframe type (constant, verbatim, fixed and LPC), every stereo mode, wasted bits, and both Rice codings. Each decoded integer sample SHALL be exact and SHALL become Float32 by dividing it by 2^(bits−1), as the WAV decoder does. Decoding SHALL use only integer and exactly specified arithmetic, so its output is identical on every runtime.

#### Scenario: Matches the WAV decoder
- **WHEN** the River's and the placeholder's WAV stems are each converted to FLAC and both files are decoded
- **THEN** every channel's Float32 samples are identical, value for value, between the WAV and the FLAC decode

#### Scenario: Reads the reference encoder's output
- **WHEN** a 24-bit stereo stem is encoded by the reference `flac` tool at levels 0, 5 and 8, which use fixed and LPC subframes and every stereo mode
- **THEN** each file decodes to the same samples as the source WAV

#### Scenario: Same samples on every runtime
- **WHEN** the same FLAC stems are decoded in Node and in Chromium, Firefox and WebKit
- **THEN** the sha256 of each channel's Float32 samples is the same on all four

### Requirement: Corrupt streams rejected
The decoder SHALL check every frame's CRC-8 header checksum and CRC-16 footer checksum, and SHALL check that the frames hold exactly the total sample count from STREAMINFO. A stream that fails any check, or that ends inside a frame, SHALL be rejected with an error naming the stem. It SHALL NOT return partial audio.

#### Scenario: Flipped byte
- **WHEN** one byte inside an audio frame of a valid stem is changed
- **THEN** decoding fails with an error naming the stem, and no samples are returned

#### Scenario: Truncated stream
- **WHEN** a valid stem's last 100 bytes are removed
- **THEN** decoding fails with an error naming the stem

#### Scenario: Wrong sample count
- **WHEN** STREAMINFO's total sample count is one more than the frames hold
- **THEN** decoding fails with an error naming the stem

### Requirement: Canonical encoding
The encoder SHALL turn 1 or 2 channels of 16- or 24-bit integer samples at 48 kHz into a FLAC stream fixed by this change's design: one STREAMINFO block with an all-zero MD5, fixed 4,096-sample blocks, and per-block choices made by fixed rules with fixed tie-breaks. It SHALL use only integer arithmetic. The same samples SHALL produce byte-identical output on every runtime.

#### Scenario: Same bytes on every runtime
- **WHEN** the placeholder's stems and a synthetic 24-bit stereo stem are encoded in Node and inside a context with only standard ECMAScript globals
- **THEN** every encoded stream has the same sha256 in both

#### Scenario: Encoder output is pinned
- **WHEN** the codec tests encode the committed synthetic test signals
- **THEN** each output's sha256 equals the value recorded in the tests, so any change to the encoder's bytes fails a test

#### Scenario: Reference tool accepts the output
- **WHEN** an encoded stem is checked with the reference `flac --test`, where that tool is installed
- **THEN** it reports no errors

### Requirement: Lossless round trip
Decoding an encoded stem SHALL give back exactly the integer samples that were encoded, at the same depth and channel count, for any signal. That includes silence, full-scale values at both extremes, and signals that are hard to predict.

#### Scenario: Extremes and noise
- **WHEN** 16-bit and 24-bit signals of silence, alternating minimum and maximum values, seeded white noise, and a sine are each encoded and decoded, mono and stereo, with lengths of 1, 4,095, 4,096 and 4,097 samples
- **THEN** every decoded sample equals the original

#### Scenario: Smaller than WAV on recorded audio
- **WHEN** the River's stems are encoded
- **THEN** their total size is at most 60% of the same stems as WAV
