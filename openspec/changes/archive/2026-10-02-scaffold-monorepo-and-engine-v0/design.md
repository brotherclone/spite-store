# Design

## Context

The repo is a single-package placeholder: a `package.json` that pins `pnpm@10.15.0`, a CommonJS `tsconfig.json`, and `src/index.ts` printing a log line. Nothing depends on these, so they are replaced outright. Locally installed Node versions include 24.12.0 (the current LTS line), but the default shell Node is 22.

Motivation is in proposal.md. Required behavior is in `specs/seeded-randomness`, `specs/music-manifest` and `specs/piece-realization`.

The constraint that shapes most of the decisions below is that the engine must give **bit-identical results in Node and in an AudioWorklet across browser engines**, with zero runtime dependencies.

## Goals / Non-Goals

**Goals:**
- A workspace layout that won't need restructuring when player, site and CLI get real work.
- A randomness and decision-path scheme that can be frozen early. Changing it later invalidates every shared seed.
- A realization core already shaped as `state → (events, state)`, so seeking and streaming playback slot in later without a rewrite.

**Non-Goals:**
- Performance tuning. Realizing a few thousand bars should be comfortably sub-second, and that's all.
- A stable public JS API. Packages are `private` and `0.x`.

## Decisions

### D1. Workspace layout and tooling

```
package.json            private, packageManager pnpm@10.15.0, engines.node ">=24 <25"
pnpm-workspace.yaml     packages/*, site, schema
.npmrc                  engine-strict=true
.nvmrc                  24
tsconfig.base.json      strict, ES2022, moduleResolution "bundler", isolatedModules, verbatimModuleSyntax
eslint.config.js        flat config + typescript-eslint; engine-specific restrictions (D7)
.prettierrc
vitest.workspace / root vitest config with projects per package
schema/                 manifest.schema.json, examples/{valid,invalid}/, CHANGELOG.md, package.json (@spite-store/schema)
packages/engine         @spite-store/engine  (tsdown → ESM, no deps)
packages/player         @spite-store/player  (stub: defines <spite-player>, renders placeholder)
packages/cli            @spite-store/cli     (bin: spite; deps: ajv, @spite-store/engine, @spite-store/schema)
fixtures/golden/        minimal.<seed>.json
pieces/                 .gitkeep + README
site/                   Vite stub (index.html importing player)
```

- `schema/` is a workspace package so the CLI imports the schema JSON by package name instead of by relative path. It has no build step.
- Libraries build with **tsdown** rather than tsup. tsup is in maintenance mode, and tsdown is its maintained Rolldown-based successor with a compatible config shape. Everything is ESM-only, with no CJS output.
- **Node 24 LTS**, pinned to the major in `engines` and `.nvmrc`. Node 26 isn't LTS until later this month, so it can be adopted in a follow-up.
- Root scripts: `build`, `test`, `lint`, `format`, `typecheck`, each `pnpm -r` or a single root tool invocation. No Turborepo.

### D2. PRNG: Philox4x32-10 as a keyed hash

**Choice:** Philox4x32-10 (Salmon et al., *Random123*). It is counter-based by construction: `output = Philox(key, counter)`, with no carried state.

- **Key (64-bit):** derived from the normalized seed string (D4).
- **Counter (128-bit):** `[pathHashLo, pathHashHi, drawIndex, 0]`. The last word is reserved and stays 0.
- **Output:** one Philox call yields four 32-bit words. Draw `i` on a path uses word `i & 3` of the block at `drawIndex = i >>> 2`.

**Why over the alternatives:**
- *PCG32*: its native form is a sequential LCG stream. Keying it per path means deriving a fresh state per path and still advancing it sequentially within the path. That works, but it reinvents what Philox already is, and PCG's 64-bit multiply needs BigInt or emulation.
- *Plain hash (e.g. Murmur3/xxHash finalizer)*: simpler, but not designed or validated as an RNG. Philox passes TestU01 BigCrush and has published known-answer vectors to test against.
- *Philox in JS:* it only needs a 32×32→64 multiply, done as `Math.imul` for the low word plus a 16-bit-split mulhi. Every operation is exact integer arithmetic on uint32. Cost is around 40 integer multiplies per four outputs, which is negligible.

**Determinism impact:** this choice and D3 together define the meaning of every seed. They are versioned (D9).

### D3. Decision paths

