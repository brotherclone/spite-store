# Spec Delta

## MODIFIED Requirements

### Requirement: Loading and stem verification
After realizing the performance, the player SHALL fetch only the stems the performance uses, from `<stems><hex>.flac`, a few at a time, in the order the performance first uses them. It SHALL verify each stem's sha256 against its hash, decode it with the engine's FLAC decoder (not the browser's audio decoder), and show progress as a count of stems loaded out of stems needed. Play SHALL be enabled once every stem sounding at the current position is loaded, and loading SHALL continue during playback. If the manifest cannot be fetched or is invalid, the player SHALL show an error naming the problem (the manifest's validation messages) and keep play disabled. If a stem is missing, fails its hash or cannot be decoded before playback has started, the player SHALL fire `error` naming each failing stem's clip ids and hash, and then either switch to fallback mode, when the manifest declares a fallback, or show that error and keep play disabled.

#### Scenario: Only needed stems are fetched
- **WHEN** a performance uses 5 of a manifest's 7 clips
- **THEN** exactly 5 stem requests are made, each for a `.flac` URL, and progress reaches "5 / 5"

#### Scenario: Hash mismatch
- **WHEN** the server returns a file for hash `H` whose bytes do not hash to `H`, and the manifest has no fallback
- **THEN** the player shows an error naming `H` and the clip ids that use it, and play stays disabled

#### Scenario: Hash mismatch with a fallback
- **WHEN** the server returns a file for hash `H` whose bytes do not hash to `H`, and the manifest declares a fallback
- **THEN** `error` fires naming `H`, the player enters fallback mode, and its status names the failed stem

#### Scenario: Undecodable stem
- **WHEN** the server returns a file that hashes to `H` but is not a valid FLAC stem, and the manifest has no fallback
- **THEN** the player shows an error naming `H`, its clip ids and the decoding problem, and play stays disabled

#### Scenario: Invalid manifest
- **WHEN** `src` points to a manifest with a dangling transition
- **THEN** the player shows the validation message and its JSON Pointer, and play stays disabled, whether or not it declares a fallback

#### Scenario: Play before every stem is in
- **WHEN** the server answers every stem first used at bar 0 at once and holds back the rest
- **THEN** `ready` fires and play is enabled while progress is below the total, and no `loaded` event has fired

#### Scenario: Fetched in order of first use
- **WHEN** the server records the order in which stem requests start, with one request allowed at a time
- **THEN** the stems are requested in order of the first bar that uses each, ties broken by hash

#### Scenario: Same samples in every browser from FLAC
- **WHEN** the placeholder piece is played with seed `42` and 16 bars from FLAC stems in Chromium, Firefox and WebKit, and the output is captured
- **THEN** each capture hashes to the placeholder's golden float32 snapshot for seed `42`

### Requirement: When the player falls back
For a valid manifest that declares a fallback, the player SHALL enter fallback mode instead of the generative performance in any of these cases: the `fallback` attribute is present; the manifest's engine pin doesn't match the player's engine; the browser lacks `AudioWorkletNode`, `crypto.subtle` or a secure context; a needed stem fails to load; or the audio worklet fails to start on first play. A manifest without a fallback SHALL never enter fallback mode.

#### Scenario: Forced by attribute
- **WHEN** a player with `fallback` loads a manifest that declares a fallback
- **THEN** it enters fallback mode without fetching any stem

#### Scenario: No AudioWorklet
- **WHEN** the player loads a manifest with a fallback in a page where `AudioWorkletNode` is undefined
- **THEN** it enters fallback mode without fetching any stem

#### Scenario: Worklet fails at play
- **WHEN** stems load, play is pressed, and loading the audio worklet module rejects
- **THEN** the player enters fallback mode and starts playing the fallback

#### Scenario: Forced without a fallback
- **WHEN** a player with `fallback` loads a manifest that declares no fallback
- **THEN** it shows an error saying the piece has no fallback recording, and play stays disabled

#### Scenario: Mismatched pin
- **WHEN** the player loads a manifest with a fallback that is pinned to trace 2 while the player's engine trace format is 1
- **THEN** it enters fallback mode without fetching any stem, and the status says the piece was made with a newer version of the player

#### Scenario: Unpinned manifest plays generatively
- **WHEN** the player loads a manifest with a fallback and no `engine` field in a browser that supports generative playback
- **THEN** it loads the stems and plays generatively, as for a manifest pinned to the current formats

### Requirement: Mismatched pin without a fallback
When a manifest's engine pin doesn't match the player's engine and the manifest declares no fallback, the player SHALL NOT play it. It SHALL fetch no stem, show an error naming each differing format with its pinned and current values, fire an `error` event with the same messages, and keep play disabled.

#### Scenario: No fallback to play
- **WHEN** the player loads a manifest without a fallback that is pinned to trace 2 while the player's engine trace format is 1
- **THEN** no stem is fetched, the status names trace format 2 and 1, an `error` event fires, and play stays disabled

#### Scenario: Forced fallback wins over the pin
- **WHEN** a player with the `fallback` attribute loads a manifest with a fallback that is pinned to other formats
- **THEN** it enters fallback mode with reason `forced`
