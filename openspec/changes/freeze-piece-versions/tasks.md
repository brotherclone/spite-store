# Tasks

## 1. Version list module

- [ ] 1.1 Add `packages/cli/src/versions.ts` with a pure `parseVersions(text)` (D4) that returns the ordered entries or every problem: invalid JSON, unknown fields, malformed hash or label, repeated hash or label, and the reserved `working` or 64-hex labels. Also add `nextLabel(entries)` (smallest `v<n>` above every existing `v<number>`) and `formatVersions(entries)` (two-space indent, trailing newline). Add shared fixtures under `packages/cli/test/fixtures/versions/{valid,invalid}/`. Verify with `versions.test.ts` covering every "Version list", "Version labels" and "Version list validity" scenario, plus `nextLabel` for `[]`, `[v1, v2]` and `[v1, first-light, v2]`.

## 2. Store: frozen manifests as stored files

- [ ] 2.1 In `packages/cli/src/publish.ts`, add `application/json` to `PublishFile.contentType` and the `.json` extension (D2), and add a helper that builds the `PublishFile` for a manifest's own bytes (`<hex>.json`, owner `manifest`). Verify with `publish.test.ts`: a fake store receives `<hex>.json` with content type `application/json`, a second upload run reports it as present ("Frozen manifest never replaced"), and the existing publish tests are unchanged.

## 3. `spite freeze`

- [ ] 3.1 Add `packages/cli/src/commands/freeze.ts` and register `freeze` in `bin.ts` and `USAGE`, with input checks in the D3 order: validate (exit 1), id vs directory name (exit 1), pin vs running engine with no `--ignore-pin` (exit 1), `--label` format and reserved names (exit 2), local stems and fallback via `readLocalFiles` (exit 2), credential (exit 2). Verify with `freeze.test.ts` for every "Freeze input checks" scenario, "Reserved label refused" and "No credential", each asserting that nothing is written to the stems dir or `versions.json` and that the fake store receives nothing.
- [ ] 3.2 Implement the freeze itself in D3 order: write `<stems>/<hex>.json`, upload the referenced files the store lacks, upload `<hex>.json`, then append to `versions.json` with the chosen or next label. Handle the idempotent and relabel cases. Verify with `freeze.test.ts` against a temporary piece directory and a fake store for "First freeze", "Automatic labels count up", "Chosen label", "Duplicate label refused", "Second freeze records nothing", "Relabelling refused" and "Upload fails" (a fake store that rejects one stem leaves `versions.json` byte-identical and exits 1).
- [ ] 3.3 Verify "Same version, same performance": a test freezes a copy of The River's manifest (or the placeholder's) into a temp stems dir, then realizes the stored `<hex>.json` and the original with seed `hello` for 64 bars and asserts equal `traceHash`. It also runs `spite bounce` on both (placeholder stems) and asserts byte-identical WAVs. Add a "Reformatting makes a new version" test that re-indents the manifest and freezes it again, giving two entries.

## 4. `spite freeze --check`

- [ ] 4.1 Add `--check <base-url>` to `freeze`: for each manifest's piece, read and validate `versions.json` (none counts as unfrozen and is skipped), `GET <base><hex>.json`, verify hash, validity and `id`, collect its files and run `checkReachable`. Warn on stranded pins without failing (D8). Exit 1 on any failure, otherwise 0. Verify with tests using an injected `fetch` for every "Freeze check" scenario, including "Stored bytes do not match" and "Stranded version warns".
- [ ] 4.2 Document `freeze` and `freeze --check` in `packages/cli/README.md`, and in the root README's "Releasing a piece" section say when to freeze (after `pin`, instead of a separate `publish` for that piece). Add a "Versions" paragraph to `pieces/README.md` explaining `versions.json`, that it is append-only, and `version=working`. Verify that the documented commands match `spite --help`, and that `pnpm format:check` passes.

## 5. Site: resolving and verifying versions

- [ ] 5.1 In `site/src/url.ts`, add the `version` parameter and a pure `resolveVersion(ref, versionsText | null)` (D5) that returns frozen `{ hex, label? }`, working, or an error, with its own small shape check of `versions.json` (D4). Verify with `site/test/url.test.ts` for every "Version resolution" scenario, using the CLI's `versions` fixtures for valid and invalid lists.
- [ ] 5.2 Make page loading asynchronous (D6). Fetch `versions.json` when needed (404 means unfrozen). For a frozen version, fetch `/stems/<hex>.json`, check its sha256 with `crypto.subtle` and its `id`, then set `src`, `seed` and `bars`, and set the title from the verified manifest. On an error, show it in the page and give the player no `src`. Keep the logic in testable functions with injected `fetch` and digest. Verify with `url.test.ts` for the "Placeholder piece page" version scenarios and both "Frozen manifest verified before playing" scenarios.
- [ ] 5.3 Extend `followPlayer` to write `version` on load and on `seedchange` (D7): the label (or the hash) for a frozen version, `working` for an explicit working copy, and no `version` for an unfrozen piece. Verify with `url.test.ts` for "Unversioned link gains its version", "Piece kept on reroll" and "URL follows the player" (history length unchanged).
- [ ] 5.4 In `site/dev-serve.ts`, serve `/stems/<hex>.json` from `.stems/` as `application/json`, with a 404 that mentions `spite freeze`. Verify with `site/test/dev-serve.test.ts` for "Frozen manifest served by hash" and "Missing frozen manifest", and check that the existing stem and fallback cases still pass.

## 6. Build and deployment

- [ ] 6.1 In `site/vite.config.ts`, have `pieceManifests` also emit `pieces/<id>/versions.json` byte for byte when present. Verify with `site/test/build.test.ts` for "Version list emitted" and "Nothing else from pieces".
- [ ] 6.2 In `scripts/deploy-check.mjs`, also run `spite freeze --check <base> <every piece manifest>` and fail the build on its failure. Verify with `site/test/deploy.test.ts` against a local server and a temp pieces dir, for "Unpublished version blocks the deploy", "Invalid version list blocks the deploy", and a frozen piece whose files are all present passing.
- [ ] 6.3 Verify "Frozen manifest cache headers" and "Version list cache headers" against `vercel.json` in `deploy.test.ts` (the existing `/stems/(.*)` and `/pieces/(.*)` rules must match `<hex>.json` and `versions.json`), with no change to `vercel.json`.

## 7. Integration

- [ ] 7.1 Freeze the placeholder into a scratch copy (a temp piece dir and stems dir, not `pieces/`), run the dev server against it, and check by hand in the browser: an unversioned link becomes `version=v1`; after a second freeze, the copied `v1` link still plays the same trace (the lanes match) while the unversioned link plays `v2`; `version=working` plays the working manifest; a tampered `<hex>.json` shows an error. Don't commit any `versions.json` to `pieces/`.
- [ ] 7.2 Run `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm format:check`, and verify that all pass with `git diff fixtures/golden` empty.

## Workflow follow-up

- Freezing The River for real is a release step for after `slot-pan` and once the piece is finished, not a task of this change.
- Archive the change with `/opsx:archive` once every task is done.