- A path is an array of segments, each a manifest id string or a non-negative integer.
- **Canonical encoding:** each segment is a type tag byte (`0x01` = string, `0x02` = int), a length or value, then the UTF-8 bytes for strings. Integers are encoded as 8 bytes, big-endian, from a safe integer. Hand-written UTF-8 encoding avoids depending on `TextEncoder`, which AudioWorkletGlobalScope doesn't guarantee. The tags and length prefixes rule out ambiguities like `["a", "b"]` vs `["ab"]` and `["1"]` vs `[1]`.
- **Path hash (64-bit):** Philox itself is used as the compression function, run Davies–Meyer style over the encoded bytes in 8-byte chunks, keyed by a fixed domain constant. That avoids adding a second hash algorithm. The per-seed key is applied only at the final draw, so the path hash depends on the path alone and can be cached per path.
- **Engine paths (the stable contract):**

  | Decision | Path |
  |---|---|
  | Next section | `["v", visitOrdinal, "next"]` |
  | Slot entry | `["v", visitOrdinal, "s", slotId, "enter"]` |
  | Clip pick | `["v", visitOrdinal, "s", slotId, "pick", pickOrdinal]` |

  `visitOrdinal` counts section visits from 0 at piece start. `pickOrdinal` counts pick attempts (including rests from exclusions) within that slot's visit. Paths use ids, never array positions. That is what makes declaration order irrelevant and keeps unreachable or added elements from disturbing existing rolls (spec: Decision-path stability).

- **Known limit (by design):** anything that changes *which* section plays at visit `k` changes every later visit's content, because the timeline itself changed. Stability is promised for elements no existing decision consults, not for edits to the graph's weights or edges.

### D4. Seeds

The seed is normalized to a string (an integer becomes its base-10 form), encoded like a path segment, and hashed with a different domain constant to produce the 64-bit Philox key. Strings are allowed so seeds can be words in URLs (`?seed=spite-store`).

### D5. Turning bits into decisions without float drift

Only operations ECMAScript specifies exactly are used: integer ops, `+ - * /` on doubles (IEEE-754 round-to-nearest; JS has no implicit FMA), comparisons, `Math.floor`, and `Math.imul`. `Math.pow`, `exp`, `log`, `sin` and so on are banned in the engine (D7) because their precision is implementation-defined.

- `rand()` = `u32 / 2^32`, which is exact.
- `chance(p)` = `u32 < p × 2^32`. Multiplying by a power of two is exact, so there is no rounding.
- `range(lo, hi)`: Lemire's multiply-and-reject over uint32, using further draw indices on the same path when it rejects. Unbiased, deterministic, and a variable draw count is harmless because draws are indexed.
- **Weighted pick:** `target = rand() × total`, then a linear scan of the cumulative sum *in canonical order*: candidates sorted by clip id (code-unit order) before summing, so float addition order is fixed. A target that lands at the end due to rounding falls to the last positive-weight item.
- **Envelope interpolation:** `v0 + (v1 − v0) × (x − x0) / (x1 − x0)`, which uses only exact-spec operations.

### D6. Realization model

The core is `createState(manifest, seed, opts)` plus `advance(manifest, state, untilBar) → { events, state }`. `realize()` creates a state, advances to `durationBars`, and returns the events. Per bar, the order is:

1. If the bar is the end of the current visit, roll the next section (D3 path) over eligible transitions. If there is none, the piece ends. Otherwise start the visit.
2. At visit start, iterate the section's slots **sorted by id** and roll entry for each with `p × envelope(visitStartBar / durationBars)`.
3. For each active slot **sorted by id** whose clip ended (or that just entered), pick a clip:
   - Candidates: pool clips that fit in the remaining bars.
   - Remove clips excluded by anything sounding now. Slots earlier in id order have already picked for this bar.
   - Apply the no-repeat window, shrinking it if it empties the set.
   - If no candidate fits, rest until the visit ends. If exclusions emptied the set, rest one bar.
   - Emit `{ bar, beat: 0, slot, clipHash, gain }`.

**State** contains `{ v: 1, seed, durationBars, bar, ended, visit: { ordinal, sectionId, startBar }, visitCounts: {sectionId: n}, slots: { [slotId]: { active, clipId, endBar, pickOrdinal, history: clipId[] } } }`. All values are plain JSON. Map-like records are always iterated in sorted key order, never insertion order. The manifest is *not* in the state, which keeps the state small, but it carries a manifest fingerprint so a resume against the wrong manifest is rejected.

**Why sort by id instead of declaration order:** reordering JSON shouldn't change music, and authors will reorder freely. The tradeoff is that renaming a slot can change exclusion outcomes in the same bar, which is acceptable and documented.

### D7. Keeping the engine portable

