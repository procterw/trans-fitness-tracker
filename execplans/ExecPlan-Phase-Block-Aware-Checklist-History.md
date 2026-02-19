# Phase/Block-Aware Fitness Checklist and History

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, fitness checklist planning is phase-aware. Users can maintain a library of training blocks (phase id, name, description, checklist), choose an active block, and have new weeks seeded from that block automatically. Past weeks preserve their phase snapshot so workout history can be grouped by phase without being rewritten by future renames. In settings chat, phase switches require explicit timing choice (`immediate` vs `next_week`) whenever there is progress in the current week.

## Progress

- [x] (2026-02-18 16:13Z) Audited current checklist/history/settings data flow in server, storage adapters, and client views.
- [x] (2026-02-18 16:20Z) Added training block metadata normalization and week phase snapshot fields in tracking data normalization and rollover.
- [x] (2026-02-18 16:23Z) Updated Postgres schema + mapper for week phase snapshot fields.
- [x] (2026-02-18 16:34Z) Implemented settings proposal support for structured `training_block` changes and timing-gated phase switches.
- [x] (2026-02-18 16:38Z) Updated settings assistant schema/instructions/context for phase/block changes.
- [x] (2026-02-18 16:41Z) Updated settings and workouts UI for phase display + grouped history sections.
- [ ] Run build and targeted validation scenarios, then capture outcomes.

## Surprises & Discoveries

- Observation: Postgres mappers were dropping unknown week fields, so week-level phase snapshot data required explicit DB columns and mapping updates.
  Evidence: `src/trackingDataPostgres.js` selected/wrote only `week_start`, `week_label`, `summary`, `checklist`, `category_order` before this change.

## Decision Log

- Decision: Store block library in `metadata.training_blocks` and keep `metadata.checklist_template` mirrored to the active block during migration.
  Rationale: Preserves backward compatibility while introducing canonical block-aware behavior.
  Date/Author: 2026-02-18 / Codex

- Decision: Treat history grouping as week snapshot fields (`training_block_id/name/description`) instead of joining dynamically from current block definitions.
  Rationale: Historical labels remain stable even if block definitions are renamed later.
  Date/Author: 2026-02-18 / Codex

- Decision: Gate phase-switch application timing only when current-week progress exists.
  Rationale: Matches “ask each time” requirement without adding friction to untouched weeks.
  Date/Author: 2026-02-18 / Codex

## Outcomes & Retrospective

Implementation completed for data model, settings apply path, assistant schema, Postgres storage mapping, and client rendering updates. Remaining step is to run and document validation commands and scenario checks.

## Context and Orientation

The checklist system lives in:
- `src/trackingData.js` for normalization, rollover, and storage-shape handling.
- `src/server.js` for settings proposal validation/application and API responses.
- `src/assistant.js` for settings assistant structured schema + prompting.
- `src/trackingDataPostgres.js` and `supabase/schema.sql` for Postgres persistence.
- `client/src/views/SettingsView.jsx` and `client/src/views/WorkoutsView.jsx` for phase visibility and history grouping.

A training block is a reusable weekly checklist template with stable id and editable name/description.

## Plan of Work

Introduce canonical training block metadata and ensure every week carries a phase snapshot. Keep compatibility by mirroring active block template into legacy checklist template metadata. Extend settings proposal schema to support block switch/create/update and apply timing. Add timing confirmation behavior when current week has progress and timing is missing. Expand assistant schema/context to produce structured phase updates. Update Postgres schema/mapping so phase snapshot fields are not lost. Update UI to surface active phase in Settings and group workout history by phase.

## Concrete Steps

1. Edit `src/trackingData.js`:
   - normalize/create `metadata.training_blocks` on read,
   - backfill week phase snapshots,
   - seed new weeks from active block and snapshot fields,
   - expose training block summary helper.
2. Edit `src/server.js`:
   - accept/normalize/validate `changes.training_block`,
   - apply phase switch/create/update logic,
   - enforce timing choice when needed,
   - include `training_blocks` in settings state API.
3. Edit `src/assistant.js`:
   - extend settings schema to include `training_block`,
   - include block summaries in context,
   - normalize emitted phase changes.
4. Edit `supabase/schema.sql` and `src/trackingDataPostgres.js`:
   - add and map week snapshot columns.
5. Edit client views for phase metadata in settings and grouped history.
6. Run build and validate behavior scenarios.

## Validation and Acceptance

- `npm run build` must pass.
- With legacy JSON activity data, loading current week must create a default block library and active block.
- Switching phases in settings with checked current-week items and missing `apply_timing` must return a follow-up question.
- `apply_timing=immediate` must update current week checklist and snapshot fields.
- `apply_timing=next_week` must leave current week unchanged and update active block for future rollover.
- Workouts history must render grouped phase sections using stored week snapshots.

## Idempotence and Recovery

Normalization and schema updates are additive/idempotent. If a migration step fails, rerun with same commands; field additions use `if not exists`. Existing checklist template mirror remains available for compatibility rollback.

## Artifacts and Notes

Key API and schema deltas:
- New metadata field: `metadata.training_blocks`.
- New week fields: `training_block_id`, `training_block_name`, `training_block_description`.
- New settings proposal field: `changes.training_block`.
- New settings state field: `training_blocks` summary.

## Interfaces and Dependencies

- `POST /api/settings/chat` and `POST /api/settings/confirm` now accept `changes.training_block` with:
  - `id?: string`
  - `name?: string`
  - `description?: string`
  - `apply_timing?: "immediate" | "next_week"`
  - `checklist_categories?: Array<{ key, label, items[] }>`
- `GET /api/settings/state` now returns `training_blocks` summary.
- `GET /api/fitness/current` and `GET /api/fitness/history` return week phase snapshot fields.

Plan change note (2026-02-18 16:41Z): Initial implementation and validation checklist captured for the phase/block-aware checklist refactor.
