# Generic User Profile Migration (Phase 1)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with those rules.

## Purpose / Big Picture

After this phase, profile storage supports a generic `user_profile` object while preserving compatibility with existing `transition_context` readers and data. This allows non-trans users to have a neutral profile shape while keeping trans-specific data in an optional module. Existing endpoints and assistant behavior continue to work.

## Progress

- [x] (2026-02-07 20:12Z) Audited all `transition_context` references and profile DB schema usage.
- [x] (2026-02-07 20:43Z) Added generic profile normalization and dual-read/write in JSON storage path (`user_profile` + legacy `transition_context` mirror).
- [x] (2026-02-07 20:43Z) Added Postgres schema/data access support for `user_profile` with fallback when the DB column is not yet present.
- [x] (2026-02-07 20:43Z) Extended settings assistant/confirm pipeline to accept `user_profile_patch` while preserving legacy `transition_context_patch`.
- [x] (2026-02-07 20:43Z) Updated project docs and validated syntax/build checks.

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

## Outcomes & Retrospective

Phase 1 migration is implemented. The app now supports generic `user_profile` storage while preserving legacy `transition_context` compatibility in both JSON and Postgres backends. Settings chat can apply `user_profile_patch` proposals, and transition-context patches are mirrored into `user_profile.modules.trans_care`. This creates a safe base for subsequent phases that move assistant prompting and UI fully to generic profile semantics.

## Context and Orientation

Key files:

- `src/trackingData.js`: split-file read/write and shape normalization for JSON backend.
- `src/trackingDataPostgres.js`: read/write mapping for `user_profiles` table.
- `supabase/schema.sql`: SQL schema and migration-safe DDL.
- `src/assistant.js`: settings assistant structured output schema.
- `src/server.js`: settings proposal validation and apply logic.

The migration is additive in Phase 1: add `user_profile`, keep `transition_context` available.

## Plan of Work

Implement normalization helper(s) that guarantee a generic `user_profile` with default sections (`general`, `medical`, `nutrition`, `fitness`, `goals`, `behavior`, `modules`, `assistant_preferences`, `metadata`) and ensure `modules.trans_care` mirrors legacy trans context when present.

Update read/write code so both JSON and Postgres paths return both fields (`user_profile`, `transition_context`) for compatibility. For Postgres, add `user_profile` column in schema and handle fallback when the column does not yet exist.

Extend settings schema and apply logic to accept and apply `user_profile_patch` in addition to legacy `transition_context_patch`.

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

- `readTrackingData()` returns a generic `user_profile` object and still provides `transition_context` for compatibility.
- Settings endpoint accepts `user_profile_patch` and persists updates.
- Existing transition-context based behavior remains functional.
- Build/syntax checks pass.

## Idempotence and Recovery

All schema and code changes are additive. Applying SQL migration repeatedly is safe (`if not exists`). If rollback is needed, code can continue using legacy `transition_context` while ignoring `user_profile`.

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

Plan revision note: Updated this plan after implementation to reflect completed migration steps, decisions, and validation outcomes.
