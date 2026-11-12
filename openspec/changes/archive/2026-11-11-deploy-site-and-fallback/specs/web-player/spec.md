# Spec Delta

## MODIFIED Requirements

### Requirement: Element configuration
The player SHALL be a custom element named `spite-player`, usable in any HTML page without a framework. It SHALL read the attributes `src` (manifest URL, required), `stems` (base URL for stems, default `stems/` relative to the page), `seed` (optional), `bars` (positive integer, default 64) and `fallback` (boolean, forces fallback mode). Changing `src`, `stems`, `seed`, `bars` or `fallback` while connected SHALL stop playback and load the new performance. A performance is fully identified by (manifest, seed, bars). Seeds follow the engine's rules, and a seed attribute is a string, so `seed="42"` is the seed `42`.

#### Scenario: Minimal embed
- **WHEN** a page contains `<spite-player src="/pieces/placeholder/manifest.json" stems="/stems/" seed="hello" bars="16">` and the referenced files are served
- **THEN** the element loads, shows the seed `hello` and 16 bars, and enables its play button

#### Scenario: Invalid bars
- **WHEN** `bars` is `0`, negative or not an integer
- **THEN** the element shows an error naming the `bars` attribute and does not load

#### Scenario: Attribute change reloads
- **WHEN** the `seed` attribute changes from `a` to `b` during playback
- **THEN** playback stops and the performance for seed `b` loads

### Requirement: Loading and stem verification
After realizing the performance, the player SHALL fetch only the stems the performance uses, from `<stems><hex>.wav`, in parallel. It SHALL verify each stem's sha256 against its hash, decode it with the engine's WAV decoder (not the browser's audio decoder), and show progress as a count of stems loaded out of stems needed. Play SHALL be enabled only once every needed stem is loaded. If the manifest cannot be fetched or is invalid, the player SHALL show an error naming the problem (the manifest's validation messages) and keep play disabled. If any stem is missing, fails its hash or cannot be decoded, the player SHALL fire `error` naming each failing stem's clip ids and hash, and then either switch to fallback mode, when the manifest declares a fallback, or show that error and keep play disabled.

#### Scenario: Only needed stems are fetched
- **WHEN** a performance uses 5 of a manifest's 7 clips
- **THEN** exactly 5 stem requests are made and progress reaches "5 / 5"

#### Scenario: Hash mismatch
- **WHEN** the server returns a file for hash `H` whose bytes do not hash to `H`, and the manifest has no fallback
- **THEN** the player shows an error naming `H` and the clip ids that use it, and play stays disabled

#### Scenario: Hash mismatch with a fallback
- **WHEN** the server returns a file for hash `H` whose bytes do not hash to `H`, and the manifest declares a fallback
- **THEN** `error` fires naming `H`, the player enters fallback mode, and its status names the failed stem

#### Scenario: Invalid manifest
- **WHEN** `src` points to a manifest with a dangling transition
- **THEN** the player shows the validation message and its JSON Pointer, and play stays disabled, whether or not it declares a fallback

## ADDED Requirements

### Requirement: When the player falls back
For a valid manifest that declares a fallback, the player SHALL enter fallback mode instead of the generative performance in any of these cases: the `fallback` attribute is present; the browser lacks `AudioWorkletNode`, `crypto.subtle` or a secure context; a needed stem fails to load; or the audio worklet fails to start on first play. A manifest without a fallback SHALL never enter fallback mode.

#### Scenario: Forced by attribute
- **WHEN** a player with `fallback` loads a manifest that declares a fallback
- **THEN** it enters fallback mode without fetching any `.wav` stem

#### Scenario: No AudioWorklet
- **WHEN** the player loads a manifest with a fallback in a page where `AudioWorkletNode` is undefined
- **THEN** it enters fallback mode without fetching any `.wav` stem

#### Scenario: Worklet fails at play
- **WHEN** stems load, play is pressed, and loading the audio worklet module rejects
- **THEN** the player enters fallback mode and starts playing the fallback

#### Scenario: Forced without a fallback
- **WHEN** a player with `fallback` loads a manifest that declares no fallback
- **THEN** it shows an error saying the piece has no fallback recording, and play stays disabled

### Requirement: Fallback mode playback
In fallback mode the player SHALL play the fallback file from `<stems><hex>.mp3` with the browser's own media playback, with working play, pause and scrub controls and the elapsed and total time. It SHALL show the fallback's seed, disable the seed, reroll and length controls, hide the structure view, and say that this is a fixed recording of that seed and why the generative version isn't playing.

#### Scenario: Fallback controls
- **WHEN** the player is in fallback mode for a fallback with seed `spite-store` and 64 bars
- **THEN** the seed field shows `spite-store` and is disabled, reroll and length are disabled, the lanes are hidden, and the status says it is a fixed recording of seed `spite-store`

#### Scenario: Copy link in fallback mode
- **WHEN** copy link is pressed in fallback mode on `https://example.test/p` for a fallback with seed `spite-store` and 64 bars
- **THEN** the clipboard holds `https://example.test/p?seed=spite-store&bars=64`

#### Scenario: Ending in fallback mode
- **WHEN** the fallback recording plays to its end
- **THEN** the `ended` event fires once and the play button returns to "play"

### Requirement: Fallback file verification
Before playing it, the player SHALL fetch the fallback file and verify its sha256 against the manifest's hash when `crypto.subtle` is available. A mismatch or failed fetch SHALL be an error naming the fallback hash, with play disabled. Without `crypto.subtle`, it SHALL play the file unverified.

#### Scenario: Corrupt fallback
- **WHEN** the server returns bytes for the fallback that do not hash to its hash
- **THEN** the player shows an error naming the fallback hash, and play stays disabled

#### Scenario: Missing fallback
- **WHEN** the fallback file returns 404
- **THEN** the player shows an error naming the fallback hash, and play stays disabled

### Requirement: Fallback event
On entering fallback mode, the player SHALL fire a `fallback` event whose detail carries `{ reason, seed, bars }`, where `reason` is one of `forced`, `unsupported`, `stems` or `worklet`. It SHALL then fire `ready` once the fallback file is playable.

#### Scenario: Reason reported
- **WHEN** the player falls back because a stem failed its hash
- **THEN** a `fallback` event fires with `reason` `stems` and the fallback's seed and bars, followed by `ready`
