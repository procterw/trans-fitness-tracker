# Condense weekly fitness UI + table-style history

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This repository’s process requirements live in `PLANS.md` (repo root) and must be followed.

## Purpose / Big Picture

Make the Fitness tab much more space-efficient:

1) The current week checklist becomes a condensed, checklist-like layout (similar to a simple notes checklist) while keeping per-item text (`details`) editable.
2) The Fitness history renders as a wide, scrollable table with one row per week and one column per tracked item (similar to a spreadsheet), making comparisons across weeks easier.

## Progress

- [x] (2026-02-05 19:49Z) Read existing Fitness UI code and CSS; identified render + style entry points.
- [x] (2026-02-05 19:52Z) Implement condensed checklist layout (checkbox + inline auto-growing details editor).
- [x] (2026-02-05 19:52Z) Implement history table layout (wide, scrollable, one row per week).
- [x] (2026-02-05 19:54Z) Validate build (`npm run build`) and fix any regressions found.
- [x] (2026-02-05 19:54Z) Document outcomes and follow-ups.

## Surprises & Discoveries

- Observation: `rg` is not available in this environment; use `grep`, `nl`, and `sed` for fast navigation instead.
  Evidence: `zsh:1: command not found: rg`

## Decision Log

- Decision: Keep current-week edit model unchanged (checkbox + debounced save + `details` text persisted per item), and only change layout/styling to be more condensed.
  Rationale: Avoid backend/schema changes while still meeting the UI goal (“text should still be editable”).
  Date/Author: 2026-02-05 / Codex

- Decision: Use the current week’s item ordering as the column ordering for the history table.
  Rationale: Ensures stable, predictable column order; avoids trying to infer/merge mismatched schemas across weeks.
  Date/Author: 2026-02-05 / Codex

## Outcomes & Retrospective

- Implemented a much more condensed current-week checklist UI that keeps `details` editable via an inline, auto-growing text control.
- Replaced the prior per-week collapsible history blocks with a single wide, scrollable history table (weeks as rows, items as columns) with sticky headers and a sticky Week column.
- Follow-ups (optional):
  - Consider adding a per-category grouping header row (colspans) in the history table if the column count grows further.
  - If long `details` become common, consider a “expand cell/editor” affordance to keep rows compact.

## Context and Orientation

- The UI is a Vite/React app in `client/`.
- Fitness UI is rendered in `client/src/App.jsx` under the `tab === "fitness"` branch.
- Fitness styles live in `client/src/styles.css` under `.fitness*` selectors.
- Fitness data comes from `tracking-data.json` via server endpoints:
  - `GET /api/fitness/current` (current week structure + items)
  - `GET /api/fitness/history` (past weeks array)

## Plan of Work

1) Update `client/src/App.jsx`:
   - Replace the current-week “card-per-item + textarea” layout with a condensed checklist row layout.
   - Keep the existing debounced save calls (`onToggleFitness`, `onEditFitnessDetails`) and the `details` editing control, but style it as an inline/compact editor.
   - Replace the “History” `<details>` body from per-week `<details>` blocks into a single table rendering.

2) Update `client/src/styles.css`:
   - Add new condensed checklist styles (tight spacing, no per-item card borders, compact inline editor).
   - Add history table styles (sticky header, readable cells, green/red status marks, horizontal scroll).

## Concrete Steps

From repo root:

1) Install deps (if needed):
   - `npm install`

2) Start dev server:
   - `npm run dev`
   - Open `http://localhost:3000`

3) Validate Fitness tab:
   - Toggle checkboxes; confirm state persists after refresh.
   - Type in item details; confirm debounced save (status shows “Saved.”) and persistence after refresh.
   - Expand History; confirm table renders and is horizontally scrollable.

## Validation and Acceptance

Accept when:

- Current week checklist is visually condensed (no large card-per-item layout) and `details` remains editable for each item.
- History is a table with:
  - rows = weeks (most recent first),
  - columns = tracked items (derived from current week),
  - each cell shows checked/unchecked and any details text.
- No console errors; Fitness tab loads and saving still works.

## Idempotence and Recovery

- UI-only changes are safe to re-run; refreshing the page should show persisted data from `tracking-data.json`.
- If layout changes mis-render, revert by restoring `client/src/App.jsx` Fitness render helpers and `.fitness*` CSS blocks.

## Artifacts and Notes

- Primary files:
  - `client/src/App.jsx`
  - `client/src/styles.css`

## Interfaces and Dependencies

- No new dependencies planned.
- Existing API functions in `client/src/api.js` remain unchanged.

---

Plan changes (append-only):

- 2026-02-05: Initial plan created for condensed Fitness UI + table history.
