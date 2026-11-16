# Design

## Context

- **Decoding is already ours.** The player decodes stems on the main thread with the engine's `decodeWav` (`packages/player/src/loader.ts`), never `decodeAudioData`, and hands Float32 channels to the worklet. The CLI does the same in `packages/cli/src/stems.ts`. So "a pinned decoder" means a second decoder in the engine, not a browser API to trust.
- **The engine has no runtime dependencies** and must run unchanged in Node, a worklet and the browser, so the codec is plain TypeScript.
- **Stems are named and checked by the sha256 of their file bytes** everywhere: `.stems/<hex>.wav`, the store's `stems/<hex>.wav`, the player's `crypto.subtle` check before decoding, `spite publish --check`, and `scripts/deploy-check.mjs`, which covers every manifest under `pieces/`, the placeholder included.
- **What the local stems hold:** the River's 24 stems are 1-channel 24-bit, and the placeholder's 8 are 16-bit, 5 mono and 3 stereo. No stem is float32.
- **Measured with the reference `flac` 1.5.0 on `.stems/`:**

  | Stems | WAV | `flac -0` (fixed predictors only) | `flac -8` |
  | --- | --- | --- | --- |
  | River, 24-bit | 57.6 MB | 31.3 MB (54%) | ≈ 51% |
  | Placeholder, 16-bit | 3.0 MB | 0.9 MB (30%) | — |

  So the River's first wait should fall from 14–19 MB to about 8–10 MB, and a whole seed from 50–55 MB to about 27–30 MB. Task 6 measures the real numbers with our encoder.
- **Trace events carry `clipHash`.** Realization never reads a hash for a decision (`realize.ts` only copies `clip.hash` into the event). So re-hashing stems changes the trace's `clipHash` values and `traceHash`, and nothing else.

## Goals / Non-Goals

**Goals:**
- Every seed of every committed piece renders the same samples from FLAC as it does from WAV today. The golden audio snapshots are the proof.
- Stem bytes stay a pure function of the samples, the same on every machine, so pack and placeholder generation stay reproducible and hash checks stay meaningful.
- Each stem is one whole file, fetched, hash-checked and then decoded, as now.

**Non-Goals:**
- Compression parity with libFLAC. Fixed predictors are within about 3 points of `-8` on the River. LPC can come later.
- Decode speed beyond "not noticeably slower than the network". No Worker and no WASM.

## Decisions

### D1. The hash is the sha256 of the FLAC file bytes

The stem's identity stays the sha256 of the file that is stored and fetched.

- **Alternative: hash the decoded PCM,** so the hash survives an encoder change. Rejected. The player would have to decode untrusted bytes before it could check them. The store name would stop being the file's hash, which breaks publish's idempotence and the reachability checks. Every tool that checks a hash would need the decoder.
- **What makes this safe:** D2 makes the bytes canonical, so the hash still depends only on the audio.
- **Cost:** changing the encoder's output re-hashes every stem. That is deliberate, rare and loud: `spite pack` and `pnpm stems:placeholder` exit 1 on hash drift, and the codec tests pin output hashes.

### D2. A canonical encoder in the engine, not libFLAC

`encodeFlac(channels: Int32Array[], bits: 16 | 24): Uint8Array` lives in `packages/engine/src/audio/flac.ts`. Every choice is a fixed rule:

- **Stream:** `fLaC`, then one STREAMINFO block marked last. Min and max block size are 4,096. Min and max frame size are 0 (unknown). The rate is 48,000, with the channels and bits per sample, and the total samples. The MD5 is all zeros, which the format allows ("not computed"). Integrity comes from sha256 plus the frame CRCs. No other metadata blocks.
- **Frames:** fixed block size 4,096. The last block is shorter and coded with an explicit 16-bit size. The frame number is UTF-8-style coded. Rate and depth are written as codes (48 kHz, 16 or 24 bit), never "from STREAMINFO". Each frame ends with its CRC-8 and CRC-16.
- **Subframes, per channel:**
  - Wasted bits are the count of trailing zero bits shared by every sample in the block, when the block is not constant.
  - The candidates are CONSTANT (only if every sample is equal), FIXED orders 0–4 (order below the block size) and VERBATIM.
  - The candidate with the fewest bits wins. Ties go CONSTANT, then FIXED by lower order, then VERBATIM.
