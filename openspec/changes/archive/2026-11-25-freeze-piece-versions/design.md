# Design

## Context

See `proposal.md` for why. The current state that shapes the approach:

- **The store is already content-addressed and append-only.** `packages/cli/src/publish.ts` models every stored file as `{ name, hash, owners, contentType }`, verifies local bytes against their hash (`readLocalFiles`), uploads only what the store lacks (`uploadMissing`, with `allowOverwrite: false`), and checks reachability with `HEAD` requests (`checkReachable`). It stores everything under one `stems/` prefix, and that prefix already holds non-stem files (MP3 fallbacks).
- **Hosting has one rewrite.** `vercel.json` maps `/stems/:file` to the store, and caches `/stems/(.*)` as immutable for a year and `/pieces/(.*)` for five minutes. `scripts/deploy-check.mjs` reads the store base from that rewrite and shells out to `spite publish --check`.
- **The site is two small files.** `site/src/url.ts` turns `?piece=` into a manifest URL synchronously and sets player attributes; `main.ts` wires it up and fetches the manifest again for its title. `followPlayer` rewrites `seed` and `bars` on `seedchange`.
- **The player only takes a `src` URL.** It never knows whether the manifest is frozen, and it needs no change.

## Goals / Non-Goals

**Goals:**
- Reuse the publish machinery for freezing rather than building a second upload path.
- Keep `vercel.json`, the engine and `<spite-player>` unchanged.
- Make version resolution one pure function that the site and the CLI's `--check` agree on.

**Non-Goals:**
- A JSON Schema for `versions.json` in `schema/`. The file is written by `spite freeze`, never by hand, so it is validated in the CLI and the site (see Decisions).
- Checking `versions.json` against git history to prove that no entry was removed.

## Decisions

### 1. A version is the hash of the manifest's exact bytes, not of a canonical form
**Determinism:** this decides what "the same version" means. The engine parses the manifest bytes into the same object whatever their formatting, so either choice keeps traces identical for identical bytes, and no decision path is touched. Hashing raw bytes matches how stems are addressed, matches the site build (which emits manifests "byte for byte"), and lets anyone check a version with `shasum -a 256`. Hashing a canonical form (sorted keys, no whitespace) would make reformatting free, but it needs a canonicalizer that agrees in Node and every browser, and the stored bytes would no longer be the authored file.
**Alternative rejected:** canonical JSON hashing. Reformatting a manifest and then freezing it is rare and deliberate, so a spurious new version is a small price.

### 2. Frozen manifests live in the stem store as `<hex>.json`
Extending `PublishFile.contentType` with `application/json` lets `readLocalFiles`, `uploadMissing` and `checkReachable` handle the manifest file unchanged. It travels through the existing `/stems/:file` rewrite and gets the existing immutable cache header, so `vercel.json` doesn't change.
**Alternative rejected:** a separate `manifests/` prefix and `/manifests/:file` rewrite. It's cleaner in name, but it needs a second rewrite, a second cache rule and a second base URL in the deploy check, for no change in behaviour. The `stems/` name is now slightly wrong; that is accepted.

### 3. `spite freeze` uploads in dependency order and records last
Order: validate, check the id against the directory and check the pin, verify local files, check the credential (exit codes as in the spec). Then write `.stems/<hex>.json`, upload the referenced stems and fallback (missing ones only), upload `<hex>.json`, and append to `versions.json` last. A crash at any point leaves either nothing recorded or a complete version. A manifest in the store that is never recorded is harmless: it is reachable by hash, as any other unrecorded file would be.
`freeze` uploads the stems itself, rather than requiring `spite publish` to have run first, so that freezing is one step and can't record a version whose stems are missing.

