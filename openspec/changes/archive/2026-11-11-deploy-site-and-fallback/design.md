# Design

## Context

- The site is a single Vite page (`site/index.html`, `site/src/main.ts`, `site/src/url.ts`). Pieces and stems are served only in development, by a Vite middleware (`site/vite.config.ts` → `site/dev-serve.ts`) reading `pieces/` and `.stems/`. `pnpm --filter site build` succeeds, but its output has no manifests and no stems, so it can't play anything.
- `url.ts` hard-codes `DEFAULT_PIECE = 'placeholder'`, and `manifestUrl()` is unit-tested in Node.
- The player fetches `<stems><hex>.wav`, checks the sha256 with `crypto.subtle` and decodes with the engine's WAV decoder (`packages/player/src/loader.ts`). An AudioWorklet is created only on first play (`element.ts` `ensureAudio()`). Every load failure goes through `fail()`, which shows the messages and fires `error`.
- Manifests are validated twice: by the CLI with ajv against `schema/manifest.schema.json` (`additionalProperties: false` at the top level), and by the engine's hand-written `checkManifest`, which is all the player uses. A new field has to be added to both.
- The engine never reads a manifest as a whole object: realization walks `tempo`, `clips`, `sections`, `start` and `envelope` by name. An extra top-level field therefore can't reach a decision path.
- `.stems/` holds 32 WAVs (58 MB): 8 synthesized placeholder stems and the River's 24. The River's catalogue is 24 clips of about 2.4 MB each. A 64-bar River performance ends before bar 64, so it lasts about 2 minutes.
- `spite bounce` already renders a seed to canonical 16-bit WAV bytes (`encodeWav16`). `spite pack` already rewrites manifest hashes with Prettier formatting (`rewriteJson`/`formatJson` in `commands/pack.ts`).
- The repo is public at `github.com/brotherclone/spite-store`, with branches `master` (behind) and `develop`. The author's machine has `ffmpeg` with `libmp3lame` and a connected Vercel account.

See proposal.md for motivation and the specs for required behaviour.

## Goals / Non-Goals

**Goals:**

- A `git push` deploys the site, and a deployment can't go live while any stem it references is missing.
- Audio never enters git. The only hosted copy of each stem is the Blob store, named by its hash.
- The fallback costs the generative path nothing. It doesn't change any trace, render or golden, and the player only touches it when it falls back.

**Non-Goals:**

- Supporting several storage providers. Code talks to the store through a two-method interface, so another provider could be added, but only Vercel Blob is implemented.
- Making the MP3 bytes bit-reproducible across machines. The hash pins the published file instead (D6).

## Decisions

### D1. Vercel serves the static build; `/stems/*` is rewritten to the Blob store

`vercel.json` at the repo root:

```json
{
  "buildCommand": "pnpm build && node scripts/deploy-check.mjs && pnpm --filter site build",
  "outputDirectory": "site/dist",
  "rewrites": [{ "source": "/stems/:file", "destination": "https://<store>.public.blob.vercel-storage.com/stems/:file" }],
  "headers": [
    { "source": "/stems/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }] },
    { "source": "/pieces/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=300, must-revalidate" }] }
  ]
}
```

A rewrite to an external URL is proxied by Vercel's edge, so the page keeps `stems="/stems/"`, its requests are same-origin, and no CORS policy on the Blob store is needed. Production and previews share one store, which works because stems are content-addressed: a preview can't overwrite anything production uses.

- *Alternative: point `stems=` straight at the Blob URL.* It saves a proxy hop, but it ties the page to the store's hostname and relies on the store's CORS headers. A rewrite can be changed later without touching the page.
- *Alternative: copy stems into `site/dist` at build time.* A git-triggered build can't see `.stems/`. It would also mean deploying from the laptop and re-uploading 58 MB on every deploy.
- *Alternative: GitHub Pages or Cloudflare.* Rejected in favour of Vercel during planning: it has a connected account, preview deployments and header control.

### D2. `vercel.json` is the single source of the store URL

