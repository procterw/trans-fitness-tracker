# Refactor App Shell Into Named Views and Sidebar Module

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the large `client/src/App.jsx` file is split into dedicated views for Chat, Workouts, and Diet, plus a dedicated sidebar view. The app still behaves the same, but code is easier to navigate and extend because each major screen is isolated in its own module. You can verify this by running the app and switching between Chat, Workouts, and Diet tabs while seeing existing behavior preserved.

## Progress

- [x] (2026-02-07 00:46Z) Review project constraints and inspect current `client/src/App.jsx` and styles.
- [x] (2026-02-07 00:50Z) Create reusable shared UI components extracted from `App.jsx`.
- [x] (2026-02-07 00:50Z) Create view modules for Chat, Workouts, Diet, and Sidebar.
- [x] (2026-02-07 00:50Z) Refactor `client/src/App.jsx` to orchestrate state and handlers across extracted views.
- [x] (2026-02-07 00:50Z) Build and validate no behavior regressions in the compiled client.

## Surprises & Discoveries

- Observation: The repo-level AGENTS guidance references `.agent/PLANS.md`, but this repository stores planning guidance in `PLANS.md` at the root.
  Evidence: `cat .agent/PLANS.md` returns file-not-found while `PLANS.md` exists and includes the ExecPlan spec.

## Decision Log

- Decision: Keep all data-fetching/state coordination in `App.jsx` and move only rendering concerns into view files.
  Rationale: This minimizes regression risk while still delivering the requested structural split.
  Date/Author: 2026-02-07 / Codex
- Decision: Rename route keys and sidebar labels to `chat`, `workouts`, and `diet` while keeping existing API interactions unchanged.
  Rationale: The user requested renamed views; preserving API/data names keeps backend contract stable and reduces risk.
  Date/Author: 2026-02-07 / Codex

## Outcomes & Retrospective

Completed the requested split: `App.jsx` now handles state/effects/handlers and delegates rendering to dedicated Chat, Workouts, Diet, and Sidebar view modules. Tab labels and route keys were renamed to `Chat`, `Workouts`, and `Diet`. The production build succeeded, indicating the refactor compiles cleanly without wiring regressions.

## Context and Orientation

The current `client/src/App.jsx` combines four responsibilities: app shell/sidebar layout, chat UI, workouts UI, and diet dashboard UI. It also owns fetch/mutation handlers for API calls defined in `client/src/api.js`. Existing presentational components (`EstimateResult`, `MarkdownContent`, `NutrientsTable`) are in `client/src/components`. This refactor keeps API behavior unchanged and reorganizes JSX into separate files in a new `client/src/views` directory and shared controls in `client/src/components`.

## Plan of Work

First, extract `TabButton` and `AutoGrowTextarea` out of `App.jsx` so they can be reused by views. Next, create dedicated view components for Chat, Workouts, Diet, and Sidebar, moving JSX and local render helpers from `App.jsx` into those files. Then simplify `App.jsx` to hold only state/effects/callbacks and compose the extracted views with props. Finally rename the tab route keys and labels from `food/fitness/dashboard` to `chat/workouts/diet` and validate with a production build.

## Concrete Steps

Run commands from repository root:

1. Create `client/src/components/TabButton.jsx` and `client/src/components/AutoGrowTextarea.jsx`.
2. Create `client/src/views/SidebarView.jsx`, `client/src/views/ChatView.jsx`, `client/src/views/WorkoutsView.jsx`, and `client/src/views/DietView.jsx`.
3. Update `client/src/App.jsx` imports, tab state routing, and render composition.
4. Run `npm run build`.

## Validation and Acceptance

Acceptance criteria:

- Sidebar renders via its own view component and still shows account card, day summary, weekly activity, and tabs.
- Main content renders Chat, Workouts, and Diet in dedicated view modules.
- Tab labels are exactly `Chat`, `Workouts`, and `Diet`.
- `npm run build` succeeds.

## Idempotence and Recovery

These edits are file-level refactors and can be repeated safely. If a view extraction introduces errors, the fallback is to restore the affected file and re-run `npm run build` to confirm state.

## Artifacts and Notes

Build transcript:

    > npm run build
    > vite build --config client/vite.config.js
    vite v7.3.1 building client environment for production...
    ✓ 334 modules transformed.
    ✓ built in 958ms

## Interfaces and Dependencies

At completion:

- `client/src/App.jsx` remains default export `App` and composes new view components.
- `client/src/views/ChatView.jsx` accepts chat composer and result props used in the prior Food tab UI.
- `client/src/views/WorkoutsView.jsx` accepts fitness state and mutation handlers used in the prior Fitness tab UI.
- `client/src/views/DietView.jsx` accepts dashboard state and actions used in the prior Dashboard tab UI.
- `client/src/views/SidebarView.jsx` accepts auth state, active view state, and summary/workout sidebar data.

Plan change note (2026-02-07 00:46Z): Created this ExecPlan for the requested App.jsx refactor and module split.
Plan change note (2026-02-07 00:50Z): Marked implementation and validation steps complete after extracting views/components and passing build.
