# Hard Reset to Simplified Human-Readable Data Model (No Migration)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `/Users/williamleahy/Documents/New project/PLANS.md` and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the app uses one simple data format aligned with `/Users/williamleahy/Documents/New project/dataStructureTemplate.js`, and all legacy storage/contracts are removed. The project is not in production, so this plan intentionally performs a destructive reset: existing user data is deleted, no migration logic is built, and no backward-compatibility adapters are retained.

The user-visible result is a cleaner system that is easy to read and edit by hand: profile text blobs (`general`, `fitness`, `diet`, `agent`), training blocks plus week snapshots, and one diet day row per date with summary details text.

## Progress

- [x] (2026-02-19 22:03Z) Confirmed scope is destructive cutover with no migration/backward compatibility.
- [x] (2026-02-19 22:03Z) Rewrote ExecPlan to remove migration and compatibility workstreams.
- [x] (2026-02-20 00:43Z) Replace backend canonical data contracts in `src/trackingData.js` with new schema only (completed: canonical split-file read/write + simplified `days/blocks/weeks/general/fitness/diet/agent`, removal of dead legacy food helper exports, canonical nested payload objects `rules/activity/food`, removal of legacy merge/adapters in `normalizeCanonicalData`/`extractCanonicalFromIncoming`, removal of runtime `current_week` read payload output, and removal of Postgres legacy payload bridging).
- [x] (2026-02-20 01:02Z) Replace Postgres schema and storage code with new schema only (completed: canonical-only Postgres adapter reads/writes in `trackingDataPostgres.js`, canonical-only JSON→Postgres migration script, and simplified `supabase/schema.sql` to `user_profiles` + `user_rules` with legacy tables dropped).
- [ ] Rewrite API routes to remove event-centric diet endpoints and old profile/training keys (completed: canonical `GET/POST /api/food/day`, canonical settings profile fields in `server.js`, removed `/api/food/events` alias, removed `/api/food/rollup` + `/api/food/sync`, updated `assistant.js` settings-change schema/parsing to canonical profile keys, and renamed active food logging payload fields from `food_log`/`day_totals_from_events` to `day`/`day_totals`; remaining: remove remaining legacy settings/profile prompt references and old compatibility payload names in onboarding/import/workout paths).
- [ ] Rewrite UI data usage to consume only simplified contracts (completed: settings profile UI/API now use canonical `general/fitness/diet/agent` only, removed rollup/sync client calls, `getFoodForDate` targets `/api/food/day`, food-day utilities no longer depend on server `events`, `App` + `DietView` are wired to explicit `day`/`day_totals`, and sidebar day summary no longer falls back to `food_log.notes`; remaining: finish broader simplified-contract cleanup outside the settings path, especially workouts and onboarding/import contexts).
- [x] (2026-02-19 23:20Z) Added destructive reset command `npm run reset:simplified-dev-data` (`scripts/reset-simplified-dev-data.js`) for JSON + Postgres dev data, with `--dry-run`/`--skip-*` flags; validated via dry run and `node --check`.
- [x] (2026-02-19 23:37Z) Rewrote import analysis/apply to canonical domains (`profile`, `food_days`, `activity_blocks`, `activity_weeks`, `rules`) and dropped legacy import-shape application; validated with module smoke test + `npm run build`.
- [x] (2026-02-19 23:56Z) Migrated fitness UI/API flow to canonical week payloads (`week.workouts[]`), added canonical activity helpers in `trackingData.js`, switched fitness item updates to `workout_index`, and rewrote workouts/sidebar rendering away from checklist category keys; validated with `node --check` + `npm run build`.
- [x] (2026-02-19 23:59Z) Added canonical `week` fields to settings chat/confirm and assistant-activity responses so the app can consume canonical week payloads across non-fitness routes.
- [x] (2026-02-20 00:20Z) Removed runtime `current_week` compatibility reads/usages from `server.js` and `assistant.js`, removed `current_week` from `readTrackingData()` JSON payload output, and updated the static `public/app.js` fitness flow to canonical `week.workouts[]` + `workout_index`; validated with `npm run build` and syntax checks.
- [x] (2026-02-20 00:43Z) Converted Postgres adapter and migration harnesses to canonical payloads: `trackingDataPostgres.js` now reads/writes canonical `profile/activity/food/rules` via `user_rules` + `user_profiles`, removed remaining runtime/script `current_week` references, and updated deterministic harness assertions to canonical day/workout behavior; validated with `npm run build` + `npm run test:harness`.
- [x] (2026-02-20 01:12Z) Removed legacy `/api/food/photo` and `/api/food/manual` endpoints plus dead client wrappers, and updated import UI/user messaging to canonical wording only; validated with `npm run build` + `npm run test:harness`.
- [x] (2026-02-20 01:19Z) Renamed remaining checklist-template conversion helpers in `server.js` away from legacy naming (`*LegacyCurrentWeek*` -> `*ChecklistTemplateWeek*`) and updated callsites for clarity; validated with `npm run build` + `npm run test:harness`.
- [x] (2026-02-20 01:24Z) Replaced import-shape legacy label usage with neutral constants in `importData.js` (`unsupported_format`), keeping import behavior unchanged; validated with `npm run build` + `npm run test:harness`.
- [x] (2026-02-20 01:30Z) Added canonical `block_end` support for activity blocks in normalization/import paths and week API payloads (`trackingData.js`, `importData.js`, server block sync fallback), and cleaned remaining goal-helper legacy variable naming; validated with `npm run build` + `npm run test:harness`.
- [x] (2026-02-19 22:11Z) Hard-reset local JSON tracking files to simplified on-disk shapes (`days`, `blocks/weeks`, `general/fitness/diet/agent`).
- [ ] Validate end-to-end behavior and update docs (completed: repeated `npm run build`, syntax checks, `readTrackingData()` smoke checks after server/client updates, and `PROJECT.md` updates to canonical day-centric contracts; remaining: manual app flow validation).
- [x] (2026-02-19 22:22Z) Fixed diet runtime contract mismatch by removing stale event props from `App.jsx` and binding `DietView` to `dashPayload.day` + `dashPayload.day_totals`; verified with `npm run build`.
- [x] (2026-02-19 22:24Z) Removed settings-profile alias handling from active client/server/assistant paths so settings are canonical-only (`general/fitness/diet/agent`); verified with `npm run build`, `node --check src/server.js`, and `node --check src/assistant.js`.
- [x] (2026-02-19 22:25Z) Removed unused event helper `client/src/utils/foodEvents.js` and renamed remaining sidebar internals from event wording to detail-line wording; revalidated with `npm run build`.
- [x] (2026-02-19 22:31Z) Converted active meal-response context/payload naming to day-centric fields (`day`, `day_totals`, `day_for_date`, `recent_days`) across `trackingData.js`, `server/ingestHelpers.js`, `server.js`, `assistant.js`, `App.jsx`, and `EstimateResult.jsx`; verified with syntax checks and `npm run build`.
- [x] (2026-02-19 22:32Z) Updated `PROJECT.md` to remove stale event/profile-key docs and align documented model/endpoints with canonical day-centric contracts.
- [x] (2026-02-19 22:37Z) Switched `/api/food/log` to canonical day rows (`listFoodDays`), updated DietView history rendering to canonical fields (`details`, `complete`), removed dead legacy food exports from `trackingData.js`, and trimmed remaining event-era response flags/regex references; verified with syntax checks and `npm run build`.
- [x] (2026-02-19 22:38Z) Added canonical nested payload objects (`rules`, `activity`, `food`) to `readTrackingData()` results and tightened `/api/food/day` server paths to read from `food.days` only; revalidated with syntax checks and `npm run build`.
- [x] (2026-02-19 22:47Z) Migrated server/assistant settings+context reads to canonical nested accessors (`profile`, `rules`, `rules.metadata`) with compatibility fallbacks, centralized assistant `current_week` access through helper, and removed top-level read payload aliases (`general/fitness/diet/agent`, `blocks/weeks/training/days/diet_data`, `fitness_weeks`); validated with syntax checks and `npm run build`.
- [x] (2026-02-19 23:11Z) Removed final direct `data.current_week` reads in `server.js`, added canonical sync from settings training-block metadata into `activity.blocks`, and seeded a starter training block during bootstrap when missing; verified with `node --check` and `npm run build`.

