# Unified Chat-Style Ingest for Food, Activity, and Questions

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, the Food tab behaves like a single ChatGPT-style composer: the user types once at the bottom (optionally attaching a photo) and the system decides whether they are logging food, logging an activity, or asking a question. GPT‑5.2 classifies the intent, then the server either logs to `tracking-data.json` and returns a short summary message, or answers the question. If the intent is ambiguous, the server asks a clarifying question instead of logging. The user can see this working by submitting a few messages (e.g., “70 minute run”, “ate a bagel”, “what’s my protein today?”) and observing the assistant summaries and updated data.

## Progress

- [x] (2026-02-05 20:17Z) Create this ExecPlan with initial scope, context, and acceptance.
- [x] (2026-02-05 20:24Z) Implement GPT‑5.2 intent routing and activity mapping on the server.
- [x] (2026-02-05 20:24Z) Replace the Food tab UI with a single chat thread + unified composer.
- [x] (2026-02-05 20:24Z) Update docs and environment examples for the new ingest endpoint/model.
- [x] (2026-02-05 20:24Z) Validate build and basic flows (food, activity, question, clarify).

## Surprises & Discoveries

None yet.

## Decision Log

- Decision: Use a new unified endpoint `POST /api/assistant/ingest` that accepts text and optional image, and returns a summary message plus any log payloads.
  Rationale: A single endpoint mirrors the “single input” UI and keeps intent routing server-side with GPT‑5.2 as requested.
  Date/Author: 2026-02-05 / Codex
- Decision: Use GPT‑5.2 structured output (Zod‑parsed JSON) to classify intent and map activity selections to current checklist items.
  Rationale: Structured output is already used in this repo and gives reliable parsing with explicit fields.
  Date/Author: 2026-02-05 / Codex
- Decision: Activity logs will auto‑check items and can update multiple items at once; details will be standardized and may include a follow‑up question.
  Rationale: Matches user requirements for auto‑checking, multi‑item logging, and standardized details.
  Date/Author: 2026-02-05 / Codex
- Decision: Treat low-confidence intent decisions (<0.55) as clarifications.
  Rationale: The user requested explicit clarifying questions when ambiguous; the threshold avoids accidental logging.
  Date/Author: 2026-02-05 / Codex
- Decision: Standardize activity details from structured fields (minutes, intensity, notes) and store a single details string per checklist item.
  Rationale: Provides consistent logging while preserving extra specifics in notes.
  Date/Author: 2026-02-05 / Codex

## Outcomes & Retrospective

Completed a unified chat-style ingest flow: GPT‑5.2 classifies food/activity/questions, activity logs auto‑check checklist items with standardized details, and the Food tab now uses a single bottom composer with a chat thread. The new endpoint and environment variable are documented, and the build passes. Follow-up refinement for food entries remains a future enhancement if editing existing food events becomes necessary.

## Context and Orientation

The server is in `src/server.js`, which exposes existing endpoints for food logging (`/api/food/log`) and assistant Q&A (`/api/assistant/ask`). Assistant logic lives in `src/assistant.js`, which already calls OpenAI for Q&A with context from `tracking-data.json`. Food logging uses `src/visionNutrition.js` and writes to `tracking-data.json` via helpers in `src/trackingData.js`. The React UI lives in `client/src/App.jsx` and the client API wrappers live in `client/src/api.js`. The current Food tab has a dedicated food form plus a separate Q&A section; it will be replaced with a single chat feed and a bottom composer.

## Plan of Work

First, add a new GPT‑5.2 intent router that receives the user’s message, the optional presence of an image, and the current fitness checklist items. This router will return a structured decision (food, activity, question, or clarify) and, for activities, a set of `{category, index, details}` selections. Next, implement a new server endpoint that uses that decision to either call the existing food logging pipeline, update the current week checklist items (auto‑checked, with standardized details), or call the existing question‑answering assistant. Then, refactor the Food tab into a chat-style thread and a single bottom composer that sends all input to the new endpoint, with optional image upload. Finally, update documentation (PROJECT.md and `.env.example`) to reflect the new endpoint and model, and validate the build.

