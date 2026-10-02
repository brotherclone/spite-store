# @spite-store/cli

The `spite` command. For now it validates manifests; `audition`, `bounce` and `pack` are stubs.

## Running it

Build first, then run it through pnpm from anywhere in the workspace:

```sh
pnpm build
pnpm exec spite validate schema/examples/valid/minimal.json          # from the repo root
pnpm --filter @spite-store/cli exec spite validate ../../schema/examples/valid/minimal.json
```

`--filter … exec` runs inside `packages/cli`, so paths are relative to that directory.

## `spite validate <manifest.json...>`

Each file is checked in two layers:

1. **JSON Schema** (`@spite-store/schema`, Ajv draft 2020-12, all errors): structure, types,
   ranges, id and hash patterns, `specVersion`.
2. **Semantic rules** (`checkManifest()` from `@spite-store/engine`): unknown `start`, `to`, pool
   and `excludes` references, duplicate section or slot ids, tempo map starting at bar 0 with
   strictly increasing bars, all-zero pool weights, and envelope endpoints and ordering. This layer
   runs only when the schema passes, so it never reports on malformed structure.

Output, one line per file or per error:

```
schema/examples/valid/minimal.json  valid
schema/examples/invalid/dangling-transition.json  /sections/2/next/1/to  section "bridge" transitions to unknown section "coda"
```

The middle column is a JSON Pointer into the manifest (`(root)` for the document itself).
Unreadable or unparseable files are reported on stderr as `file  error: reason`.

| Exit code | Meaning                                                                                 |
| --------- | --------------------------------------------------------------------------------------- |
| 0         | Every file is valid                                                                     |
| 1         | At least one file is invalid                                                            |
| 2         | Usage error (no files, unknown command, stub command), or a file is missing or not JSON |

## Stubs

`spite audition`, `spite bounce` and `spite pack` print `not implemented yet` and exit 2.
