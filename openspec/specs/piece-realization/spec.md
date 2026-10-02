# piece-realization Specification

## Purpose

Turns a valid manifest and a seed into a concrete, reproducible performance: an ordered event trace that says which clip starts in which slot at which bar. This is the contract that makes a shared seed mean the same piece everywhere.

## Requirements

### Requirement: Realization produces an event trace
Realizing a valid manifest with a seed and a positive integer `durationBars` SHALL produce an ordered list of events `{ bar, beat, slot, clipHash, gain }`. `bar` is a zero-based integer below `durationBars`. In this version `beat` is always 0. `slot` is the slot id, `clipHash` the clip's content hash, and `gain` the clip gain multiplied by the slot gain. Events SHALL be ordered by bar, then by slot id in code-unit order.

#### Scenario: Shape of the minimal trace
- **WHEN** `schema/examples/valid/minimal.json` is realized with seed `0` for 16 bars
- **THEN** every event has exactly the fields bar, beat, slot, clipHash and gain, with `0 ≤ bar < 16` and `beat = 0`, and events are sorted by (bar, slot)

#### Scenario: Invalid manifest refused
- **WHEN** realization is requested for a manifest that fails validation, or with `durationBars` of 0 or a non-integer
- **THEN** an error is raised and no trace is returned

### Requirement: Same seed, identical trace
Realizing the same manifest with the same seed and options SHALL produce an identical trace every time, on every supported runtime. Realization SHALL be a pure function with no I/O, no ambient randomness or time, and no dependence on object key insertion order.

#### Scenario: Repeated realization
- **WHEN** `minimal.json` is realized 100 times with seed `"spite"` for 64 bars
- **THEN** all 100 traces have the same canonical hash

#### Scenario: Key order is irrelevant
- **WHEN** the same manifest is realized once as written and once with every object's keys reordered
- **THEN** the two traces are identical

#### Scenario: Runs without a DOM
- **WHEN** the engine is loaded and run in a JavaScript context that provides only standard ECMAScript globals (no DOM, no Node built-ins)
- **THEN** realization succeeds and produces the same trace hash as in Node

### Requirement: Different seeds diverge
Different seeds SHALL produce different performances for any manifest that has more than one possible outcome.

#### Scenario: Seeds diverge on the minimal piece
- **WHEN** `minimal.json` is realized for 64 bars with seeds `0` through `19`
- **THEN** at least 15 of the 20 traces are distinct

