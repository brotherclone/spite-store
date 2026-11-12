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
| `pnpm test:browser`      | Build, then run the player's real-browser tests (see below)            |
| `pnpm lint`              | ESLint, including the engine's determinism restrictions                |
| `pnpm typecheck`         | `tsc` in every package                                                 |
| `pnpm format`            | Prettier, writing changes (`pnpm format:check` to only check)          |
| `pnpm golden:update`     | Regenerate golden trace and audio snapshots on purpose                 |
| `pnpm stems:placeholder` | Synthesize the placeholder stems into `.stems/` and check their hashes |

`pnpm --filter site build` builds the production site into `site/dist`, with every piece's manifest
under `/pieces/` (stems are served from the stem store; see [Releasing a piece](#releasing-a-piece)).

## Hearing a piece

Audio is never committed. The placeholder piece's stems can be synthesized:

```sh
pnpm build
pnpm stems:placeholder                                       # writes .stems/<sha256>.wav
pnpm exec spite audition pieces/placeholder/manifest.json    # 4 seeds, 16 bars each, via afplay
```

The first recorded piece, _The River Forgets to Answer_, needs its source recordings, which live
outside the repo. `spite pack` cuts them into stems (see `pieces/the-river-forgets-to-answer/`):

```sh
pnpm exec spite pack pieces/the-river-forgets-to-answer/manifest.json --source "<…>/Collaborations"
pnpm exec spite audition pieces/the-river-forgets-to-answer/manifest.json --bars 64
```

See `packages/cli/README.md` for `realize`, `bounce`, `audition` and `pack`.

In the browser, the site serves a piece with `<spite-player>` (the placeholder unless `?piece=` names
another):

```sh
pnpm build
pnpm stems:placeholder
pnpm --filter site dev     # then open http://localhost:5173/?seed=hello&bars=16
                           # or /?piece=the-river-forgets-to-answer&seed=hello
```

The URL is a permalink: the same `piece`, `seed` and `bars` always play the same performance. See
`packages/player/README.md` for embedding the player elsewhere.

## Releasing a piece

The production site is a static build on Vercel. Stems and fallback recordings live in a public
Vercel Blob store, by content hash, and `/stems/*` on the site is served from there. Audio never
goes through git, so publishing it is a step on your machine:

```sh
vercel env pull .env.local     # once: writes BLOB_READ_WRITE_TOKEN (git-ignored)
pnpm build
pnpm stems:placeholder         # and spite pack for each recorded piece
pnpm exec spite fallback pieces/<id>/manifest.json --seed <seed> --update   # needs ffmpeg
pnpm exec spite pin pieces/<id>/manifest.json --update                     # once, on first release
node --env-file=.env.local packages/cli/bin/spite.js publish pieces/*/manifest.json
```

In development (`pnpm --filter site dev`) the page opens on the placeholder; production builds open
on the piece named in `site/.env.production`. `spite publish` uploads only what the store lacks and
never replaces a file. Commit the manifest
change and push: every branch gets a preview deployment, and `master` is production. The build
runs `spite publish --check`, so it fails rather than deploy a manifest whose stems aren't in the
store, and it refuses a piece that isn't pinned to engine formats (`spite pin`), so a shared seed
link never quietly plays a different performance. See `packages/cli/README.md` for `fallback`,
`publish` and `pin`.

## Browser tests

`pnpm test:browser` checks, in headless Chromium, Firefox and WebKit, that the player's audio is
bit-identical to the Node renderer and that the element behaves as specified. It is kept out of
`pnpm test`. Run this once first (about 500 MB of browser downloads):

```sh
pnpm exec playwright install chromium firefox webkit
```

## Layout

```
schema/            Music manifest JSON Schema (v0.1), examples/{valid,invalid}, CHANGELOG
packages/engine    Pure TypeScript realization engine: no DOM, zero runtime dependencies
packages/player    <spite-player> web component (AudioWorklet + canvas lanes view)
packages/cli       `spite` CLI: validate, realize, bounce, audition, pack, fallback, publish
fixtures/golden/   Golden trace snapshots
pieces/            Authored pieces (manifests and pack files only); pieces/placeholder for development
site/              Vite page for any piece, with seed permalinks; site/.env.production sets its default
scripts/           Golden updates, placeholder stems, and the deploy build's stem check
vercel.json        Hosting: build command, /stems/ rewrite to the stem store, cache headers
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
