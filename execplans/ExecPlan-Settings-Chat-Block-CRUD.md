# Settings Chat Block CRUD Engine

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/williamleahy/Documents/New project/PLANS.md` and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the Settings chat becomes a deterministic training-block CRUD engine. Users can edit the selected block by default, add or remove workouts, create/schedule blocks with Monday-aligned dates, and safely confirm destructive edits with explicit confirmation phrases before data is mutated.

## Progress

- [x] (2026-02-21 00:00Z) Audited current settings chat flow, assistant schema, server apply logic, and UI selected-block plumbing.
- [x] (2026-02-21 00:08Z) Wrote a full block-CRUD rules spec in `settings-rules.md`.
- [x] (2026-02-21 01:20Z) Implemented server-side CRUD operations, date scheduling rules, selected block precedence, and confirmation-gated mutations.
- [x] (2026-02-21 01:27Z) Implemented assistant schema/instruction/context updates for operation-driven training block changes.
- [x] (2026-02-21 01:34Z) Implemented frontend selected-block request plumbing and confirmation phrase flow in settings chat.
- [x] (2026-02-21 01:41Z) Added deterministic harness scenarios for settings block CRUD and safety checks (S01-S03).
- [x] (2026-02-21 01:45Z) Ran validation (`npm run test:harness`, `npm run build`) and confirmed passing output.

## Surprises & Discoveries

- Observation: The current settings flow has no notion of selected block in API requests, so “this block” cannot map to the UI-selected block.
  Evidence: `client/src/api.js` sends only `{ message, messages }` for settings chat.

- Observation: Existing training block updates are additive template merges; explicit delete semantics do not exist.
  Evidence: `mergeChecklistTemplates` in `src/server.js` only merges/relocates items and never supports operation-level removals.

## Decision Log

- Decision: Keep profile text editing behavior intact while narrowing training block behavior to explicit CRUD operations.
  Rationale: Avoid regressions in existing settings usage while making block operations deterministic.
  Date/Author: 2026-02-21 / Codex

- Decision: Use `CONFIRM <token>` phrases and require the phrase in `/api/settings/confirm` for risky operations.
  Rationale: This gives deterministic safety guarantees and supports an auditable confirmation boundary.
  Date/Author: 2026-02-21 / Codex

- Decision: Non-Monday `block_start` dates are auto-corrected to Monday and require confirmation before mutation.
  Rationale: Enforces block timing invariants while preserving user intent.
  Date/Author: 2026-02-21 / Codex

## Outcomes & Retrospective

Implemented the settings chat as a deterministic block CRUD engine with explicit operations and safety gates.

- Selected block id is now sent from UI to settings APIs and used as default target on the server.
- Settings assistant now emits operation-driven `training_block` payloads with date and add/remove workout fields.
- Server apply flow now supports `update_block`, `create_block`, `switch_block`, `replace_workouts`, `add_workouts`, and `remove_workouts`.
- Delete-with-history now requires a `CONFIRM <token>` phrase before mutation.
- Non-Monday `block_start` values are corrected to Monday and require confirmation before apply.
- Block scheduling enforces valid ranges and overlap checks, with predecessor auto-close behavior.
- Workout `optional` and `category` metadata are preserved through template/canonical sync.
- Backward compatibility remains for legacy checklist-driven proposals.

## Context and Orientation

Relevant files:

- `settings-rules.md`: settings chat behavior specification.
- `src/assistant.js`: settings assistant prompts, schema, and normalization.
- `src/server.js`: settings chat endpoints and apply engine.
- `client/src/api.js`: settings chat and confirm API calls.
- `client/src/App.jsx`: settings chat stream handling, selected block state, and confirmation UX.
- `scripts/run-deterministic-harness.js`: deterministic test harness.

A training block in this repo is metadata (`metadata.training_blocks.blocks[]`) mirrored into canonical activity blocks (`activity.blocks[]`) and week snapshots (`activity.weeks[]`).

## Plan of Work

First, rewrite the settings rules so behavior is explicit and testable. Next, extend assistant output schema to emit operation-driven `training_block` changes (`create`, `switch`, `add`, `remove`, `replace`, `update`). Then replace server-side merge-first behavior with operation-driven apply logic that uses `selected_block_id` precedence, preserves workout category/optional fields, and enforces scheduling invariants. Add confirmation gating for delete-with-history and Monday correction. Finally, wire frontend selected-block request fields and pending-confirmation UX, then extend deterministic harness scenarios and validate.

## Concrete Steps

1. Update `settings-rules.md` with complete operation grammar and safety rules.
2. Update `src/assistant.js` settings schema + instructions + normalization and context fields.
3. Update `src/server.js`:
   - parse `selected_block_id`,
   - support operation-driven block/workout CRUD,
   - implement confirmation phrase flow,
   - enforce Monday correction and block date overlap rules,
   - preserve optional/category across block sync.
4. Update `client/src/api.js` for `selected_block_id` and confirmation phrase payloads.
5. Update `client/src/App.jsx` for pending confirmation proposal state and confirmation submit behavior.
6. Add settings CRUD checks to `scripts/run-deterministic-harness.js`.
7. Run:
   - `npm run test:harness`
   - `npm run build`

## Validation and Acceptance

Acceptance is met when:

- Settings chat defaults to selected block edits unless explicit block target is supplied.
- Removing a workout with history returns `requires_confirmation=true` and a `CONFIRM <token>` phrase.
- Confirming with `/api/settings/confirm` applies the mutation and increments settings version.
- Creating a block with non-Monday start returns confirmation with corrected Monday start.
- Confirming the corrected proposal creates the block and auto-closes predecessor date range.
- `optional` and `category` values are preserved after settings mutations.
- Existing profile text edits continue to work.

## Idempotence and Recovery

Apply operations are designed to be idempotent under repeated proposals (same target state yields no-op). Confirmation-required proposals do not mutate until confirmed. If an invalid overlap or date error occurs, no write is performed.

## Artifacts and Notes

Validation commands:

- `npm run test:harness` -> passed (includes new S01-S03 settings CRUD checks).
- `npm run build` -> passed (Vite production build successful).

Implementation note:

- Harness was migrated to direct server apply calls to avoid localhost/network dependency during deterministic runs.

## Interfaces and Dependencies

- `POST /api/settings/chat`: now accepts optional `selected_block_id`.
- `POST /api/settings/chat`: may return `requires_confirmation`, `proposal`, and `confirmation_phrase`.
- `POST /api/settings/confirm`: accepts `{ proposal, confirmation_phrase }`.
- Assistant `changes.training_block` includes operation and date/workout fields for deterministic CRUD.

Plan change note (2026-02-21 00:08Z): Created this plan to execute the requested settings chat CRUD refactor and explicitly documented confirmation/date safety invariants.