## Surprises & Discoveries

- Observation: The current codebase strongly assumes event-first diet tracking and then derives daily rows.
  Evidence: `/Users/williamleahy/Documents/New project/src/trackingData.js:1186` through `/Users/williamleahy/Documents/New project/src/trackingData.js:1360`.

- Observation: Training currently uses dynamic category checklists (`cardio`, `strength`, etc.) instead of explicit `workouts[]` records.
  Evidence: `/Users/williamleahy/Documents/New project/src/trackingData.js:159`.

- Observation: Current import/export and settings endpoints include legacy and transitional handling that becomes unnecessary in a hard reset.
  Evidence: `/Users/williamleahy/Documents/New project/src/importData.js` and `/Users/williamleahy/Documents/New project/src/server.js` settings/import sections.

- Observation: Replacing `trackingData.js` first is mechanically safe because current consumers compile as long as exported function names remain unchanged.
  Evidence: `node --check src/server.js`, `node --check src/assistant.js`, and `npm run build` all pass after the storage rewrite.

- Observation: Introducing canonical `/api/food/day` while keeping `/api/food/events` as an alias avoids breaking existing diet fetch flows during transition.
  Evidence: client now calls `/api/food/day` in `client/src/api.js`, while existing event flattening still receives an `events` array from the alias payload.

