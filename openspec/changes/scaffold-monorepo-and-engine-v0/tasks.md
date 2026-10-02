# Tasks

## 1. Workspace scaffold

- [x] 1.1 Remove `src/` and the root CommonJS `tsconfig.json`. Rewrite the root `package.json` (private, `packageManager: pnpm@10.15.0`, `engines.node: ">=24 <25"`, scripts `build`/`test`/`lint`/`format`/`typecheck`/`golden:update`), and add `pnpm-workspace.yaml`, `.npmrc` (`engine-strict=true`) and `.nvmrc` (`24`). Verify `pnpm install` succeeds on Node 24 and is refused on Node 22.
- [x] 1.2 Add `tsconfig.base.json` (strict, ES2022, bundler resolution, `verbatimModuleSyntax`), ESLint flat config with typescript-eslint, `.prettierrc`, and a root Vitest config with one project per package. Verify `pnpm lint`, `pnpm format --check` and `pnpm typecheck` run clean on the empty workspace.
- [x] 1.3 Extend `.gitignore` with audio extensions (`*.wav *.aif *.aiff *.flac *.mp3 *.ogg *.opus *.m4a`), `dist/` and coverage. Verify `git check-ignore` matches a sample `x.wav`.
- [x] 1.4 Create package skeletons: `schema` (`@spite-store/schema`, exports the schema JSON), `packages/engine` (tsdown, ESM, `lib: ["ES2022"]`, `types: []`, empty `dependencies`), `packages/player` (stub defining `<spite-player>`), `packages/cli` (`bin: spite`), and `site` (Vite stub importing the player), plus `fixtures/golden/` and `pieces/` with READMEs. Verify `pnpm build` produces `dist/` for engine, player and cli, and `pnpm --filter site build` succeeds.
- [x] 1.5 Add engine-specific lint restrictions (`Math.random`, `Date`, `performance`, `Intl`, `toLocale*`, transcendental `Math.*`, `TextEncoder`). Verify a scratch file that uses `Math.random` in `packages/engine/src` fails `pnpm lint`, then delete it.
- [x] 1.6 Write a root `README.md` covering setup (`nvm use`, `corepack enable`, `pnpm install`), the layout, and the "no audio in git / schema ≠ openspec/specs" notes. Verify the commands work as written from a fresh clone.

## 2. Seeded randomness (engine)

- [x] 2.1 Implement Philox4x32-10 on uint32 words (`Math.imul` plus a 16-bit-split mulhi). Verify it against the Random123 known-answer vectors in a unit test.
- [x] 2.2 Implement canonical path encoding (tagged, length-prefixed, hand-rolled UTF-8), the path hash, and seed normalization/keying (integer → decimal string; reject negative, non-integer, unsafe, NaN and non-string/non-number values). Verify tests cover `["a","b"]≠["ab"]`, `["1"]≠[1]`, `42≡"42"`, non-ASCII strings, and the rejection cases.
- [x] 2.3 Implement the draw primitive (seed, path, index → u32) and `rand`, `chance`, `range` (Lemire with rejection) and `weightedPick`, including argument validation. Verify unit tests cover every `seeded-randomness` scenario: order independence, unrelated-draw insertion, seed divergence, path divergence, bounds, edge probabilities, invalid inputs, `[1,2,7]` convergence over 10k trials (±0.02), and `range(1,6)` uniformity.
- [x] 2.4 Add the "no ambient randomness" test (stub `Math.random`/`Date` to throw) and commit known-answer vectors for (seed, path, index) → u32 as a fixture. Verify they pass.

## 3. Manifest schema and checks

- [x] 3.1 Write `schema/manifest.schema.json` (draft 2020-12, `specVersion` const `"0.1"`, id pattern, `sha256:` hash pattern, tempo map, clip catalogue, sections/slots/pools, transitions with `maxVisits`, envelope) and `schema/CHANGELOG.md` (0.1 entry). Verify Ajv2020 compiles it in strict mode.
- [x] 3.2 Add engine manifest types (mirroring the schema) and `checkManifest()` for the semantic rules: unknown `start`/`to`/pool/`excludes` references, duplicate section or slot ids, tempo bar ordering and bar 0 start, all-zero pool weights, and envelope endpoints and ordering. It returns `{ pointer, message }[]`. Verify it with unit tests, one per rule.
- [x] 3.3 Author `schema/examples/valid/minimal.json` (2–3 sections, ≥2 slots, a no-repeat window, one exclusion pair, a `maxVisits` guard, no envelope) plus one valid example that has an envelope. Author `schema/examples/invalid/*.json`, one per failure in the `music-manifest` spec, named for the reason and carrying a `"$comment"` with the expected pointer. Verify an example test asserts every valid file passes and every invalid file fails at its expected pointer.

## 4. Realization (engine)

- [x] 4.1 Implement `createState` / `advance` / `realize` per design D6 (section traversal, `maxVisits`, slot entry with envelope, fit-in-visit, exclusions with one-bar rest, no-repeat with window shrinking, gain product, sorted-by-id iteration, manifest fingerprint in the state). Verify with unit tests for each `piece-realization` traversal, entry, fit, no-repeat, exclusion and envelope scenario, using small inline manifests.
- [x] 4.2 Add determinism tests: 100 repeated realizations with the same hash, key-reordered manifest, declaration-reordered manifest, seeds 0–19 producing ≥15 distinct traces, an unreachable section added, a slot added (the other slots' events unchanged), and prefix stability for 32 vs 64 bars. Verify they all pass.
- [x] 4.3 Add the serializable-state test: four 16-bar chunks with a JSON round trip between them equal the one-shot 64-bar trace. Add a test that a resume against a different manifest throws. Verify both pass.
- [x] 4.4 Add the `node:vm` portability test (bare ECMAScript context, built engine bundle, compare against the Node trace hash) and a test asserting the engine has no runtime `dependencies`. Verify both pass.
- [x] 4.5 Add the canonical trace serialization plus a `golden:update` script that writes `fixtures/golden/minimal.{0,42,spite-store}.json`. Add the golden test, which recomputes the hashes and on mismatch names the seed and the first differing event. Verify that `pnpm test` passes after generation, and that a deliberate one-line engine tweak makes the golden test fail with that message (then revert the tweak).
- [x] 4.6 Document the engine API, the decision-path table, and the `traceFormat` bump policy in `packages/engine/README.md`. Verify the README's usage snippet runs under `node --input-type=module`.

## 5. CLI validate

- [x] 5.1 Implement `spite validate <file...>`: Ajv2020 (`allErrors`) followed by `checkManifest()`, errors printed as `file  pointer  message`, exit codes 0/1/2, and usage on no args. Add `audition`/`bounce`/`pack` stubs that print "not implemented yet" and exit 2. Verify `execFile` tests on the built binary cover each `CLI validate command` scenario plus every example file.
- [x] 5.2 Document CLI usage in `packages/cli/README.md`. Verify `pnpm --filter @spite-store/cli exec spite validate ../../schema/examples/valid/minimal.json` exits 0 as documented.

## 6. Integration check

- [x] 6.1 From a clean clone on Node 24, run `pnpm install && pnpm build && pnpm lint && pnpm typecheck && pnpm test`. Verify everything passes, `git ls-files` contains no audio files, and `openspec validate scaffold-monorepo-and-engine-v0 --strict` still passes.
