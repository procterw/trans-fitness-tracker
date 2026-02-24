# Replace Settings Chat With Blocks + Checklist Editors

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` will be kept up to date as work proceeds.

This plan follows repository guidance in `PLANS.md` from the repository root.

## Purpose / Big Picture

The Settings screen currently depends on a chat workflow to update training blocks and checklist content, but that workflow is unreliable and hard to control. After this change, the Settings screen will be a direct editor: column 1 keeps profile text editing, column 2 edits training blocks directly, and column 3 edits checklist rows directly (including drag/drop ordering and row delete). The user can add/delete blocks, edit block name/description, import a block JSON payload, and edit checklist rows without AI chat.

## Progress

- [x] (2026-02-23 23:31Z) Reviewed `PROJECT.md`, `PLANS.md`, and existing settings/chat code paths in frontend and backend.
- [x] (2026-02-23 23:31Z) Created this ExecPlan and mapped required behavior changes.
- [x] (2026-02-23 23:44Z) Implemented backend block CRUD support for editor flows, including `delete_block` and empty-template block handling.
- [x] (2026-02-23 23:44Z) Removed settings chat plumbing from server route layer and removed settings assistant exports/normalizers from `src/assistant.js`.
- [x] (2026-02-23 23:44Z) Replaced Settings view with profile + blocks editor + checklist row editor (drag/drop, row delete, row field edits).
- [x] (2026-02-23 23:44Z) Replaced `App.jsx` settings chat state/handlers with deterministic block/checklist draft + autosave proposal writes.
- [x] (2026-02-23 23:44Z) Removed settings chat API helpers, updated styles, and updated `PROJECT.md`/`README.md` settings API docs.
- [x] (2026-02-23 23:44Z) Validated via `npm run build` and `npm run test:harness`.

## Surprises & Discoveries

- Observation: The AGENTS instruction references `.agent/PLANS.md`, but this repository has `PLANS.md` at root and no `.agent` directory.
  Evidence: `ls .agent` returns “No such file or directory”; `PLANS.md` exists at repo root.

- Observation: `create_block` logic inherited workouts from a baseline block when no explicit workouts were supplied, which conflicted with a clean “add new block” UI behavior.
  Evidence: `applySettingsChanges` initialized `nextWorkouts` from a baseline before checking `replaceWorkouts`; empty create payloads would copy prior workouts.

## Decision Log

- Decision: Reuse the existing proposal-based settings mutation path (`/api/settings/confirm` + `applySettingsChanges`) for deterministic UI writes instead of adding an entirely new persistence layer.
  Rationale: This path already performs settings versioning/history updates and metadata synchronization; extending it is lower risk than duplicating behavior.
  Date/Author: 2026-02-23 / Codex

- Decision: Add missing operation support (`delete_block`) to the existing settings mutation engine rather than building a parallel delete implementation.
  Rationale: Keeps all training-block mutation semantics centralized and consistent.
  Date/Author: 2026-02-23 / Codex

- Decision: Keep create/import behavior deterministic by sending a default starter workout row (`New checklist item`) when creating a new block without explicit workouts.
  Rationale: Avoids accidental workout inheritance from baseline blocks and gives the checklist editor an immediate editable row.
  Date/Author: 2026-02-23 / Codex

## Outcomes & Retrospective

Implemented end-to-end replacement of Settings chat with direct UI editors. Column 1 remained profile text editing with autosave. Column 2 became deterministic block CRUD in required control order. Column 3 became a row editor for checklist workouts (`name`, `description`, `category`, `optional`) with delete and drag/drop reorder. Backend `/api/settings/chat` was removed, and settings mutations now flow through structured proposals via `/api/settings/confirm`.

Validation was successful with both build and deterministic harness passing. Residual risk: no dedicated UI integration test currently asserts drag/drop row ordering behavior in-browser, so that behavior is verified by manual usage plus successful build/harness.

## Context and Orientation

The Settings implementation spans:

- `client/src/views/SettingsView.jsx`: current three-column layout where column 3 is chat.
- `client/src/App.jsx`: settings state, autosave for profiles, and chat submit/stream logic.
- `client/src/api.js`: frontend API helpers (`settingsChatStream`, `confirmSettingsChanges`, etc.).
- `src/server.js`: settings APIs (`/api/settings/state`, `/api/settings/profiles`, `/api/settings/chat`, `/api/settings/confirm`) and the mutation engine `applySettingsChanges`.
- `src/assistant.js`: settings assistant functions currently used only by `/api/settings/chat`.

“Checklist rows” in this plan means training block workout definitions with fields:
- `name`
- `description`
- `category`
- `optional` (boolean)

These rows are stored in training block `workouts` and edited in UI order.

## Plan of Work

First, extend `applySettingsChanges` in `src/server.js` so direct UI actions can fully manage blocks. The existing operations already cover create/update/switch/replace/add/remove workouts; add `delete_block` and ensure it updates metadata and canonical block sync safely.

Second, remove chat-specific server plumbing: delete `/api/settings/chat` route and remove its assistant imports (`askSettingsAssistant`, `streamSettingsAssistant`) from `src/server.js`.

Third, replace Settings chat UI with deterministic editors:

- Keep profile textareas unchanged in column 1.
- Rebuild column 2 as block editor controls in required order.
- Rebuild column 3 as editable checklist rows with drag/drop reorder and per-row delete.

Fourth, replace chat logic in `client/src/App.jsx` with UI mutation handlers that call proposal-confirm endpoint directly for:
- create block
- update selected block metadata/workouts
- delete selected block
- import block JSON into selected block (or create when no selection)

Fifth, remove unused settings-chat helpers from `client/src/api.js` and adjust CSS in `client/src/styles.css` for the new column layouts and row editor.

## Concrete Steps

From repository root:

1. Edit `src/server.js`:
   - add `delete_block` in operation validation and mutation logic.
   - remove `/api/settings/chat` route.
   - remove settings assistant imports no longer referenced.

2. Edit `client/src/api.js`:
   - remove chat helper exports used only by settings chat.
   - retain and use `confirmSettingsChanges`.

3. Edit `client/src/App.jsx`:
   - remove settings chat state/refs/effects/submit handlers.
   - add selected-block editor draft state and persistence handlers.
   - wire new handlers into `SettingsView`.

4. Edit `client/src/views/SettingsView.jsx`:
   - remove `MessageThread` and settings composer.
   - render required column 2 and column 3 editors.

5. Edit `client/src/styles.css`:
   - remove now-unused settings chat column styling.
   - add styles for block editor controls + checklist row editor + drag state.

6. Run validation:
   - `npm run build`
   - any available tests if present.

Expected evidence: successful build, no references to `/api/settings/chat` in frontend/server, and Settings UI presents editors instead of chat.

## Validation and Acceptance

Acceptance checks:

1. Start app (`npm run dev`) and open Settings.
2. Confirm column 1 shows profile textareas and continues autosaving.
3. Confirm column 2 includes:
   - reverse-ordered block selector with active/current selected by default
   - add button
   - name input
   - description textarea
   - delete button
   - import button for pasted JSON block
4. Confirm column 3 includes checklist rows with editable `name`, `description`, `category`, `optional`, delete action, and drag/drop ordering.
5. Confirm no settings chat UI remains.
6. Confirm backend no longer exposes `/api/settings/chat`.

## Idempotence and Recovery

Edits are source-code-only and repeatable. If a mutation change introduces regressions, restore by editing code and rerunning `npm run build`; no destructive data migrations are introduced by this plan.

## Artifacts and Notes

- Build:
  - `npm run build`
  - Result: success (`vite build`, 343 modules transformed, output in `dist/`).
- Deterministic harness:
  - `npm run test:harness`
  - Result: all 15 checks passed (including settings block mutation checks `S01`..`S03`).
- Chat-route verification:
  - `rg -n "/api/settings/chat|settingsChatStream|askSettingsAssistant|streamSettingsAssistant" src client/src`
  - Result: no runtime/frontend references remain.

## Interfaces and Dependencies

No new dependencies are required. Existing interfaces are reused:

- Client settings writes: `confirmSettingsChanges({ proposal, selectedBlockId })` in `client/src/api.js`.
- Server mutation engine: `applySettingsChanges({ proposal, selectedBlockId, confirmationPhrase })` in `src/server.js`.
- Settings state reader: `GET /api/settings/state` returning `training_blocks` summary used by the editor UI.

Revision note (2026-02-23): Initial plan authored before implementation, with decision to extend existing proposal-based settings mutation path and remove settings chat route/UI.
Revision note (2026-02-23): Updated after implementation to record completed milestones, validation evidence, and final design decisions.
