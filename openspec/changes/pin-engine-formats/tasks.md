# Tasks

## 1. Manifest `engine` field and the compatibility check

- [x] 1.1 Add the optional top-level `engine` object to `schema/manifest.schema.json` (`trace` and `render` both required, integers with minimum 1, `additionalProperties: false`), and record it under 0.1 in `schema/CHANGELOG.md` with the D2 note on `specVersion`. Add `schema/examples/valid/engine-pin.json` and `schema/examples/invalid/engine-pin-zero.json` (expected pointer `/engine/trace`). Verify the examples test passes, `spite validate` passes the valid example, and fails the invalid one with a pointer under `/engine`.
- [x] 1.2 Add `engine?: EngineFormats` to the engine's `Manifest` type and to the structural check in `checkManifest`, with JSON Pointers under `/engine` for a zero `trace`, a string `render`, a missing `render` and an unknown field, plus the CLI's plain-language messages for the same cases. Verify with engine unit tests for each scenario of the "Engine pin field" requirement, including the pin `{ trace: 7, render: 3 }` validating.
- [x] 1.3 Add `packages/engine/src/pin.ts` with `ENGINE_FORMATS`, `checkPin(manifest, current?)` and `describePinMismatch` (D3), exported from `index.ts`. Verify with unit tests for each "Pin compatibility" scenario (matching, unpinned, newer trace pin, older pin via an injected `current`, and a mismatch on both numbers reporting two entries), and that `pnpm lint` passes the engine's determinism rules.
- [x] 1.4 Add the determinism tests from the "Realization ignores the pin" requirement: the River (seeds `0`, `42`, `"spite-store"`, 64 bars) with its pin, without one and with `{ trace: 9, render: 9 }`, checked against the existing goldens; then the placeholder (seed `42`, 16 bars) rendered with and without `engine`, checked against `fixtures/golden/placeholder.audio.42.json`. Follow `packages/engine/test/fallback-ignored.test.ts`. Verify `pnpm test` passes and `git diff fixtures/golden` is empty.

## 2. CLI

- [x] 2.1 Add `checkPinOrExit` to `packages/cli/src/common.ts` (D4) and call it right after `loadManifest` in `realize`, `bounce` and `audition`, which parse `--ignore-pin`. Then call it in `fallback`, which doesn't accept the flag. Update the usage text. Verify with CLI tests for: "Mismatched pin" for each of the three commands (exit 1, both formats printed, `--ignore-pin` mentioned, no output file); "Unpinned manifest" (placeholder without `engine` bounces with no warning); "Hearing the current engine's version" (`bounce --ignore-pin` warns and writes the WAV); "Flag has no effect on a compatible manifest" (`realize --json` output byte-identical with and without the flag); and the two new `fallback-recording` scenarios (no MP3 written and the manifest unchanged on a mismatch; `--ignore-pin` gives usage and exit 2).
- [x] 2.2 Implement `spite pin <manifest> [--update]` (D5) and wire it into `bin.ts` and the usage text. Verify with CLI tests for every "Pin command" and "Writing the pin" scenario: current, unpinned and mismatched (exit codes 0, 1, 1, and the file byte-identical each time); invalid manifest (exit 1, pointer printed); pinning an unpinned copy of the placeholder (`engine` placed after `specVersion`, otherwise unchanged, still valid); re-pinning with the warning; already current leaving the file byte-identical; and usage errors (no manifest, two manifests, unknown flag: exit 2).
- [x] 2.3 Document `pin` and `--ignore-pin` in `packages/cli/README.md`, including the exit codes and what re-pinning does to existing links. Verify `pnpm exec spite --help` lists both and `pnpm format:check` passes.

## 3. Player

- [x] 3.1 In `packages/player/src/element.ts`, check the pin in `load()` after the forced-fallback check and before the generative-support check (D7). Add `'engine'` to `FallbackReason` with direction-aware status text, and on a mismatch without a fallback, `fail` with the `describePinMismatch` lines. Verify with browser tests in all three engines (manifests pinned to `{ trace: 99, render: 1 }`): "Mismatched pin" (fallback mode, no `.wav` requested, status says a newer version); "Engine reason reported" (`fallback` event with reason `engine`, then `ready`); "No fallback to play" (no stem requested, error status naming 99 and the current format, `error` event, play disabled); "Forced fallback wins over the pin" (reason `forced`); and "Unpinned manifest plays generatively".
- [x] 3.2 Document the `engine` fallback reason and the mismatch error in `packages/player/README.md`. Verify `pnpm format:check` passes.

## 4. Deployment and pieces

- [x] 4.1 Add the pin check to `scripts/deploy-check.mjs` before the stem check (D6): unpinned fails, mismatched warns with or without a fallback, and a `SPITE_PIECES_DIR` override is added. Verify in `site/test/deploy.test.ts`, against a temporary pieces directory and the existing local stem server, every "Deployed pieces are pinned" scenario: an unpinned piece exits 1 and names the manifest; a stranded piece with a fallback exits 0 and warns that it will play its fallback; a stranded piece without one exits 0 and warns that it will not play; pinned pieces exit 0 with no warning. The existing deploy-check tests must still pass against the real `pieces/`.
- [x] 4.2 Pin both committed pieces with `spite pin --update` (`pieces/the-river-forgets-to-answer/manifest.json` and `pieces/placeholder/manifest.json`), and add the River's "Pinned to its release formats" check to its piece tests. Verify `spite pin` exits 0 on both, `pnpm test` passes, `git diff fixtures/golden` is empty, and the dev site still plays both pieces generatively.
- [x] 4.3 Add the format-bump note (D8) to `fixtures/golden/README.md` and `pieces/README.md`, and mention pinning in the root `README.md` release steps. Verify `pnpm format:check` passes.

## 5. Release

- [x] 5.1 Run the full suite: `pnpm test`, `pnpm test:browser`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check`, all passing, with `git diff fixtures/golden` empty.
- [ ] 5.2 Push a feature branch and verify on its preview: the build log shows the pin check passing with no warnings, the River plays generatively, and `vercel curl` on `/pieces/the-river-forgets-to-answer/manifest.json` shows `"engine": { "trace": 1, "render": 1 }`. Then merge into `develop` and `master`, and confirm the production manifest carries the pin.

## Workflow follow-up

- Archive the change with `/opsx:archive` once every task is done.
