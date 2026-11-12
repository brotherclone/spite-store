# Pieces

Authored pieces live here, one directory per piece. Audio stems are never committed; manifests
reference them by `sha256:` content hash, and stems are made locally into `.stems/`.

| Piece                          | Stems from                                                         |
| ------------------------------ | ------------------------------------------------------------------ |
| `placeholder/`                 | Synthesized from `recipes.json` by `pnpm stems:placeholder`        |
| `the-river-forgets-to-answer/` | Cut from recordings outside the repo by `spite pack` (`pack.json`) |

A piece may also have a fallback recording: one seed rendered and encoded to MP3 by `spite
fallback`, written to `.stems/<sha256>.mp3` and recorded in the manifest's `fallback`. The player
plays it when a browser can't play the piece generatively.

Production serves stems and fallbacks from the public stem store, not from `.stems/`. After making
or changing a piece's audio, upload it with `spite publish` before pushing (see the root README,
"Releasing a piece"). The deployment build refuses manifests whose files aren't in the store.

Every piece here is pinned to the engine formats it was released with (`"engine"` in the manifest,
written by `spite pin --update`), so a seed link keeps naming one performance. The deployment build
refuses an unpinned piece. When an engine change bumps `TRACE_FORMAT` or `RENDER_FORMAT`, every
pinned piece is stranded: the site plays its fallback recording instead (or nothing, without one),
and the build log lists each stranded piece as a warning. Re-pinning a stranded piece with
`spite pin --update` is a re-release: its existing seed links will play a different performance.
