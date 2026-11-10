# Proposal

## Why

The MVP's goal is to release one White track as an aleatoric piece on our own site, and _The River Forgets to Answer_ is now cleared for publishing. Two things are still missing. Nothing is deployed anywhere: the site only runs on the Vite dev server, which reads stems from a local `.stems/` folder. And there is no fallback: a listener whose browser can't run the generative player (no AudioWorklet, or the stems fail to load) hears nothing.

## What Changes

- **Production site on Vercel.** `pnpm --filter site build` emits every piece's `manifest.json` under `/pieces/`, so the built site works without the dev server. A `vercel.json` at the repo root builds the workspace on Node 24 and serves `site/dist`. It also rewrites `/stems/<file>` to a public Vercel Blob store, so the page and `<spite-player stems="/stems/">` stay unchanged. Production deploys from `master`, and every other branch gets a preview deployment. In production the page opens on _The River Forgets to Answer_ when no `?piece=` is given.
- **`spite publish`.** A new CLI command uploads to the Blob store every stem (and fallback file) that a set of manifests references, by content hash. It verifies each local file against its hash first, and skips files already uploaded. `spite publish --check <base-url>` uploads nothing: it confirms every referenced file is reachable, and the Vercel build runs it so a deployment can't go live with missing stems.
- **Fallback recording (AUD).** A manifest may declare an optional `fallback`: one fixed recording of the piece, identified by its content hash and the `seed` and `bars` it was rendered from. A new `spite fallback` command bounces that seed, encodes it to MP3 with `ffmpeg`, writes the file to the stems directory by hash and, with `--update`, writes the `fallback` field into the manifest. Realization ignores the field: adding or changing a fallback never changes any trace.
- **Fallback playback in `<spite-player>`.** When a manifest has a fallback and the browser can't run the generative player, or a needed stem fails to load, or the audio worklet can't start, the player switches to a fallback mode. It plays the fixed recording through an `<audio>` element, says why and which seed it is, and fires a `fallback` event. A `fallback` attribute forces this mode.
- **The River ships.** Its manifest gets a fallback, its README records that the recordings are cleared for publishing, and its stems and fallback are published to the Blob store.
- The dev server also serves fallback files (`/stems/<hex>.mp3`) from `.stems/`.

## Capabilities

### New Capabilities

- `site-deployment`: the production build and hosting of the site: what the build emits, the Vercel configuration, how `/stems/` resolves in production, the pre-deploy stem check, and which branches deploy where.
- `stem-publishing`: `spite publish`, which uploads stems and fallback files by content hash and checks that a deployment can reach all of them.
- `fallback-recording`: `spite fallback`, which produces a piece's fixed recording from a chosen seed and records it in the manifest.

### Modified Capabilities

- `music-manifest`: adds the optional `fallback` field (`hash`, `type`, `seed`, `bars`), and a requirement that realization ignores it.
- `web-player`: adds fallback mode: when it is used, what it shows, the `fallback` attribute and event, and verifying the fallback file.
- `player-site`: development serving of `/stems/<hex>.mp3`, and a production default piece that differs from the development default.
- `river-piece`: the piece files include a fallback, and the README says the recordings are cleared for publishing.

## Out of Scope

- Streaming loads (starting playback before every needed stem has arrived), caching beyond HTTP cache headers, and offline playback.
- Fallback formats other than MP3 (Opus, AAC), several fallbacks per piece, and choosing the fallback seed automatically.
- Drawing the structure view in fallback mode. The render plan needs the stems, so the lanes are hidden.
- Hosting other than Vercel and Vercel Blob, and a storage-provider abstraction.
- Embedding the player on other sites (CORS, publishing `@spite-store/player` to npm or a CDN).
- Analytics, accounts, uploads by other artists, and anything else "store"-shaped.
- Producing the fallback in CI. It is made on an author's machine, which has the stems and `ffmpeg`.
- Changes to realization, the renderer, the trace format or any golden snapshot.
- Mobile layout polish beyond the current page.

## Impact

- **Schema:** `schema/manifest.schema.json` gains an optional top-level `fallback` object, recorded in `schema/CHANGELOG.md`. Existing manifests stay valid, and `specVersion` stays `0.1` (see design).
- **Engine:** the `Manifest` type and `checkManifest` accept `fallback`. Realization and rendering are unchanged.
- **CLI:** new `publish` and `fallback` commands, and a new runtime dependency on `@vercel/blob` (in `packages/cli` only, never the engine). `spite fallback` needs `ffmpeg` with `libmp3lame` on `PATH`.
- **Player:** a fallback mode in `element.ts`, with new browser tests.
- **Site:** a build plugin that emits manifests, a production default piece, and `/stems/<hex>.mp3` in `dev-serve.ts`.
- **Repo root:** a new `vercel.json`.
- **External systems:** a Vercel project connected to `brotherclone/spite-store`, a public Vercel Blob store, a `BLOB_READ_WRITE_TOKEN` on the author's machine, and optionally a custom domain.
- **Pieces:** _The River Forgets to Answer_'s manifest and README.