`scripts/deploy-check.mjs` reads the `/stems/:file` rewrite destination from `vercel.json`, derives the base URL (`…/stems/`), and runs `spite publish --check <base> pieces/*/manifest.json`. It runs right after `pnpm build` (the CLI must be built), before the site build, so a missing stem fails the build early. A unit test checks that `vercel.json` has exactly one `/stems/:file` rewrite and that its destination ends in `/stems/:file`. The script has no network logic of its own: the check is `spite publish --check`, tested on its own.

### D3. Manifests are emitted by a Vite build plugin

A sibling of the dev middleware in `vite.config.ts`, with `apply: 'build'`, lists `pieces/*/manifest.json` and calls `this.emitFile({ type: 'asset', fileName: 'pieces/<id>/manifest.json', source })` with the exact bytes. Only `manifest.json` is emitted, never `pack.json` or READMEs. The listing is sorted, so builds are reproducible.

- *Alternative: a `public/` directory with copies or symlinks.* Copies drift, and Vercel's build doesn't preserve symlinks reliably.

### D4. Production default piece via a Vite env file

`site/.env.production` sets `VITE_DEFAULT_PIECE=the-river-forgets-to-answer`. `manifestUrl(href, defaultPiece)` and `applyQuery(player, href, defaultPiece)` take the default as an argument, keeping `url.ts` pure and Node-testable. `main.ts` passes `import.meta.env.VITE_DEFAULT_PIECE ?? DEFAULT_PIECE`, where `DEFAULT_PIECE` stays `'placeholder'`. Vercel's preview builds also run in production mode, so previews open on the River too. That's intended, since they preview the release. The static `<title>` and `<h1>` text changes from "Placeholder" to "Spite Store". `main.ts` already replaces both with the manifest's title.

### D5. `spite publish`: a tiny store interface, `@vercel/blob` behind it

```ts
interface StemStore {
  has(name: string): Promise<boolean>;
  put(name: string, bytes: Uint8Array, contentType: string): Promise<void>;
}
```

- The command collects `(name, hash, clipIds | 'fallback', contentType)` for every catalogued clip and every fallback across all named manifests, de-duplicated by name and sorted. It verifies every local file's sha256 before any network call, so a bad file uploads nothing.
- The Blob implementation stores at `stems/<name>` with `access: 'public'`, `addRandomSuffix: false`, `cacheControlMaxAge: 31536000` and no overwrite. `has()` uses the SDK's `head`, which throws a "not found" error for a missing name. Uploads run with a concurrency of 4. A failed upload exits 1 after reporting it; a rerun picks up where it left off.
- `--check <base>` doesn't use the interface or the SDK: it sends `HEAD <base><name>` with `fetch`, with a concurrency of 8. Tests run it against a local `node:http` server. The upload path is tested against an in-memory `StemStore`.
- `@vercel/blob` is a dependency of `packages/cli` only. It is imported lazily inside the upload path, so `--check` (run during every Vercel build) and the other commands don't load it.
- *Alternative: `vercel blob` CLI from a script.* It's harder to test and gives worse errors. It also would need the Vercel CLI wherever `--check` runs.

### D6. `spite fallback`: shared render, `ffmpeg` over pipes, metadata stripped

- The render code in `bounce.ts` moves into a shared `renderSeedWav(manifest, seed, bars, stemsDir)` that both commands call. The "same render as bounce" scenario holds by construction, and a test checks it by injecting an encoder that captures its input.
- Encoding: `ffmpeg -hide_banner -loglevel error -f wav -i pipe:0 -map_metadata -1 -fflags +bitexact -flags:a +bitexact -codec:a libmp3lame -b:a 256k -ar 48000 -ac 2 -f mp3 pipe:1`, run with `child_process.spawn`. The bitexact flags and `-map_metadata -1` remove the encoder-version tag and other metadata, so the same `ffmpeg` build gives the same bytes run after run. Before encoding it runs `ffmpeg -hide_banner -encoders` once and looks for `libmp3lame`. If `ffmpeg` is missing or the encoder isn't there, it exits 2 with nothing written.
- The encoder is injected (`encode(wav) => Promise<Uint8Array>`), so CLI tests run without `ffmpeg`. One integration test runs real `ffmpeg` and is skipped when it isn't on `PATH`.
- `--update` reuses the `rewriteJson`/`formatJson` helpers, moved from `commands/pack.ts` into `common.ts`.
- **Determinism:** the WAV given to the encoder is the deterministic bounce. MP3 bytes depend on the `ffmpeg` and LAME versions, so they're treated as an artefact pinned by hash, like a recording. That's why, without `--update`, a changed hash exits 1 rather than being treated as an error in the piece.
- *Alternative: an encoder in WASM or JS (lamejs and similar) for bit-reproducible bytes.* It adds a heavy dependency for a promise no listener sees, and those encoders are slower and poorer than LAME.
- *Alternative: FLAC or WAV.* A 2-minute stereo WAV is about 23 MB, and FLAC about 12 MB. The fallback exists for weak devices and networks, so 256 kbps MP3 (about 4 MB) plays everywhere and stays small.