- `packages/engine/tsconfig.json` sets `lib: ["ES2022"]` with no `DOM`, and `types: []` so there are no Node types. Any DOM or Node global becomes a compile error.
- ESLint `no-restricted-globals` / `no-restricted-properties` in `packages/engine` covers `Math.random`, `Date`, `performance`, the `Intl` and `toLocale*` methods, the transcendental `Math.*` functions, and `TextEncoder`.
- `package.json` for the engine has empty `dependencies`, and a test asserts this.
- Worklet proxy test: load the built engine bundle into a `node:vm` context created with no extra globals, realize `minimal.json`, and compare hashes with the Node run. A real-browser AudioWorklet check belongs to the player change.

### D8. Manifest validation is split between schema and engine

JSON Schema handles structure, types, ranges, patterns and `specVersion`. It can't express referential integrity, uniqueness of keyed ids, the tempo map's strictly increasing bars, or envelope endpoint rules. Those live in a dependency-free `checkManifest()` in the engine, so the engine can refuse bad input on its own. The CLI runs ajv (Ajv2020, `allErrors`, `ajv-formats` is not needed) first, then `checkManifest()`, and reports both with JSON Pointers. Errors from both layers share one shape: `{ pointer, message }`.

Manifest shape (abbreviated):

```jsonc
{
  "$schema": "../../manifest.schema.json",
  "specVersion": "0.1",
  "id": "minimal", "title": "Minimal",
  "tempo": [{ "bar": 0, "bpm": 90, "meter": [4, 4] }],
  "clips": { "kick-a": { "hash": "sha256:…", "lengthBars": 2, "gain": 0.9, "excludes": ["kick-b"] } },
  "start": "a",
  "sections": [{
    "id": "a", "lengthBars": 8, "maxVisits": 3,
    "slots": [{ "id": "drums", "enter": 1, "gain": 1, "noRepeat": 1,
                "pool": [{ "clip": "kick-a", "weight": 2 }] }],
    "next": [{ "to": "b", "weight": 1 }]
  }],
  "envelope": [{ "at": 0, "value": 0.5 }, { "at": 1, "value": 1 }]
}
```

`sections` is an array, which is friendlier for authors, but the engine indexes it by id and never depends on its order. Clips are keyed by id because pools and exclusions refer to them.

### D9. Golden snapshots and the trace format

- **Canonical trace JSON:** an array of objects whose keys are emitted in the fixed order `bar, beat, slot, clipHash, gain`, using `JSON.stringify` number formatting (shortest round-trip, which ECMAScript specifies). `traceHash` is the sha256 hex of that string. Tests compute it with `node:crypto`. The engine itself never hashes.
- **Snapshot file:** `fixtures/golden/minimal.<seed>.json` holding `{ manifest, seed, durationBars, traceFormat: 1, traceHash, trace }`. The full trace is kept so a drift shows up as a readable diff.
- **Regeneration** is an explicit `pnpm golden:update`. The test never writes snapshots.
- `traceFormat` (and the state's `v`) is bumped whenever D2–D6 change in a way that changes outcomes. That bump is the signal that existing shared seeds now mean something different.

### D10. CLI

A hand-rolled argv parser (one subcommand, a few flags), so no CLI framework. `validate` behaves as specified. `audition`, `bounce` and `pack` print "not implemented yet" and exit 2. Tests run the built binary via `execFile` on the example manifests.

## Risks / Trade-offs

- [The Philox or path encoding has a subtle bug, and seeds get shared before it's caught] → Known-answer vectors from the Random123 reference implementation in unit tests, golden snapshots, and `traceFormat` versioning so a fix is an explicit, visible break.
- [Float weights cause cross-engine drift] → Only exactly-specified operations (D5), a fixed summation order, and lint bans. Integer-only weights were considered and rejected because they're less friendly for authors and unnecessary given D5.
- [Sorting by id couples exclusion priority to naming] → Documented. Exclusion conflicts within a single bar are rare, and the behavior is still deterministic.
- [An envelope breaks prefix stability (the trace depends on `durationBars`)] → Specified explicitly. A future "open-ended" mode can define progress differently.
- [The `node:vm` check isn't a real AudioWorklet] → It catches DOM and Node global leaks, which are the realistic failure mode. A real-browser check is deferred to the player change.
- [The default shell Node (22) fails `engine-strict`] → `.nvmrc` plus a README note: `nvm use` and `corepack enable`.

## Migration Plan

Greenfield. Delete `src/` and the root CommonJS `tsconfig.json`, then add the workspace. Rollback is reverting the commit(s).

## Open Questions

- Should the manifest carry author or licensing metadata in v0.1? It is additive, so it can wait until `pack` exists.
- What is the canonical id for the schema (`$id` URL)? A relative `$id` (`manifest.schema.json`) is used until a domain is settled.
