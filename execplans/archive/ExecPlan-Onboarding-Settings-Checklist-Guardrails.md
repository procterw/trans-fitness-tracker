# Enforce Activity-Only Checklists And Add Onboarding/Settings Planning Sidebar

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with those rules.

## Purpose / Big Picture

After this change, onboarding and settings checklist flows will never accept checklist categories/items that are about food, eating, or diet. During settings checklist edits, users will always see the full updated checklist to vet before confirming. On both onboarding and settings screens, a second sidebar will show a compact summary of goal types (diet, fitness, health) and the current working checklist (proposal if present, otherwise current week).

## Progress

- [x] (2026-02-12 18:32Z) Read `PROJECT.md`, `PLANS.md`, onboarding/settings client views, and checklist/settings server logic to identify all checklist entry points.
- [x] (2026-02-12 19:12Z) Implemented shared checklist policy normalization (`src/checklistPolicy.js`) and applied it in onboarding/settings assistant parsing plus server proposal/application validation.
- [x] (2026-02-12 19:13Z) Updated settings checklist-change responses to include a full updated checklist markdown preview before confirmation.
- [x] (2026-02-12 19:15Z) Added onboarding/settings secondary sidebar UI (`client/src/components/GoalChecklistSidebar.jsx`) and wired goal-type + working-checklist state in `client/src/App.jsx`.
- [x] (2026-02-12 19:17Z) Validated with `npm run build` (success) and server-side syntax checks for touched backend modules.

## Surprises & Discoveries

- Observation: The instruction mentions `.agent/PLANS.md`, but this repository uses root `PLANS.md` and no `.agent` directory exists.
  Evidence: `ls .agent` returned `No such file or directory`.

- Observation: `node --check` does not support `.jsx` files directly in this environment.
  Evidence: `TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".jsx"` for `client/src/App.jsx`; frontend validation relied on `vite build` success.

## Decision Log

- Decision: Enforce the food/eating/diet exclusion at normalization and application layers, not prompt-only.
  Rationale: Prompt constraints can drift; server-side normalization/validation guarantees checklist policy invariants.
  Date/Author: 2026-02-12 / Codex

- Decision: Use the most recent pending checklist proposal as the “working checklist” in sidebars; otherwise fall back to current-week checklist.
  Rationale: This reflects what the user is actively editing before confirmation while still showing useful state when no proposal exists.
  Date/Author: 2026-02-12 / Codex

## Outcomes & Retrospective

Completed the requested behavior end-to-end. Checklist content is now constrained to workout/activity language via shared normalization and server-side validation, so onboarding/settings proposals and confirmations cannot keep food/eating/diet checklist entries. Settings checklist proposals now include a full checklist preview in assistant output for user vetting before confirm. Onboarding and settings views now include an added sidebar summarizing goal types (diet/fitness/health) and showing a working checklist snapshot (pending proposal when present, otherwise current-week checklist). Build validation passed, and backend syntax checks passed.

## Context and Orientation

Relevant files and responsibilities:

- `src/assistant.js`: GPT-backed onboarding/settings structured outputs and checklist normalization.
- `src/server.js`: onboarding/settings endpoints, proposal confirmation, checklist template application.
- `client/src/App.jsx`: top-level app shell and onboarding/settings rendering state.
- `client/src/views/OnboardingView.jsx`: onboarding chat panel.
- `client/src/views/SettingsView.jsx`: settings chat panel.
- `client/src/styles.css`: layout and sidebar styles.

In this project, “checklist” means weekly activity/workout categories and items under `current_week` and checklist template metadata, not diet or meal planning items.

## Plan of Work

Add a shared checklist policy utility in `src/` that normalizes checklist categories and filters disallowed content (food/eating/diet terms). Replace existing checklist normalization paths in `src/assistant.js` and `src/server.js` to use this policy so onboarding and settings both inherit the same behavior.

Update `/api/settings/chat` in `src/server.js` so when checklist changes are proposed, the assistant response appends a full checklist markdown preview suitable for review.

Update `/api/context` to return goal-type arrays from `user_profile.goals` so the client can render a goal summary without extra endpoints.

In `client/src/App.jsx`, add state derived from `getContext()` for goal-type summaries and compute working checklist snapshots from pending proposals or current week. Render a reusable sidebar component next to onboarding and settings chat panels.

Add a new client component for the secondary sidebar and styles in `client/src/styles.css` for desktop two-column layout and mobile stacking.

## Concrete Steps

From repository root:

1. Implement checklist policy helper and wire it into assistant/server checklist normalization.
2. Update settings chat response assembly to append full checklist preview when checklist changes are proposed.
3. Extend context payload and client state mapping for goal-type summaries.
4. Add sidebar component and layout wiring for onboarding + settings.
5. Run:

   npm run build

Expected output includes successful Vite build completion.

## Validation and Acceptance

Acceptance checks:

- Onboarding/settings checklist proposals do not include food/eating/diet categories/items after normalization.
- Settings checklist-change responses include the complete updated checklist preview before confirmation.
- Onboarding view shows a second sidebar with goal-type summary and working checklist.
- Settings view shows a second sidebar with goal-type summary and working checklist.
- Desktop and mobile layouts both remain usable (sidebar stacks on narrow screens).
- `npm run build` succeeds.

## Idempotence and Recovery

All edits are additive and repeatable. If normalization is too strict, adjust the disallowed-term matcher in one shared policy file and rebuild; no data migration is required. If UI layout regresses on mobile, remove only new sidebar layout classes and rerun build.

## Artifacts and Notes

Implementation artifacts will include:

- Updated server/assistant normalization logic,
- Settings checklist preview response changes,
- New onboarding/settings sidebar component + styling,
- Build transcript summary.

## Interfaces and Dependencies

New shared helper module in `src/` will provide stable checklist-policy functions for both `src/assistant.js` and `src/server.js`.

Client additions will remain within existing React view/state architecture and existing `GET /api/context` call.

Plan revision note (2026-02-12 19:17Z): Updated this living ExecPlan to reflect implementation completion, validation evidence, and final outcomes so a future contributor can resume from current state without re-discovery.
