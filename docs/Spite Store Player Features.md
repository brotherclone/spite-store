Spite Store · Player spec · draft 1

# The aleatoric player, feature by feature

Every feature the player could have, scored by how much it enables music that is different on each play. Each row lists the source formats it depends on. Click a column header to sort, or filter by format.

Aleatoric enablement

1. Indeterminacy can't exist without it
2. Major expressive range
3. Makes chance legible, ownable or shareable
4. Supports the ecosystem
5. Table stakes for any player

Source formats

1. AUD Fixed audio (FLAC / Opus master)
2. STM Stem and clip pools + rules
3. SYM Symbolic: MIDI / MusicXML + instruments
4. DSP Procedural patch or code (Faust, Csound, Pd, RNBO, Strudel → WASM)
5. NN Audio or symbolic model (RAVE, DDSP, codec-token LM; ONNX / WebGPU)
6. TXT Text or graphic score for human performers

Phase · Effort

1. MVP Needed to put out the first aleatoric release
2. v1 Needed for other artists to publish on it
3. v2 Platform / community layer
4. S · M · L Rough build cost for one developer

| # | Feature | Category | Enablement | Formats | Phase | Effort | Why it matters |
| --- | --- | --- | --- | --- | --- | --- | --- |

| Format | Unit of chance | Container | Browser runtime | Payload | CPU | Fidelity | Seed reproducible? | Authoring path | Prior art |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

## What the ranking says

The top tier is almost entirely about **determinism and structure**, not sound. A seeded PRNG, a sample-accurate scheduler, a rule graph and clip pools are what turn "random" into a composed indeterminate work that can be named, shared and owned. Get those right and every format can plug in later.

**Recommended manifest:** STM + SYM + DSP as first-class layers, NN as an optional layer, AUD as a mandatory fallback. Stems give studio-grade fidelity with low CPU. Symbolic gives note-level chance at tiny size. Procedural gives unlimited range. All three can be bit-identical per seed.

**The NN caveat.** Neural inference is not bit-reproducible across GPUs and drivers. Floating-point reduction order varies, so the same seed can drift audibly on WebGPU. Options: run models on a pinned CPU/WASM int8 path for "canonical" seeds; label NN layers as "approximate seeds"; or render NN material ahead of time into stem pools, which gives model-made timbre with stem-level determinism. The last option is probably the right default for v1.

**Seeking is the hidden hard problem.** A generative stream has no timeline to scrub. To jump to 14:00 you must either fast-simulate the rule state (cheap for STM/SYM, expensive for DSP/NN) or store checkpoints. Design the scheduler around serializable state from day one.

**MVP cut (≈ 13 features):** seeded PRNG, deterministic scheduler, seed permalinks, clip pools, rule graph, layer probabilities, bar-quantized transitions, manifest + runtime pinning, streaming asset loads, live structure view, multi-seed audition for the author, graceful ending, AUD fallback. That's enough to release one White track as an aleatoric "repo" on your own site.