### D7. The `fallback` manifest field, and why `specVersion` stays `0.1`

```json
"fallback": { "hash": "sha256:…", "type": "audio/mpeg", "seed": "spite-store", "bars": 64 }
```

- It's added to the JSON Schema as an optional top-level property with `additionalProperties: false`, and to the engine's `Manifest` type and structural check in `checkManifest`, with JSON Pointers under `/fallback`. `type` is an enum with one value. A second format later is a schema addition, not a new field.
- The engine's realize and render functions never read `fallback`. The determinism scenarios in the `music-manifest` delta are tested directly: realize the River with and without the field against its goldens, and bounce the placeholder with an added field against its golden audio hash.
- `specVersion` stays `0.1`. The changelog's rule is to bump when a change "alters how an existing manifest validates or realizes", and every existing manifest validates and realizes exactly as before. The addition is recorded in `schema/CHANGELOG.md` under 0.1. A consequence: a manifest that uses `fallback` won't validate with a validator from before this change. Nothing outside this repo validates manifests yet, so that's accepted.
- New examples: `schema/examples/valid/fallback.json` and `schema/examples/invalid/fallback-bad-type.json`, picked up by the existing examples test.

### D8. Player fallback mode

- **Decision point.** After `loadManifest` succeeds, in order: if the `fallback` attribute is present, use reason `forced`; otherwise, if the generative path is unsupported (`typeof AudioWorkletNode === 'undefined'`, `!isSecureContext` or `!crypto.subtle`), use `unsupported`. If neither applies, `loadPerformance` runs as now. If it throws a `LoadError` for stems and the manifest has a fallback, the player fires `error` and then falls back with `stems`. In `ensureAudio()`, a rejected `addModule` or `AudioWorkletNode` construction falls back with `worklet` and plays at once (the user already pressed play). A forced fallback without a `fallback` field is an error. In every other case, no `fallback` field means today's behaviour.
- **Playback.** A hidden `HTMLAudioElement` in the shadow root. The file is fetched with `fetchImpl`, its sha256 checked with `crypto.subtle` (when available), and it's played from a `blob:` URL that is revoked on the next load. Without `crypto.subtle` (an insecure context) the `audio.src` is the URL itself. Existing controls are reused: the scrub range and time display are kept in 48 kHz frames (`currentTime × 48000`), so `updateTime` and the scrub handler stay shared. Play, pause, seek and `ended` map to the media element's API and events. `position`, `isPlaying`, `seek()` and `seekToBar()` keep working. `seekToBar` uses the manifest's tempo map (engine `barFrame`) to convert to frames, since the realization of the fallback's seed defines the bars.
- **UI.** The seed field shows `fallback.seed`. Seed, reroll and bars are disabled, and the lanes canvas is hidden (the render plan needs stems). The status line reads "Fixed recording of seed `<seed>` · <reason text>". The `stems` reason text names the failed stems.
- **Events.** `fallback` (`{ reason, seed, bars }`), then `ready`. `link()` uses the fallback's seed and bars, so a copied link describes the recording and opens the generative version of the same seed in a capable browser.
- **Determinism:** fallback mode realizes nothing and never touches the worklet, so the generative path's sample-identity tests are unaffected. Platform audio decoding is used only for the fallback, which is outside the determinism promise (spec: `fallback-recording`).
- *Alternative: draw the lanes in fallback mode from a realization alone.* `planRender` needs stem lengths for tails, so the lanes would be approximate. Hidden is honest.
- *Alternative: a separate `<spite-fallback>` element.* It would duplicate the controls and make embedders handle the switch themselves.

