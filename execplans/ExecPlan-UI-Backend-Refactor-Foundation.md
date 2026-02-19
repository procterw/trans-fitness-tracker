# UI and Backend Refactor Foundation

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this refactor, the app keeps the same behavior but has lower maintenance overhead: repeated chat UI rendering is centralized, class names are clearer and consistent, and key `App.jsx` utilities are moved into focused modules. On the backend, ingest-related helper logic is extracted from `src/server.js` into dedicated modules so route handlers read as orchestration instead of implementation detail. A user can verify this by running the app and confirming chat/settings flows, fitness updates, and food ingest all work exactly as before.

## Progress

- [x] (2026-02-19 20:06Z) Audit current UI/backend hotspots and define refactor scope.
- [x] (2026-02-19 20:06Z) Create this ExecPlan with implementation and validation steps.
- [x] (2026-02-19 20:12Z) Extract shared frontend chat rendering/status primitives and adopt clearer class aliases.
- [x] (2026-02-19 20:12Z) Move reusable client utilities out of `client/src/App.jsx` into dedicated modules/hooks.
- [x] (2026-02-19 20:12Z) Extract ingest and streaming helper clusters from `src/server.js` into backend helper modules.
- [x] (2026-02-19 20:12Z) Run build and syntax validation; update plan outcomes and artifacts.

## Surprises & Discoveries

- Observation: `client/src/App.jsx` is a single 1714-line component that includes both app-level orchestration and low-level utility helpers.
  Evidence: `wc -l client/src/App.jsx` returns `1714`.
- Observation: Chat message rendering logic is duplicated between `client/src/views/ChatView.jsx` and `client/src/views/SettingsView.jsx`.
  Evidence: both files manually render `chatMsg`/`chatContent` blocks with the same markdown/plain branching.
- Observation: `src/server.js` includes many pure helper functions unrelated to route declaration and spans over 2000 lines.
  Evidence: `wc -l src/server.js` returns `2139`; helper cluster appears before route definitions.
- Observation: Existing CSS selectors are heavily coupled to legacy class names (`chatMsg`, `chatContent`, `foodComposerForm`), so class cleanup needs compatibility aliases.
  Evidence: introducing new class names without alias selectors would require touching many view-specific style rules.
- Observation: Extracting helpers reduced the main-file footprint while preserving behavior.
  Evidence: `wc -l client/src/App.jsx src/server.js` now returns `1600` and `1838`, down from `1714` and `2139`.

## Decision Log

- Decision: Keep this refactor behavior-preserving; do not redesign data flow or endpoint contracts.
  Rationale: User asked for cleanup/refactor, so risk should stay low while improving maintainability.
  Date/Author: 2026-02-19 / Codex
- Decision: Prioritize extracting cohesive helper clusters (chat rendering, hooks, ingest helpers, streaming helpers) rather than broad rewrites.
  Rationale: These deliver meaningful line-count and readability wins with minimal regression risk.
  Date/Author: 2026-02-19 / Codex
- Decision: Introduce cleaner class names as additive aliases instead of hard renames in one pass.
  Rationale: Alias selectors (`messageBubble`, `messageContent`, `composerForm`, `statusMessage`) improve readability immediately while avoiding styling regressions.
  Date/Author: 2026-02-19 / Codex

## Outcomes & Retrospective

Completed a behavior-preserving refactor across UI and backend:

- Frontend:
  - Added shared components `client/src/components/MessageThread.jsx` and `client/src/components/StatusMessage.jsx`.
  - Updated `client/src/views/ChatView.jsx` and `client/src/views/SettingsView.jsx` to use shared thread/status rendering.
  - Added reusable client modules:
    - `client/src/hooks/useDebouncedKeyedCallback.js`
    - `client/src/hooks/useSerialQueue.js`
    - `client/src/utils/settingsProfiles.js`
    - `client/src/utils/date.js`
    - `client/src/utils/foodEvents.js`
    - `client/src/constants/views.js`
  - Updated `client/src/App.jsx` and `client/src/components/AppNavbar.jsx` to consume these modules.
  - Added clearer class aliases in `client/src/styles.css` for message, composer, and status elements.

- Backend:
  - Added `src/server/ingestHelpers.js` for ingest, activity-mapping, and food-summary helpers.
  - Added `src/server/streaming.js` for SSE helpers.
  - Updated `src/server.js` to import helper modules and removed inlined helper implementations.

