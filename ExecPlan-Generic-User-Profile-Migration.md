# Generic User Profile Migration (Phase 1 + Phase 2)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with those rules.

## Purpose / Big Picture

After these phases, profile storage is fully `user_profile`-first and no longer keeps `transition_context` in active app contracts. This allows non-trans users to have a neutral profile shape while keeping trans-specific data in an optional module (`user_profile.modules.trans_care`) without carrying a parallel legacy field.

## Progress

- [x] (2026-02-07 20:12Z) Audited all `transition_context` references and profile DB schema usage.
- [x] (2026-02-07 20:43Z) Added generic profile normalization and dual-read/write in JSON storage path (`user_profile` + legacy `transition_context` mirror).
- [x] (2026-02-07 20:43Z) Added Postgres schema/data access support for `user_profile` with fallback when the DB column is not yet present.
- [x] (2026-02-07 20:43Z) Extended settings assistant/confirm pipeline to accept `user_profile_patch` while preserving legacy `transition_context_patch`.
- [x] (2026-02-07 20:43Z) Updated project docs and validated syntax/build checks.
- [x] (2026-02-07 20:49Z) Updated assistant QA/meal context to prefer generic `user_profile` summary with optional `trans_care` module fallback.
- [x] (2026-02-07 20:49Z) Added and ran one-time `migrate:profile` script to write `user_profile` into `tracking-profile.json`.
- [x] (2026-02-07 21:03Z) Removed top-level `transition_context` from model-facing assistant contexts (QA, meal response, settings chat) while keeping server-side legacy patch compatibility.
- [x] (2026-02-07 21:18Z) Removed server-side legacy `transition_context` compatibility from settings apply/validation and Postgres/JSON persistence paths; data migration now drops legacy field.
- [x] (2026-02-07 21:31Z) Removed runtime transition-context fallback shim from `src/trackingData.js`; migration handling is now explicit via migration script/SQL only.
- [x] (2026-02-07 21:31Z) Extended `migrate:profile` to migrate both `tracking-profile.json` and legacy `tracking-data.json`.
- [x] (2026-02-07 21:43Z) Cleaned `supabase/schema.sql` to the `user_profile` steady-state by removing the one-time `transition_context` migration block after successful apply.

## Surprises & Discoveries

- Observation: Postgres path currently selects only `transition_context` and would fail if we start writing `user_profile` without schema support.
  Evidence: `src/trackingDataPostgres.js` query currently selects `user_id,transition_context,updated_at`.

- Observation: During migration, precedence between legacy `transition_context` and new `user_profile.modules.trans_care` must be explicit or patches can silently drift.
  Evidence: Write-path normalization originally preferred legacy transition data even when new profile modules were updated.

## Decision Log

- Decision: Keep `transition_context` as a mirrored legacy field during Phase 1.
  Rationale: Avoid breaking existing assistant logic and callers while introducing `user_profile` incrementally.
  Date/Author: 2026-02-07 / Codex

- Decision: Represent trans-specific details under `user_profile.modules.trans_care`.
  Rationale: Keeps the root profile generic while preserving all current transition data.
  Date/Author: 2026-02-07 / Codex

- Decision: In normalization, prefer `user_profile.modules.trans_care` as source-of-truth for mirrored `transition_context` once present.
  Rationale: Enables `user_profile_patch` updates to propagate correctly during phased migration.
  Date/Author: 2026-02-07 / Codex

- Decision: Add runtime fallback for missing `user_profile` DB column in Postgres adapter.
  Rationale: Allows staged rollout where code can deploy before SQL migration is applied.
  Date/Author: 2026-02-07 / Codex

- Decision: Stop sending top-level `transition_context` in assistant prompt context; keep only `user_profile` (with optional `modules.trans_care`).
  Rationale: Keeps user-facing prompts generic and avoids surfacing legacy shape while preserving backend compatibility.
  Date/Author: 2026-02-07 / Codex

- Decision: Remove `transition_context` compatibility entirely from active runtime contracts.
  Rationale: User explicitly confirmed backward compatibility is not required; removing the parallel field reduces schema complexity and duplicate patch paths.
  Date/Author: 2026-02-07 / Codex

- Decision: Keep legacy `transition_context` handling only in explicit migration paths (script + SQL), not in runtime normalization.
  Rationale: Avoid hidden compatibility logic in production code while still providing a safe one-time upgrade path.
  Date/Author: 2026-02-07 / Codex

- Decision: After successful migration in target DB, remove one-time `transition_context` SQL migration block from `supabase/schema.sql`.
  Rationale: Keeps the checked-in schema as a clean steady-state definition for new environments.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Phase 1 and Phase 2 are implemented. The app now uses `user_profile` as the only active profile contract in assistant prompt context, settings proposals, and persistence writes. Existing legacy `transition_context` values are migrated into `user_profile.modules.trans_care` through explicit migration paths and then removed from active JSON and Postgres flows.

## Context and Orientation

Key files:

- `src/trackingData.js`: split-file read/write and shape normalization for JSON backend.
- `src/trackingDataPostgres.js`: read/write mapping for `user_profiles` table.
- `supabase/schema.sql`: SQL schema and migration-safe DDL.
- `src/assistant.js`: settings assistant structured output schema.
- `src/server.js`: settings proposal validation and apply logic.

The migration now includes a deprecation pass: migrate legacy context into `user_profile` and remove `transition_context` from active contracts.

## Plan of Work

Implement normalization helper(s) that guarantee a generic `user_profile` with default sections (`general`, `medical`, `nutrition`, `fitness`, `goals`, `behavior`, `modules`, `assistant_preferences`, `metadata`) and ensure `modules.trans_care` mirrors legacy trans context when present.

Update read/write code so JSON and Postgres paths persist `user_profile` only. For existing datasets, map legacy `transition_context` to `user_profile.modules.trans_care` during migration and drop the legacy key/column.

Use `user_profile_patch` as the only profile patch field in settings assistant flow.

## Concrete Steps

From repo root:

1. Edit `src/trackingData.js` and `src/trackingDataPostgres.js`.
2. Edit `supabase/schema.sql` for additive column/backfill.
3. Edit `src/assistant.js` and `src/server.js` settings patch flow.
4. Update docs.
5. Run:

   node --check src/trackingData.js
   node --check src/trackingDataPostgres.js
   node --check src/assistant.js
   node --check src/server.js
   npm run build

## Validation and Acceptance

Acceptance criteria:

- `readTrackingData()` returns a generic `user_profile` object and does not expose `transition_context`.
- Settings endpoint accepts `user_profile_patch` and persists updates.
- Existing legacy `transition_context` data is migrated into `user_profile.modules.trans_care` and no longer actively used.
- Build/syntax checks pass.

## Idempotence and Recovery

Schema/data migration remains idempotent: repeated runs keep `user_profile` populated and do not reintroduce `transition_context`.

## Artifacts and Notes

Artifacts at completion:

- build + syntax transcripts,
- short summary of new `user_profile` shape and compatibility behavior.

## Interfaces and Dependencies

New/updated payload field in settings assistant flow:

- `user_profile_patch` (JSON object string in model schema, parsed server-side).

New DB column:

- `public.user_profiles.user_profile jsonb not null default '{}'::jsonb`.

---

Plan revision note: Updated this plan after implementation to reflect completed migration steps, decisions, validation outcomes, the prompt-context cleanup, and the final removal of runtime `transition_context` compatibility per user direction.
