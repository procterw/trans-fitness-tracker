# Project: Health & Fitness Tracker (feminization-focused)

This is a personal diet + fitness tracker designed around long-term trans feminization goals. It tracks food intake (macros + key micronutrients), fitness activities, and adherence to routines that support gradual body recomposition (upper-body atrophy, glute/hip maintenance/growth, endurance, mobility) with low stress and high sustainability.

## Core goals (as encoded in the data)
- **Nutrition:** consistent “calm surplus” for energy sufficiency and fat redistribution; avoid restriction patterns and avoid *lean/acute* protein timing that might increase muscle-retention signaling when paired with training.
- **Fitness:** endurance-biased; lower-body/glute-focused strength; **intentional avoidance of upper-body training**; mobility/prehab 2×/week (hip/ankle/calf emphasis); ballet/climbing as optional “other” activities.
- **Process:** long-horizon progress (3–5+ years); non-punitive tracking; reduce hypervigilant self-scrutiny by leaning on consistency + data.

## Source of truth: `tracking-data.json`
All tracked data lives in `tracking-data.json`. The file already contains:
- `metadata` (timezone conventions, food definitions, last updated)
- `food_log` (daily summary rows with calories/macros/micros + status)
- `food_events` (event-level food entries; used by the photo logging flow)
- `fitness_weeks` + `current_week` (weekly checklists with details + summaries)
- `diet_philosophy`, `fitness_philosophy`, `transition_context` (project “rules” / context)

### Conventions
- **Timezone:** Seattle, WA (Pacific Time).
- **Week start:** Monday.
- **Dates:** `YYYY-MM-DD`.
- **Late-night rollover:** after midnight, default to logging for the **previous** calendar day unless explicitly stated.

### Food definitions
`metadata.food_definitions` includes canonical defaults for common items (e.g., chocolate, smoothie, oatmeal, chili, fish oil, soy milk). Logging should reuse these definitions when applicable.

### Nutrients tracked
Always track:
- **Macros:** `calories`, `fat_g`, `carbs_g`, `protein_g`
- **Micronutrients:** `fiber_g`, `potassium_mg`, `magnesium_mg`, `omega3_mg`, `calcium_mg`, `iron_mg`

Note: for photo-based inference, some micronutrients may be unknown; represent unknown as `null` (not `0`).

## App: local web UI + API
This repo includes a minimal local web app that supports:
- Meal photo upload + nutrition inference (OpenAI vision)
- Manual meal description logging + nutrition inference (OpenAI text)
- Weekly fitness checklist updates (`current_week`)
- A basic dashboard for browsing food events + daily totals + optional rollups to `food_log`

### Run
1. `npm install`
2. `cp .env.example .env` and set `OPENAI_API_KEY`
3. `npm run dev`
4. Open `http://localhost:3000`

### Environment variables
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; defaults to `gpt-4.1-mini`)
- `PORT` (optional; defaults to `3000`)

### Endpoints
- `GET /` → local UI (Photo / Manual / Fitness / Dashboard)
- `GET /api/context` → returns suggested log date (rollover-aware) + philosophy snippets
- `POST /api/food/photo` → multipart upload (`image`) + optional `date` and `notes`
  - Uses OpenAI vision to estimate nutrients
  - Appends a `food_events` entry to `tracking-data.json`
  - Returns the created event + the estimate + running totals for that date (from `food_events`)
- `POST /api/food/manual` → JSON body: `description` + optional `date` and `notes`
  - Uses OpenAI text to estimate nutrients
  - Appends a `food_events` entry to `tracking-data.json`
  - Returns the created event + the estimate + running totals for that date (from `food_events`)
- `GET /api/food/events?date=YYYY-MM-DD` → events for that date + running totals + existing `food_log` row (if present)
- `POST /api/food/rollup` → JSON body: `date` + optional `overwrite`
  - Creates/refreshes a `food_log` row *from `food_events`* when missing (or when the row was auto-generated)
  - By default it will **not overwrite** an existing manual `food_log` entry
  - Auto-generated rows use `status: "⚪"` and `notes: "Auto-generated from food_events."`
- `GET /api/fitness/current` → current week checklist (rollover-aware)
- `POST /api/fitness/current/item` → JSON body: `category` (`cardio|strength|mobility|other`), `index`, `checked`, `details`
- `POST /api/fitness/current/summary` → JSON body: `summary`
- `GET /api/fitness/history?limit=N` → recent `fitness_weeks`

## Food event logging format
Photo + manual logs append to `tracking-data.json.food_events` with:
- `id` (uuid)
- `date` (effective date used for the log)
- `logged_at` (Seattle-local ISO string)
- `rollover_applied` (true if effective date differs from “today” in Seattle time)
- `source` (e.g. `"photo"` or `"manual"`)
- `description` (short meal title)
- `notes` (user-supplied)
- `nutrients` (macros + micros; some may be `null`)
- `items` (itemized breakdown)
- `model`, `confidence`

## OpenAI nutrition inference (photo + text)
Implementation: `src/visionNutrition.js`
- Uses the OpenAI Responses API with a strict Zod schema for structured output.
- Photo flow uses `input_image`; manual flow uses text-only input.
- Produces **itemized** nutrients and **totals**. Totals are normalized to match the sum of items.
- Sets micronutrients to `null` when they’re genuinely not inferable from image/context (rather than guessing).

## File layout
- `tracking-data.json` — all tracking data
- `src/server.js` — Express server (UI + API)
- `src/trackingData.js` — reading/writing + rollover-aware date + fitness week helpers + rollups
- `src/visionNutrition.js` — OpenAI nutrition estimation (photo + text)
- `public/` — static UI

## Intended interaction model (assistant + app)
Project intent includes a workflow where:
- When you mention eating food or doing activities, the tracker should **immediately** update `tracking-data.json`.
- Advice should be contextualized by reading recent patterns from `tracking-data.json` first.

(Current code implements photo + manual meal logging → `food_events`, current-week fitness checklist updates, and optional `food_log` rollups.)

## Next steps (likely)
- Add “quick add” without OpenAI for foods with numeric definitions (e.g., soy milk / fish oil / chili per-serving).
- Add edit/delete for `food_events` (and recompute totals).
- Expand dashboards: weekly adherence, cardio volume, glute sessions, calorie/macro averages, weight trend.
- Add safety rails: warn on sustained under-eating, high systemic training stress, or accidental upper-body training stimulus.




