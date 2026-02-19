# LLM Ingest Test Matrix

This matrix covers non-deterministic LLM routing/output by testing stable behavioral contracts:

- selected action (`food`, `activity`, `question`, `clarify`)
- data side effects (`food.days`, `activity.weeks` via `week`)
- idempotency and duplicate prevention
- update semantics (mutate existing row, do not append)

## Required Fixtures

- `samples/avocado-toast.png` for food-photo tests.
- One activity screenshot fixture (recommended: `samples/strava-run.png`) for activity-photo tests.

## Core Assertions Used Across Cases

- `food.days` rows change only when expected.
- Logged meal updates mutate the same day row when date is unchanged.
- Day totals are recomputed correctly after add/update/date-move.
- `week` workout updates happen only for activity intent.
- Duplicate submissions do not create extra rows.

## Matrix

| ID | Scenario | Input (assistant ingest unless noted) | Expected Action | Expected Data Result |
|---|---|---|---|---|
| F01 | Add food (text) | `"I ate oatmeal with berries"` | `food` | `food_events +1`, `food_log` day totals increase, `log_action=created` |
| F02 | Add food (photo) | image=`samples/avocado-toast.png`, message optional | `food` | `food_events +1`, `food_log` day totals increase |
| F03 | Update food (text) | `event_id=<existing>`, message correction | `food` | same event id mutated, `food_events` count unchanged, `log_action=updated` |
| F04 | Update food (photo) | `event_id=<existing>`, new image | `food` | same event id mutated from image estimate, no new event |
| F05 | Move food to another date | `event_id=<existing>`, `date=<new day>` | `food` | old day totals decrease, new day totals increase, event count unchanged |
| F06 | Vague food asks clarify | `"had some stuff"` no image | `clarify` | no write to `food_events` or `food_log` |
| F07 | Low-confidence food phrase | ambiguous short text | `clarify` | no writes |
| A01 | Add activity (text) | `"Did a 45 minute run, moderate"` | `activity` | matching checklist item checked/updated, no food write |
| A02 | Vague activity asks clarify | `"worked out"` | `clarify` | no checklist mutation |
| A03 | Add activity from photo screenshot | image=`samples/strava-run.png`, message empty | `activity` | checklist item updated from photo-derived context |
| A04 | Activity photo with supporting text | image + `"this was my run today"` | `activity` | checklist mutation only, no food write |
| A05 | Activity image is unclear | unclear screenshot/photo | `clarify` | no checklist/food write |
| R01 | Ask question only | `"What is my protein today?"` | `question` | no write to food/activity data |
| M01 | Multi-intent mixed message | `"I ate toast and ran 30 min"` | `clarify` (preferred) | no writes until clarified |
| D01 | Duplicate submit race | same request fired twice quickly | first `food`, second `food` | second returns existing (`log_action=existing`), no extra event |
| D02 | Retry with same `client_request_id` | replay exact request id | same action as first | same event returned, no extra write |
| D03 | Duplicate without request id (near-time) | same payload within 15s | same action | dedupe fallback prevents second write |
| D04 | Legit repeated meal separated in time | same text later, different intent timing | `food` | second event should be allowed when outside dedupe window |
| U01 | Update nutrients only | `event_id` + same text/date, changed quantity | `food` | event mutated, totals reflect new nutrients only once |
| U02 | Update with invalid `event_id` | nonexistent id | error response | no data change |
| S01 | Sync endpoint idempotence | `POST /api/food/sync` twice same date | n/a | totals unchanged on second run |
| V01 | Invalid photo mimetype | non-image upload | error response | no data change |
| V02 | Missing message and image | empty ingest | error response | no data change |
| C01 | Clarification follow-up mapping | ambiguous then user follow-up | `food` or `activity` | only one final write after clarification |
| T01 | Rollover boundary before cutoff | submit near midnight PT | route-specific | event saved to suggested prior day unless explicit date |
| T02 | Rollover boundary with explicit date | explicit `date` provided | route-specific | explicit date respected |

## Photo-Activity Capability Gate

Treat this as a hard gate before release:

1. Submit `samples/strava-run.png` with empty message to `POST /api/assistant/ingest`.
2. Verify action is `activity` or `clarify`, but never `food`.
3. If `activity`, verify checklist updates and no food event is created.
4. If `clarify`, submit one follow-up sentence and verify activity is logged with no food write.

## Recommended Automation Split

- Deterministic integration tests (mock LLM): validate write/update/idempotency contracts for all rows above.
- Eval tests (real LLM): validate routing quality and clarify behavior for selected prompts/images from this matrix.

## Executable Harness Commands

- Deterministic contracts: `npm run test:harness`
- Mocked ingest-image plumbing checks: `npm run test:ingest-mocked`
- Real model evals (requires `OPENAI_API_KEY`): `npm run eval:llm`
- Real model evals with custom threshold: `npm run eval:llm -- --min-pass-rate 0.80`
