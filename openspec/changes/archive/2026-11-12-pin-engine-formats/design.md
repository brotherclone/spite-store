# Design

## Context

- **Formats today:** `TRACE_FORMAT` (in `packages/engine/src/realize.ts`) and `RENDER_FORMAT` (in `audio/render.ts`) are both 1. The golden snapshots record them, and the golden tests tell whoever changes the engine to bump them. Nothing outside the tests reads them.
- **Manifests:** they carry `specVersion` (the schema's version) but nothing about the engine. Every committed piece would realize differently after a `TRACE_FORMAT` bump, and nothing would notice.
- **Fallback precedent:** the `fallback` addition (archived change `2026-11-11-deploy-site-and-fallback`) set the pattern this change follows: an optional top-level field, `specVersion` staying `0.1`, a CLI command with check-by-default and `--update`, and a fallback reason in the player.
- **Player:** `<spite-player>` bundles the engine, so "the player's engine" is the engine it was built with. The site and the player deploy together, so a page never mixes an old player with a new engine.

## Goals / Non-Goals

**Goals:**

- A shared seed link never plays a performance different from the one it was shared as. It plays that performance, or the piece's fixed recording, or an error that says why.
- No change to the generative path for compatible manifests: the same traces, renders, goldens and load sequence.
- Pinning is one command, and production can't ship an unpinned piece.

**Non-Goals:**

- Playing stranded pieces generatively on an old engine.
- Deciding whether a given format bump actually changes a given piece.

## Decisions

### D1. The pin is `engine: { trace, render }`, two numbers matched exactly

```json
"engine": { "trace": 1, "render": 1 }
```

- **Why the two existing numbers:** they are already maintained with exactly the meaning needed: "bumped whenever a change alters the trace (or the samples) for an existing manifest and seed". Pinning to the engine package version was rejected. The package version would change for reasons unrelated to output, such as refactors and new commands, and stranding pieces on every release would make the pin worthless.
- **Why both numbers, and why exact matching:** a render-only bump keeps the trace, so the lanes would draw correctly, but the samples differ. That is still a different performance from the one shared, so either number differing is a mismatch. Keeping the numbers separate lets messages say which one changed, and leaves room to relax the rule for render bumps later without a schema change.
- **Why direction matters only for wording:** "older" and "newer" are both mismatches. Direction only changes the message ("made with an earlier/later version of the player").
- **Validation and the engine:** schema validation accepts any integer of at least 1. A manifest pinned to formats this engine doesn't have is still a valid manifest; it's just not playable here.

### D2. Optional field, `specVersion` stays `0.1`; production requires it

- **Why optional:** making `engine` required would invalidate every existing manifest and example, plus every hand-written test fixture.
- **What an unpinned manifest means:** "whatever the current engine does". That suits development: schema examples, test fixtures, a piece being drafted.
- **Where it is required:** the release boundary is the deploy check (D6), and that is where it's enforced.
- **The changelog:** `schema/CHANGELOG.md` records it as a 0.1 addition with the same note as `fallback`. Existing manifests validate and realize exactly as before. A pinned manifest doesn't validate with a validator from before this addition.

### D3. A pure compatibility check in the engine, with the current formats injectable

```ts
// packages/engine/src/pin.ts
export interface EngineFormats { trace: number; render: number }
export const ENGINE_FORMATS: EngineFormats = { trace: TRACE_FORMAT, render: RENDER_FORMAT };
export interface PinMismatch {
  format: 'trace' | 'render'; pinned: number; current: number; made: 'older' | 'newer';
}
export function checkPin(manifest: Manifest, current = ENGINE_FORMATS): PinMismatch[]; // [] = compatible
export function describePinMismatch(m: PinMismatch): string;
// "trace format 2, this engine has 1 (made with a newer engine)"
```

- **Why `current` is a parameter:** the "older pin" case can then be tested without bumping a real format. Tests pass `{ trace: 2, render: 1 }`. Every caller in the product uses the default.
- **Why it lives in the engine:** the engine is the only package that owns both constants. The CLI, the player and the deploy script all import the check from there, so they can't disagree about what "compatible" means.
- **Messages:** `describePinMismatch` gives every caller the same wording.

**Determinism:** `realize`, `advance`, `planRender` and the path hashing never read `manifest.engine`. `checkPin` runs before realization, as a gate, and is not on any decision path. The new engine module obeys the existing lint rules: no `Math.random`, no locale, no `Date`. A test realizes The River with its pin, without it, and with a nonsense pin, and checks each trace against the existing golden hashes (see the music-manifest spec). No trace, render, golden snapshot or `TRACE_FORMAT` value changes.

### D4. CLI: one shared gate after `loadManifest`

A helper `checkPinOrExit(file, manifest, { ignore })` in `packages/cli/src/common.ts` runs immediately after `loadManifest` in `realize`, `bounce`, `audition` and `fallback`. It prints errors in the same layout as validation errors:

```
pieces/x/manifest.json  /engine/trace  trace format 2, this engine has 1 (made with a newer engine)
pieces/x/manifest.json  use --ignore-pin to hear this engine's version anyway
```

- **On a mismatch:** it exits 1 (`EXIT_INVALID`), before stems are read, so nothing is written or played.
- **With `--ignore-pin`:** the same lines go to stderr as `warning:` lines, and the command carries on. `--ignore-pin` is parsed by `realize`, `bounce` and `audition`.
- **Not `fallback`:** it doesn't accept the flag. Its argument parser rejects unknown flags, so the flag gets usage and exit 2 for free. A fallback is a fixed recording of the pinned performance, and rendering it on another engine would publish a recording of something else.
- **Not `validate` or `publish`:** `validate` stays a schema check. Publishing stems doesn't depend on the engine, and the deploy check covers releases.

### D5. `spite pin`: check by default, `--update` writes

```
spite pin <manifest.json> [--update]
```

- **Check:**
  - It validates the manifest, then prints one of three things:
    - `pinned to trace 1, render 1 (current)`
    - `not pinned (this engine: trace 1, render 1); run with --update to pin`
    - the mismatch lines from D3
  - It exits 0 only for "current".
  - It takes exactly one manifest, like `pack` and `fallback`.
- **`--update`:**
  - **Writing:** it writes through the existing `rewriteJson`, which formats through Prettier like the other `--update` commands. `engine` is placed directly after `specVersion`, so the two version fields read together.
  - **Already current:** no edit is reported, and the file isn't rewritten.
  - **Replacing a different pin:** it prints `warning: re-pinned from trace 2, render 1; existing seed links to this piece will play a different performance`, then exits 0. Re-pinning is the author deliberately re-releasing the piece, and the tool doesn't block it.

### D6. Deploy check: pins first, then stems

`scripts/deploy-check.mjs` imports `checkPin` and `describePinMismatch` from the built `@spite-store/engine`. It already runs after `pnpm build`.

- **Order:** for each emitted manifest, it checks the pin before running `spite publish --check`.
- **Unpinned:** it prints `<file>  not pinned: run spite pin --update` and fails the build with exit 1. The stem check still runs, so one build log reports every problem.
- **Mismatched:** it prints a warning, not a failure:
  - with a fallback: `warning: <file>  trace format 2, this engine has 1 … the piece will play its fallback recording`
  - without one: `… the piece will not play`
- **Why a mismatch only warns:** a mismatch is the expected state of a released piece after a format bump. Blocking the deploy would make it impossible to ship a new engine without re-pinning, which is exactly the link-breaking change the pin exists to prevent.
- **Tests:** the script gains a `SPITE_PIECES_DIR` override, alongside the existing `SPITE_STEMS_BASE`. The tests point it at a temporary directory of hand-made manifests and run against the existing local stem server, which answers 200 for any hash.

### D7. Player: the pin is checked right after the manifest loads

In `load()`, the order of decisions becomes:

1. The `fallback` attribute: `forced`, as today. An explicit request wins, so authors can still audition the recording of a stranded piece.
2. The pin check, which is new. On a mismatch with a fallback, the player enters fallback mode with reason `engine`. On a mismatch without one, it calls `fail(...)` with the `describePinMismatch` lines, which shows the error, fires `error` and keeps play disabled.
3. Generative support: `unsupported`, as today.
4. Stems, then the worklet at play, as today.

Details:

- **Before the stems:** the pin check happens before `loadPerformance`, so a stranded piece costs no stem downloads.
- **Status text:** `FallbackReason` gains `'engine'`. `REASON_TEXT` can't be static for this reason, because the direction matters, so the status line reads "Fixed recording of seed spite-store · made with an earlier version of the player" (or "later").
- **Other reasons:** unchanged.
- **Testing:** the browser tests use manifests pinned to `{ trace: 99, render: 1 }`. They need no injected formats, because 99 is always newer than the bundled engine's formats.

### D8. Committed pieces and the bump workflow

The River and the placeholder are pinned with `spite pin --update`. Schema examples and test fixtures stay unpinned. `fixtures/golden/README.md` and `pieces/README.md` gain a short note on what happens when someone bumps `TRACE_FORMAT` or `RENDER_FORMAT`:

- Every pinned piece is stranded and will play its fallback.
- The deploy log lists them.
- Re-pinning a piece with `spite pin --update` is a re-release that changes what its existing links play.

## Risks / Trade-offs

- **A format bump strands every released piece.** After a bump, every seed link to The River plays the same fixed recording, seed `spite-store`, instead of its own performance. That is the trade chosen: the fixed recording is honest, and a different performance under the same link isn't. The status line says why. Keeping old engines would avoid this, and was explicitly left out.
- **The pin is only as good as the format numbers.** An engine change that alters output without bumping `TRACE_FORMAT` or `RENDER_FORMAT` slips past the pin. The golden tests already catch this: The River has three trace goldens, and the placeholder has audio and float32 goldens. Their failure messages say to bump the format. This change makes those bumps matter more, but doesn't change how they're caught.
- **Unpinned manifests play on whatever engine runs them.** That is intended for development. The deploy check keeps unpinned manifests out of production. An unpinned manifest hosted elsewhere is outside this project's control.
- **The pin makes old validators reject pinned manifests.** This is the same accepted cost as `fallback`, recorded in the changelog.