## Concrete Steps

Run commands from the repository root.

1. Add GPT‑5.2 intent routing to `src/assistant.js` and expose a new function for ingestion decisions. Add any helper functions and a Zod schema for the structured decision.
2. Add a new route in `src/server.js` (`POST /api/assistant/ingest`) to:
   - Accept `multipart/form-data` with `message`, optional `image`, optional `date`, and optional `messages` JSON.
   - Call the GPT‑5.2 decision function.
   - For food intent, call the existing log pipeline (image + text) and return a short summary plus the nutrition payload.
   - For activity intent, update one or more checklist items (auto‑checked) and return a summary and any follow‑up question.
   - For question intent, call `askAssistant` and return the answer.
   - For clarify intent, return the clarifying question.
3. Update `client/src/api.js` with a new `ingestAssistant` helper that sends `FormData` to `/api/assistant/ingest`.
4. Replace the Food tab UI in `client/src/App.jsx`:
   - Remove the separate food form and “Ask a question” section.
   - Add a chat thread that displays user and assistant messages.
   - Keep the single bottom composer with optional photo and Enter‑to‑submit.
   - Display assistant summaries and follow‑ups in the chat thread.
5. Update `PROJECT.md` to document the new endpoint and unified input behavior. Add `OPENAI_INGEST_MODEL` to `.env.example`.
6. Run `npm run build` to validate the UI and server bundle.

## Validation and Acceptance

Start the app with `npm run dev` and verify:

- Typing “70 minute run” produces a chat response summarizing a logged activity and the matching checklist item is auto‑checked in the Fitness tab.
- Typing “ate a bagel” (with or without a photo) produces a chat response summarizing the logged meal and shows nutrition details.
- Typing a question (e.g., “What’s my protein today?”) returns an assistant answer without logging.
- Ambiguous input triggers a clarifying question rather than logging.

Run `npm run build` and expect it to complete without errors.

## Idempotence and Recovery

Edits are safe to reapply; re‑running the build is idempotent. If the new endpoint fails, revert to the previous `/api/assistant/ask` and `/api/food/log` routes by removing the ingest route and re‑building. No data migrations are required.

## Artifacts and Notes

Build output (2026-02-05 20:24Z):

    > npm run build
    vite v7.3.1 building client environment for production...
    ✓ 289 modules transformed.
    ✓ built in 949ms

## Interfaces and Dependencies

In `src/assistant.js`, define a new exported function such as `decideIngestAction({ message, hasImage, date, messages })` that returns a structured decision object parsed with Zod. It must use GPT‑5.2 by default (via `OPENAI_INGEST_MODEL` or `gpt-5.2` fallback) and include the current week checklist items in the prompt.

In `src/server.js`, add `POST /api/assistant/ingest` that accepts `multipart/form-data` fields:

    message: string
    image: file (optional)
    date: YYYY-MM-DD (optional)
    messages: JSON string (optional)

Responses should be JSON with:

    ok: boolean
    action: "food" | "activity" | "question" | "clarify"
    assistant_message: string
    followup_question: string | null
    food_result: object | null
    activity_updates: array | null
    answer: string | null

The client should only require `assistant_message` and optionally `followup_question` + `food_result` for detail rendering.

Plan change note (2026-02-05 20:16Z): Initial ExecPlan created to cover the unified ChatGPT-style ingest feature requested by the user.
Plan change note (2026-02-05 20:17Z): Marked ExecPlan creation as complete in Progress.
Plan change note (2026-02-05 20:24Z): Updated Progress, Decision Log, and Outcomes to reflect completed implementation and validation.
Plan change note (2026-02-05 20:25Z): Added build artifact evidence to Artifacts and Notes.
