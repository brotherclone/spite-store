# Placeholder

A development piece whose stems are synthesized, not recorded. `recipes.json` describes each clip;
`pnpm stems:placeholder` generates the WAVs into `.stems/` and checks their sha256 against
`manifest.json` (`-- --update` rewrites the hashes after a deliberate recipe change).

- `count` clicks every beat with an accent on the first, so bar alignment is audible, including
  across the 4/4 to 3/4 change at bar 8.
- `pad-long` has a two-bar body and a long release tail that rings past it.
- `bass-b` excludes `hat-b`.
