# Model-Centric Chat Intent Refactor

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This document follows `/Users/williamleahy/Documents/New project/PLANS.md`.

## Purpose / Big Picture

After this change, chat no longer contains a special “import data” routing path, and activity/food intent handling relies primarily on the model instead of local regex heuristics. Users can type normal corrections and in-progress workout messages without regex-based server overrides deciding behavior. The model receives explicit context (including the latest food event id candidate) and decides whether to update or create.

## Progress

- [x] (2026-02-27 17:07Z) Captured scope and target behavior in this ExecPlan.
- [x] (2026-02-27 17:10Z) Removed chat import routing branch and related helper wiring.
- [x] (2026-02-27 17:10Z) Removed regex-driven intent overrides (food clarification heuristic in client, in-progress activity remap in server).
- [x] (2026-02-27 17:10Z) Added model-first correction context by sending `recent_food_event_id` to ingest decision context and wiring update fallback only when model marks correction.
- [x] (2026-02-27 17:10Z) Updated ingest instructions/schema to support correction intent explicitly.
- [x] (2026-02-27 17:10Z) Ran static consistency checks (symbol usage/import references) and confirmed no stale references remain.

## Surprises & Discoveries

- Observation: The repository references `PLANS.md` at root, not `.agent/PLANS.md`.
  Evidence: `/Users/williamleahy/Documents/New project/PLANS.md` exists; `.agent/PLANS.md` does not.

## Decision Log

- Decision: Use an explicit model-controlled correction flag (`is_correction`) instead of regex inference in client/server.
  Rationale: This preserves deterministic write safety while shifting semantic interpretation to GPT-5.
  Date/Author: 2026-02-27 / Codex

## Outcomes & Retrospective

Chat intent routing is now model-centric in the targeted paths. The special “import in chat” behavior has been removed, and semantic regex overrides were removed from both client and server. Correction handling is now explicit and model-controlled through `is_correction` plus `recent_food_event_id` context. No runtime tests were executed in this pass, so behavioral verification remains a follow-up step.

## Context and Orientation

The ingest request path starts in `/Users/williamleahy/Documents/New project/client/src/App.jsx`, sends data through `/Users/williamleahy/Documents/New project/client/src/api.js`, and reaches `/Users/williamleahy/Documents/New project/src/server.js` at `POST /api/assistant/ingest`. The model decision is produced in `/Users/williamleahy/Documents/New project/src/assistant.js`, and write behavior is applied in `/Users/williamleahy/Documents/New project/src/server/ingestHelpers.js`.

## Plan of Work

Edit the chat client to remove regex-based correction detection and instead send a plain `recent_food_event_id` hint. Edit the API transport and ingest route to accept/pass that field. Extend the ingest model schema and instructions with an explicit correction signal and guidance for “starting now” activity phrasing. Remove the special chat import routing branch and remove server-side activity remap heuristics that override model output.

## Concrete Steps

From `/Users/williamleahy/Documents/New project`:

    Edit client/src/App.jsx
    Edit client/src/api.js
    Edit src/server.js
    Edit src/assistant.js
    Edit src/server/ingestHelpers.js
    Run: rg -n "old_symbol|new_symbol" src client

## Validation and Acceptance

Acceptance for this refactor is:

1. `/api/assistant/ingest` has no bulk-import chat branch.
2. Client no longer uses regex function `isLikelyFoodClarificationMessage`.
3. Server no longer applies `remapActivitySelectionsForInProgressStart`.
4. Model context includes `recent_food_event_id`, and schema/instructions include explicit correction handling.
5. Build-time static references are consistent (no unresolved imports/exports).

## Idempotence and Recovery

All edits are source-only and idempotent. Re-applying the same patch should produce no further changes. If a step fails due to patch mismatch, re-read the current file and re-apply targeted edits.

## Artifacts and Notes

Key references:

    client/src/App.jsx
    client/src/api.js
    src/server.js
    src/assistant.js
    src/server/ingestHelpers.js

## Interfaces and Dependencies

`ingestAssistantStream` and `ingestAssistant` accept `recentFoodEventId`. `POST /api/assistant/ingest` accepts `recent_food_event_id`. `decideIngestAction` accepts `recentFoodEventId` and injects it into model context. `IngestFoodDecisionSchema` carries `is_correction` as model output, and write helpers use it to decide whether to apply the recent event id fallback.

Update note: Plan updated after implementation to mark completed milestones and record final outcomes for restartability.
