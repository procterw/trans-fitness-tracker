# UI Import for Legacy + Current Tracking JSON

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at the repository root and must be maintained in accordance with it.

## Purpose / Big Picture

After this change, users can import legacy unified tracking JSON and current export JSON through the app UI (account menu) without manual file surgery. The flow is two-step (analyze then typed confirm) and applies a direct, domain-scoped replace with best-effort validation and warnings. The expected user-visible result is successful import of valid domains, explicit warnings for missing/invalid sections, and no bootstrap reseeding of starter settings over imported data.

## Progress

- [x] (2026-02-18 17:13Z) Audited current import/export capabilities and confirmed no UI/server import path existed.
- [x] (2026-02-18 17:20Z) Added import normalization/apply engine (`src/importData.js`) for legacy + current shapes.
- [x] (2026-02-18 17:25Z) Added import analyze/confirm endpoints with tokenized confirmation in `src/server.js`.
- [x] (2026-02-18 17:31Z) Added account-menu import entry, modal flow, and API client functions.
- [ ] Run build and exercise sample-file import analyze/confirm behavior end-to-end.

## Surprises & Discoveries

- Observation: The current system had export but no import endpoint/UI at all; import failures were expected regardless of file quality.
  Evidence: Only `GET /api/user/export` exists in `src/server.js` and no import methods existed in `client/src/api.js`.

- Observation: Legacy data includes `transition_context`, which current settings flows do not consume for profile context.
  Evidence: Profile blobs are `user_profile`, `training_profile`, `diet_profile`, `agent_profile` across `src/server.js` and `src/assistant.js`.

## Decision Log

- Decision: Use a dedicated import utility module (`src/importData.js`) with domain-level normalization and apply logic.
  Rationale: Keeps server routes minimal and makes translation rules testable.
  Date/Author: 2026-02-18 / Codex

- Decision: Use short-lived in-memory import sessions (token + TTL) for analyze -> confirm handoff.
  Rationale: Avoids transmitting normalized payload back to the client and provides destructive-action guardrail.
  Date/Author: 2026-02-18 / Codex

- Decision: For legacy imports lacking `food_events`, set events to empty with warning.
  Rationale: Preserves requested direct-replace semantics while explicitly communicating reduced event-level history.
  Date/Author: 2026-02-18 / Codex

## Outcomes & Retrospective

Core implementation completed for backend parser/apply flow and UI entry/confirmation flow. Remaining task is final validation pass against sample legacy data and current export payload.

## Context and Orientation

Relevant paths:
- `src/server.js`: HTTP routes and auth context.
- `src/importData.js`: shape detection, normalization, and domain-scoped apply.
- `client/src/api.js`: new analyze/confirm client methods.
- `client/src/App.jsx`: import modal workflow.
- `client/src/components/AppNavbar.jsx`: account-menu entry.
- `client/src/styles.css`: modal styles.

## Plan of Work

Introduce a two-step import route pair. `analyze` parses and normalizes file data into a server-side plan, returning summary/warnings + token. `confirm` enforces typed `IMPORT`, consumes token, applies domain-scoped replace over current tracking data, sets seed metadata guardrails, and writes through the existing tracking backend abstraction.

## Concrete Steps

1. Add `src/importData.js` with:
   - shape detection,
   - smart key coercion,
   - per-domain validators/normalizers,
   - transition_context -> user_profile text mapping,
   - domain-scoped apply with seed guard.
2. Add endpoints in `src/server.js`:
   - `POST /api/user/import/analyze` (multipart file),
   - `POST /api/user/import/confirm` (typed confirm + token).
3. Add `client/src/api.js` methods for analyze/confirm.
4. Add account-menu import action + modal state machine in `client/src/App.jsx` and `client/src/components/AppNavbar.jsx`.
5. Add modal styles in `client/src/styles.css`.
6. Validate with build and sample data file.

## Validation and Acceptance

- `npm run build` passes.
- Analyzing `/Users/williamleahy/Desktop/data.json` returns warnings for missing `food_events` and importable domains.
- Confirm without `IMPORT` fails with 400.
- Confirm with `IMPORT` applies valid domains and returns `applied_domains` + warnings/stats.
- Post-import bootstrap does not seed starter profile/checklist over imported data.

## Idempotence and Recovery

Import sessions expire automatically and are one-time consumed at confirmation. If a token expires or confirm fails, users re-run analyze. Domain-scoped replace means non-present domains are preserved; malformed present domains are skipped with reasons.

## Artifacts and Notes

New API surface:
- `POST /api/user/import/analyze`
- `POST /api/user/import/confirm`

Key guardrails:
- typed confirmation `IMPORT`
- TTL-backed import token session
- profile migration warning when `transition_context` is mapped.

## Interfaces and Dependencies

Analyze response includes:
- `detected_shape`,
- `summary`,
- `warnings`,
- `normalized_preview`,
- `import_token`.

Confirm response includes:
- `applied_domains`,
- `skipped_domains`,
- `warnings`,
- `stats`.

Plan change note (2026-02-18 17:31Z): Initial implementation completed for import engine, backend endpoints, and UI modal flow.