### Requirement: Decision-path stability
Each random decision SHALL be keyed by the stable ids of the things it concerns (section visit ordinal, section id, slot id, and the ordinal of the pick within that slot's visit), never by declaration position. Adding manifest elements that no existing decision consults SHALL leave the existing events unchanged.

#### Scenario: Adding an unreachable section
- **WHEN** a new section with no incoming transitions is added to `minimal.json`, and both versions are realized with the same seed and duration
- **THEN** the traces are identical

#### Scenario: Adding a slot leaves other slots alone
- **WHEN** a new slot with its own new clips (no exclusions involving existing clips) is added to one section, and both versions are realized with the same seed and duration
- **THEN** removing the new slot's events from the new trace yields exactly the original trace

#### Scenario: Reordering declarations
- **WHEN** the order of sections in the manifest, slots within a section, or clips in the catalogue is changed
- **THEN** the trace is unchanged

### Requirement: Section traversal
Realization SHALL begin at the `start` section at bar 0 and play each section visit for that section's `lengthBars`. At the end of a visit it SHALL pick the next section from the current section's transitions by weight. A transition SHALL be ineligible when its weight is 0 or its target has reached `maxVisits`. If no transition is eligible, the piece SHALL end there, even if that is before `durationBars`. Realization SHALL stop at `durationBars`.

#### Scenario: Max visits respected
- **WHEN** a manifest has a single 4-bar section with `maxVisits: 2` and one transition to itself, and it is realized for 100 bars
- **THEN** every event has `bar < 8`

#### Scenario: Trace truncated at duration
- **WHEN** a piece whose graph never terminates is realized for 10 bars
- **THEN** no event has `bar ≥ 10`

### Requirement: Slot entry
At the start of each section visit, each slot in that section SHALL enter with its entry probability, multiplied by the form envelope value when an envelope is present. A slot that does not enter SHALL be silent for that whole visit. A slot that enters SHALL pick a clip at the visit's first bar, and again each time its current clip ends within the visit.

#### Scenario: Entry probability 0
- **WHEN** a slot has entry probability 0
- **THEN** it produces no events under any seed

#### Scenario: Entry probability 1
- **WHEN** a slot has entry probability 1 and the manifest has no envelope
- **THEN** it produces an event at the first bar of every visit to its section

### Requirement: Clips stay inside section visits
A slot SHALL only pick clips whose `lengthBars` fits in the bars remaining in the current section visit. If no pool clip fits, the slot SHALL rest until the visit ends.

#### Scenario: Long clip near the section end
- **WHEN** a slot's pool has a 4-bar clip and a 1-bar clip, and 2 bars remain in the visit
- **THEN** the slot picks only the 1-bar clip at that point

### Requirement: No-repeat window
A slot with `noRepeat: n` SHALL NOT pick a clip that was among that slot id's previous `n` picks, counted across section visits. If the window removes every candidate, the window SHALL be shortened until at least one candidate remains.

#### Scenario: No immediate repeats
- **WHEN** a slot with `noRepeat: 1` and a pool of two equally weighted clips is realized for 200 picks
- **THEN** no two consecutive picks in that slot are the same clip

#### Scenario: Window larger than pool
- **WHEN** a slot has `noRepeat: 5` and a pool of 2 clips
- **THEN** realization succeeds and the slot alternates between the two clips

### Requirement: Clip exclusions
Exclusions SHALL be symmetric: if clip A excludes clip B, B also excludes A. At a pick, a clip SHALL be ineligible when a clip it excludes is sounding in any slot at that bar, including clips picked at that same bar by slots earlier in slot-id order. If exclusions remove every candidate, the slot SHALL rest for one bar and then pick again.

#### Scenario: Excluded clips never overlap
- **WHEN** clip `a` excludes clip `b`, they sit in different slots of the same section, and the piece is realized with 50 different seeds
- **THEN** in no trace is `a` sounding during any bar in which `b` is sounding

### Requirement: Form envelope
When a manifest has a form envelope, its value at the start of a section visit SHALL be the piecewise-linear interpolation at progress `visitStartBar / durationBars`. When there is no envelope, a trace for a shorter duration SHALL be an exact prefix of the trace for a longer one with the same seed.

#### Scenario: Prefix stability without an envelope
- **WHEN** `minimal.json` (which has no envelope) is realized with the same seed for 32 bars and for 64 bars
- **THEN** the 32-bar trace equals the events of the 64-bar trace with `bar < 32`

#### Scenario: Envelope silences slots
- **WHEN** an envelope's value is 0 across its whole range
- **THEN** the trace is empty

### Requirement: Serializable, resumable realization state
Realization state SHALL be a plain JSON-serializable value. Resuming from a state that has been through a JSON round trip SHALL produce exactly the same events as continuing without serialization.

#### Scenario: Chunked realization equals one-shot
- **WHEN** `minimal.json` is realized with seed `42` in four 16-bar chunks, with the state put through `JSON.stringify` and `JSON.parse` between chunks
- **THEN** the concatenated events equal the one-shot 64-bar trace

### Requirement: Golden trace snapshots
The repository SHALL hold golden snapshots in `fixtures/golden/` for `schema/examples/valid/minimal.json` at 64 bars with seeds `0`, `42` and `"spite-store"`. Each snapshot SHALL record the seed, duration, canonical trace hash (sha256 of the canonical JSON) and the trace itself. A changed trace SHALL fail the test suite until the snapshot is regenerated on purpose.

#### Scenario: Snapshots match
- **WHEN** the test suite runs
- **THEN** each of the three realizations hashes to the value recorded in its golden snapshot

#### Scenario: Drift detected
- **WHEN** an engine change alters any event for one of the golden seeds
- **THEN** the golden test fails and names the seed and the first differing event