- **Residuals:**
  - Partition orders 0–8 are tried. An order is allowed when the block size divides evenly and the first partition holds more samples than the predictor order.
  - For each partition, the Rice parameter with the fewest bits wins, searched over 0–30, ties to the lower parameter.
  - The partition order with the fewest total bits wins, ties to the lower order.
  - The coding method is RICE (4-bit parameters) when every chosen parameter is at most 14, and RICE2 (5-bit) otherwise. The escape code is never used.
- **Stereo (2 channels):** the encoder computes the best subframe for left, right, side (`L − R`, one extra bit) and mid (`(L + R) >> 1`). It picks the cheapest of independent, left/side, side/right and mid/side, ties in that order.
- **Arithmetic:** integer only. Samples are `Int32Array`. Bit counts and residual sums are JS integers well below 2^53, and no value is shifted past 32 bits. No floating point, `Math` transcendentals or platform APIs.

The alternative was shelling out to `flac` or using a JS port of libFLAC. Rejected because the bytes depend on the version and its options, and re-hashing would then happen whenever a machine's `flac` changed. The measurement above shows fixed predictors give up very little.

### D3. A general decoder with exact integer prediction

`decodeFlac(bytes, name): Stem` returns the same `Stem` shape as `decodeWav`.

- **What it handles:** the whole of RFC 9639 that is legal at 48 kHz, 1–2 channels and 16/24-bit. That covers constant, verbatim, fixed and LPC subframes, all stereo modes, wasted bits, RICE and RICE2, escape partitions, variable block sizes, and skipped metadata blocks.
- **Why general:** our streams only use part of it, but a general decoder can be cross-checked against `flac` output, and it accepts a hand-made stem if one ever appears.
- **LPC exactness:** a sum of up to 32 products of 15-bit coefficients and 25-bit samples stays below 2^53, so it is computed in plain JS numbers. The quantization shift is `Math.floor(sum / 2 ** shift)`, which is exact for powers of two. `>>` is never used on sums.
- **Conversion to Float32:** `sample / 2^(bits − 1)`, the same divisor `decodeWav` uses (32,768 or 8,388,608). That makes FLAC and WAV decodes identical value for value.
- **Validation:**
  - Frame CRC-8 and CRC-16 are checked, and the total sample count must equal STREAMINFO.
  - Any failure throws, so no partial stems.
  - The errors match `decodeWav`'s style: `<name>: <what>`.

### D4. One stem format; no format field, no new pin

The file extension, the store name, the dev server, the player and the CLI all move to `.flac` together, and WAV stems stop being read.

- **Alternative: a manifest `stemFormat` field, or trying `.flac` then `.wav`.** Rejected. Manifests, the site and the player deploy as one build from one repo, so there is never a live manifest whose stems are a different format from the player's. A second path would only be dead code to test.
- **Schema:** unchanged. A clip hash was always "the sha256 of the stem file". `schema/CHANGELOG.md` gets a note that stem files are now FLAC.
- **Engine pin:** unchanged. A pin records what a seed sounds like. `TRACE_FORMAT` covers the sequence of decisions and `RENDER_FORMAT` the samples, and neither changes. **Determinism:** the seeded decision paths are untouched, and the River's golden traces change only in `clipHash` and `traceHash` (D6).

### D5. Pack and placeholder produce integer samples, then encode

- **Pack:** `wavslice.ts` currently copies source bytes into a new WAV. It will instead read the frame range into one `Int32Array` per channel, sign-extending 16- and 24-bit, and call `encodeFlac` at the source's depth.
- **Float sources:** refused at the source check with the message from the spec. Converting them would break "pack does not process audio".
- **Placeholder:** `synthesizeStemWav` becomes `synthesizeStem`. It runs `synthesizeClip`, then `quantize16` per sample (the same rounding `encodeWav16` uses), then `encodeFlac(…, 16)`. The decoded samples equal those of today's WAVs, so the golden audio snapshots hold without regeneration.
- **The WAV helpers stay:** `decodeWav` still reads sources and `encodeWav16` still writes bounces, auditions and the fallback encoder's input.

### D6. Re-hashing and the golden traces

