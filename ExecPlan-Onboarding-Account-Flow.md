# Account Onboarding Chat Flow

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, newly authenticated users are routed into a guided onboarding chat instead of landing directly in the full app. The chat asks targeted profile questions, saves structured profile updates automatically after each answer, and exits onboarding once enough useful profile context is captured. The user can see this working by signing in as a new user, answering onboarding prompts, and observing that the app automatically switches to the normal UI once onboarding is complete.

## Progress

- [x] (2026-02-12 01:36Z) Create ExecPlan with scope, architecture direction, and validation approach.
- [x] (2026-02-12 01:41Z) Implement onboarding state and onboarding chat endpoints on the server.
- [x] (2026-02-12 01:41Z) Implement onboarding assistant parsing and completion heuristics.
- [x] (2026-02-12 01:41Z) Implement frontend onboarding route + chat UI + completion reroute.
- [x] (2026-02-12 01:41Z) Update docs and validate with production build.
- [x] (2026-02-12 02:00Z) Refactor onboarding into explicit stages with iterative checklist/diet proposals and accept-button confirmations.

## Surprises & Discoveries

- Observation: The instruction path `.agent/PLANS.md` referenced by `AGENTS.md` does not exist in this repository.
  Evidence: `cat .agent/PLANS.md` returned `No such file or directory`; repository root `PLANS.md` is present and used.
- Observation: Existing `user_profile` normalization already preserves unknown metadata keys, so onboarding progress can be stored under `user_profile.metadata.onboarding` without schema migrations.
  Evidence: `normalizeUserProfile` in `src/trackingData.js` merges `...asObject(safe.metadata)` before setting defaults.

## Decision Log

- Decision: Treat onboarding completion as “enough profile coverage” instead of a strict all-fields-required checklist.
  Rationale: The requested behavior is completion once enough answers are collected or information is adequate, which maps better to thresholded coverage than fixed mandatory fields.
  Date/Author: 2026-02-12 / Codex
- Decision: Persist onboarding progress in `user_profile.metadata.onboarding` while still deriving coverage from actual profile values.
  Rationale: Some valid answers are explicit negatives (for example no allergies), which should count as answered even when target arrays remain empty.
  Date/Author: 2026-02-12 / Codex
- Decision: Use completion threshold `>=5/8 covered` with required keys (`timezone`, `diet_goals`, `fitness_goals`) before exit.
  Rationale: This balances “adequate information” with predictable minimum quality and prevents onboarding completion with only peripheral fields.
  Date/Author: 2026-02-12 / Codex
- Decision: Fail open on onboarding-state fetch errors in the client (show main app), but surface the error inside onboarding chat state when applicable.
  Rationale: Blocking the entire app on a transient onboarding endpoint failure is worse than temporarily bypassing onboarding.
  Date/Author: 2026-02-12 / Codex
- Decision: Remove timezone from onboarding prompts/required fields and auto-capture browser timezone silently.
  Rationale: Timezone was not affecting onboarding quality and is better inferred automatically from the client environment.
  Date/Author: 2026-02-12 / Codex
- Decision: Replace coverage-threshold completion with a deterministic staged flow (`goals` → `checklist` accept → `diet` accept → complete).
  Rationale: The user requested explicit, iterative acceptance of checklist and diet targets before onboarding completion.
  Date/Author: 2026-02-12 / Codex
- Decision: Introduce a dedicated confirmation endpoint (`POST /api/onboarding/confirm`) with `accept_checklist` / `accept_diet` actions.
  Rationale: Explicit button-driven acceptance is clearer and safer than inferring acceptance from freeform chat text.
  Date/Author: 2026-02-12 / Codex

## Outcomes & Retrospective

Implemented end-to-end staged onboarding for authenticated users. Flow now supports broad goals collection followed by iterative proposal/accept cycles for fitness checklist and calorie/macro goals. Acceptance is explicit via UI buttons backed by a confirmation endpoint, and completion only occurs after both accepts. Build passes. Remaining opportunity: add deterministic onboarding e2e tests (currently only manual + build validation).

## Context and Orientation

The server entrypoint is `src/server.js`. It already supports authenticated requests and writes profile updates through `readTrackingData`/`writeTrackingData` from `src/trackingData.js`. Assistant-driven structured updates already exist for settings in `src/assistant.js` and `POST /api/settings/chat` + `POST /api/settings/confirm`. The React client root is `client/src/App.jsx`, which currently gates only signed-out users via `SignedOutView`; authenticated users always land in the normal shell (`SidebarView`, `ChatView`, `WorkoutsView`, `DietView`, `SettingsView`).