- Observation: Removing dead rollup/sync endpoints is low risk because the UI no longer references those API calls.
  Evidence: project-wide search has no references to `/api/food/rollup`, `/api/food/sync`, `rollupFoodForDate`, or `syncFoodForDate`.

- Observation: Converting settings assistant output schema to canonical keys is safe as long as parser fallbacks still accept old keys.
  Evidence: `SettingsChangesSchema` now uses `general/fitness/diet/agent`, while normalization still reads `user_profile/training_profile/diet_profile/agent_profile` as fallback.

- Observation: Removing `/api/food/events` is safe once client food-day helpers synthesize day summaries from `day.details` and `day` nutrients.
  Evidence: `client/src/utils/foodEvents.js` now builds rows from `GET /api/food/day` payload without reading `json.events`, and `src/server.js` no longer defines `/api/food/events`.

- Observation: During transition, a compile-clean build can still hide a diet-view runtime crash when stale prop names remain in `App.jsx`.
  Evidence: `DietView.jsx` had already switched to `dashDay`/`dashDayTotals`, while `App.jsx` still passed removed `dashRecentEvents*` props until the 22:22Z fix.

- Observation: Alias removal is tractable when applied by domain (settings path first) instead of attempting a single all-at-once delete across import/onboarding/workout systems.
  Evidence: Canonical-only settings changes touched five files and passed build + syntax checks without requiring immediate rewrites of import or Postgres layers.

- Observation: A full frontend event-model removal needs dead-code cleanup after route cuts; otherwise old utility files remain without references.
  Evidence: `client/src/utils/foodEvents.js` had zero imports after app diet flow switched to direct day payload usage, so it was deleted safely.

- Observation: Event-oriented field names persisted longer than event routes, so assistant and ingest contracts still looked legacy even when behavior was day-based.
  Evidence: `assistant.js` and `server/ingestHelpers.js` were still using `food_log_for_date` / `day_totals_from_events` until the 22:30Z contract rename.

- Observation: Product docs were significantly behind implementation and still described removed endpoints (`/api/food/events`, rollup/sync) and old profile keys.
  Evidence: `PROJECT.md` had numerous references to `food_events`, `food_log`, and `user_profile`-style keys until the 22:32Z update.

- Observation: After assistant/ingest contract cleanup, several legacy food helper exports in `trackingData.js` were entirely unreferenced.
  Evidence: project-wide search showed no call sites for `listFoodLog`, `getFoodLogForDate`, `getFoodEventsForDate`, `getDailyFoodEventTotals`, `rollupFoodLogFromEvents`, or `syncFoodEventsToFoodLog` before removal.

- Observation: Canonical nested objects in `readTrackingData()` can be introduced without breaking existing top-level consumers, enabling incremental caller migration.
  Evidence: Adding `rules/activity/food` to the payload and switching `/api/food/day` to `food.days` compiled and built cleanly.

- Observation: Server/assistant can be moved to canonical nested reads without changing runtime behavior by introducing thin accessors and retaining temporary top-level fallbacks.
  Evidence: `src/server.js` and `src/assistant.js` now read profile/rules/metadata via helpers and still pass all syntax/build checks.

- Observation: Most top-level read payload aliases were already unused once server/assistant switched to canonical nested helpers.
  Evidence: Removing top-level aliases from `buildReadPayloadFromCanonical()` did not change build or syntax outcomes.

- Observation: Settings training-block edits were primarily mutating `rules.metadata.training_blocks`, which risked leaving canonical `activity.blocks` stale.
  Evidence: `applySettingsChanges()` updated metadata block state but did not persist matching changes into `activity.blocks` until the 23:11Z sync helper update.

