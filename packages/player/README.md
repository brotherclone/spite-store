# @spite-store/player

`<spite-player>`: an embeddable web component that plays a Spite Store piece. A performance is
(manifest, seed, bars), and the same performance sounds identical in every browser.

## Embed

The build is two self-contained files, `dist/index.js` (the element, engine included) and
`dist/worklet.js` (the audio thread), which must sit next to each other.

```html
<script type="module" src="/player/index.js"></script>
<spite-player
  src="/pieces/placeholder/manifest.json"
  stems="/stems/"
  seed="hello"
  bars="16"
></spite-player>
```

| Attribute  | Meaning                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src`      | Manifest URL (required).                                                                                                 |
| `stems`    | Base URL for stems; the stem `sha256:<hex>` is fetched from `<stems><hex>.wav`. Default `stems/`.                        |
| `seed`     | Any string. Omit it and the player picks a pronounceable random seed (e.g. `tamirobe`), shows it and sets the attribute. |
| `bars`     | Length in bars, a positive integer. Default 64. The piece may end earlier if its graph does.                             |
| `fallback` | Boolean. Play the manifest's fixed recording instead of the generative performance (see below).                          |

Changing any attribute stops playback and loads the new performance.

## Events, properties and methods

|                                                      |                                                                                                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                                              | The performance is loaded and playable.                                                                                                                                |
| `seedchange`                                         | The seed or length changed from the UI or a random choice. `detail: { seed, bars }`. Hosts use it to keep their URL in sync.                                           |
| `ended`                                              | Playback reached the end of the render (after the last tail).                                                                                                          |
| `error`                                              | Loading failed. `detail: { messages }`: validation messages, or each failing stem's clip ids and hash.                                                                 |
| `fallback`                                           | Switched to the fixed recording. `detail: { reason, seed, bars }`, with `reason` one of `forced`, `unsupported`, `stems`, `worklet`. `ready` follows once it can play. |
| `fallbackReason`                                     | Why the fixed recording is playing, or `null` for the generative performance.                                                                                          |
| `play()`, `pause()`, `seek(frame)`, `seekToBar(bar)` | Playback control.                                                                                                                                                      |
| `performance`                                        | The loaded trace, section visits and render plan.                                                                                                                      |
| `position`, `isPlaying`                              | Current frame (48 kHz) and state.                                                                                                                                      |
| `link()`                                             | The page URL with `seed` and `bars` set; the copy-link button copies it.                                                                                               |

## Styling

Shadow parts: `controls`, `play`, `seed`, `reroll`, `bars`, `copy`, `time`, `scrub`, `lanes`,
`status`. Custom properties: `--spite-accent` (clips, scrub bar), `--spite-ink` (text, playhead),
`--spite-band` (alternate sections), `--spite-error`.

## How it plays

1. Fetch the manifest and check it with the engine's `checkManifest`.
2. Realize the performance and plan the render on the main thread.
3. Fetch only the stems the performance uses, verify each against its sha256 (`crypto.subtle`), and
   decode it with the engine's WAV decoder. The browser's decoder is never used.
4. On the first play, create a 48 kHz `AudioContext` and an AudioWorklet that runs the engine
   renderer, 128 frames at a time.

## Fallback recording

A manifest may declare a `fallback`: one fixed recording of the piece, rendered from a seed by
`spite fallback`. When the piece has one, the player switches to it instead of failing:

| `reason`      | When                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| `forced`      | The `fallback` attribute is present.                                                                         |
| `unsupported` | The page has no `AudioWorkletNode`, isn't a secure context, or has no `crypto.subtle`.                       |
| `stems`       | A stem the performance needs is missing, fails its hash or can't be decoded. `error` fires first, naming it. |
| `worklet`     | The audio worklet fails to start on the first play. The recording then starts playing.                       |

The recording is fetched from `<stems><hex>.mp3`, checked against its sha256 (when `crypto.subtle`
exists), and played by the browser's own media playback. Play, pause, the scrub bar, `seek()` and
`seekToBar()` work as usual, and positions stay in 48 kHz frames. The seed field shows the
recording's seed, and seed, reroll and length are disabled. The lanes are hidden, because drawing
them needs the stems. `link()` and copy link give the recording's seed and length, so the link
opens the generative version of the same seed in a browser that can play it. A piece without a
`fallback` never falls back. An invalid manifest is an error either way.

The fixed recording is outside the sample-identity promise below: it was encoded to MP3 and is
decoded by the browser.

## What "same performance everywhere" covers

The worklet's output is exactly the engine renderer's samples rounded to float32, frame for frame,
in every browser. `pnpm test:browser` checks this in Chromium, Firefox and WebKit against
`fixtures/golden/placeholder.float32.*.json`. The 10 ms fades on pause, resume and seek, and
anything after the worklet (output latency, OS or device resampling, volume) are outside the
promise.

## Tests

- `pnpm test:browser` (from the repo root) builds everything and runs `test-browser/` in headless
  Chromium, Firefox and WebKit.
- Run `pnpm exec playwright install chromium firefox webkit` once first.
