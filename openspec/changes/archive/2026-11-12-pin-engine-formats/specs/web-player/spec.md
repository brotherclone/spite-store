# Spec Delta

## MODIFIED Requirements

### Requirement: When the player falls back
For a valid manifest that declares a fallback, the player SHALL enter fallback mode instead of the generative performance in any of these cases: the `fallback` attribute is present; the manifest's engine pin doesn't match the player's engine; the browser lacks `AudioWorkletNode`, `crypto.subtle` or a secure context; a needed stem fails to load; or the audio worklet fails to start on first play. A manifest without a fallback SHALL never enter fallback mode.

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

#### Scenario: Mismatched pin
- **WHEN** the player loads a manifest with a fallback that is pinned to trace 2 while the player's engine trace format is 1
- **THEN** it enters fallback mode without fetching any `.wav` stem, and the status says the piece was made with a newer version of the player

#### Scenario: Unpinned manifest plays generatively
- **WHEN** the player loads a manifest with a fallback and no `engine` field in a browser that supports generative playback
- **THEN** it loads the stems and plays generatively, as for a manifest pinned to the current formats

### Requirement: Fallback event
On entering fallback mode, the player SHALL fire a `fallback` event whose detail carries `{ reason, seed, bars }`, where `reason` is one of `forced`, `engine`, `unsupported`, `stems` or `worklet`. It SHALL then fire `ready` once the fallback file is playable.

#### Scenario: Reason reported
- **WHEN** the player falls back because a stem failed its hash
- **THEN** a `fallback` event fires with `reason` `stems` and the fallback's seed and bars, followed by `ready`

#### Scenario: Engine reason reported
- **WHEN** the player falls back because the manifest is pinned to other formats
- **THEN** a `fallback` event fires with `reason` `engine` and the fallback's seed and bars, followed by `ready`

## ADDED Requirements

### Requirement: Mismatched pin without a fallback
When a manifest's engine pin doesn't match the player's engine and the manifest declares no fallback, the player SHALL NOT play it. It SHALL fetch no stem, show an error naming each differing format with its pinned and current values, fire an `error` event with the same messages, and keep play disabled.

#### Scenario: No fallback to play
- **WHEN** the player loads a manifest without a fallback that is pinned to trace 2 while the player's engine trace format is 1
- **THEN** no `.wav` stem is fetched, the status names trace format 2 and 1, an `error` event fires, and play stays disabled

#### Scenario: Forced fallback wins over the pin
- **WHEN** a player with the `fallback` attribute loads a manifest with a fallback that is pinned to other formats
- **THEN** it enters fallback mode with reason `forced`
