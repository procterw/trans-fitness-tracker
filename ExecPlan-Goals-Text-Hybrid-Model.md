# Simplify Goals Storage To Text-First Hybrid Model

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with those rules.

## Purpose / Big Picture

After this change, goal capture is text-first (`goals_text`) so users can express broad intent naturally. The app still keeps deterministic compatibility arrays (`goals.*`) derived from text for existing UI and checklist logic. Checklist updates remain explicit suggestions requiring confirmation.

## Progress

- [x] (2026-02-12 20:02Z) Added shared goals-text utilities (`src/goalsText.js`) for normalization, parsing, legacy backfill, and derived list generation.
- [x] (2026-02-12 20:05Z) Updated profile normalization (`src/trackingData.js`) to make `goals_text` canonical and `goals.*` derived compatibility fields.
- [x] (2026-02-12 20:07Z) Updated onboarding/settings/server flows (`src/server.js`) to apply goals-text derivation and attach checklist suggestions (proposal-only) on settings goals-text edits.
- [x] (2026-02-12 20:08Z) Updated assistant context/instructions (`src/assistant.js`) so LLM patches target `user_profile.goals_text`.
- [x] (2026-02-12 20:09Z) Updated migration script (`scripts/migrate-profile-to-user-profile.js`) and default profile seed (`tracking-profile.json`) for new fields.
- [x] (2026-02-12 20:13Z) Validated with syntax checks and `npm run build` (success).

## Surprises & Discoveries

- Observation: Onboarding stage advancement checks goal context before write-time normalization, so `goals_text`-only patches would not advance to checklist unless derivation happens in-server first.
  Evidence: `hasGoalContext(profile)` is evaluated immediately in `/api/onboarding/chat` stage `goals` branch.

## Decision Log

- Decision: Keep compatibility arrays (`goals.*`) derived from `goals_text` on every normalization/write.
  Rationale: Preserves existing UI/API consumers while making text blobs canonical.
  Date/Author: 2026-02-12 / Codex

- Decision: Trigger checklist suggestion generation (not auto-apply) when settings `user_profile_patch.goals_text` changes and no checklist proposal is present.
  Rationale: Enforces goals-to-checklist coupling through explicit confirmation.
  Date/Author: 2026-02-12 / Codex

## Outcomes & Retrospective

Completed the text-first hybrid goals model with compatibility arrays preserved. `goals_text` is now normalized and backfilled from legacy goals when needed, `goals.*` are deterministically derived from text, and server flows apply derivation on goals-text edits. Settings now generates checklist suggestions (proposal-only) when goals text is changed and no checklist proposal exists, preserving the confirmation gate. Build and syntax checks passed.

## Context and Orientation

Key files:

- `src/goalsText.js`: goals text normalization + derivation logic.
- `src/trackingData.js`: canonical profile normalization used by read/write paths.
- `src/server.js`: onboarding/settings flow and proposal behavior.
- `src/assistant.js`: LLM context and instruction policy for profile patches.
- `scripts/migrate-profile-to-user-profile.js`: migration/backfill for existing files.
- `tracking-profile.json`: default user profile seed.

## Plan of Work

Implement goals text as canonical profile fields, derive compatibility lists from text, ensure onboarding/settings save flows derive immediately when goals text changes, and ensure settings edits produce checklist suggestions requiring confirmation.

## Concrete Steps

1. Add shared goals text helper module.
2. Integrate helper into profile normalization and migration.
3. Update assistant prompts/context to target goals text.
4. Update server onboarding/settings behavior for derivation and checklist suggestion coupling.
5. Run build checks.

## Validation and Acceptance

- `npm run build` succeeds.
- Existing UI remains functional using compatibility arrays.
- Settings goals-text edit can return checklist proposal without auto-applying.
- Onboarding goals stage can advance when goals are provided via `goals_text` patch.

## Idempotence and Recovery

Normalization and migration are idempotent; reruns preserve deterministic outputs. If derivation behavior needs adjustment, update `src/goalsText.js` and rerun migration/build.

## Artifacts and Notes

Primary artifacts: updated source files listed above and successful build transcript.

## Interfaces and Dependencies

New module API in `src/goalsText.js`:

- `normalizeGoalTextValue(value)`
- `parseGoalsTextToList(value)`
- `buildGoalsTextFromLegacyGoals(legacyGoals)`
- `deriveGoalsListsFromGoalsText({ goalsText, legacyGoals })`
- `normalizeGoalsText(value, { legacyGoals })`
