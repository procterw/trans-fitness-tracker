# Split Tracking Data Into Multiple Files

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it. The repository does not contain `.agent/PLANS.md`, so `PLANS.md` is treated as the authoritative ExecPlan guide.

## Purpose / Big Picture

After this change, the tracker stores food data, activity data, user profile information, and interpretation rules in separate JSON files instead of a single `tracking-data.json`. The server continues to expose the same API behavior, but reads/writes are routed to the new files under the hood. A user can verify the change by starting the app, logging a meal or activity, and then seeing new files (`tracking-food.json`, `tracking-activity.json`, `tracking-profile.json`, `tracking-rules.json`) updated with the expected sections while the app still functions.

## Progress

- [x] (2026-02-06 20:43Z) Review existing data layout and usages of `tracking-data.json` to define a split map and migration strategy.
- [x] (2026-02-06 20:53Z) Implement multi-file read/write and safe migration in `src/trackingData.js`, keeping existing public APIs stable.
- [x] (2026-02-06 20:55Z) Generate new data files from the current `tracking-data.json` without deleting the legacy file.
- [x] (2026-02-06 20:57Z) Update docs and environment examples to describe the new files and configuration.
- [ ] (2026-02-06 20:57Z) Validate basic flows (food log, fitness checklist, dashboard) to ensure behavior is unchanged.

## Surprises & Discoveries

- Observation: Pending.
  Evidence: N/A.

## Decision Log

- Decision: Use four top-level JSON files: `tracking-food.json` (food log + food events), `tracking-activity.json` (current week + fitness history), `tracking-profile.json` (transition context), and `tracking-rules.json` (metadata + diet/fitness philosophy + parsing conventions).
  Rationale: Matches the user’s requested categories while keeping the existing object shape inside each file and minimizing downstream code changes.
  Date/Author: 2026-02-06 / Codex

- Decision: Preserve backward compatibility by supporting a legacy single-file mode via `TRACKING_DATA_FILE`, but prefer the new multi-file defaults when no legacy path is set.
  Rationale: Avoids breaking existing setups while enabling the requested split by default.
  Date/Author: 2026-02-06 / Codex

- Decision: Perform a safe, non-destructive migration by generating the new files if they are missing and `tracking-data.json` exists, without deleting the legacy file.
  Rationale: Prevents data loss and makes the change reversible.
  Date/Author: 2026-02-06 / Codex

- Decision: Preserve any unrecognized top-level keys by storing them in `tracking-rules.json`.
  Rationale: Avoids silently dropping future data fields while keeping food/activity/profile files scoped to their domains.
  Date/Author: 2026-02-06 / Codex

## Outcomes & Retrospective

Pending. This will be filled in once implementation and validation are complete.

## Context and Orientation

All data reads and writes are centralized in `src/trackingData.js`. Other modules (for example `src/assistant.js`, `src/visionNutrition.js`, and `src/server.js`) call `readTrackingData()` and helper functions from that file, so we can implement multi-file storage there without touching most callers. The current single file, `tracking-data.json`, includes `metadata`, `food_log`, `food_events`, `current_week`, `fitness_weeks`, `diet_philosophy`, `fitness_philosophy`, and `transition_context`. We will split those sections into four files and keep the aggregated shape intact when `readTrackingData()` is called.

## Plan of Work

First, define new default file paths for the food, activity, profile, and rules files in `src/trackingData.js`, plus optional environment variables to override them. Add a legacy mode that continues to use `TRACKING_DATA_FILE` if set, but otherwise reads/writes the four new files. Next, implement `readTrackingData()` to assemble a combined object from the four files and `writeTrackingData()` to split the combined object back out. Add a migration step that creates the new files from `tracking-data.json` if the new files do not exist yet. Then, create the four new JSON files in the repository by splitting the existing data. Finally, update `PROJECT.md` and `.env.example` to document the new storage layout and configuration.

## Concrete Steps

Run commands from the repository root.

1. Update `src/trackingData.js`:
   - Add file path constants for `tracking-food.json`, `tracking-activity.json`, `tracking-profile.json`, `tracking-rules.json` with optional env overrides.
   - Implement a `splitTrackingData()` helper to produce four objects from the aggregated data.
   - Implement a `mergeTrackingData()` helper to assemble the aggregated object from the four files.
   - Add a migration function that, when the new files do not exist but `tracking-data.json` does, reads the legacy file and writes the new files.
   - Preserve existing exported function signatures so other modules do not change.

2. Generate new JSON files from `tracking-data.json` and ensure they are written with pretty JSON formatting.

3. Update `PROJECT.md` to point to the new files as the source of truth for each category and mention the legacy file behavior.

4. Update `.env.example` to document the new environment variables and note that `TRACKING_DATA_FILE` enables legacy single-file mode.

## Validation and Acceptance

Start the app with `npm run dev` and verify:

- Logging a meal writes to `tracking-food.json` and the Food tab still shows the expected totals.
- Checking a fitness item updates `tracking-activity.json` and the Fitness tab reflects the change.
- Assistant context (diet/fitness philosophy) is still available, coming from `tracking-rules.json`.

No automated tests exist; validation is manual.

## Idempotence and Recovery

The migration writes new files without deleting `tracking-data.json`. Re-running the migration is safe because it only creates the new files when they are missing. To roll back, set `TRACKING_DATA_FILE` to the legacy file and remove or ignore the new files.

## Artifacts and Notes

Pending; will include a short example of the generated file structure after implementation.

## Interfaces and Dependencies

`src/trackingData.js` will continue to export the same functions (`readTrackingData`, `writeTrackingData`, and helpers). The only interface changes are new environment variables:

- `TRACKING_FOOD_FILE` (optional): path to the food data JSON.
- `TRACKING_ACTIVITY_FILE` (optional): path to the activity data JSON.
- `TRACKING_PROFILE_FILE` (optional): path to the profile data JSON.
- `TRACKING_RULES_FILE` (optional): path to the rules data JSON.
- `TRACKING_DATA_FILE` (optional, legacy): when set, the app uses the single-file mode instead of the new split files.