- Observation: Import apply logic was still writing legacy keys (`food_log`, `fitness_weeks`, `user_profile`) that no longer match canonical write paths.
  Evidence: `applyImportPlan()` mutated top-level legacy fields in `src/importData.js` before the 23:37Z rewrite.

- Observation: Fitness UI and API were still coupled to legacy checklist category/index semantics even though canonical training data is workout-list based.
  Evidence: `client/src/views/WorkoutsView.jsx` and `/api/fitness/current/item` depended on `category/index` and `current_week` before the 23:56Z canonical-week update.

- Observation: Non-fitness routes (settings chat + assistant activity responses) still returned only `current_week`, forcing UI fallback even after canonical fitness endpoint migration.
  Evidence: `server.js` settings and ingest payloads lacked canonical `week` fields until the 23:59Z response update.

## Decision Log

- Decision: Perform a hard reset of all stored tracking data and remove migration code paths.
  Rationale: User explicitly approved data loss and requested simpler architecture over compatibility.
  Date/Author: 2026-02-19 / Codex

- Decision: Remove `food_events` entirely from data model, APIs, and UI.
  Rationale: Daily `details` text is accepted as sufficient narrative record; event granularity is unnecessary complexity.
  Date/Author: 2026-02-19 / Codex

- Decision: Prefer direct schema rewrite over adapter layering.
  Rationale: Non-production context makes a big-bang change lower cost and easier to reason about.
  Date/Author: 2026-02-19 / Codex

- Decision: Keep a temporary compatibility boundary in `src/trackingData.js` while `src/server.js` and `src/assistant.js` are still on old keys.
  Rationale: This allows immediate canonical storage changes without breaking the app during staged implementation in the same branch.
  Date/Author: 2026-02-19 / Codex

- Decision: Treat `general/fitness/diet/agent` as canonical settings fields in `server.js`, but continue to accept old input keys (`user_profile`, etc.) during transition.
  Rationale: Enables forward progress on simplified contracts without requiring an atomic assistant+client rewrite in the same edit.
  Date/Author: 2026-02-19 / Codex

- Decision: Remove settings-profile alias support from active UI/server/assistant paths now (keep other legacy domains for later milestones).
  Rationale: Hard-reset scope allows strict canonical contracts; doing this per-domain reduces breakage risk and keeps validation tight.
  Date/Author: 2026-02-19 / Codex

- Decision: Standardize active meal/assistant context payload names to day-centric terms now (`day`, `day_totals`, `day_for_date`, `recent_days`) while retaining legacy helper function names only where not yet refactored.
  Rationale: This cuts visible event-model language from active contracts immediately without requiring an all-at-once rewrite of every historical helper in one pass.
  Date/Author: 2026-02-19 / Codex

- Decision: Update `PROJECT.md` immediately after each contract shift instead of deferring docs to the end.
  Rationale: The migration spans many files; keeping product docs current reduces future regressions and conflicting assumptions during implementation.
  Date/Author: 2026-02-19 / Codex

- Decision: Use `/api/food/log` as a compatibility route name but serve canonical day rows from it now.
  Rationale: Keeps current UI route wiring stable while eliminating legacy row shape semantics (`status`, `healthy`, `notes`) from payloads.
  Date/Author: 2026-02-19 / Codex

- Decision: Keep top-level convenience fields during migration but start moving new server reads to nested canonical objects (`food.days` first).
  Rationale: This reduces break risk while still making structural progress toward removing top-level legacy aliases entirely.
  Date/Author: 2026-02-19 / Codex

- Decision: Defer full `current_week` removal to a dedicated pass after canonical accessor migration.
  Rationale: `current_week` is deeply coupled to checklist-template logic in settings flows; isolating it reduces regression risk during ongoing contract cleanup.
  Date/Author: 2026-02-19 / Codex

- Decision: Remove unused top-level read payload aliases now while retaining only `current_week` as temporary compatibility output.
  Rationale: This reduces surface area immediately and leaves one explicit compatibility seam to remove in the next focused milestone.
  Date/Author: 2026-02-19 / Codex

- Decision: Synchronize canonical `activity.blocks` from settings block edits now, while preserving metadata block payloads as transitional API output.
  Rationale: This keeps canonical training storage authoritative immediately and avoids hidden drift during the remaining `current_week` compatibility period.
  Date/Author: 2026-02-19 / Codex

