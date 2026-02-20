# Date-Aware Indefinite Training Block Resolution

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `PLANS.md` from the repository root.

## Purpose / Big Picture

After this change, the app resolves the active/current training block by date instead of by array position or stale metadata. Finite race-prep blocks are chosen when their date range includes today. If no finite block is active, an open-ended block (for example maintenance) is used as a fallback. This prevents future blocks from appearing as active and makes indefinite maintenance behavior predictable.

## Progress

- [x] (2026-02-20 00:45Z) Added backend date-aware block resolver and wired it into current-week creation and metadata active block derivation.
- [x] (2026-02-20 00:45Z) Preserved and exposed `block_start`/`block_end` in training block summaries and server block-sync paths.
- [x] (2026-02-20 00:45Z) Updated Settings block labeling to use block date ranges first, with history/active fallbacks.
- [x] (2026-02-20 00:45Z) Built frontend bundle successfully to validate integration changes.
- [x] (2026-02-20 00:48Z) Added backend write-time validation that rejects settings updates when more than one open-ended training block exists.

## Surprises & Discoveries

Observation: `training_blocks` metadata was not consistently carrying `block_start` and `block_end`, so UI classification had to infer timing from week history or block order.
Evidence: `summarizeTrainingBlocks` returned only id/name/description/category metadata before this update.

## Decision Log

Decision: Implement active-block selection in canonical tracking data (`src/trackingData.js`) rather than only patching client labels.
Rationale: Current-week generation and metadata active block both depend on backend selection; fixing UI alone would not prevent wrong block assignment.
Date/Author: 2026-02-20 / Codex

Decision: Keep fallback behavior when no block is active by date (pick latest started, then nearest future).
Rationale: Prevents empty-week generation when imported schedules are sparse or incomplete.
Date/Author: 2026-02-20 / Codex

## Outcomes & Retrospective

The app now supports the intended two-tier behavior: finite scheduled blocks first, open-ended maintenance fallback second. Remaining work, if desired, is adding explicit validation to enforce “only one open-ended block” at write time.
The app now supports the intended two-tier behavior: finite scheduled blocks first, open-ended maintenance fallback second. Write-time validation now enforces that only one open-ended block can exist after settings block edits.

## Context and Orientation

The canonical activity model lives in `src/trackingData.js`. It defines block normalization, week generation (`ensureCurrentWeekInCanonical`), and metadata projection (`metadataTrainingBlocksFromCanonical`). The API layer in `src/server.js` uses those helpers and also transforms metadata block entries back to canonical blocks during settings updates. The React app in `client/src/App.jsx` renders Settings block options from `/api/settings/state` and fitness week/history data.

## Plan of Work

Update canonical block resolution to choose blocks by date range with finite-first precedence and open-ended fallback. Ensure metadata summaries include `block_start`/`block_end` and preserve these fields through server-side metadata normalization and canonical sync. Update Settings block labeling to use block date fields directly before falling back to inferred ranges.

## Concrete Steps

From repository root:

    npm run build

Expected: Vite build succeeds and writes `dist` assets without errors.

## Validation and Acceptance

Acceptance is satisfied when:

1. A finite block that includes today is treated as current over any open-ended block.
2. If no finite block is active, an open-ended block with `block_start <= today` is selected as current.
3. Settings block labels classify blocks using `block_start`/`block_end` when present.
4. Workouts history still excludes future weeks.

## Idempotence and Recovery

These code changes are idempotent and safe to re-run. Re-running build should produce updated assets only. If rollback is needed, revert the touched files and rerun `npm run build`.

## Artifacts and Notes

Validation command output (abbreviated):

    > npm run build
    vite v7.3.1 building client environment for production...
    ✓ built in ~1s

## Interfaces and Dependencies

No external dependency changes. Interfaces extended:

- `/api/settings/state` now includes `training_blocks.blocks[*].block_start` and `training_blocks.blocks[*].block_end`.
- Client block option normalization in `client/src/App.jsx` now reads those fields.

Plan revision note (2026-02-20): Created during implementation because this feature required coordinated backend and frontend behavior changes and date-resolution rules.
