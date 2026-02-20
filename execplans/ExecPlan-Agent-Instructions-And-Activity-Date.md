# Sync Agent Instructions Defaults and Persist Workout-Level Activity Dates

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

After this change, two user-visible behaviors are true at the same time. First, the hardcoded assistant defaults in `src/assistant.js` reflect the latest guidance in `agentInstructions.txt` for ingest routing, meal responses, chat Q&A, and settings chat. Second, activity logs persist a workout-level `date` field inside weekly workout entries, so each checked workout can store when it was performed.

You can verify the outcome by logging an activity through `/api/assistant/ingest` or `/api/fitness/current/item` and then reading `/api/fitness/current` to confirm each updated workout includes a `date` value in `YYYY-MM-DD` format. You can also inspect `src/assistant.js` defaults to see instruction text aligned with `agentInstructions.txt`.

## Progress

- [x] (2026-02-20 21:53Z) Read `PLANS.md`, captured scope, and created this ExecPlan.
- [x] (2026-02-20 21:55Z) Implemented workout-level `date` normalization and persistence in activity week workouts across canonical normalization and update paths in `src/trackingData.js`.
- [x] (2026-02-20 21:55Z) Updated ingest and direct activity item update handlers in `src/server.js` to write/validate optional workout `date`.
- [x] (2026-02-20 21:55Z) Synced hardcoded assistant defaults in `src/assistant.js` with `agentInstructions.txt` tone and behavior constraints for ingest, QA, meal response, and settings.
- [x] (2026-02-20 21:55Z) Ran validation checks (`node --check` for edited files, `npm run test:ingest-mocked`, `npm run test:harness`).
- [x] (2026-02-20 21:57Z) Added client support to show/edit workout-level `date` in `client/src/views/WorkoutsView.jsx`, threaded through `client/src/App.jsx` and `client/src/api.js`, and verified with `npm run build`.

## Surprises & Discoveries

- Observation: `dataStructureTemplate.js` already documents workout-level `date`, but runtime canonical week normalization still drops this field.
  Evidence: `src/trackingData.js` `normalizeWeekWorkout` currently returns only `name`, `details`, `completed`.

- Observation: Activity update behavior was centralized enough that adding `date` only required patching two write entry points (`updateCurrentWeekItems`, `updateCurrentActivityWorkout`) plus ingest/API wiring.
  Evidence: `npm run test:harness` still passed all existing checks after date support was added.

## Decision Log

- Decision: Add optional `date` to canonical week workouts now without changing week-level indexing model.
  Rationale: Matches requested behavior while keeping compatibility with the existing weekly checklist architecture.
  Date/Author: 2026-02-20 / Codex

- Decision: Keep `agentInstructions.txt` as authoring source and manually mirror into hardcoded arrays.
  Rationale: User requested this file be used to generate code updates, not loaded dynamically at runtime.
  Date/Author: 2026-02-20 / Codex

## Outcomes & Retrospective

Completed. The assistant defaults now reflect the latest guidance from `agentInstructions.txt`, and activity logs support workout-level `date` persistence. This preserves the weekly checklist model while allowing each checked workout row to carry a specific activity date. Validation passed with no syntax errors and existing deterministic/mocked ingest harness checks still green.

## Context and Orientation

The assistant instruction defaults are hardcoded in `src/assistant.js` as section-specific arrays (`DEFAULT_INGEST_CLASSIFIER_INSTRUCTIONS`, `DEFAULT_QA_ASSISTANT_INSTRUCTIONS`, `DEFAULT_MEAL_ENTRY_RESPONSE_INSTRUCTIONS`, and `DEFAULT_SETTINGS_ASSISTANT_INSTRUCTIONS`). These defaults are used when per-user `assistant_rules` are absent.

Activity state is normalized and persisted in `src/trackingData.js` under `activity.weeks[].workouts[]`. Activity updates are applied through `updateCurrentWeekItems` and `updateCurrentActivityWorkout`. Chat ingest activity mapping happens in `src/server/ingestHelpers.js` and is committed from `src/server.js`.

## Plan of Work

First, update activity workout normalization in `src/trackingData.js` so `workouts[]` supports optional `date` with strict `YYYY-MM-DD` validation and stable fallback behavior (`null` when missing/invalid). Then thread this field through all update/write paths: legacy patch conversion, batch update (`updateCurrentWeekItems`), single-item update (`updateCurrentActivityWorkout`), and view/legacy transforms so API payloads can round-trip the date.

Next, update ingest write behavior in `src/server.js` for activity intent so each resolved activity update writes a date. Use request date when provided, otherwise `getSuggestedLogDate()` to keep rollover semantics.

Then, align hardcoded instruction arrays in `src/assistant.js` with `agentInstructions.txt`, while preserving schema/output constraints already required by each assistant section.

## Concrete Steps

From `/Users/williamleahy/Documents/New project`:

1. Edit `src/trackingData.js` to add `date` handling for workout rows and update functions.
2. Edit `src/server.js` activity ingest handler to pass `date` on updates.
3. Edit `src/assistant.js` default instruction arrays to match `agentInstructions.txt`.
4. Run:
   - `node --check src/trackingData.js`
   - `node --check src/server.js`
   - `node --check src/assistant.js`
5. If available, run targeted tests or smoke checks for current-week endpoints.

Expected evidence:
- Activity update responses include workout entries with `date`.
- No syntax errors from node checks.

## Validation and Acceptance

Acceptance criteria:

1. Logging activity through chat ingest updates mapped checklist entries and stores a workout-level `date`.
2. Updating one workout through `/api/fitness/current/item` can set/keep `date`.
3. Reading current week via `/api/fitness/current` returns `workouts[]` entries that include `date` (`YYYY-MM-DD` or `null`).
4. Assistant default arrays in `src/assistant.js` include the tone and behavior constraints from `agentInstructions.txt`.

## Idempotence and Recovery

These edits are code-only and safe to reapply. If behavior regresses, revert only the touched files (`src/trackingData.js`, `src/server.js`, `src/assistant.js`) and rerun syntax checks.

## Artifacts and Notes

Validation transcripts:

  node --check src/trackingData.js
  node --check src/server.js
  node --check src/assistant.js
  node --check src/server/ingestHelpers.js

  npm run test:ingest-mocked
  Mocked ingest harness passed:
  - image inputs are sent as model-readable input_image content
  - text-only inputs stay text-only
  - fallback behavior for missing image bytes is stable

  npm run test:harness
  Deterministic harness passed:
  - F01 add food
  - F02 add food photo
  - D02 repeated add appends to day
  - D03 near-time repeats append to day
  - F03 update food
  - F04 update food photo
  - F05 move date recalculates both days
  - A01 add activity
  - D01 no duplicate day rows across flow
  Total checks: 9

  npm run build
  vite build completed successfully after client date-editing changes.

## Interfaces and Dependencies

No new external dependencies are required.

Interfaces to preserve:

- `updateCurrentWeekItems(updates)` remains batch update entry point.
- `updateCurrentActivityWorkout({ index, completed, details, date? })` remains the single-item update entry point, with optional `date`.
- `GET /api/fitness/current` continues to return canonical week view; workout rows now include `date`.

Plan update note (2026-02-20 21:57Z): Extended implementation to include workouts UI date editing and added build validation evidence.
