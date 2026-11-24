# Proposal

## Why

Spite Store's pieces are endless and different every time, but people share music as tracks: one thing with a name and a length that you can link to from anywhere. Being banned from conventional storefronts is why the store exists, so a piece's fixed cuts have to live on the store too. An originator needs to be able to pick a performance they stand behind, name it, give it a set length, and share a link that plays it, offers it for download and leads the listener into the live piece. The machinery is mostly there already. A `fallback` is already one seed rendered at a fixed length and stored by hash, but it has no name, no page and no URL of its own.

## What Changes

- **Tracks.** A track is a named, fixed performance of a frozen version: `{ id, title, version, seed, bars }`, plus its audio's hash and its length in frames. It must reference a version recorded in the piece's `versions.json` (see `freeze-piece-versions`), so a track can never drift. A recorded track's version, seed, bars and audio never change; only its title can.
- **Track audio is a 24-bit FLAC with reproducible bytes.** The render is the one `spite bounce` makes, quantized to 24 bits and encoded by the engine's own FLAC encoder, which uses integer arithmetic only and gives the same bytes on every runtime. Unlike the MP3 fallback, a track's file can be re-made by anyone and hashed to the same value. No `ffmpeg` is involved. The same file is used for playback on the page and for download.
- **Piece release metadata lives outside the manifest.** Tracks and credits go in a committed per-piece `pieces/<id>/release.json`, with its own JSON Schema in `schema/`. They can't go in the manifest, because adding a track would change the manifest's bytes and make a new version.
- **Credits.** The release file lists people and their roles (for The River, the originator and the quartet players who recorded the source takes). Track pages show them.
- **`spite track <manifest> --id <id> --version <label> --seed <s> --bars <n> --title <t> [--update]`** renders the frozen version, writes `<hex>.flac` to the local stems directory and, with `--update`, records the track in `release.json`. Without `--update` it re-renders and checks that the recorded track is current. Because the bytes are deterministic, that check is exact.
- **Track page.** Each track gets a stable URL, `/pieces/<id>/tracks/<track-id>/`. The page shows the piece and track titles, seed, version label, length and credits, an audio player for the FLAC, a **download link** with a readable file name, and a "hear it play live" link to `?piece=<id>&version=<label>&seed=<s>&bars=<n>`. The page is static HTML with no script, and it carries share metadata (title, description, audio) so a link pasted elsewhere previews properly.
- **The site becomes multi-page.** The player page stays as it is. The build also emits a page per track, and the dev server renders the same pages from the same code.
- **Publishing and deployment** cover track audio: `spite publish` also uploads the tracks in a manifest's sibling `release.json`, and `spite publish --check` (already run by the deploy check) covers them and refuses an invalid release file.

## Capabilities

### New Capabilities

- `piece-release`: the per-piece release file (credits and tracks), its schema, and its validation, including the rule that every track references a recorded version.
- `track-recording`: the `spite track` command, the 24-bit render-and-encode path, the stored file, and the exact current/stale check.
- `track-page`: the static track page, its URL, its contents, the download link, the hand-off to the live player, share metadata, and its development serving.

### Modified Capabilities

- `stem-publishing`: `spite publish` and `--check` include track audio from a manifest's sibling `release.json`, and refuse an invalid one.
- `site-deployment`: the build emits a page per track.
- `player-site`: the site is no longer a single page; the player page's behaviour is unchanged.

## Impact

- **Schema:** a new `schema/release.schema.json` with valid and invalid examples, and a `schema/CHANGELOG.md` entry. The manifest schema is unchanged.
- **Engine:** a `quantize24` beside `quantize16` in `audio/wav.ts` (clip, scale by 8,388,607, round half up). `encodeFlac` already takes 24-bit samples. No change to realization, rendering, `TRACE_FORMAT` or `RENDER_FORMAT`.
- **CLI:** a new `track` command; a `release.ts` module that loads and validates `release.json` against the schema and the piece's `versions.json`; `publish` collects track files. The render step is shared with `bounce` and `fallback` (`renderSeedWav`, which gains a float-output sibling).
- **Site:** a track-page renderer shared by the build plugin and the dev server, plus its styles. `vite.config.ts` emits `pieces/<id>/tracks/<track-id>/index.html`.
- **Hosting:** no `vercel.json` change expected (track pages fall under the five-minute `/pieces/` rule, and track audio under `/stems/`). Design notes one thing to verify on a preview: that Vercel serves the directory index without a trailing slash.
- **Determinism:** a track's audio is the deterministic render of (version, seed, bars), quantized and encoded with integer-only, runtime-independent code. So its hash is reproducible in Node and in a bare ECMAScript context, which is stronger than the fallback's promise. Quantization uses only multiplication, addition and `Math.floor`, which are exact IEEE operations and identical everywhere.
- **Depends on `freeze-piece-versions`:** the `version` parameter, `versions.json` and frozen manifests in `.stems/`. This change's delta specs are written against the requirement texts as that change leaves them.

## Out of Scope

- **Listener-made tracks** and anything that needs accounts. Tracks are made only by the originator, through the CLI.
- **Shipping The River's first track.** That happens once The River is finished and frozen, as a release step rather than part of this change.
- **Payment, pricing or gated downloads.** Downloads are free and public.
- **Mastering or loudness processing** of track audio, and any render path other than the existing bounce.
- **Tags inside the FLAC file** (Vorbis comments with title, piece or seed). The engine's encoder writes only STREAMINFO; the download's file name carries the names.
- **An MP3 or other lossy version** of a track.
- **Off-site distribution** (uploading tracks to other platforms) and embeddable track widgets.
- **A storefront or index page** listing pieces and tracks.
- **Replacing or merging the `fallback` field.** It keeps working as it does today. Whether a piece's fallback should become its default track can be decided later.
- **Links from the player page to a piece's tracks.** A track page links to the live piece, not the other way round, until there is a storefront.
