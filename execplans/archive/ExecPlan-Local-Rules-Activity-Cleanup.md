# Move General Rules Local and Remove Nutrition Activity Checklist

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` from the repository root and must be maintained in accordance with that file.

## Purpose / Big Picture

After this change, workout tracking data will no longer include a `nutrition` checklist category, and GPT input/output rule configuration will be local-file backed instead of stored in Supabase `user_rules`. The user-visible behavior stays the same for food/activity logging and assistant responses, but the rule source of truth becomes local and deterministic. You can verify this by running the app, checking the workouts payload for only `cardio|strength|mobility|other`, and confirming PostgreSQL reads no longer depend on `user_rules`.

## Progress

- [x] (2026-02-07 19:05Z) Reviewed `PLANS.md`, `supabase/schema.sql`, `src/trackingData.js`, `src/trackingDataPostgres.js`, `src/assistant.js`, and current tracking JSON files.
- [x] (2026-02-07 19:12Z) Implemented backend changes so local rules are layered from `tracking-rules.json` in both JSON and Postgres modes; removed all `user_rules` reads/writes from runtime and migration paths.
- [x] (2026-02-07 19:13Z) Moved assistant ingest/Q&A/meal-response prompt rules into `tracking-rules.json.assistant_rules` and consumed them from `src/assistant.js` with safe defaults.
- [x] (2026-02-07 19:14Z) Removed `nutrition` from `tracking-activity.json.current_week` and added activity payload sanitization in `src/trackingData.js` for read/write paths.
- [x] (2026-02-07 19:15Z) Updated `PROJECT.md` + `supabase/schema.sql` references and validated with `npm run build` and a runtime key check.

## Surprises & Discoveries

- Observation: `tracking-activity.json` currently contains `current_week.nutrition`, but runtime update APIs only allow `cardio|strength|mobility|other`.
  Evidence: `src/trackingData.js` `updateCurrentWeekItem` allowed set excludes `nutrition`.
- Observation: legacy single-file mode (`TRACKING_DATA_FILE`) initially bypassed the new activity sanitizer.
  Evidence: `readTrackingData()` legacy branch returned raw parsed JSON before normalization; fixed by sanitizing before return.

## Decision Log

- Decision: Treat "general rules" as local-only configuration for GPT/system behavior and tracking conventions, not per-user DB rows.
  Rationale: Matches the request to pull general rules out of database and keep them locally editable.
  Date/Author: 2026-02-07 / Codex

- Decision: Keep `diet_philosophy` and `fitness_philosophy` in `tracking-rules.json` and load that file even when `TRACKING_BACKEND=postgres`.
  Rationale: This preserves existing behavior while removing database dependency.
  Date/Author: 2026-02-07 / Codex

- Decision: In Postgres mode, continue writing local rules in `writeTrackingData()` while limiting `writeTrackingDataPostgres()` to per-user data only.
  Rationale: Keeps a single write call site for app code while enforcing a strict storage boundary between user data and local configuration.
  Date/Author: 2026-02-07 / Codex

- Decision: Normalize activity payloads on both read and write paths to drop unsupported categories (`nutrition` and any unknown keys).
  Rationale: Prevents stale/legacy category data from persisting or resurfacing regardless of backend mode.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Completed the planned cleanup. Rules and prompt configuration now come from local `tracking-rules.json` even when `TRACKING_BACKEND=postgres`, and Postgres runtime/migration code no longer reads or writes `user_rules`. Activity payloads are normalized to supported categories only (`cardio|strength|mobility|other`), with `tracking-activity.json.current_week.nutrition` removed. Build succeeded and runtime inspection confirms `current_week` keys no longer include `nutrition`.

## Context and Orientation

Relevant files:

- `src/trackingData.js`: repository-level read/write layer selecting JSON vs Postgres backend.
- `src/trackingDataPostgres.js`: Supabase persistence for per-user data.
- `src/assistant.js`: GPT routing and response composition prompts.
- `tracking-rules.json`: local rules + philosophy data loaded in JSON mode.
- `tracking-activity.json`: local fitness checklist data.
- `supabase/schema.sql`: baseline table/policy definitions.

"General rules" in this plan means reusable GPT prompt instructions and logging conventions that are not specific to one user account. "Local" means files in this repository (for example `tracking-rules.json`), not per-user database tables.

## Plan of Work

First, refactor the storage boundary so `readTrackingData()` always layers local rules from `tracking-rules.json` on top of backend data, and `writeTrackingData()` in Postgres mode writes only user-specific tables (`food_events`, `food_log`, `fitness_current`, `fitness_weeks`, `user_profiles`) while persisting rules locally. In the same pass, remove `user_rules` reads/writes from `src/trackingDataPostgres.js`.

Second, add structured assistant rule config under `tracking-rules.json` (ingest classifier, Q&A assistant, meal response formatter) and update `src/assistant.js` to read these instructions from config with safe fallbacks.

Third, remove `nutrition` from `tracking-activity.json` and enforce a normalized activity schema in `src/trackingData.js` that strips unknown categories from current and historical weeks.

Fourth, update `supabase/schema.sql` and `PROJECT.md` references so they describe local rules storage, then run build validation.

## Concrete Steps

From repository root `/Users/williamleahy/Documents/New project`:

1. Edit `src/trackingData.js` to split local rules from user data and load local rules in Postgres mode.
2. Edit `src/trackingDataPostgres.js` to remove `user_rules` query/upsert logic.
3. Edit `src/assistant.js` to load prompt sections from `tracking-rules.json` via tracking data.
4. Edit `tracking-rules.json` to add assistant rule sections.
5. Edit `tracking-activity.json` to remove `nutrition` from `current_week`.
6. Edit `supabase/schema.sql` and `PROJECT.md` to match new source of truth.
7. Run `npm run build` and inspect for failures.

Expected build transcript snippet:

    > new-project@1.0.0 build
    > vite build --config client/vite.config.js
    ...
    ✓ built in ...

## Validation and Acceptance

Acceptance criteria:

- `GET /api/fitness/current` no longer returns `nutrition` in `current_week`.
- Assistant behavior still works and consumes rule text from local config (verified by code path and successful build).
- Postgres path no longer reads or writes `user_rules`.
- Build passes via `npm run build`.

## Idempotence and Recovery

These edits are idempotent. Re-running the app after changes should keep stripping unknown activity categories and preserve only supported categories. If needed, rollback is a normal git revert of touched files.

## Artifacts and Notes

Build artifact (2026-02-07 19:15Z):

    > new-project@1.0.0 build
    > vite build --config client/vite.config.js
    vite v7.3.1 building client environment for production...
    ✓ 334 modules transformed.
    ✓ built in 954ms

Runtime sanity check (2026-02-07 19:15Z):

    > node -e "import('./src/trackingData.js').then(async (m) => { const d = await m.readTrackingData(); console.log(Object.keys(d.current_week || {}).join(',')); })"
    week_start,week_label,summary,cardio,strength,mobility,other

## Interfaces and Dependencies

- Keep using existing dependency stack (`express`, `openai`, `@supabase/supabase-js`, React/Vite).
- `src/trackingData.js` will remain the single interface for read/write.
- `src/assistant.js` will continue to use Responses API + Zod structured outputs.

Revision note: Created plan to implement request for removing workout nutrition category and relocating general GPT/config rules to local files.
Revision note (2026-02-07 19:15Z): Updated the living document after implementation with completed progress entries, new decisions/discoveries, and concrete validation evidence because the original plan state was still marked as pending.
