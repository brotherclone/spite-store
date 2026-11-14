# Spec Delta

## MODIFIED Requirements

### Requirement: Element configuration
The player SHALL be a custom element named `spite-player`, usable in any HTML page without a framework. It SHALL read the attributes `src` (manifest URL, required), `stems` (base URL for stems, default `stems/` relative to the page), `seed` (optional), `bars` (positive integer, default 64), `fallback` (boolean, forces fallback mode) and `late` (`wait` or `skip`, default `wait`; any other value is treated as `wait`). Changing `src`, `stems`, `seed`, `bars` or `fallback` while connected SHALL stop playback and load the new performance. Changing `late` SHALL NOT reload or stop playback. A performance is fully identified by (manifest, seed, bars). Seeds follow the engine's rules, and a seed attribute is a string, so `seed="42"` is the seed `42`.

#### Scenario: Minimal embed
- **WHEN** a page contains `<spite-player src="/pieces/placeholder/manifest.json" stems="/stems/" seed="hello" bars="16">` and the referenced files are served
- **THEN** the element loads, shows the seed `hello` and 16 bars, and enables its play button

#### Scenario: Invalid bars
- **WHEN** `bars` is `0`, negative or not an integer
- **THEN** the element shows an error naming the `bars` attribute and does not load

#### Scenario: Attribute change reloads
- **WHEN** the `seed` attribute changes from `a` to `b` during playback
- **THEN** playback stops and the performance for seed `b` loads

#### Scenario: Changing late keeps playing
- **WHEN** the `late` attribute changes from `wait` to `skip` during playback
- **THEN** playback continues without a reload, and no stem is fetched again

### Requirement: Loading and stem verification
After realizing the performance, the player SHALL fetch only the stems the performance uses, from `<stems><hex>.wav`, a few at a time, in the order the performance first uses them. It SHALL verify each stem's sha256 against its hash, decode it with the engine's WAV decoder (not the browser's audio decoder), and show progress as a count of stems loaded out of stems needed. Play SHALL be enabled once every stem sounding at the current position is loaded, and loading SHALL continue during playback. If the manifest cannot be fetched or is invalid, the player SHALL show an error naming the problem (the manifest's validation messages) and keep play disabled. If a stem is missing, fails its hash or cannot be decoded before playback has started, the player SHALL fire `error` naming each failing stem's clip ids and hash, and then either switch to fallback mode, when the manifest declares a fallback, or show that error and keep play disabled.

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

#### Scenario: Play before every stem is in
- **WHEN** the server answers every stem first used at bar 0 at once and holds back the rest
- **THEN** `ready` fires and play is enabled while progress is below the total, and no `loaded` event has fired

#### Scenario: Fetched in order of first use
- **WHEN** the server records the order in which stem requests start, with one request allowed at a time
- **THEN** the stems are requested in order of the first bar that uses each, ties broken by hash

### Requirement: Playback
Play SHALL start the performance from the current position, and pause SHALL stop it while keeping the position. Seeking SHALL move the position to the start of any bar, or to any point on the scrub bar, and playback SHALL continue from exactly that frame of the render. Pausing, resuming and seeking SHALL fade the output over 10 ms to avoid clicks. These fades happen after the worklet output and are outside the sample-identity promise. When the render ends, after the last tail, playback SHALL stop, the position SHALL rest at the end, and an `ended` event SHALL fire. The render SHALL NOT end while any stem is still loading under `late="wait"`. Pressing play at the end SHALL restart from the beginning.

#### Scenario: Seek is exact
- **WHEN** the player seeks to bar 8 and plays
- **THEN** the worklet's first output frame is the render's frame at bar 8's start frame

#### Scenario: Ending
- **WHEN** a performance plays to the end of its render
- **THEN** the `ended` event fires once, the play button returns to "play", and the position equals the render length

### Requirement: Sample identity across browsers
The player's audio worklet SHALL output, at 48,000 Hz in stereo, exactly the engine renderer's samples rounded to float32, frame for frame, independent of the render quantum, of when blocks are requested, and of when stems arrive under `late="wait"`. Chromium, Firefox and WebKit SHALL each produce output identical to the float32 golden snapshots for the placeholder piece. This SHALL be checked by an automated browser test that renders through the real worklet in an `OfflineAudioContext`.

#### Scenario: Three engines agree with the golden
- **WHEN** `pnpm test:browser` renders the placeholder piece for 16 bars with seeds `0`, `42` and `"spite-store"` through the worklet in Chromium, Firefox and WebKit
- **THEN** in every browser the sha256 of each output, as interleaved little-endian float32, equals the value in `fixtures/golden/placeholder.float32.<seed>.json`

#### Scenario: Seeking mid-render matches
- **WHEN** a browser test renders from frame 0, and separately from bar 8 after a seek
- **THEN** the samples after the seek equal the corresponding samples of the uninterrupted render

