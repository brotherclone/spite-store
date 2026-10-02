# Proposal

## Why

Spite Store needs a foundation before anything user-facing can exist: a place for the code to live, a draft format for describing an aleatoric piece, and an engine that turns (manifest, seed) into a concrete, reproducible performance. Determinism is the product's core promise. A seed must be shareable and mean the same performance everywhere. So the randomness model and the realization contract have to be right from the first commit, not retrofitted.

## What Changes

- Replace the single-package placeholder (`src/index.ts`, root `tsconfig.json`) with a pnpm workspace containing `schema/`, `packages/engine`, `packages/player` (stub), `packages/cli`, `fixtures/golden/`, `pieces/` and `site/` (stub), plus shared TypeScript, Vitest, ESLint and Prettier config, a pinned pnpm and Node LTS, and `engine-strict`.
- Add the music manifest JSON Schema v0.1 (`schema/manifest.schema.json`) with valid and invalid example manifests and a CHANGELOG. The manifest covers: tempo map, clip catalogue (by sha256 content hash), sections, slots with weighted clip pools (weights, exclusions, no-repeat window), per-slot entry probability, a weighted section transition graph with an optional per-section max-visits guard, and an optional form envelope.
- Add a counter-based, seeded PRNG to the engine. Every random decision is a pure function of (seed, decision path), so adding new decisions never shifts earlier ones. Helpers: `rand`, `chance(p)`, weighted pick, integer `range`.
- Add a pure `realize(manifest, seed, { durationBars })` that returns an event trace `[{ bar, beat, slot, clipHash, gain }]`. It is built on a fully serializable realization state, so realization can be paused and resumed (groundwork for seeking).
- Add `spite validate <manifest...>` to the CLI. It checks a manifest against the JSON Schema (ajv) and against semantic rules the schema can't express, such as dangling references and duplicate ids.
- Add golden trace-hash snapshots for three seeds of `schema/examples/valid/minimal.json`.

## Capabilities

### New Capabilities

- `seeded-randomness`: Deterministic, counter-based random decisions keyed by (seed, decision path), and the random helpers built on them.
- `music-manifest`: The manifest format (structure, semantic rules, versioning) and validating a manifest from the CLI.
- `piece-realization`: Turning a manifest and seed into an event trace. Covers determinism, decision-path stability, the musical rules (sections, transitions, slots, pools), serializable state, and golden snapshots.

### Modified Capabilities

None. This is the first change; `openspec/specs/` is empty.

## Out of Scope

- Any audio: decoding, scheduling, rendering, `bounce`, `audition`, `pack`. The CLI ships these as "not implemented" stubs only.
- `<spite-player>` behavior and any site content. These are package stubs that build and nothing more.
- A public seeking API. This change only guarantees the state is serializable and resumable.
- Sub-bar timing (every v0 event starts on a downbeat, `beat: 0`), tempo ramps, and meter-aware beat math.
- Stem hosting, upload, content-addressed storage, accounts, and anything "store"-shaped.
- Turborepo or any other task runner, CI pipelines, and publishing packages to npm.

## Assumptions to confirm in review

These shape externally visible behavior. Each is recorded in design.md and can be changed before apply.

- **Form envelope**: a piecewise-linear curve over piece progress (0–1) that scales every slot's entry probability. When present, it makes the trace depend on `durationBars`.
- **Exclusions**: symmetric, and they apply to clips sounding at the same time in *any* slot.
- **Clips never cross section boundaries**: a slot only picks clips that fit in the bars remaining in the current section visit.
- **Seeds**: a string or a non-negative safe integer. `42` and `"42"` are the same seed.

## Impact

- Root `package.json`, `tsconfig.json` and `src/` are replaced. Nothing depends on them yet.
- New dev dependencies: TypeScript, Vitest, tsdown, Vite, ESLint (with typescript-eslint), Prettier. The CLI gets `ajv` as a runtime dependency. The engine has zero runtime dependencies.
- Contributors need Node 24 (LTS), and pnpm 10 via Corepack. `engine-strict` refuses installs on other Node versions, and the current default shell Node is 22.