### 4. `versions.json` shape and labels
```json
{ "versions": [ { "hash": "sha256:<hex>", "label": "v1" } ] }
```
The list is ordered oldest first and appended to only, and the last entry is the latest. No dates: freezing order is enough, and a timestamp would make the file depend on the clock. Automatic labels are `v<n>` with the smallest `n` above every existing `v<number>` label, so a custom label in between doesn't cause a clash. Labels are restricted so they can't be mistaken for a hash or for `working`. The file is written with two-space indentation and a trailing newline, like the other committed JSON.
Validation lives in one CLI module, `versions.ts`, with a pure `parseVersions(text)` that returns entries or problems. The site has its own small copy of the shape check, because it can't import the CLI. Both are tested against the same fixture files.

### 5. Resolution is a pure function shared in spirit, separate in code
`resolveVersion(ref, versions)` returns `{ kind: 'frozen', hex, label? } | { kind: 'working' } | { kind: 'error', message }`. In the site it lives in `url.ts`, beside `manifestUrl`, so it is tested in Node like the rest of the page logic. The CLI's `--check` doesn't need label resolution: it walks every recorded entry.

### 6. The page becomes asynchronous before setting `src`
Today `applyQuery` sets `src` synchronously. With versions, the page first fetches `/pieces/<id>/versions.json` (a 404 means unfrozen, which isn't an error) unless the reference is a hash or `working`. It resolves the version, then for a frozen version fetches `/stems/<hex>.json`, hashes it with `crypto.subtle.digest('SHA-256')`, checks `id`, and only then sets `src`. That URL is now in the browser's immutable cache, so the player's own fetch costs nothing. The title comes from the verified manifest rather than a second fetch. When `<hex>` is reached by hash, `versions.json` is still fetched, but only to find a label to show; failing to fetch it doesn't block playback.
**Determinism:** this only chooses which bytes become `src`. Seed, bars and the realization path are untouched. Verifying the hash is what makes "this link plays version X" true even if the store or the CDN misbehaves.
**Alternative rejected:** passing `<id>@<ref>` in `piece`. `URLSearchParams` writes `@` as `%40`, which makes permalinks ugly.

### 7. Permalinks name the version by label
`followPlayer` also sets `version` to the label of the version being played (the hash when it has no recorded label; `working` for an intentional working-copy preview) and removes it for unfrozen pieces. It does this on load as well as on `seedchange`, so an unversioned link is rewritten to a versioned one immediately. Labels are never reused or changed (spec), so a label link is as stable as a hash link and much shorter.

### 8. Deploy check
`scripts/deploy-check.mjs` keeps its pin and stem checks for working manifests and adds `spite freeze --check <base> <every piece manifest>`. The check fetches each recorded `<hex>.json` with `GET` (not `HEAD`), because it needs the bytes to verify the hash and to collect the files the version references, which it then checks with the existing `checkReachable`. Unfrozen pieces are skipped. A stranded version (pinned to other formats) warns but doesn't fail, matching the existing rule for working manifests.

## Risks / Trade-offs

- [Someone hand-edits `versions.json` and removes or relabels an entry] → Label links to that version break (hash links still work). Mitigation: the README and the file's only writer, `spite freeze`, are append-only; code review catches diffs to `versions.json` that aren't appends. Proving it against git history is out of scope.
- [The store is lost or the token leaks] → Same exposure as stems today; frozen manifests add no new credential.
- [Deploy time grows with every version: each deploy re-fetches every frozen manifest and checks its stems] → A handful of pieces with a few versions each means tens of requests. If it ever matters, the check can skip versions already verified by an earlier deploy.
- [An engine format bump strands every frozen version] → As today: the player plays the version's fallback. Re-pinning means a new freeze, a new label and a new performance. Old label links keep playing the fallback of their version, which is the honest outcome.
- [`version=working` in production exposes unfinished edits] → It always did: `/pieces/<id>/manifest.json` is public. The parameter only makes it reachable from the page on purpose.

## Migration Plan

No migration: every existing piece is unfrozen and behaves exactly as today, and existing links keep working. Rollback means reverting the code. Any `versions.json` already committed would then be emitted to nobody, and the stored `<hex>.json` files stay harmless in the store.
