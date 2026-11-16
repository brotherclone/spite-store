# Proposal

## Why

Streaming lets the River start before every stem is in. It still has to download the 6–8 stems that sound at bar 0 first, and those are 14–19 MB of WAV. A full seed is 50–55 MB. FLAC is lossless, so it shrinks that download without changing a single sample. On the local stems, the River's 24-bit mono stems come to 54% of their WAV size using fixed predictors alone (51% with `flac -8`). The placeholder's 16-bit stems come to 30%.

## What Changes

- **Stems are FLAC:** a stem is a FLAC file, `<hex>.flac`, and its hash is the sha256 of those bytes. **BREAKING** for any stem store, stems directory or manifest made before this change: WAV stems are no longer read by the player, the CLI or the site.
- **A canonical encoder:** stems are written by an encoder in the engine, in plain TypeScript. It is fully specified and uses only integer arithmetic. The same samples produce the same FLAC bytes on every machine, so a stem's hash still depends only on its audio. It doesn't use libFLAC: libFLAC's output can change between versions, and that would change the hashes.
- **The engine decodes FLAC itself:** the player and the CLI decode stems with the engine's own FLAC decoder, never the browser's audio decoder. The decoded samples equal the source's integer samples, so the Float32 values the mixer gets are exactly what the WAV decoder gives today.
- **Pack, placeholder, publish and serving switch over:** `spite pack` and `pnpm stems:placeholder` write `.flac`. `spite publish` uploads them as `audio/flac`. The dev server and production `/stems/` serve them. The player fetches `<stems><hex>.flac`.
- **Float sources refused:** FLAC has no float encoding, so `spite pack` refuses 32-bit float sources. No piece uses one today; every River source is 24-bit.
- **Re-release of the River and the placeholder with the same performances:** both are re-packed and their clip hashes rewritten. The River's stems are published again. Every seed renders sample-identical audio, so `TRACE_FORMAT`, `RENDER_FORMAT`, the engine pins, the fallback recordings and the golden audio snapshots stay unchanged. The River's golden traces are regenerated, because trace events carry clip hashes. Their bars, slots and gains stay the same.
- **Measured:** stem bytes for the River's first wait and for a whole seed, before and after, recorded in the design.

## Capabilities

### New Capabilities

- `stem-codec`: the FLAC stem format, the canonical encoder, and the engine's decoder. Covers which streams are accepted, exact decoding, byte-identical encoding on every runtime, and round-tripping.

### Modified Capabilities

- `audio-rendering`: a stem is a FLAC file decoded by the engine instead of a WAV file. Float32 stems go away.
- `stem-packing`: pack writes `<hex>.flac`, refuses float sources, and canonical stem bytes are defined by the encoder.
- `placeholder-stems`: generation writes FLAC stems.
- `piece-audition`: CLI commands look stems up as `<dir>/<hex>.flac`.
- `stem-publishing`: stems are stored as `<hex>.flac` with content type `audio/flac`.
- `player-site`: the dev server serves `/stems/<hex>.flac`.
- `site-deployment`: the production stem scenarios use `.flac`.
- `web-player`: the player fetches `<hex>.flac` and decodes it with the engine's FLAC decoder.

## Out of Scope

- Lossy stems (Opus, MP3, AAC). Their decoders don't give identical samples across browsers.
- Keeping WAV stems readable alongside FLAC, or a per-clip or per-manifest stem format field. There is one stem format.
- Float stems: a float-capable codec, or converting float sources to integers.
- Decoding stems off the main thread (a Worker), progressive decoding, and HTTP range requests.
- Matching libFLAC's compression with LPC, adaptive block sizes or exhaustive Rice search. The encoder may gain these later. Doing so changes stem bytes, so every piece would be re-packed and re-published.
- Removing old WAV stems from the public store. Stored files are immutable, and old deployments may still point at them.
- The fallback recording: still MP3, still rendered from the same samples, and not re-encoded.
- Changes to the manifest schema, `TRACE_FORMAT`, `RENDER_FORMAT`, the trace or the realization.

## Impact

- **Engine:** a new `packages/engine/src/audio/flac.ts` with `encodeFlac` and `decodeFlac`. `synthesizeStemWav` becomes a FLAC-producing function. `decodeWav` and `encodeWav16` stay for sources, bounces and the fallback encoder's input.
- **CLI:** `pack.ts` (encode, `.flac` name, float refusal), `stems.ts` (`.flac` lookup and decode), `publish.ts` (`audio/flac`). Usage text and README.
- **Player:** `loader.ts` fetches `.flac` and calls `decodeFlac`.
- **Site:** `dev-serve.ts` and `vite.config.ts` serve `.flac` with `audio/flac`. The Vercel `/stems/*` rewrite already forwards any name.
- **Scripts and fixtures:** `scripts/stems-placeholder.mjs` writes `.flac`. `pnpm golden:update` regenerates the River's traces. The placeholder's and the River's manifests get new clip hashes.
- **Tests:** new codec tests, including cross-checks against the reference `flac` tool where it is installed. Existing WAV-stem fixtures in the CLI and engine tests move to FLAC.
- **Release:** re-pack the River from its sources, `spite publish`, then deploy. The previous deployment's WAV stems stay in the store.
