# Align Runtime Data Model With `dataStructureTemplate.js`

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document is maintained in accordance with `PLANS.md`.

## Purpose / Big Picture

The app should persist and expose the same core shapes defined in `dataStructureTemplate.js`. After this change, diet day rows use `status` and `ai_summary` (instead of `complete`, `details`, and `on_track`), and training weeks use `ai_summary` and `context` (instead of only `summary`). A user can verify this by logging food and fetching a day row, and by fetching the current week after activity updates.

## Progress

- [x] (2026-02-20 20:20Z) Reviewed `PROJECT.md`, `dataStructureTemplate.js`, and all usages of old fields in server, tracking data, imports, and client views.
- [x] (2026-02-20 20:35Z) Updated canonical tracking normalization/write paths in `src/trackingData.js` to write new fields while reading legacy aliases for compatibility.
- [x] (2026-02-20 20:45Z) Updated import normalization in `src/importData.js` and manual food day patch handling in `src/server.js`.
- [x] (2026-02-20 20:52Z) Updated UI reads in `client/src/views/DietView.jsx`, `client/src/App.jsx`, and `client/src/components/EstimateResult.jsx`.
- [x] (2026-02-20 20:57Z) Updated weekly summary refresh fallback in `src/server/ingestHelpers.js`.
- [x] (2026-02-20 21:01Z) Validated with `npm run build`, `npm run test:harness`, and `npm run test:ingest-mocked`.

## Surprises & Discoveries

- Observation: Several internal flows still expect legacy `summary` for checklist/template plumbing.
  Evidence: `src/server.js` had template week conversion logic reading `safeTemplateWeek.summary`.
- Observation: Existing harnesses remained green after adding compatibility aliases rather than forcing all callsites to switch at once.
  Evidence: deterministic harness and mocked ingest harness both passed unchanged.

## Decision Log

- Decision: Keep backward-compatible reads for legacy keys (`summary`, `details`, `on_track`) while writing new canonical keys.
  Rationale: Existing imports and in-flight data should continue to work without one-time migration scripts.
  Date/Author: 2026-02-20 / Codex
- Decision: Keep `summary` as a view alias in some week payloads while promoting `ai_summary` as canonical.
  Rationale: Minimizes break risk in settings/checklist code paths that still consume summary.
  Date/Author: 2026-02-20 / Codex

## Outcomes & Retrospective

Canonical storage and most API/UI surfaces now align with the updated template. Compatibility aliases remain intentionally for low-risk rollout. Remaining cleanup is optional future hardening: remove legacy aliases after data and UI paths are fully migrated.

## Context and Orientation

This repository stores user tracking data in split JSON files (or Postgres via the same canonical structure). The main data normalization and persistence logic lives in `src/trackingData.js`. Imports are normalized in `src/importData.js`. HTTP endpoints are in `src/server.js`. The diet view UI is in `client/src/views/DietView.jsx`, with shared app state in `client/src/App.jsx`.

The old diet day model used `complete`, `details`, and `on_track`. The new model uses `status` and `ai_summary`. The old week model used `summary`; the new model uses `ai_summary` and `context`.

## Plan of Work

Apply migration in four layers. First, update canonical normalization in `src/trackingData.js` so reads accept old/new keys and writes emit the new keys. Second, update import and manual patch normalization (`src/importData.js`, `src/server.js`) to emit the new fields. Third, update UI read paths to display the new fields. Fourth, run build and harness tests to confirm behavior did not regress.

## Concrete Steps

From `/Users/williamleahy/Documents/New project`, run:

    npm run build
    npm run test:harness
    npm run test:ingest-mocked

Expected results:

    - Vite build succeeds.
    - Deterministic harness reports all checks passed.
    - Mocked ingest harness reports all checks passed.

## Validation and Acceptance

Acceptance is met when:

1. `GET /api/food/day?date=YYYY-MM-DD` returns `day.status` and `day.ai_summary` for rows written after this change.
2. `GET /api/fitness/current` returns week data that includes `ai_summary` (with `summary` alias still available where required).
3. UI diet screens render summary text from `ai_summary` and show status from `status`.
4. Build and both harness scripts pass.

## Idempotence and Recovery

These edits are idempotent at runtime because normalizers accept both old and new keys. Re-running imports or writes will continue to produce canonical new keys. Recovery path is standard git-based rollback of modified files if needed.

## Artifacts and Notes

Validation transcript:

    npm run build                       -> success
    npm run test:harness                -> Deterministic harness passed (9 checks)
    npm run test:ingest-mocked          -> Mocked ingest harness passed

## Interfaces and Dependencies

Updated interfaces:

- `src/trackingData.js` canonical day row: `{ date, weight_lb, calories, fat_g, carbs_g, protein_g, fiber_g, status, ai_summary }`
- `src/trackingData.js` canonical week row: `{ week_start, week_end, block_id, workouts[], ai_summary, context }`
- `src/server.js` `normalizeDietDayPatchInput` now writes `status` and `ai_summary`.

Dependencies remain unchanged (Express, React, Vite, OpenAI SDK).

Revision note: Created this ExecPlan and completed implementation in the same work session because the request was a significant data-model refactor spanning backend normalization, import paths, API mappings, and UI reads.