### D9. Hosting project setup

- A Vercel project imported from `brotherclone/spite-store`, root directory `/`, framework "Other" (the `vercel.json` build command takes precedence). Node.js 24.x is set in project settings (`engines.node` is a range, so it isn't relied on). Corepack is enabled with `ENABLE_EXPERIMENTAL_COREPACK=1`, so the pinned pnpm is used.
- Production branch is `master`. Releasing means merging `develop` into `master`. Every other branch gets a preview. Vercel's default deployment protection on previews is left on; production is public.
- A public Blob store is created in the same project. `vercel env pull` writes `BLOB_READ_WRITE_TOKEN` to `.env.local`. That file isn't git-ignored today, so `.env*.local` and `.vercel/` are added to `.gitignore` before any token reaches the machine. `spite publish` doesn't read `.env.local` itself: the author exports the variable, or runs it as `node --env-file=.env.local …`. The build itself needs no token: `--check` reads public URLs.

## Risks / Trade-offs

- [Vercel may not apply `headers` to a response proxied from an external rewrite, or Blob's own `Cache-Control` may win] → Checked on the first preview with `curl -I`. If the header can't be set, the stem caching scenario is relaxed to what Blob sends (`max-age=31536000` from `cacheControlMaxAge`, perhaps without `immutable`), and the spec delta is amended before archiving.
- [The build's network check slows or flakes deploys] → 25 to 35 HEAD requests at a concurrency of 8 take about a second. One retry per file before it counts as unreachable. A real outage fails the build, which is the intent.
- [Proxying stems through the edge counts bandwidth twice] → It's acceptable at this scale. Switching `stems=` to the Blob URL directly (D1's alternative) is a one-line change if it matters.
- [A fallback MP3 re-encoded on another machine gets a different hash] → `spite fallback` without `--update` reports it and exits 1. The published file stays valid for its recorded hash, so nothing breaks until someone runs `--update` and republishes.
- [The River's fallback lasts about 2 minutes (about 4 MB), and a slow connection waits for the whole file before verifying] → Accepted for v0. Streaming the fallback unverified is a later choice, kept out of scope with streaming loads.
- [Safari or another browser decodes MP3 with a few ms of encoder padding] → The fallback is a fixed recording with no sample promise. `ended` comes from the media element.
- [Previews open on the River, so a broken River manifest on a branch breaks that preview's home page] → That's what a preview is for. The deploy check also catches missing stems before the page exists.
- [Preview deployment protection makes previews private by default] → Intended. Previews can be shared with a Vercel share link when needed.

## Migration Plan

1. Land the code (schema, engine, CLI, player, site, `vercel.json` with a placeholder store URL) on a feature branch, with all tests green.
2. Create the Vercel project and the public Blob store, then put the store's real URL into `vercel.json`.
3. Locally: `pnpm stems:placeholder`, `spite pack` for the River, then `spite fallback … --seed spite-store --update`, then `spite publish pieces/*/manifest.json`.
4. Push the branch. The preview build runs the deploy check. Verify the stem headers, the home page, `?piece=placeholder`, and the fallback (with `fallback` forced in the page through devtools, and in a browser without AudioWorklet).
5. Merge into `develop`, then `develop` into `master`, which deploys production. Attach the custom domain if one is wanted.

**Rollback:** promote the previous production deployment in Vercel (instant). Stems are never deleted or overwritten, so any earlier deployment still finds its stems. Reverting the code is a normal git revert, with no data migration.

## Open Questions

- The custom domain, if any. Attaching it is a hosting setting with no effect on specs or tasks beyond the final step.
- Whether `spite-store` is the best-sounding seed for the River's fallback. Choose by ear with `spite audition --seed …` before running `spite fallback --update`. If another seed is chosen, update the seed in the `river-piece` delta.
