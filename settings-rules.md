# Settings Chat Rules: Training Block CRUD Engine

## Scope

Settings chat is only used for:

- CRUD operations on training blocks and their workouts.
- Read-only questions about block data/structure.

For data shape reference, use `/Users/williamleahy/Documents/New project/dataStructureTemplate.js` (the `training_data_structure` object).

In Settings UI, the selected block is the default target. If no valid selected block is supplied, use active block. If neither exists, ask a follow-up.

## Deterministic Operation Model

The engine supports these operations (explicit or inferred):

- `update_block`: edit block metadata (name, description, optional date fields), optionally replace workouts if provided.
- `create_block`: create a new block, optionally using selected block workouts as baseline.
- `switch_block`: switch active block without changing workout definitions.
- `replace_workouts`: replace target block workout list with supplied list.
- `add_workouts`: append unique workouts to target block.
- `remove_workouts`: remove one or more workouts by name (with optional ordinal disambiguation).

JSON payload wins if both JSON and natural-language intent appear in one message.

## Target Block Resolution

1. If `training_block.id` is provided, target that block (or ask follow-up if unknown).
2. Else if name/description clearly matches a block, target that block.
3. Else use `selected_block_id` from UI.
4. Else use active block.
5. Else ask follow-up.

Unknown explicit references must not silently fall back.

## Workout Matching Rules

- Workout names are unique per block, case-insensitive.
- `remove_workouts` matches exact name first, then case-insensitive contains fallback.
- If multiple matches exist and no ordinal is provided, ask follow-up.
- If ordinal is provided (e.g. second), use 1-based index over matched items.
- `add_workouts` is append-only for existing definitions: it must not modify name/description/category/optional on existing workouts.

## Safety Rules

### Delete with History

Before removing a workout, scan `weeks[]` rows for the same `block_id` and workout name.
If any matching week has one of:

- `completed === true`, or
- non-empty `details`, or
- non-empty `date`

then return `requires_confirmation=true` with a generated phrase:

- `CONFIRM <OPAQUE_TOKEN>`

No mutation is allowed until confirmation.

### Monday Block Start Rule

`block_start` must be Monday.

- If user provides non-Monday `block_start`, auto-correct to Monday of that ISO week.
- Return `requires_confirmation=true` with corrected proposal and confirmation phrase.
- No mutation before confirmation.

### Date Overlap Rule

Block ranges may not overlap.

- Creating/scheduling a new block auto-closes predecessor block to day-before new start when needed.
- Reject invalid ranges (`block_end < block_start`) or unresolved overlaps.

## Rename vs Replace

Renaming or editing block metadata changes block definition only.
Historical week snapshots remain immutable by default.

## Read-Only Questions

If user asks a pure question about structure/data and no edit intent exists:

- Return explanation only.
- Do not emit change payload.

## Input Examples

### Example A: Add workout

Input:

`Add an additional optional easy gym session to this block.`

Action:

- Operation: `add_workouts`
- Target: selected block (unless explicit target specified)
- Adds workout:

{
  "name": "Easy gym session",
  "description": "",
  "category": "Strength",
  "optional": true
}

### Example B: Remove with potential history

Input:

`Remove the second easy run from this block.`

Action:

- Operation: `remove_workouts`
- Resolve by ordinal (`second`) among matches for “easy run”.
- If historical logs exist, return confirmation requirement.

### Example C: Bulk add from JSON

Input:

`Add these workouts to the training block: [ ... ]`

Action:

- Operation: `add_workouts`
- Parse and append unique normalized workouts.

### Example D: Create scheduled block

Input:

`Add a new block starting the week of 3/2. It should be the same as this block but with an additional short run, and increase the length and intensity of the other cardio.`

Action:

- Operation: `create_block`
- Parse date using current year.
- Enforce Monday start (correct + confirm if needed).
- Baseline from selected block workouts, then apply edits.
- Auto-close predecessor block to day before new start.

## Defaults

- Confirmation phrase format: `CONFIRM <opaque_token>`.
- `M/D` dates assume current year.
- Invalid dates produce follow-up question.
- Category keys are normalized; user-facing labels remain human-readable.