- Decision: Make importer canonical-first and treat legacy unified import payloads as unsupported.
  Rationale: Hard-reset scope prioritizes a simple single schema and avoids silently writing ignored legacy fields.
  Date/Author: 2026-02-19 / Codex

- Decision: Move workouts UI/API to canonical `week.workouts[]` and use `workout_index` mutations.
  Rationale: This matches the target data template directly and removes an unnecessary checklist-key abstraction from active user flows.
  Date/Author: 2026-02-19 / Codex

- Decision: Add canonical `week` to settings/assistant responses immediately while temporarily keeping `current_week` compatibility fields.
  Rationale: This reduces contract drift quickly without blocking remaining assistant/settings internals that still rely on legacy week paths.
  Date/Author: 2026-02-19 / Codex

- Decision: Remove runtime `current_week` compatibility output/reads now that fitness/settings/client flows consume canonical week contracts.
  Rationale: This completes the active contract simplification and avoids reintroducing legacy shape dependencies in new features.
  Date/Author: 2026-02-20 / Codex

- Decision: Store Postgres data canonically in `user_rules.rules_data` (`profile/activity/food/rules`) and keep `user_profiles` as a mirrored profile text cache.
  Rationale: In hard-reset mode this removes unnecessary event/checklist-table transforms and keeps backend storage shape aligned with JSON mode.
  Date/Author: 2026-02-20 / Codex

- Decision: Drop legacy Postgres tables from canonical schema setup (`food_events`, `food_log`, `fitness_current`, `fitness_weeks`, and transitional tables).
  Rationale: The app no longer reads/writes these domains; removing them prevents accidental drift and keeps DB structure human-readable.
  Date/Author: 2026-02-20 / Codex

- Decision: Remove legacy food route aliases (`/api/food/photo`, `/api/food/manual`) now that canonical `/api/food/log` is the only client path.
  Rationale: This reduces backend contract surface and avoids maintaining duplicate ingestion endpoints with identical behavior.
  Date/Author: 2026-02-20 / Codex

## Outcomes & Retrospective

Implementation now includes canonical storage changes plus first-pass server/client contract shifts. `src/trackingData.js` persists simplified split-file shapes, enforces canonical-only normalization/input extraction, and now exposes canonical activity-week helpers for current week/history/update operations. `server.js` exposes canonical food-day endpoints and canonical settings profile fields, and active settings paths are canonical-only end to end (no profile-key aliases in UI/API/server/assistant settings handling). Fitness UI/API now consume canonical `week.workouts[]` payloads and `workout_index` updates instead of checklist-category keys. Diet rendering and active meal-response contracts consume day-centric fields directly (`day`, `day_totals`), and `/api/food/log` now returns canonical day rows consumed by the history table (`details`, `complete`). The settings path also syncs training-block edits into canonical `activity.blocks` and seeds a starter block on bootstrap. Import analysis/apply targets canonical domains directly, and legacy unified import payloads are treated as unsupported. Runtime `current_week` compatibility has been removed from active server/assistant read paths, Postgres adapter persistence now uses canonical `profile/activity/food/rules` payloads directly in `user_rules`, and `supabase/schema.sql` is simplified to canonical user-scoped tables only. A destructive reset command exists for local JSON + Postgres dev data. Remaining work is broader cleanup around onboarding/workout prompt contracts.

## Context and Orientation

Current storage is now split across:

- `/Users/williamleahy/Documents/New project/tracking-food.json` (`days`)
- `/Users/williamleahy/Documents/New project/tracking-activity.json` (`blocks`, `weeks`)
- `/Users/williamleahy/Documents/New project/tracking-profile.json` (`general`, `fitness`, `diet`, `agent`)
- `/Users/williamleahy/Documents/New project/tracking-rules.json` (metadata and rules)

Current backend storage orchestration:

- `/Users/williamleahy/Documents/New project/src/trackingData.js` (JSON mode and normalization)
- `/Users/williamleahy/Documents/New project/src/trackingDataPostgres.js` (Postgres mode)
- `/Users/williamleahy/Documents/New project/supabase/schema.sql` (database schema)
- `/Users/williamleahy/Documents/New project/src/server.js` (HTTP contracts)

Current UI orchestration:

