# Spec Delta

## ADDED Requirements

### Requirement: Slot pan field
A slot MAY declare `pan`, its position in the stereo field: either a number in [-1, 1], where −1 is hard left, 0 is centre and 1 is hard right, or an object with exactly the fields `min` and `max`, both in [-1, 1] with `min ≤ max`. A slot without `pan` is centred. `specVersion` SHALL stay `"0.1"`, and every manifest without `pan` SHALL stay valid.

#### Scenario: Fixed pan accepted
- **WHEN** a manifest that is otherwise valid gives a slot `"pan": -0.6`
- **THEN** validation passes

#### Scenario: Pan range accepted
- **WHEN** a manifest that is otherwise valid gives a slot `"pan": { "min": -0.5, "max": 0.25 }`
- **THEN** validation passes

#### Scenario: Pan out of range rejected
- **WHEN** a slot's `pan` is `1.5`, `"left"`, or `{ "min": -2, "max": 0 }`
- **THEN** validation fails and reports a JSON Pointer to that slot's `pan`

#### Scenario: Inverted range rejected
- **WHEN** a slot's `pan` is `{ "min": 0.5, "max": -0.5 }`
- **THEN** validation fails, reports that slot's `pan`, and says `min` must not exceed `max`

#### Scenario: Unknown range field rejected
- **WHEN** a slot's `pan` is `{ "min": 0, "max": 1, "step": 0.1 }`
- **THEN** validation fails and reports that slot's `pan`

#### Scenario: Engine and schema agree
- **WHEN** each new valid and invalid pan example under `schema/examples/` is checked by the JSON Schema and by the engine's own structural check
- **THEN** both accept every valid example, the engine rejects every invalid one, and the JSON Schema rejects every invalid one except the inverted range, which a JSON Schema cannot express

### Requirement: Unknown slot properties rejected
The engine's own structural check SHALL reject a slot with a property other than `id`, `enter`, `gain`, `noRepeat`, `pool` and `pan`, as the JSON Schema does, so that an engine never silently ignores a slot field it doesn't know.

#### Scenario: Misspelt slot field
- **WHEN** a manifest that is otherwise valid gives a slot `"pann": 0.5`, and it is checked by the engine without the JSON Schema
- **THEN** the check fails with a JSON Pointer to that slot and a message naming `pann`

#### Scenario: Existing manifests still pass
- **WHEN** every manifest under `schema/examples/valid/` and `pieces/` is checked by the engine
- **THEN** each passes
