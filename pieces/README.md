# Pieces

Authored pieces live here, one directory per piece. Audio stems are never committed; manifests
reference them by `sha256:` content hash, and stems are made locally into `.stems/`.

| Piece                          | Stems from                                                         |
| ------------------------------ | ------------------------------------------------------------------ |
| `placeholder/`                 | Synthesized from `recipes.json` by `pnpm stems:placeholder`        |
| `the-river-forgets-to-answer/` | Cut from recordings outside the repo by `spite pack` (`pack.json`) |