- `/Users/williamleahy/Documents/New project/client/src/App.jsx`
- `/Users/williamleahy/Documents/New project/client/src/api.js`
- `/Users/williamleahy/Documents/New project/client/src/views/DietView.jsx`
- `/Users/williamleahy/Documents/New project/client/src/views/WorkoutsView.jsx`
- `/Users/williamleahy/Documents/New project/client/src/views/SettingsView.jsx`

## Target Data Model

Canonical simplified model:

- `profile`:
  - `general: string`
  - `fitness: string`
  - `diet: string`
  - `agent: string`

- `training`:
  - `blocks: Array<{ block_id, block_start, block_end, block_name, block_details, workouts[] }>`
  - `weeks: Array<{ week_start, week_end, block_id, workouts[], summary }>`
  - `workouts[]` in blocks: `{ name, description, category, optional }`
  - `workouts[]` in weeks: `{ name, details, completed }`

- `diet`:
  - `days: Array<{ date, weight_lb, calories, fat_g, carbs_g, protein_g, fiber_g, complete, details }>`

Persistent metadata remains separate in rules/config storage:

- settings version/history,
- onboarding metadata,
- last updated timestamps,
- auth ownership (`user_id` in Postgres).

## Plan of Work

### Milestone 1: Replace core storage contracts (no adapters)

Rewrite `/Users/williamleahy/Documents/New project/src/trackingData.js` to read/write only the new schema. Remove all normalization paths for legacy keys (`user_profile`, `training_profile`, `food_log`, `food_events`, `current_week`, `fitness_weeks`) and expose only simplified structures internally and externally.

File shape after reset:

- `/Users/williamleahy/Documents/New project/tracking-profile.json` stores `general/fitness/diet/agent`.
- `/Users/williamleahy/Documents/New project/tracking-activity.json` stores `blocks/weeks`.
- `/Users/williamleahy/Documents/New project/tracking-food.json` stores `days`.
- `/Users/williamleahy/Documents/New project/tracking-rules.json` stores metadata/rules only.

Acceptance:

- `readTrackingData()` and `writeTrackingData()` operate without legacy fields or conversions.

### Milestone 2: Rewrite Postgres schema and storage code

Replace `/Users/williamleahy/Documents/New project/supabase/schema.sql` with simplified tables only:

- `diet_days` (daily diet rows),
- `training_blocks`,
- `training_weeks`,
- `user_profiles` with `general/fitness/diet/agent` payload,
- existing rules/metadata table.

Remove `food_events`, `food_log`, `fitness_current`, and legacy checklist-shape dependence. Update `/Users/williamleahy/Documents/New project/src/trackingDataPostgres.js` to match exactly.

Acceptance:

- Postgres backend round-trips simplified objects only.

### Milestone 3: Rewrite backend API contracts to simplified model

In `/Users/williamleahy/Documents/New project/src/server.js`:

- Keep only day-centric food operations (`/api/food/log`, `/api/food/day`, `/api/food/list` as needed).
- Remove event-centric endpoints (`/api/food/events`, `/api/food/sync`, `/api/food/rollup`) and any event-oriented response payload fields.
- Rewrite settings endpoints to accept/return `general/fitness/diet/agent`.
- Rewrite fitness endpoints to accept/return `blocks/weeks` workout-list shape.
- Remove compatibility logic from import flow; optionally remove import feature entirely, or allow import of new shape only.

Acceptance:

- No API route references legacy schema keys.

### Milestone 4: Rewrite UI to simplified contracts

Update UI modules to consume only simplified responses:

- `/Users/williamleahy/Documents/New project/client/src/api.js`
- `/Users/williamleahy/Documents/New project/client/src/App.jsx`
- `/Users/williamleahy/Documents/New project/client/src/views/DietView.jsx`
- `/Users/williamleahy/Documents/New project/client/src/views/WorkoutsView.jsx`
- `/Users/williamleahy/Documents/New project/client/src/views/SettingsView.jsx`

UI behaviors:

- Diet screen shows one row per day with editable `details`, nutrients, and `complete`.
- Workouts screen shows block definitions and week completion status by workout name.
- Settings screen labels and saves profile blobs as `general/fitness/diet/agent`.

Acceptance:

- Core flows work without hidden conversion layers.

### Milestone 5: Destructive reset command and documentation

Add a reset script (for example `/Users/williamleahy/Documents/New project/scripts/reset-simplified-dev-data.js`) that:

- truncates/recreates JSON files in simplified shape,
- truncates relevant Postgres tables and seeds empty simplified records,
- prints clear confirmation that prior user data was deleted.

