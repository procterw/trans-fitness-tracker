# User-Specific Fitness Checklist Categories

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, weekly fitness checklists still exist, but the backend no longer assumes global fixed categories (`cardio`, `strength`, `mobility`, `other`). Each user’s own checklist categories and items become the source of truth for ingest routing, API updates, persistence, and UI rendering. This is visible by loading a week that contains custom categories (for example `nutrition`) and confirming they render and can be updated without schema-specific logic.

## Progress

- [x] (2026-02-07 19:12Z) Capture current hardcoded category usage in backend, ingest logic, and UI.
- [x] (2026-02-07 19:16Z) Implement dynamic-category helpers and replace hardcoded backend category validation/update logic.
- [x] (2026-02-07 19:16Z) Update assistant ingest schema/context to choose from dynamic user checklist categories.
- [x] (2026-02-07 19:17Z) Move Postgres fitness storage from fixed category columns to flexible checklist JSON with category order; update mapping and migration script.
- [x] (2026-02-07 19:18Z) Update UI category rendering (workouts + sidebar + history) to dynamic iteration.
- [x] (2026-02-07 19:19Z) Validate with `npm run build` and record outcomes.

## Surprises & Discoveries

- Observation: The previous implementation enforced category allow-lists (`cardio`, `strength`, `mobility`, `other`) in update and ingest paths, which blocks truly user-defined checklist categories.
  Evidence: Hardcoded sets were removed from `src/trackingData.js` and enum constraints were removed from `src/assistant.js` during this implementation.
- Observation: SQL backfill statements that reference legacy columns must be executed as dynamic SQL, otherwise fresh installs without those columns can fail parse/planning.
  Evidence: `supabase/schema.sql` now wraps legacy-column backfills in `execute $sql$ ... $sql$` inside guarded `if exists` checks.

## Decision Log

- Decision: Keep the weekly checklist shape compatible with existing data (`current_week` object with category arrays), but make category detection dynamic from week data.
  Rationale: This minimizes breakage while removing schema-level assumptions about specific categories.
  Date/Author: 2026-02-07 / Codex

- Decision: Add explicit `category_order` support for deterministic rendering/persistence.
  Rationale: JSON object key order is not reliable across stores (especially `jsonb`), so category display order needs an explicit field.
  Date/Author: 2026-02-07 / Codex
- Decision: Keep Postgres migration additive by introducing `checklist`/`category_order` columns and backfilling from legacy fixed columns when present.
  Rationale: This preserves existing user data while allowing new flexible category storage without destructive schema changes.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Completed. The backend and UI now treat checklist categories as user data rather than schema-level assumptions. The refactor preserved the weekly checklist behavior while allowing arbitrary categories to flow through rollover logic, ingest routing, API updates, persistence, and rendering.

The largest compatibility risk was existing Postgres tables that still use legacy fixed columns. That risk is mitigated by additive schema updates plus guarded backfill statements that populate `checklist` and `category_order`.

## Context and Orientation

Fitness data flows through:

- `src/trackingData.js`: in-memory/data-file business logic for ensuring current week, updating checklist items, and rollover.
- `src/trackingDataPostgres.js`: Postgres read/write mapping.
- `src/assistant.js` + `src/server.js`: GPT ingest activity mapping to checklist items.
- `client/src/views/WorkoutsView.jsx` and `client/src/views/SidebarView.jsx`: checklist rendering.
- `scripts/migrate-json-to-postgres.js`: backfill from split JSON files into Supabase tables.
- `supabase/schema.sql`: table definitions and migrations.

The current implementation hardcodes category keys in all of these layers.

## Plan of Work

First, introduce a shared backend utility for fitness week category introspection. This module will identify category keys by excluding reserved metadata fields and returning stable ordered keys via `category_order` plus discovered keys.

Next, refactor `src/trackingData.js` so weekly rollover and item updates use dynamic categories. This includes removing fixed allowed sets and resolving category keys from the current week object.

Then, update assistant ingest parsing and server-side activity resolution so selected categories are strings and validated against the dynamic checklist snapshot.

After that, update Postgres schema and adapters to store fitness categories in `checklist` JSON plus `category_order`, and modify migration script writes accordingly.

Finally, update workouts/sidebar views to iterate dynamic categories and verify behavior with a production build.

## Concrete Steps

1. Add `src/fitnessChecklist.js` with shared helpers:
   - category-key discovery
   - category-key resolution
   - checklist serialization (`checklist` + `category_order`)
2. Refactor `src/trackingData.js` validators and rollover creation to use helpers.
3. Refactor `src/assistant.js` and `src/server.js` activity selection mapping to use dynamic categories.
4. Update `src/trackingDataPostgres.js` mapping and `supabase/schema.sql` for flexible checklist storage.
5. Update `scripts/migrate-json-to-postgres.js` to populate new fitness fields.
6. Refactor `client/src/views/WorkoutsView.jsx` and `client/src/views/SidebarView.jsx` to render dynamic categories.
7. Run `npm run build`.

## Validation and Acceptance

- Loading `/api/fitness/current` returns a week object that may include arbitrary category keys, and `/api/fitness/current/item` can update those keys.
- Ingest activity selection maps to user checklist categories present in `current_week`, not a fixed enum.
- Workouts and sidebar views render all categories present in `fitnessWeek` (including custom ones like `nutrition`).
- Postgres read/write stores checklist categories in flexible JSON fields and preserves display order.
- `npm run build` completes successfully.

## Idempotence and Recovery

Schema changes are additive (`add column if not exists` style), and app logic can continue reading existing week payloads. If Postgres schema changes are not yet applied, switching `TRACKING_BACKEND=json` continues local development while migrations are applied.

## Artifacts and Notes

Validation artifact:

- `npm run build` (2026-02-07 19:19Z) succeeded with Vite production build output.

## Interfaces and Dependencies

New shared backend helper module:

- `src/fitnessChecklist.js`
  - `getFitnessCategoryKeys(week)`
  - `getFitnessCategories(week)`
  - `resolveFitnessCategoryKey(week, category)`
  - `toFitnessChecklistStorage(week)`
  - `fromFitnessChecklistStorage({ checklist, categoryOrder })`

These functions will be used by tracking, assistant routing, server activity mapping, and Postgres adapters.

Plan change note (2026-02-07 19:12Z): Initial ExecPlan created to migrate fitness categories from hardcoded schema assumptions to user-specific dynamic categories.
Plan change note (2026-02-07 19:19Z): Marked implementation complete after refactoring backend + UI category handling, migrating Postgres storage to flexible checklist JSON, and validating via production build.
