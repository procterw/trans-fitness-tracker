# Four Text-Profile Data Model + Settings Textarea/Chat Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with those rules.

## Purpose / Big Picture

After this change, settings profile data is represented as four separate user-managed text blobs: `user_profile`, `training_profile`, `diet_profile`, and `agent_profile`. Users can edit these directly in Settings textareas and save immediately, or ask chat to propose changes and confirm before apply. This removes JSON patch-style settings edits for checklist/diet/fitness philosophy from Settings routes and makes profile context simpler and explicit.

## Progress

- [x] (2026-02-17 22:10Z) Reworked profile persistence shape in `src/trackingData.js` to canonical four text blobs.
- [x] (2026-02-17 22:18Z) Updated Postgres adapter in `src/trackingDataPostgres.js` to read/write four profile text fields via `user_profiles.user_profile` JSONB.
- [x] (2026-02-17 22:21Z) Updated migration scripts and template profile file (`scripts/migrate-profile-to-user-profile.js`, `scripts/migrate-json-to-postgres.js`, `tracking-profile.json`).
- [x] (2026-02-17 22:37Z) Replaced Settings API behavior in `src/server.js` with profile-only proposal/confirm flow and added `/api/settings/state` and `/api/settings/profiles`.
- [x] (2026-02-17 22:51Z) Updated assistant settings schema/prompt/context in `src/assistant.js` and injected `agent_profile` into all system instruction builders.
- [x] (2026-02-17 23:06Z) Replaced Settings UI with four textareas plus chat confirm flow (`client/src/views/SettingsView.jsx`, `client/src/App.jsx`, `client/src/api.js`, `client/src/styles.css`).
- [x] (2026-02-17 23:10Z) Updated product docs (`README.md`, `PROJECT.md`).
- [x] (2026-02-17 23:36Z) Ran validation commands (`npm run test:harness`, `npm run test:ingest-mocked`, `npm run build`) and fixed final API payload cleanup (`apply_mode` removed from client confirm call).
- [x] (2026-02-17 23:41Z) Fixed checklist bootstrap metadata overwrite in `src/server.js` (`applyStarterSeed`) and re-ran validation commands.

## Surprises & Discoveries

- Observation: Existing `settingsBootstrap` behavior was tightly coupled to structured `user_profile` object seeding and timezone fields.
  Evidence: `src/server.js` previous flow used object patching and `applyClientTimezone(...)`.

- Observation: During final verification, `applyStarterSeed` could overwrite `metadata.checklist_template` after seeding it because metadata was reassigned at function end.
  Evidence: `src/server.js` had a temporary `dataMetadata` assignment inside checklist seed branch, then replaced with stale `metadata` object before return.

## Decision Log

- Decision: Keep all four profile text blobs in the profile store (`tracking-profile.json` / `user_profiles`) rather than split across profile/rules stores.
  Rationale: It keeps settings profile editing in one canonical location and simplifies read/write semantics.
  Date/Author: 2026-02-17 / Codex

- Decision: Remove legacy settings JSON patch domains from Settings chat/confirm (`checklist_categories`, `diet_philosophy_patch`, `fitness_philosophy_patch`).
  Rationale: This was explicitly requested as hard cutover for settings editing.
  Date/Author: 2026-02-17 / Codex

- Decision: Preserve first-visit checklist seeding behavior while changing profile seeding to text blob.
  Rationale: Workout checklist generation and rollover behavior remain important and are outside profile text refactor scope.
  Date/Author: 2026-02-17 / Codex

- Decision: Apply `agent_profile` by appending it to all assistant system instruction sets.
  Rationale: Ensures broad behavioral effect across question-answering, ingest, meal-response, settings, and onboarding assistant calls.
  Date/Author: 2026-02-17 / Codex

- Decision: Keep checklist template writes on a single metadata object inside `applyStarterSeed`.
  Rationale: Prevents accidental loss of seeded checklist template when metadata is finalized at the end of bootstrap.
  Date/Author: 2026-02-17 / Codex

## Outcomes & Retrospective

Implementation is complete for the data model/API/UI/docs refactor and all planned validation commands pass. The largest remaining risk area is compatibility with older onboarding assumptions that still use structured patch flows (outside Settings), but this change intentionally hard-cuts only Settings editing to four text blobs.

## Context and Orientation

Key files changed:

- `src/trackingData.js`: canonical normalization and split-file persistence for four text profiles.
- `src/trackingDataPostgres.js`: profile serialization/deserialization in Postgres backend.
- `src/server.js`: settings bootstrap/state/chat/confirm/direct-save behavior.
- `src/assistant.js`: settings schema and profile-aware assistant context/instructions.
- `client/src/views/SettingsView.jsx`: new textarea + chat settings layout.
- `client/src/App.jsx`: settings state loading, draft/save/confirm orchestration.
- `client/src/api.js`: settings state/save APIs.
- `scripts/migrate-profile-to-user-profile.js`: start-blank normalization for profile fields.
- `scripts/migrate-json-to-postgres.js`: profile blob mapping during JSON->Postgres migration.
- `tracking-profile.json`: default four-field profile blob shape.

## Plan of Work

Implementation sequence followed:

1. Convert data model and persistence to four string profile fields.
2. Replace Settings API contract to profile-only proposal/confirm and add direct-save endpoint.
3. Refactor assistant settings schema and prompt behavior to profile text edits only.
4. Update settings UI to present and save four textareas while preserving chat confirmation flow.
5. Update docs to match final contracts.
6. Run regression commands and capture outputs.

## Concrete Steps

From repository root:

1. `npm run test:harness`
2. `npm run test:ingest-mocked`
3. `npm run build`

Expected outcomes:

- Harness scripts report pass with listed checks.
- Vite build completes successfully.

## Validation and Acceptance

Acceptance criteria:

- `GET /api/settings/state` returns four strings.
- `POST /api/settings/profiles` directly saves textarea edits.
- `POST /api/settings/chat` proposes four-field text changes and does not auto-apply.
- `POST /api/settings/confirm` applies proposed profile text changes.
- Settings UI shows four editable profile textareas with save/discard actions.
- Confirming chat proposals is blocked while local drafts are dirty.

## Idempotence and Recovery

- `npm run migrate:profile` remains idempotent.
- If profile values are missing/non-string, normalization resets them to empty string.
- Failed profile saves do not partially update state; writes happen through a single `writeTrackingData` commit path.

## Artifacts and Notes

- Primary artifacts are the modified files listed above.
- Validation transcript excerpts:
  - `npm run test:harness` -> "Deterministic harness passed ... Total checks: 10"
  - `npm run test:ingest-mocked` -> "Mocked ingest harness passed ..."
  - `npm run build` -> "vite ... ✓ built"

## Interfaces and Dependencies

Settings API interfaces:

- `GET /api/settings/state` -> `{ profiles: { user_profile, training_profile, diet_profile, agent_profile }, settings_version }`
- `POST /api/settings/profiles` -> direct write of one or more profile fields.
- `POST /api/settings/chat` -> proposal output constrained to the four profile text fields.
- `POST /api/settings/confirm` -> applies confirmed proposal.

Profile persistence interface:

- Canonical shape in runtime data:
  - `user_profile: string`
  - `training_profile: string`
  - `diet_profile: string`
  - `agent_profile: string`

Revision note (2026-02-17, Codex): Updated this ExecPlan after implementation completion to record final validation results, mark all progress steps complete, capture the final cleanup decision to remove `apply_mode` from settings confirm client payload, and document the post-validation bootstrap metadata overwrite fix in `applyStarterSeed`.