Update:

- `/Users/williamleahy/Documents/New project/PROJECT.md`
- `/Users/williamleahy/Documents/New project/README.md`

Acceptance:

- Running reset script always returns the app to a clean, simplified baseline.

## Concrete Steps

Run all commands from `/Users/williamleahy/Documents/New project`.

1. Create working branch.

    git checkout -b codex/simplified-hard-reset

2. Rewrite storage core and Postgres schema/code.

    npm run build
    node --check src/trackingData.js
    node --check src/trackingDataPostgres.js
    node --check src/server.js

3. Implement UI contract updates and remove dead event-based UI paths.

    npm run build

4. Run destructive reset script and verify clean baseline.

    node scripts/reset-simplified-dev-data.js

5. Run app and validate interactive flows.

    npm run dev

Manual flow checks:

- Log a text meal and confirm one `diet.days` row updates.
- Log `samples/avocado-toast.png` and confirm day nutrients + `details` update.
- Edit profile blobs and verify keys are `general/fitness/diet/agent`.
- Mark workout completion in current week and verify week summary text updates.

## Validation and Acceptance

Required pass conditions:

- Build succeeds: `npm run build`.
- Server has no syntax errors: `node --check src/server.js`.
- JSON and Postgres backends both persist and return only simplified structures.
- No runtime references to `food_events`, `food_log`, `current_week`, or `fitness_weeks`.
- UI successfully completes the four core flows: food log (text), food log (image), profile editing, workout completion.

Behavioral acceptance example:

1. Start app with clean reset data.
2. Submit “I ate avocado toast and coffee for breakfast.”
3. Open diet view for the same date.
4. Observe exactly one day record with updated macros/fiber and readable details text.
5. Confirm there is no event-list interface and no event-sync endpoint usage in network calls.

## Idempotence and Recovery

This plan is intentionally destructive and does not preserve old data.

Idempotence expectation:

- Reset script is safe to run repeatedly and always converges to the same empty baseline.

Recovery:

- There is no migration-based rollback path in this plan.
- If rollback is needed, recover by reverting git changes and reloading data from any external backup the developer made manually before starting.

## Artifacts and Notes

Capture these artifacts during implementation:

- Before/after schema snippets for `tracking-food.json`, `tracking-activity.json`, `tracking-profile.json`.
- Terminal output from reset script showing deletions and re-seeding.
- Example API responses for simplified:
  - food log response,
  - settings state response,
  - workouts current state response.

## Interfaces and Dependencies

At completion, the following interfaces must exist and be stable:

- `src/trackingData.js`:
  - `readTrackingData()` returns simplified model only.
  - `writeTrackingData()` accepts simplified model only.

- `src/trackingDataPostgres.js`:
  - read/write functions map 1:1 to simplified tables and fields.

- `src/server.js`:
  - food APIs are day-centric only.
  - settings APIs use `general/fitness/diet/agent`.
  - fitness APIs use `blocks/weeks` workout-list shape.

- `client/src/api.js`:
  - no event-specific methods.
  - request/response types aligned with simplified backend.

