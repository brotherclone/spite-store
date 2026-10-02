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

| Attribute | Meaning                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src`     | Manifest URL (required).                                                                                                 |
| `stems`   | Base URL for stems; the stem `sha256:<hex>` is fetched from `<stems><hex>.wav`. Default `stems/`.                        |
| `seed`    | Any string. Omit it and the player picks a pronounceable random seed (e.g. `tamirobe`), shows it and sets the attribute. |
| `bars`    | Length in bars, a positive integer. Default 64. The piece may end earlier if its graph does.                             |

Changing any attribute stops playback and loads the new performance.

## Events, properties and methods

|                                                      |                                                                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ready`                                              | The performance is loaded and playable.                                                                                      |
| `seedchange`                                         | The seed or length changed from the UI or a random choice. `detail: { seed, bars }`. Hosts use it to keep their URL in sync. |
| `ended`                                              | Playback reached the end of the render (after the last tail).                                                                |
| `error`                                              | Loading failed. `detail: { messages }`: validation messages, or each failing stem's clip ids and hash.                       |
| `play()`, `pause()`, `seek(frame)`, `seekToBar(bar)` | Playback control.                                                                                                            |
| `performance`                                        | The loaded trace, section visits and render plan.                                                                            |
| `position`, `isPlaying`                              | Current frame (48 kHz) and state.                                                                                            |
| `link()`                                             | The page URL with `seed` and `bars` set; the copy-link button copies it.                                                     |

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
