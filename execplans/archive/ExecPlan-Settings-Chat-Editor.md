# Settings Chat Editor For Goals, Checklist, And Profile

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository includes `PLANS.md` at the root, and this document is maintained in accordance with those rules.

## Purpose / Big Picture

After this change, the Settings page is a chat interface powered by GPT-5 that can directly update three settings domains in the tracking data: fitness checklist template, diet/fitness philosophy goals, and transition profile context. The user can open Settings from the navbar, send plain-language requests like “replace my mobility checklist” or “update my calorie goal wording,” and immediately see updates persisted to the same split tracking files already used by the app.

## Progress

- [x] (2026-02-07 19:56Z) Reviewed current app structure, settings entry point, assistant pipeline, and tracking data write APIs.
- [x] (2026-02-07 19:58Z) Added backend settings assistant schema/function and `/api/settings/chat` route with structured patch application.
- [x] (2026-02-07 19:58Z) Replaced static Settings page with chat UI and wired client API + app state handling.
- [x] (2026-02-07 19:58Z) Validated with `npm run build` and Node syntax checks for `src/server.js` and `src/assistant.js`.
- [x] (2026-02-07 20:04Z) Converted settings writes to propose-then-confirm with inline confirmation controls in the Settings chat.
- [x] (2026-02-07 20:04Z) Added settings version/effective metadata and checklist apply timing support (`now` vs `next_week`).

## Surprises & Discoveries

- Observation: There is no `.agent/PLANS.md`; the effective plan rules are in root `PLANS.md`.
  Evidence: Shell output: `ls: .agent: No such file or directory` and `sed: .agent/PLANS.md: No such file or directory`.

## Decision Log

- Decision: Implement settings edits through a dedicated `/api/settings/chat` endpoint rather than overloading existing `/api/assistant/ingest`.
  Rationale: It keeps food/activity ingestion behavior stable and allows stronger, settings-specific guardrails and schemas.
  Date/Author: 2026-02-07 / Codex

- Decision: Use model-generated structured patches (JSON) and apply merges server-side.
  Rationale: It provides controlled writes and a clear audit of what changed.
  Date/Author: 2026-02-07 / Codex

- Decision: Require explicit confirmation before applying settings mutations.
  Rationale: Settings changes have higher consequences than food/activity logs, so user intent should be re-confirmed inline before persistence.
  Date/Author: 2026-02-07 / Codex

- Decision: Support checklist timing modes by storing a canonical checklist template in metadata and using it during week rollover.
  Rationale: This enables “apply next week” behavior without rewriting in-progress week data.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Implemented end-to-end settings chat editing for checklist template, goals/philosophy, and profile context with explicit confirmation before write. The backend now separates proposal from apply (`/api/settings/chat` and `/api/settings/confirm`), and records settings version/effective metadata for traceability. Checklist updates can apply immediately or be staged for next-week rollover via metadata-backed template persistence.

## Context and Orientation

Relevant files:

- `client/src/App.jsx`: top-level signed-in app shell and active view routing.
- `client/src/components/AppNavbar.jsx`: settings icon trigger beside account menu.
- `client/src/views/SettingsView.jsx`: currently static, non-chat settings UI.
- `client/src/api.js`: frontend API client wrappers.
- `src/server.js`: Express routes; currently has `/api/assistant/ask` and `/api/assistant/ingest`.
- `src/assistant.js`: GPT-5 prompting and Zod structured parsing.
- `src/trackingData.js`: canonical data read/write functions and fitness helpers.
- `src/fitnessChecklist.js`: checklist category key normalization helpers.

“Checklist template” in this plan means the category/item definitions stored on `current_week` (for example `cardio`, `strength`, `mobility`, `other`) that future checkboxes use.

## Plan of Work

Add a new assistant function in `src/assistant.js` that accepts a settings chat message plus prior conversation messages and returns:

- assistant reply text,
- optional follow-up question,
- optional structured changes for `transition_context`, `diet_philosophy`, `fitness_philosophy`, and checklist categories.

Add a new server route `POST /api/settings/chat` in `src/server.js`. It will call the assistant function, merge/apply any requested changes to tracking data, write via `writeTrackingData`, and return a summary of applied changes and updated snippets.

Replace `client/src/views/SettingsView.jsx` with a chat UI variant similar to existing chat styling. Wire it in `client/src/App.jsx` with local state for settings messages/input/loading/errors, and call a new `settingsChat` API function added to `client/src/api.js`.

## Concrete Steps

From repository root:

1. Edit backend assistant and server route.
2. Edit frontend API + settings view + app wiring.
3. Run:

   npm run build

Expected build output includes `vite build ... ✓ built`.

## Validation and Acceptance

Acceptance criteria:

- Clicking gear icon opens Settings chat view.
- Sending a normal question in settings returns assistant text.
- Sending an edit request (for checklist/goals/profile) returns confirmation and persists updates into tracking files.
- Existing chat/food/workout views keep functioning.
- Build passes.

## Idempotence and Recovery

Changes are additive and can be rerun safely. If the settings endpoint produces invalid writes, revert only touched files and re-run build; no schema migrations are required.

## Artifacts and Notes

Artifacts will include:

- build transcript,
- short diff summary,
- example `changes_applied` payload from settings endpoint shape (documented in code comments/response).

## Interfaces and Dependencies

New backend interface:

- `askSettingsAssistant({ message, messages })` in `src/assistant.js`.

New API endpoint:

- `POST /api/settings/chat` with JSON body `{ message: string, messages?: Array<{ role, content }> }`.
- Response includes `{ assistant_message, followup_question, changes_applied, updated }`.

New frontend client API:

- `settingsChat({ message, messages })` in `client/src/api.js`.

New/updated view behavior:

- `SettingsView` becomes a chat-style component that consumes settings chat state/handlers from `App.jsx`.

---

Plan revision note: Updated the plan to capture the follow-up safety requirement (explicit confirmation) and version/effective-date behavior requested after initial implementation.