Plan change note (2026-02-19 22:03Z): Rewrote this plan from phased migration to hard reset after explicit user instruction that production compatibility and data preservation are unnecessary.
Plan change note (2026-02-19 22:06Z): Recorded initial implementation progress after replacing `src/trackingData.js` with a simplified canonical split-file model and resetting local tracking JSON files to the new schema; documented temporary compatibility aliases that remain to be removed.
Plan change note (2026-02-19 22:11Z): Logged continued implementation: server settings profile fields now canonicalized to `general/fitness/diet/agent` (with transitional aliases), canonical `/api/food/day` endpoints were added, and client settings/food API calls were updated to the new routes/keys.
Plan change note (2026-02-19 22:13Z): Logged additional cleanup after removing deprecated food rollup/sync routes and client calls, and updated progress/discoveries for the canonical day-centric food flow transition.
Plan change note (2026-02-19 22:14Z): Logged assistant-side contract updates after changing settings output schema/parsing to canonical profile keys with fallback alias parsing for transitional compatibility.
Plan change note (2026-02-19 22:18Z): Logged removal of the `/api/food/events` alias route and client-side event dependency, with day-centric synthesis from `day` payloads for transitional diet summaries.
Plan change note (2026-02-19 22:22Z): Logged the diet UI contract fix after aligning `App.jsx` prop passing to `DietView` (`day`/`day_totals` instead of removed `dashRecentEvents*`) and revalidating with `npm run build`.
Plan change note (2026-02-19 22:24Z): Logged canonical-only settings cleanup after removing `user_profile`/`training_profile`/`diet_profile`/`agent_profile` alias handling in active client API, settings normalization, server settings routes, and assistant settings parsing.
Plan change note (2026-02-19 22:25Z): Logged frontend cleanup after deleting dead `foodEvents` helper and renaming sidebar day-summary internals to detail-line terminology.
Plan change note (2026-02-19 22:31Z): Logged active meal/assistant contract rename from legacy event language to day-centric fields and corresponding server/client/assistant updates (including `EstimateResult`), validated by syntax checks and `npm run build`.
Plan change note (2026-02-19 22:32Z): Logged `PROJECT.md` alignment updates so documented data model and endpoint contracts now match the day-centric implementation.
Plan change note (2026-02-19 22:37Z): Logged canonical day-row history migration (`/api/food/log` + DietView), deletion of dead legacy food helper exports, and final event-era naming cleanup in active ingest helpers.
Plan change note (2026-02-19 22:38Z): Logged read-payload canonical nesting additions (`rules/activity/food`) and `/api/food/day` migration to nested `food.days` reads.
Plan change note (2026-02-19 22:47Z): Logged canonical accessor migration in `server.js` and `assistant.js` (`profile`/`rules`/`rules.metadata`), removal of unused top-level read payload aliases in `trackingData.js`, and deliberate deferral of full `current_week` contract removal to a dedicated next pass.
Plan change note (2026-02-19 23:11Z): Logged `server.js` settings-path cleanup: removed direct `data.current_week` reads, added canonical `activity.blocks` sync from settings block updates, and seeded starter training block metadata+activity state when absent.
Plan change note (2026-02-19 23:20Z): Logged new destructive reset command (`scripts/reset-simplified-dev-data.js`) and npm script wiring, including dry-run/skip flags and support for both legacy and simplified Postgres table names.
Plan change note (2026-02-19 23:37Z): Logged canonical-only `trackingData.js` normalization/input extraction (legacy merge removal), plus canonical import rewrite in `importData.js` (`profile`/`food_days`/`activity_blocks`/`activity_weeks`/`rules`) and doc alignment updates.
Plan change note (2026-02-19 23:56Z): Logged canonical workouts refactor across `trackingData.js`, `server.js`, and client workouts/sidebar/app flows: current/history fitness endpoints now serve canonical `week.workouts[]`, item updates use `workout_index`, and UI no longer depends on checklist category keys for workout rendering/editing.
Plan change note (2026-02-19 23:59Z): Logged canonical `week` response additions in `server.js` settings chat/confirm and assistant activity payloads, enabling canonical week consumption beyond the dedicated fitness endpoints.
Plan change note (2026-02-20 00:20Z): Logged final runtime `current_week` compatibility cleanup in `trackingData.js`/`server.js`/`assistant.js`, static `public/app.js` migration to canonical week contracts, and docs updates (`README.md`, `PROJECT.md`, `docs/LLM_TEST_MATRIX.md`).
Plan change note (2026-02-20 00:43Z): Logged Postgres bridge cleanup in `trackingDataPostgres.js` (canonical-only read/write via `user_rules` + `user_profiles`), canonical rewrite of `scripts/migrate-json-to-postgres.js`, and deterministic harness migration to canonical day/workout assertions (`scripts/run-deterministic-harness.js`).
Plan change note (2026-02-20 01:02Z): Logged Postgres schema simplification in `supabase/schema.sql`, dropping legacy domain tables and retaining only canonical `user_profiles`/`user_rules` tables with RLS policies.
Plan change note (2026-02-20 01:12Z): Logged removal of `/api/food/photo` + `/api/food/manual` compatibility endpoints, deletion of dead API wrappers in `client/src/api.js`, and canonical wording updates in import UX copy and product docs.
Plan change note (2026-02-20 01:19Z): Logged server helper rename cleanup for checklist-template week conversion naming and verified no behavior changes with build + deterministic harness.
Plan change note (2026-02-20 01:24Z): Logged import-shape terminology cleanup in `importData.js` (neutral shape constants and `unsupported_format` identifier) with no runtime behavior changes.
Plan change note (2026-02-20 01:30Z): Logged `block_end` field propagation work across canonical block normalization/import/API output and minor goal-helper naming cleanup in `server.js`.