The largest remaining risk is manual UI-flow coverage; only build/syntax validation was run in this pass.

## Context and Orientation

The frontend root component is `client/src/App.jsx`. It orchestrates auth, view routing, API calls, message stream handling, and utility helpers. Chat and settings views are in `client/src/views/ChatView.jsx` and `client/src/views/SettingsView.jsx`; both render conversation threads using similar markup and class names. Shared visual rules live in `client/src/styles.css`.

The backend API server is `src/server.js`. It defines all routes and also contains helper logic for ingest decisions, activity mapping, food summaries, and Server-Sent Events (SSE). Those helpers can be isolated into helper modules under `src/server/` while preserving current route behavior.

## Plan of Work

First, create reusable UI primitives: a shared chat-thread component that handles markdown/plain rendering and optional image attachments, and a status message primitive for consistent error/status blocks. Update `ChatView.jsx` and `SettingsView.jsx` to use them. During this step, introduce clearer class names (`messageBubble`, `messageContent`, `composerForm`, `statusMessage`) while retaining compatibility aliases in CSS.

Next, move lightweight reusable utility logic out of `client/src/App.jsx` into focused modules (hooks and profile normalization utilities) and update imports. Keep function signatures and behavior unchanged so no route/view contracts move.

Then, extract backend helper clusters from `src/server.js`:

- Ingest helpers: food logging from inputs, date parsing for clear commands, activity selection resolution, food/activity summary builders.
- SSE helpers: request streaming detection and SSE response writing.

Wire `src/server.js` to import those functions. Keep route payload formats unchanged.

Finally, run `npm run build` and verify the refactor compiles and bundles.

## Concrete Steps

Run all commands from repository root.

1. Create new frontend shared components:
   - `client/src/components/MessageThread.jsx`
   - `client/src/components/StatusMessage.jsx`
2. Update `client/src/views/ChatView.jsx` and `client/src/views/SettingsView.jsx` to use these components and class-name cleanup.
3. Create client utility modules:
   - `client/src/hooks/useDebouncedKeyedCallback.js`
   - `client/src/hooks/useSerialQueue.js`
   - `client/src/utils/settingsProfiles.js`
4. Update `client/src/App.jsx` to import and use the extracted utilities.
5. Create backend helper modules:
   - `src/server/ingestHelpers.js`
   - `src/server/streaming.js`
6. Update `src/server.js` to import from helper modules and remove inlined helper implementations.
7. Run `npm run build` and record result.

## Validation and Acceptance

1. Run `npm run build` and expect a successful build.
2. Run `npm run dev` and manually validate:
   - Chat view: send text and image-assisted messages; message rendering and status lines behave the same.
   - Settings view: send a settings chat message; streaming response appears as before.
   - Ingest route behavior remains unchanged for food/activity/question intents.

Acceptance criteria: no endpoint contract changes, no UI behavior regressions in the validated flows, and reduced duplication in frontend/backend source layout.

## Idempotence and Recovery

All edits are source refactors and are idempotent when re-applied carefully. If any issue appears, rollback can be done file-by-file since no schema or stored data migration is included. Build validation can be re-run safely.

## Artifacts and Notes

Validation commands and results:

- `npm run build`
  - Result: success.
  - Evidence:
    - `vite v7.3.1 building client environment for production...`
    - `✓ 344 modules transformed.`
    - `✓ built in 971ms`
- `node --check src/server.js && node --check src/server/ingestHelpers.js && node --check src/server/streaming.js`
  - Result: success (no syntax errors).

## Interfaces and Dependencies

Frontend:

- `client/src/components/MessageThread.jsx` must accept message arrays with fields currently used by chat/settings (`id`, `role`, `content`, `format`, `tone`, optional `attachments`) and preserve markdown rendering behavior via `MarkdownContent`.
- `client/src/components/StatusMessage.jsx` must render consistent status and error text and accept optional class names.

Backend:

- `src/server/ingestHelpers.js` must export helper functions used by `/api/assistant/ingest` and `/api/assistant/ask` without changing response shapes.
- `src/server/streaming.js` must export streaming utility helpers currently used by `/api/settings/chat`, `/api/assistant/ask`, and `/api/assistant/ingest`.

Plan change note (2026-02-19 20:06Z): Initial ExecPlan created for UI/backend maintainability refactor with behavior-preserving scope.
Plan change note (2026-02-19 20:12Z): Marked implementation and validation complete; documented extracted modules, line-count impact, and build/syntax artifacts.