This feature adds a new intermediate authenticated state: “signed in but onboarding not complete.” In that state the user sees a dedicated onboarding chat view. The chat calls new onboarding APIs that compute completion status, ask follow-up questions, and persist profile patches.

## Plan of Work

Add onboarding support in three layers.

First, add backend helpers that compute onboarding completion from profile coverage plus explicit answered flags stored in `user_profile.metadata.onboarding`. Then add `GET /api/onboarding/state` to return whether onboarding is required and what question should be asked next.

Second, add `POST /api/onboarding/chat` that accepts a user message and recent chat messages, calls a new onboarding assistant parser in `src/assistant.js`, merges the returned profile patch into `user_profile`, records answered onboarding slots, recomputes completion, and returns assistant text plus completion metadata.

Third, update the client to request onboarding state after auth loads. If onboarding is required, render a new onboarding chat view and block the main app shell. The view should append messages like the existing chat UI and auto-transition to the normal app once the server reports completion.

Finally, update `PROJECT.md` endpoint docs and run a production build.

## Concrete Steps

Run commands from repository root.

1. Edit `src/assistant.js` to add onboarding assistant schemas and a new onboarding chat function returning structured profile patch + answered keys.
2. Edit `src/server.js` to add onboarding state/completion helpers plus:
   - `GET /api/onboarding/state`
   - `POST /api/onboarding/chat`
3. Edit `client/src/api.js` to add onboarding API wrappers.
4. Add `client/src/views/OnboardingView.jsx`.
5. Edit `client/src/App.jsx` to gate authenticated users into onboarding until completion.
6. Edit `client/src/styles.css` for onboarding container styling.
7. Update `PROJECT.md` with onboarding behavior and endpoints.
8. Run `npm run build` and capture output.

## Validation and Acceptance

Start with `npm run dev` and verify behavior manually:

- Signed out users still see sign-in view.
- Newly signed-in users with sparse profile are shown onboarding chat first.
- Each onboarding answer produces an assistant response and saves profile updates server-side.
- Once completion threshold is reached, onboarding exits automatically and the normal app shell appears.
- Signed-in users with already-complete profile bypass onboarding and land in the normal app directly.

Also run `npm run build` and expect success.

## Idempotence and Recovery

Changes are additive and safe to re-run. If onboarding behavior is incorrect, `GET /api/onboarding/state` is the source of truth for gate checks and can be inspected directly without mutating data. Recovery is straightforward by removing onboarding endpoints/view and restoring the previous `signedOut`-only gate in `client/src/App.jsx`.

## Artifacts and Notes

Build validation (2026-02-12 01:41Z):

    > npm run build
    vite v7.3.1 building client environment for production...
    ✓ 337 modules transformed.
    ✓ built in 1.01s

## Interfaces and Dependencies

In `src/assistant.js`, add an exported onboarding function with signature equivalent to:

    askOnboardingAssistant({ message, messages, onboardingState, userProfile }) -> {
      assistant_message: string,
      followup_question: string | null,
      user_profile_patch: object | null,
      answered_keys: string[]
    }

In `src/server.js`, add onboarding routes:

    GET /api/onboarding/state
    response: {
      ok: true,
      needs_onboarding: boolean,
      onboarding_complete: boolean,
      completion: { answered: number, total: number, percent: number },
      missing_keys: string[],
      next_prompt: string,
      assistant_message: string
    }

    POST /api/onboarding/chat
    body: { message: string, messages?: [{ role, content }] }
    response: {
      ok: true,
      needs_onboarding: boolean,
      onboarding_complete: boolean,
      completion: { answered: number, total: number, percent: number },
      missing_keys: string[],
      assistant_message: string,
      followup_question: string | null,
      saved_profile: boolean,
      updated_profile: object | null
    }

Plan change note (2026-02-12 01:36Z): Initial ExecPlan created for onboarding chat flow implementation.
Plan change note (2026-02-12 01:41Z): Updated progress, decisions, outcomes, and artifacts after completing implementation and validating build.
Plan change note (2026-02-12 01:47Z): Refined onboarding to remove timezone questioning and persist client timezone automatically.
Plan change note (2026-02-12 02:00Z): Refactored onboarding to explicit staged flow with accept-button confirmation for checklist and diet targets.
