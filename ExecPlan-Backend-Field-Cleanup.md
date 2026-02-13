# Clean Up Legacy Backend Fields In Postgres Tracking Tables

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the Postgres backend stores each tracked field exactly once in the canonical column layout used by runtime code. Legacy duplicate fields remain readable long enough to backfill into canonical columns, then are removed so the schema and server mapping stay simpler and less error-prone. A user can verify the change by applying `supabase/schema.sql`, running the JSON-to-Postgres migration script, and confirming the app still builds and reads/writes nutrition + checklist data.

## Progress

- [x] (2026-02-13 04:07Z) Create this ExecPlan with scope, constraints, and acceptance.
- [x] (2026-02-13 04:08Z) Update `supabase/schema.sql` to backfill canonical fields from legacy columns and drop deprecated columns.
- [x] (2026-02-13 04:08Z) Update `src/trackingDataPostgres.js` to stop selecting/reading/writing removed columns.
- [x] (2026-02-13 04:08Z) Update `scripts/migrate-json-to-postgres.js` to write only canonical DB fields while preserving JSON import compatibility.
- [x] (2026-02-13 04:08Z) Validate with project build/tests and record evidence.

## Surprises & Discoveries

- Observation: The repo-level instruction references `.agent/PLANS.md`, but this workspace has `PLANS.md` at repo root.
  Evidence: `cat .agent/PLANS.md` fails with ENOENT while `cat PLANS.md` succeeds.
- Observation: The migration mapper had no fallback for `fiber_g` from legacy micronutrient blobs, while other micronutrients already had fallback logic.
  Evidence: `scripts/migrate-json-to-postgres.js` previously computed `fiber` from `row?.fiber_g` only.

## Decision Log

- Decision: Scope this cleanup to field-level schema/runtime parity, not API response contract changes.
  Rationale: The user asked to clean backend fields; preserving API payload shape minimizes regression risk while still removing backend duplication.
  Date/Author: 2026-02-13 / Codex
- Decision: Keep migration compatibility at JSON ingest level (`scripts/migrate-json-to-postgres.js`) even while removing duplicate DB columns.
  Rationale: Existing local JSON history may still contain legacy keys; importing should remain resilient.
  Date/Author: 2026-02-13 / Codex
- Decision: Backfill numeric values from `food_log.micronutrients` using regex-guarded casts before dropping the column.
  Rationale: Prevent migration failures from malformed legacy JSON strings while preserving valid numeric values.
  Date/Author: 2026-02-13 / Codex

## Outcomes & Retrospective

Implemented the backend field cleanup with no API contract changes. `food_log.micronutrients` is now treated as a legacy input-only source during migration and is removed from canonical runtime schema/mapping. Legacy fixed checklist columns are dropped after checklist backfill, reducing duplicated storage paths. Build and deterministic harness both passed, indicating no regression in core ingest/update flows.

## Context and Orientation

The SQL schema is defined in `supabase/schema.sql` and is applied idempotently in existing environments. Runtime Postgres read/write mapping lives in `src/trackingDataPostgres.js`, where `food_log` currently includes a duplicate JSON blob field (`micronutrients`) alongside explicit micronutrient columns. JSON bootstrap migration is in `scripts/migrate-json-to-postgres.js`; it currently writes both canonical micronutrient columns and duplicate `micronutrients` JSON. `fitness_current` and `fitness_weeks` include migration logic from legacy fixed columns (`cardio`, `strength`, `mobility`, `other`) to flexible `checklist` JSON, but those legacy columns are not yet removed.

## Plan of Work

First, update `supabase/schema.sql` to backfill canonical micronutrient columns from `food_log.micronutrients` when present, then drop the deprecated `micronutrients` column. In the same schema pass, preserve the existing fixed-to-flexible checklist backfill logic and then drop the old fixed checklist columns from `fitness_current` and `fitness_weeks`.

Next, update `src/trackingDataPostgres.js` so `food_log` selects only canonical columns and no longer performs fallback reads from `micronutrients`. Update write mapping to stop writing `micronutrients`.

Then update `scripts/migrate-json-to-postgres.js` to keep reading legacy JSON fields (`micronutrients` / `micronutrients_legacy`) for import compatibility, but only write canonical DB columns.

Finally, run the build and deterministic harness to verify no behavioral regressions in baseline app flows.

## Concrete Steps

Run commands from repository root.

1. Edit `supabase/schema.sql` to add conditional backfill-and-drop for `food_log.micronutrients` and conditional drop for legacy checklist columns after checklist backfill.
2. Edit `src/trackingDataPostgres.js` to remove `micronutrients` from `food_log` select/write paths and simplify row mapping.
3. Edit `scripts/migrate-json-to-postgres.js` to remove `micronutrients` from inserted/upserted `food_log` payloads while retaining legacy JSON read fallbacks.
4. Run:
   - `npm run build`
   - `npm run test:harness`

## Validation and Acceptance

Acceptance criteria:

- Server-side Postgres mapping compiles and no longer references dropped fields.
- Schema migration is idempotent and includes safe conditional logic before dropping legacy columns.
- `npm run build` succeeds.
- `npm run test:harness` succeeds.

## Idempotence and Recovery

All SQL changes use `if exists` checks and are safe to rerun. If schema cleanup causes environment-specific issues, recovery is to restore dropped columns manually and rerun previous code revision; no destructive data deletion occurs before a backfill step in this plan.

## Artifacts and Notes

Validation output:

    npm run build
    vite v7.3.1 building client environment for production...
    ✓ built in 1.42s

    npm run test:harness
    Deterministic harness passed
    Total checks: 10

## Interfaces and Dependencies

No new external dependencies are introduced. Existing interfaces remain stable:

- `readTrackingDataPostgres()` and `writeTrackingDataPostgres(data)` in `src/trackingDataPostgres.js` keep the same signatures.
- `scripts/migrate-json-to-postgres.js` keeps the same CLI invocation (`npm run migrate:postgres`).

Plan change note (2026-02-13 04:07Z): Initial ExecPlan created for backend field cleanup to track schema/runtime alignment and validation.
Plan change note (2026-02-13 04:08Z): Marked implementation and validation complete; recorded final decisions, discoveries, and evidence.
