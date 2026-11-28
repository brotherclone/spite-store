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

## Versions

A finished piece is frozen with `spite freeze`, which stores the manifest's exact bytes in the stem
store as `<sha256>.json` and appends it to `<piece>/versions.json`:

```json
{ "versions": [{ "hash": "sha256:<hex>", "label": "v1" }] }
```

The list is oldest first, and the last entry is the latest version. Only `spite freeze` writes it,
and only by appending: never edit, reorder or remove an entry, because links name versions by
label. Once a piece has a version, `?piece=<id>` plays its latest version and the page writes
`version=<label>` into the URL; `?version=v1` or `?version=<hex>` plays that version, and
`?version=working` plays the working `manifest.json` on purpose, for previews. Editing the working
manifest never changes a frozen version: freeze again to make a new one.

## Tracks and credits

A piece's release metadata lives in `<piece>/release.json`, beside the manifest rather than in it,
so editing it never makes a new version. It is described by `schema/release.schema.json`:

```json
{
  "credits": [{ "name": "A. Composer", "role": "composition" }],
  "tracks": [
    {
      "id": "first-light",
      "title": "First Light",
      "version": "sha256:<frozen manifest>",
      "seed": "ox-bow",
      "bars": 40,
      "audio": "sha256:<flac>",
      "frames": 5880000
    }
  ]
}
```

- **Credits** are written by hand: a name and a role each, shown in this order on every track page.
  The same person can appear once per role.
- **Tracks** are written by `spite track --update`, which renders a frozen version for a seed and
  length to a 24-bit FLAC. A track must name a version recorded in `versions.json`, so a piece has
  to be frozen before it can have tracks. Once recorded, a track's version, seed, bars and audio
  never change; only its title can (run `spite track` again with a new `--title`). To cut a
  different performance, use a new id.
- Each track gets a page at `/pieces/<piece>/tracks/<track-id>/` with the recording, a download
  and a link into the live piece at the same version and seed.
- `spite publish` uploads each track's FLAC along with the piece's stems, and the deploy check
  refuses an invalid `release.json` or a track whose audio isn't in the store.

## After a deploy

The build checks that `vercel.json` keeps Vercel's edge cache from storing `/stems/` responses,
but it can't probe its own deployment, which isn't live yet. Once a deploy is live, run:

```sh
pnpm run check:live https://spite-store.vercel.app
```

For every frozen version, every track and each piece's first stem, it sends a range request and
then a plain request to the file's URL with a fresh `?probe=` query (so the real URL's cache entry
is never touched). It fails if the plain request gets anything but the whole file, which is what
happens when an edge cache stores a range request's partial response under the URL, or if a track
is served with a filename that would override its page's download name. For a protected preview,
set `VERCEL_AUTOMATION_BYPASS_SECRET` to the project's protection bypass secret.
