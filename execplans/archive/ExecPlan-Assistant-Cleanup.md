# Refactor Assistant Module For Current Workflows

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, `src/assistant.js` is easier to maintain while preserving behavior for the current Postgres-backed workflows (ingest routing, Q&A, onboarding, settings). Shared OpenAI request patterns and instruction assembly are consolidated so future changes are lower risk and less repetitive.

## Progress

- [x] (2026-02-13 04:32Z) Create ExecPlan and define behavior-preserving cleanup scope.
- [x] (2026-02-13 04:53Z) Extract shared helper functions in `src/assistant.js` for model selection, instruction assembly, request input composition, and structured parse handling.
- [x] (2026-02-13 04:53Z) Refactor exported assistant functions to use shared helpers with no response-shape changes.
- [x] (2026-02-13 04:53Z) Run validation (`node --check`, `npm run build`, `npm run test:harness`) and capture outcome.

## Surprises & Discoveries

- Observation: `src/assistant.js` duplicates the same `responses.parse` and `input` assembly flow across multiple exports.
  Evidence: `decideIngestAction`, `composeMealEntryResponse`, `askOnboardingAssistant`, `proposeOnboardingChecklist`, `proposeOnboardingDietGoals`, and `askSettingsAssistant` all rebuild similar blocks.

## Decision Log

- Decision: Keep all schemas and exported function signatures unchanged.
  Rationale: This cleanup should not affect API contracts consumed by `src/server.js`.
  Date/Author: 2026-02-13 / Codex
- Decision: Consolidate request-building into shared helpers but keep per-flow context labels and payload fields unchanged.
  Rationale: Reduces duplication while preserving prompt/context behavior across ingest, onboarding, and settings workflows.
  Date/Author: 2026-02-13 / Codex

## Outcomes & Retrospective

Completed a behavior-preserving refactor of `src/assistant.js` by extracting shared helpers (`getAssistantModel`, `getIngestModel`, `buildSystemInstructions`, `buildModelInput`, `parseStructuredResponse`, and `cleanUserMessage`). Exported assistant workflows now call these helpers instead of repeating inline parse/input assembly logic. Validation passed (`node --check`, build, deterministic harness), with no evidence of contract regression.

## Context and Orientation

`src/assistant.js` is the central orchestration layer for OpenAI calls. It transforms tracking data into context JSON and returns parsed structured outputs for onboarding/settings/ingest as well as plain-text Q&A. Current behavior already matches backend workflows, but internal duplication increases maintenance cost and merge risk.

## Plan of Work

Introduce private utility functions near the existing helper section:

- model selection helpers (`getAssistantModel`, `getIngestModel`)
- instruction assembly helper (`buildSystemInstructions`)
- request input helper (`buildModelInput`)
- structured parse helper (`parseStructuredResponse`)

Then switch each exported function to those helpers without changing schemas, context payloads, or returned object shape.

## Concrete Steps

Run commands from repository root:

1. Edit `src/assistant.js` with behavior-preserving helper extraction.
2. Run syntax and validation:
   - `node --check src/assistant.js`
   - `npm run build`
   - `npm run test:harness`

## Validation and Acceptance

- `src/assistant.js` compiles.
- Build succeeds.
- Deterministic harness passes.
- Exported response shapes remain unchanged.

## Idempotence and Recovery

Refactor is code-only and can be reverted by restoring `src/assistant.js` from git history. No schema/data mutation involved.

## Artifacts and Notes

Validation output:

    node --check src/assistant.js
    (no output; success)

    npm run build
    vite v7.3.1 building client environment for production...
    ✓ built in 1.04s

    npm run test:harness
    Deterministic harness passed
    Total checks: 10

## Interfaces and Dependencies

- No new dependencies.
- Keep existing exported interfaces:
  - `decideIngestAction`
  - `askAssistant`
  - `composeMealEntryResponse`
  - `askOnboardingAssistant`
  - `proposeOnboardingChecklist`
  - `proposeOnboardingDietGoals`
  - `askSettingsAssistant`

Plan change note (2026-02-13 04:32Z): Initial ExecPlan created for assistant module cleanup.
Plan change note (2026-02-13 04:53Z): Refactor completed with shared helper extraction and validation evidence recorded.