#### Scenario: Stems arriving mid-render match
- **WHEN** a browser test renders the placeholder piece for seed `42` and 16 bars through the worklet, giving it only the bar-0 stems at first and the rest after it has held, under `late="wait"`
- **THEN** the output with the held frames removed hashes to `fixtures/golden/placeholder.float32.42.json`

### Requirement: Structure view
The player SHALL draw the performance as lanes: a band showing each section visit across time, then one row per slot id with a block for each clip (its body drawn solid and its audible tail drawn faded), labelled with the clip id, and a playhead at the current position that moves during playback. Clicking or tapping the view SHALL seek to the corresponding position. The view SHALL be drawn from the same plan the worklet plays. While a clip's stem is loading, its block SHALL span its clip length in bars and be marked pending. A clip skipped under `late="skip"` SHALL be marked skipped. The view SHALL redraw as stems arrive.

#### Scenario: Lanes match the plan
- **WHEN** the placeholder piece loads with seed `42` and 16 bars
- **THEN** the view shows one row per slot id used, one block per event, and section labels in visit order

#### Scenario: Click to seek
- **WHEN** the view is clicked at the horizontal position of bar 5
- **THEN** the position moves to bar 5 (within one frame of the click's time) and the playhead is drawn there

#### Scenario: Pending clips drawn
- **WHEN** the view is drawn while a clip's stem is still loading
- **THEN** that clip's block is marked pending and spans its clip length, and it is redrawn with its tail once the stem arrives

## ADDED Requirements

### Requirement: Late stem control
The player SHALL show a control that switches between waiting for late stems and skipping late clips, reflecting and setting the `late` attribute. The choice SHALL apply from the next clip that starts, never to a clip already sounding or already skipped.

#### Scenario: Control sets the attribute
- **WHEN** the listener turns the control to skip
- **THEN** the element's `late` attribute becomes `skip`, and turning it back sets `wait`

### Requirement: Waiting for late stems
Under `late="wait"`, when playback reaches the first frame that needs a stem still loading, the player SHALL hold that frame and output silence, show that it is buffering, and fire `waiting`. When the stem arrives, it SHALL resume from exactly that frame without the listener pressing play, and fire `playing`. A held frame SHALL NOT count as played.

#### Scenario: Hold and resume
- **WHEN** playback under `wait` reaches a clip whose stem the server is still holding back, and the server then releases it
- **THEN** `waiting` fires, the position stays at that clip's start frame while held, and after release `playing` fires and the position advances from that frame

#### Scenario: Seeking ahead of the loaded stems
- **WHEN** the listener seeks under `wait` to a bar whose sounding stems have not been fetched yet
- **THEN** those stems are requested before any stem first used later, and playback holds at the sought frame until they arrive

### Requirement: Skipping late clips
Under `late="skip"`, when playback reaches the start of a clip whose stem is still loading, the player SHALL leave that clip out for its whole occurrence and keep time going. It SHALL fire `skipped` with `{ slot, clipHash, bar }`, and the status SHALL say how many clips were skipped. A later occurrence of the same clip SHALL play if its stem has arrived by then. Seeking SHALL clear every skip, so a skipped clip plays when its occurrence is reached again with its stem loaded.

#### Scenario: Late clip left out
- **WHEN** playback under `skip` reaches a clip whose stem the server is holding back
- **THEN** the position keeps advancing, `skipped` fires once with that clip's slot, hash and bar, and the output for that occurrence has no contribution from it, even after the stem arrives mid-occurrence

#### Scenario: No skips, same samples
- **WHEN** a performance plays under `skip` and every stem arrives before its first use
- **THEN** no `skipped` event fires, and the output is identical to the same performance under `wait`

### Requirement: Stem failure during playback
When a stem fails (missing, wrong hash, undecodable) after playback has started, the player SHALL fire `error` naming it, and keep playing until the first frame that needs it, under either `late` value. There it SHALL stop. With a fallback, it SHALL enter fallback mode, paused, at the same position when the fallback's seed and bars equal the performance's, otherwise at the start. Without one, it SHALL show the error and disable play.

#### Scenario: Plays up to the failed stem, then falls back
- **WHEN** a stem first used at bar 8 fails its hash while bar 2 is playing, and the manifest declares a fallback with a different seed
- **THEN** `error` fires naming the stem, playback continues to bar 8's start frame, then a `fallback` event fires with reason `stems`, and the recording is paused at its start

#### Scenario: No fallback
- **WHEN** the same failure happens and the manifest declares no fallback
- **THEN** playback stops at bar 8's start frame, the status shows the error naming the stem, and play is disabled

### Requirement: Every stem loaded
The player SHALL fire `loaded` once every stem the performance uses has arrived and been verified. Only then SHALL the render's length be final. The scrub bar and the time display SHALL show the length of the realized bars until then, and the full length including the last tail after.

#### Scenario: Length becomes final
- **WHEN** the last stem of a performance arrives during playback
- **THEN** `loaded` fires once, and the scrub bar's maximum becomes the render's full length, equal to the length the engine's full plan reports
