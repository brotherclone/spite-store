# web-player Specification

## Purpose

Plays a piece in the browser as `<spite-player>`, an embeddable element that turns a manifest, a seed and a length into the same performance in every browser, and shows its structure as it plays.

## Requirements

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

### Requirement: Random seed
When no `seed` attribute is given, the player SHALL choose a seed of eight lowercase letters made of four consonant-vowel syllables (for example `tamirobe`), using the browser's cryptographic random source. It SHALL display the seed, reflect it into the `seed` attribute, and announce it like any other seed change. Platform randomness SHALL be used only to choose a seed and SHALL NOT influence what a given seed plays.

#### Scenario: Seed chosen and shown
- **WHEN** a player without a `seed` attribute loads
- **THEN** its `seed` attribute is set to a string matching `^([bcdfghjklmnprstvz][aeiou]){4}$`, and that seed is displayed

#### Scenario: Chosen seed is reproducible
- **WHEN** the chosen seed is copied into another player's `seed` attribute with the same `src` and `bars`
- **THEN** both players produce identical traces

### Requirement: Same performance as the engine
For a given (manifest, seed, bars), the player SHALL play exactly the trace and render plan the engine produces in Node. The events it plays SHALL equal `spite realize --json` for the same manifest, seed and bars.

#### Scenario: Trace matches the CLI
- **WHEN** the player loads the placeholder piece with seed `42` and 16 bars
- **THEN** the canonical JSON of its trace hashes to the same value as `spite realize pieces/placeholder/manifest.json --seed 42 --bars 16 --json`

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

### Requirement: Playback
Play SHALL start the performance from the current position, and pause SHALL stop it while keeping the position. Seeking SHALL move the position to the start of any bar, or to any point on the scrub bar, and playback SHALL continue from exactly that frame of the render. Pausing, resuming and seeking SHALL fade the output over 10 ms to avoid clicks. These fades happen after the worklet output and are outside the sample-identity promise. When the render ends, after the last tail, playback SHALL stop, the position SHALL rest at the end, and an `ended` event SHALL fire. Pressing play at the end SHALL restart from the beginning.

#### Scenario: Seek is exact
- **WHEN** the player seeks to bar 8 and plays
- **THEN** the worklet's first output frame is the render's frame at bar 8's start frame

#### Scenario: Ending
- **WHEN** a performance plays to the end of its render
- **THEN** the `ended` event fires once, the play button returns to "play", and the position equals the render length

### Requirement: Sample identity across browsers
The player's audio worklet SHALL output, at 48,000 Hz in stereo, exactly the engine renderer's samples rounded to float32, frame for frame, independent of the render quantum or of when blocks are requested. Chromium, Firefox and WebKit SHALL each produce output identical to the float32 golden snapshots for the placeholder piece. This SHALL be checked by an automated browser test that renders through the real worklet in an `OfflineAudioContext`.

#### Scenario: Three engines agree with the golden
- **WHEN** `pnpm test:browser` renders the placeholder piece for 16 bars with seeds `0`, `42` and `"spite-store"` through the worklet in Chromium, Firefox and WebKit
- **THEN** in every browser the sha256 of each output, as interleaved little-endian float32, equals the value in `fixtures/golden/placeholder.float32.<seed>.json`

#### Scenario: Seeking mid-render matches
- **WHEN** a browser test renders from frame 0, and separately from bar 8 after a seek
- **THEN** the samples after the seek equal the corresponding samples of the uninterrupted render

### Requirement: Seed and length controls
The player SHALL show a seed field, a reroll button that picks a new random seed, a length field (bars), and a copy-link button. Editing the seed or length and confirming it, or pressing reroll, SHALL stop playback, load the new performance and fire a `seedchange` event whose detail carries `{ seed, bars }`. Copy link SHALL copy the current page URL with its `seed` and `bars` query parameters set to the current performance.

#### Scenario: Reroll
- **WHEN** reroll is pressed
- **THEN** a new seed is shown, the new performance loads, and `seedchange` fires with the new seed

#### Scenario: Copy link
- **WHEN** copy link is pressed on `https://example.test/p?x=1` while playing seed `tamirobe` for 32 bars
- **THEN** the clipboard holds `https://example.test/p?x=1&seed=tamirobe&bars=32`

### Requirement: Structure view
The player SHALL draw the performance as lanes: a band showing each section visit across time, then one row per slot id with a block for each clip (its body drawn solid and its audible tail drawn faded), labelled with the clip id, and a playhead at the current position that moves during playback. Clicking or tapping the view SHALL seek to the corresponding position. The view SHALL be drawn from the same plan the worklet plays.

#### Scenario: Lanes match the plan
- **WHEN** the placeholder piece loads with seed `42` and 16 bars
- **THEN** the view shows one row per slot id used, one block per event, and section labels in visit order

#### Scenario: Click to seek
- **WHEN** the view is clicked at the horizontal position of bar 5
- **THEN** the position moves to bar 5 (within one frame of the click's time) and the playhead is drawn there

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
On entering fallback mode, the player SHALL fire a `fallback` event whose detail carries `{ reason, seed, bars }`, where `reason` is one of `forced`, `engine`, `unsupported`, `stems` or `worklet`. It SHALL then fire `ready` once the fallback file is playable.

#### Scenario: Reason reported
- **WHEN** the player falls back because a stem failed its hash
- **THEN** a `fallback` event fires with `reason` `stems` and the fallback's seed and bars, followed by `ready`

#### Scenario: Engine reason reported
- **WHEN** the player falls back because the manifest is pinned to other formats
- **THEN** a `fallback` event fires with `reason` `engine` and the fallback's seed and bars, followed by `ready`

### Requirement: Mismatched pin without a fallback
When a manifest's engine pin doesn't match the player's engine and the manifest declares no fallback, the player SHALL NOT play it. It SHALL fetch no stem, show an error naming each differing format with its pinned and current values, fire an `error` event with the same messages, and keep play disabled.

#### Scenario: No fallback to play
- **WHEN** the player loads a manifest without a fallback that is pinned to trace 2 while the player's engine trace format is 1
- **THEN** no `.wav` stem is fetched, the status names trace format 2 and 1, an `error` event fires, and play stays disabled

#### Scenario: Forced fallback wins over the pin
- **WHEN** a player with the `fallback` attribute loads a manifest with a fallback that is pinned to other formats
- **THEN** it enters fallback mode with reason `forced`