- **The placeholder:** `pnpm stems:placeholder -- --update` rewrites its clip hashes.
- **The River:** `spite pack --update` rewrites its clip hashes and leaves the pack file's source hashes alone, because the sources haven't changed.
- **The River's goldens:** `pnpm golden:update` then rewrites `the-river-forgets-to-answer.*.json`.
- **The check:** a one-off comparison (task 5.4) maps each old hash to its new one by clip id and confirms that the old and new traces are identical once mapped. The minimal example's traces use made-up hashes and don't change.
- **The golden README:** re-hashing stems is added as a third legitimate reason to regenerate traces.

## Risks / Trade-offs

- **Main-thread decode time.** FLAC decoding in JS is slower than copying WAV samples. On a 10 MB first wait this could add a few hundred milliseconds and jank the page. → Task 6 measures decode time per MB in Chromium, Firefox and WebKit. If any is above about 50 ms per MB of FLAC, moving decoding into a Worker is a follow-up change. The decoder is already DOM-free.
- **An encoder bug that is lossy for some signal.** → Every encode in `pack` and the placeholder script is decoded and compared with its input before it is written. A mismatch is a hard error. Round-trip tests cover extremes, noise and boundary lengths, and the reference `flac --test` is used where installed.
- **Encoder changes re-hash everything.** → The codec tests pin output hashes, so this can't happen silently. When it is deliberate, it is a re-pack, a re-publish and a golden update, with performances unchanged.
- **The `flac` tool missing on CI.** → The tests against the reference tool are skipped when `flac` is absent, the same way the ffmpeg tests are handled. Correctness rests on the round-trip tests, the golden audio snapshots and the WAV-against-FLAC comparison, none of which need it.
- **The River's sources are off-repo.** Re-packing needs the source directory. → The WAV-against-FLAC comparison for the River and the bounce check run locally, before publishing, as release tasks.
- **Old deployments or embeds pointing at WAV names.** → The WAV files stay in the store, which is immutable, so the old build keeps working until it is replaced. New builds never request them.

## Migration Plan

1. Land the codec, then switch pack, the placeholder, the CLI, the site and the player over, with all tests passing on placeholder stems.
2. Locally: regenerate the placeholder stems with `--update`. Re-pack the River with `--update`. Run `pnpm golden:update` and check the trace mapping. Bounce the River's `spite-store` seed and compare it with a bounce from the WAV stems. Leave the fallback MP3 alone.
3. `spite publish pieces/*/manifest.json` uploads the new `.flac` stems. The fallbacks and old WAVs are untouched.
4. Push. `deploy-check` confirms every `.flac` is reachable before the new build goes live.
5. **Rollback:** redeploy the previous build. Its WAV stems are still in the store.

## Measured

These are measured on the River after re-packing it with our encoder (task 6.1, 2026-11-16). The FLAC stems decode to the same Float32 samples as the old WAV stems, and the 64-bar `spite-store` bounce is byte-identical.

| River | WAV | FLAC (ours) |
| --- | --- | --- |
| Catalogue, 24 stems | 57.6 MB | 31.0 MB (53.7%) |
| Seed `0`, first wait (6 stems at bar 0) | 14.4 MB | 7.7 MB |
| Seed `0`, whole seed (23 stems) | 55.2 MB | 29.7 MB |
| Seed `42`, first wait (8 stems at bar 0) | 19.2 MB | 10.4 MB |
| Seed `42`, whole seed (21 stems) | 50.4 MB | 27.3 MB |
| Seed `spite-store`, first wait (7 stems at bar 0) | 16.8 MB | 9.0 MB |
| Seed `spite-store`, whole seed (23 stems) | 55.2 MB | 29.6 MB |

- **Size.** The catalogue is 53.7% of its WAV size, under the 60% bound, and a little smaller than `flac -0` (54%). The placeholder's 8 stems shrink from 3.0 MB to 0.41 MB (14%).
- **Decode time.** We timed `decodeFlac` on the River's largest stem (1.37 MB of FLAC), taking the median of 10 runs after warm-up:

  | Runtime | Speed |
  | --- | --- |
  | Chromium | 22.6 ms/MB |
  | WebKit | 32.9 ms/MB |
  | Firefox | 34.3 ms/MB |
  | Node 24 | about 25 ms/MB |

  Every browser is under the 50 ms/MB threshold, so a first wait of 8–10 MB adds about 0.2–0.35 s of main-thread decoding, spread across stems as they arrive. No Worker follow-up is needed for now.
- **Encode time.** Encoding all 32 stems, the River's and the placeholder's, takes about 7 s in Node. A full `spite pack` of the River from source takes about 10 s.
