# Spite Store

A platform for aleatoric music: pieces are published as a manifest plus audio stems, and every
listen is a seeded, reproducible performance. The same manifest and seed produce the same event
trace on any device.

## Setup

Requires Node 24 (LTS) and pnpm 10 via Corepack. `engine-strict` refuses installs on any other
Node major.

```sh
nvm use            # reads .nvmrc (24)
corepack enable    # provides the pinned pnpm
pnpm install
```

Common scripts, all run from the repo root:

| Script                   | What it does                                                           |
| ------------------------ | ---------------------------------------------------------------------- |
| `pnpm build`             | Build `packages/*` (engine, player, cli) into `dist/`                  |
| `pnpm test`              | Run all Vitest projects (build first: some tests use `dist/`)          |
| `pnpm lint`              | ESLint, including the engine's determinism restrictions                |
| `pnpm typecheck`         | `tsc` in every package                                                 |
| `pnpm format`            | Prettier, writing changes (`pnpm format:check` to only check)          |
| `pnpm golden:update`     | Regenerate golden trace and audio snapshots on purpose                 |
| `pnpm stems:placeholder` | Synthesize the placeholder stems into `.stems/` and check their hashes |

`pnpm --filter site build` builds the site stub.

## Hearing a piece

There is no real audio in the repo yet, but the placeholder piece's stems can be synthesized:

```sh
pnpm build
pnpm stems:placeholder                                       # writes .stems/<sha256>.wav
pnpm exec spite audition pieces/placeholder/manifest.json    # 4 seeds, 16 bars each, via afplay
```

See `packages/cli/README.md` for `realize`, `bounce` and `audition`.

## Layout

```
schema/            Music manifest JSON Schema (v0.1), examples/{valid,invalid}, CHANGELOG
packages/engine    Pure TypeScript realization engine: no DOM, zero runtime dependencies
packages/player    <spite-player> web component (stub)
packages/cli       `spite` CLI: validate (audition / bounce / pack are stubs)
fixtures/golden/   Golden trace snapshots
pieces/            Authored pieces (manifests only); pieces/placeholder for development
site/              Vite site (stub)
openspec/          Behavioral specs and change proposals (OpenSpec)
```

## Notes

- **No audio in git.** Manifests reference stems by `sha256:` content hash, and `.gitignore`
  excludes audio extensions. Never commit `.wav`, `.flac`, `.mp3` and friends.
- **`schema/` is not `openspec/specs/`.** `schema/manifest.schema.json` is the product's data
  format, the file authors write against. `openspec/specs/` holds the behavioral requirements for
  the codebase itself.
- **Determinism is the core promise.** The engine bans `Math.random`, `Date`, locale APIs and
  transcendental `Math.*` (see `packages/engine/README.md`).
