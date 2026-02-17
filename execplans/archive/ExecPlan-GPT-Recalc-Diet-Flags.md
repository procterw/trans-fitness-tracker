# Recalculate Daily Diet Flags with GPT-5 on Food Add

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

`PLANS.md` is checked in at `/Users/williamleahy/Documents/New project/PLANS.md`; this document is maintained in accordance with it.

## Purpose / Big Picture

After this change, each time a meal is added to a day, the backend recomputes both daily diet flags (`status` = on-track and `healthy`) using GPT-5 context. This replaces stale/manual flag behavior and keeps day-level signals aligned with the latest food and activity context. A user can verify this by logging another meal and observing updated `On track` and `Healthy` values in the Diet history table.

## Progress

- [x] (2026-02-09 00:00Z) Identified current behavior in `src/trackingData.js`: food adds updated nutrients but did not recalculate both flags, and `healthy` was not preserved in some rewrite paths.
- [x] (2026-02-09 00:00Z) Added GPT-5 structured-output evaluator in `src/trackingData.js` to return `status` and `healthy` for a selected date.
- [x] (2026-02-09 00:00Z) Hooked evaluator into `addFoodEvent` so flags recalc on every food add.
- [x] (2026-02-09 00:00Z) Fixed `healthy` persistence defaults in food-log mutation paths.
- [x] (2026-02-09 00:00Z) Ran validation: `node --check src/trackingData.js` and `npm run build`.

## Surprises & Discoveries

- Observation: `healthy` was not explicitly preserved in `applyFoodEventToFoodLogInData` and `rollupFoodLogFromEvents`, so rows could lose that field.
  Evidence: Pre-change object construction included `status` and `notes` but omitted `healthy`.

## Decision Log

- Decision: Implement GPT-5 flag recalculation in `src/trackingData.js` instead of client code.
  Rationale: This guarantees all API paths that add food events share the same behavior and keeps business logic centralized.
  Date/Author: 2026-02-09 / Codex

- Decision: Keep food logging non-blocking if GPT flag inference fails.
  Rationale: Logging a meal must succeed even if model calls transiently fail; fallback keeps existing flags.
  Date/Author: 2026-02-09 / Codex

## Outcomes & Retrospective

The feature goal was achieved: food adds now trigger GPT-5 recalculation of both daily flags. Existing note-generation work remains compatible. A meaningful bug was fixed (`healthy` field persistence), improving reliability across add/rollup flows.

## Context and Orientation

The relevant backend lives in `src/trackingData.js`. `addFoodEvent` is the common ingestion write path used by food endpoints. `food_log` stores day-level totals and flags (`status`, `healthy`). Prior to this change, flag values were not re-scored on each add. The GPT client is created in `src/openaiClient.js` and model output parsing uses `zod` + `openai/helpers/zod` like other structured assistant flows in this repository.

## Plan of Work

Implement a GPT-5 evaluator that receives day totals, day events, previous day context, and activity context. Parse strict JSON containing `status` and `healthy`. Invoke it immediately after nutrient totals are updated for a day in `addFoodEvent`, then persist results in `food_log`. Also ensure `healthy` survives non-model update paths where rows are rebuilt.

## Concrete Steps

Run from repository root (`/Users/williamleahy/Documents/New project`):

    node --check src/trackingData.js
    npm run build

Expected:

    node --check exits successfully with no output.
    npm run build completes with "✓ built" and no errors.

## Validation and Acceptance

1. Add a new food event for an existing date via chat or `/api/food/log`.
2. Fetch that date via `/api/food/events?date=YYYY-MM-DD` and inspect `food_log.status` + `food_log.healthy`.
3. Confirm values reflect recalculation after the new event, not stale prior values.
4. Open Diet view and verify `On track` and `Healthy` columns update for that day.

## Idempotence and Recovery

The change is additive and safe to re-run. If GPT inference fails, food logging still persists totals and existing flags remain. Recovery path is simply retrying another log or rebuild.

## Artifacts and Notes

Key implementation points:

    src/trackingData.js
      - FoodDayFlags schema and parser format
      - recalculateFoodDayFlagsWithModel(...)
      - refreshFoodLogFlagsInData(...)
      - addFoodEvent(...) now awaits refreshFoodLogFlagsInData(...)
      - applyFoodEventToFoodLogInData(...) preserves healthy
      - rollupFoodLogFromEvents(...) preserves healthy

## Interfaces and Dependencies

- Uses existing OpenAI dependency via `getOpenAIClient()` from `src/openaiClient.js`.
- Uses structured response parsing with:
  - `zod`
  - `zodTextFormat` from `openai/helpers/zod`
- Uses existing model config fallback:
  - `OPENAI_ASSISTANT_MODEL || OPENAI_MODEL || "gpt-5.2"`

Revision note (2026-02-09): Created this plan after implementing to document architecture decisions, persistence behavior, and validation outcomes for future contributors.
