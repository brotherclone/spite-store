# Proposal

## Why

A seed permalink is meant to name one performance forever. The engine pin protects that promise against engine changes, but nothing protects it against changes to the piece itself. Editing a gain, a weight or a take in a manifest silently changes what every shared `?seed=` link plays. That is fine while nothing is finished. But before any piece can ship as music someone can link to, and before tracks (fixed, named performances, see `track-pages`) can point at anything stable, a piece needs versions that can't change once frozen.

## What Changes

- **Frozen versions are content-addressed.** A version is a manifest identified by the sha256 of its exact bytes, in the same way stems are. Freezing a piece stores that manifest in the public store as `<hex>.json`, next to the stems and fallbacks, and it is never replaced or deleted. Further edits to the working manifest don't touch it, and freezing again makes a new version. There is no "frozen" flag to enforce: immutability comes from the storage.
- **`spite freeze <manifest> [--label <l>]`** validates the manifest, requires an engine pin that matches the running engine, and verifies every referenced stem and the fallback locally. It then uploads whatever the store lacks (stems, fallback and the manifest itself) and appends the version to the piece's committed version list, `pieces/<id>/versions.json`. Every version gets a label: `v1`, `v2` and so on unless `--label` names one. Labels are never reused or changed. Freezing the same bytes again records nothing new.
- **`spite freeze --check <base-url> <manifest...>`** checks that every recorded version's manifest, stems and fallback are reachable in the store, and that the manifest's bytes match its hash.
- **Version-pinned links.** The site accepts `?piece=<id>&version=<label or hash>` and loads that exact manifest after checking its hash. Once a piece has a frozen version, a link without `version` plays the **latest frozen version** rather than the working manifest, and `version=working` plays the working manifest on purpose (for previews). The permalink the page writes always names the version it is playing, by label, so a link copied today keeps playing the same performance after the next freeze.
- **Unfrozen pieces behave as today.** A piece with no frozen versions keeps playing its working manifest from `/pieces/<id>/manifest.json`, and its links carry no version.
- **The identity of a performance** becomes (version, seed, bars), where the version together with its engine pin fixes the rules. The engine, trace and render formats are unchanged.
- **Deployment** emits each piece's `versions.json`, serves frozen manifests through the existing `/stems/` rewrite (already immutable-cached), and runs `spite freeze --check` so that a build whose recorded versions aren't reachable fails.

## Capabilities

### New Capabilities

- `piece-versioning`: freezing a piece into an immutable, content-addressed version; the committed version list and labels; the `spite freeze` command, its checks and its `--check` mode; resolving a version reference (hash, label, `working` or latest) to a manifest.

### Modified Capabilities

- `stem-publishing`: the store also holds frozen manifests, as `<hex>.json` with content type `application/json`, under the same public, never-replace rules.
- `player-site`: a `version` parameter selects a frozen version; an unversioned link plays the latest frozen version when one exists; seed permalinks the page writes name the version; the dev server serves frozen manifests from `.stems/`.
- `site-deployment`: the build emits each piece's version list, the default piece resolves to its latest frozen version, and the deploy check covers every recorded version.

## Impact

- **CLI:** a new `freeze` command (with `--check`). It reuses publish's local verification and idempotent upload; `publish` itself is unchanged.
- **Pieces:** a piece directory gains `versions.json` the first time it is frozen.
- **Site:** `site/src/url.ts` and `main.ts` resolve versions and verify the frozen manifest's hash; `site/dev-serve.ts` serves `/stems/<hex>.json`; `site/vite.config.ts` emits `versions.json`.
- **Hosting:** `scripts/deploy-check.mjs` runs `spite freeze --check`. `vercel.json` is unchanged: frozen manifests travel through the existing `/stems/:file` rewrite and its immutable cache headers, and `versions.json` falls under the existing five-minute rule for `/pieces/`.
- **Determinism:** no engine change. The version hash only selects which manifest is realized; the same (version, seed, bars) gives the same trace as before. The hash covers the manifest's exact bytes, so reformatting a manifest and freezing it again makes a new version (see design).
- **Unchanged:** the engine, `<spite-player>` (a version is just a different `src`), the manifest schema, `TRACE_FORMAT`, `RENDER_FORMAT`, and the golden snapshots.

## Out of Scope

- **Freezing The River.** It isn't finished music. It is frozen once it is ready, after `slot-pan` at the earliest, and that freeze is a release decision, not part of this change.
- **Tracks, track pages and downloads.** See `track-pages`, which depends on this change.
- **Accounts, roles and permissions.** For now the originator is whoever holds the repo and the store credential.
- **Unfreezing, deleting or replacing a version**, and redirecting old versions to new ones.
- **Diffs or changelogs between versions** shown to listeners.
- **Listener-chosen versions in the UI** (a version picker). Versions are reached by link.
- **Migrating existing unversioned seed links.** They keep resolving through the unversioned rule above.
