# The River Forgets to Answer

From the White album (`white-nine-windows-no-interval`). The first recorded piece: a string
quartet whose four players each choose between three recorded variations of one phrase on every
pass.

## Source recordings

The recordings are cleared for publishing, but the audio is never committed. It comes from the track's
Logic project folder, under `Collaborations/`: eight mono 48 kHz 24-bit WAVs, violin 1, violin 2,
viola and cello, each on a close and a room mic (`Maria/<Instrument> close.wav`,
`Maria/<Instrument> room.wav`).

Each file is 15 bars at 63 BPM in 7/8 (160,000 frames per bar). It holds three takes, each a 4-bar
variation of the same phrase followed by its ring-out and silence, starting at bars 0, 5 and 10.
The takes line up across all eight files.

## Packing

`pack.json` cuts each take as a 5-bar range: the 4-bar phrase is the clip's body, and the fifth bar
(the ring-out) is its tail. Paths are relative to the `Collaborations` folder:

```sh
pnpm build
pnpm exec spite pack pieces/the-river-forgets-to-answer/manifest.json \
  --source "<…>/White/Tracks/white-nine-windows-no-interval/The River Forgets to Answer (green_the_river_forgets_to_answer_v1)/Collaborations"
```

This writes 24 stems to `.stems/` and checks them against the manifest. If a recording is
re-exported or a range changes, rerun with `--update`, then `pnpm golden:update`.

## How it plays

- Each instrument has two slots, `<instrument>-close` and `<instrument>-room`, and each slot picks
  one of its three variations for every 4-bar `phrase`. Instruments choose independently, so
  violin 1 can play take 1 against cello take 3.
- The mics enter independently, so either one can play alone. When both play, they are on the same
  take. Each room clip excludes the close clips of the other two takes, and because `close` sorts
  before `room`, the close slot picks first and the room slot follows it. Keep that slot naming,
  and don't give room slots a `noRepeat`, or the lock can break (see `packages/cli/test/river.test.ts`).
- `phrase` repeats (weight 2) or takes a 1-bar `breath` (weight 1), which lets the ring-out sound
  through. After 8 phrases the piece ends, so a performance lasts at most 40 bars (about 2 minutes).

## Mix

| Slot  | enter | gain | noRepeat |
| ----- | ----- | ---- | -------- |
| close | 0.8   | 0.5  | 1        |
| room  | 0.5   | 0.4  | –        |

Peak check (seeds 0–19 bounced for 64 bars): loudest peak −3.4 dBFS, no clipped samples.
Everything is mono and centred, because the manifest schema has no panning yet.

## Fallback and publishing

The fallback recording, for browsers that can't play the piece generatively, is seed `spite-store`
for 64 bars (about 2 minutes, 4 MB as MP3). After packing, and again whenever the stems or the mix
change:

```sh
pnpm exec spite fallback pieces/the-river-forgets-to-answer/manifest.json --seed spite-store --update
node --env-file=.env.local packages/cli/bin/spite.js publish pieces/the-river-forgets-to-answer/manifest.json
```

`spite fallback` needs `ffmpeg`. Without `--update` it only checks that the recorded fallback is
current. Publish uploads the 24 stems and the fallback to the stem store before the manifest change
is pushed (see the root README, "Releasing a piece").
