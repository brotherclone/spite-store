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
