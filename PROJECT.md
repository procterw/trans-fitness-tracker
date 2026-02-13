# Project: Health & Fitness Tracker (feminization-focused)

This is a personal diet + fitness tracker designed around long-term trans feminization goals. It tracks food intake (macros + key micronutrients), fitness activities, and adherence to routines that support gradual body recomposition (upper-body atrophy, glute/hip maintenance/growth, endurance, mobility) with low stress and high sustainability.

## Working agreements (how vs what)
- **How we build:** follow `PLANS.md` (immutable). For any non-trivial feature or refactor, create/use an ExecPlan per `PLANS.md` and keep progress/decisions there. Don’t duplicate build-process rules in this file.
- **What we build:** `PROJECT.md` (mutable) is the source of truth for product scope, user-visible behavior, data model, and API/UI requirements. Update this file whenever the target behavior changes.

## Core goals (as encoded in the data)
- **Nutrition:** consistent “calm surplus” for energy sufficiency and fat redistribution; avoid restriction patterns and avoid *lean/acute* protein timing that might increase muscle-retention signaling when paired with training.
- **Fitness:** endurance-biased; lower-body/glute-focused strength; **intentional avoidance of upper-body training**; mobility/prehab 2×/week (hip/ankle/calf emphasis); ballet/climbing as optional “other” activities.
- **Process:** long-horizon progress (3–5+ years); non-punitive tracking; reduce hypervigilant self-scrutiny by leaning on consistency + data.

## Source of truth: split tracking files
Tracking data is split across four files in the repo root:
- `tracking-food.json` — `food_log` + `food_events`
- `tracking-activity.json` — `fitness_weeks` + `current_week`
- `tracking-profile.json` — `user_profile` (generic profile)
- `tracking-rules.json` — `metadata`, `diet_philosophy`, `fitness_philosophy`, `assistant_rules` (JSON backend / local fallback source)
These files are optional when `TRACKING_BACKEND=postgres`; empty template files are valid for future local JSON development.

To backfill existing profile payloads into the generic shape and remove legacy keys, run `npm run migrate:profile` (idempotent). This migrates `tracking-profile.json`.

When `TRACKING_BACKEND=postgres`, rules/philosophy are stored per-user in Postgres (`user_rules.rules_data`).
When `TRACKING_BACKEND=json` (or split-file mode), rules are loaded from `tracking-rules.json`.

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
- Unified meal logging (photo and/or manual description) + nutrition inference (OpenAI)
- Asking questions in-app (OpenAI assistant, contextualized by the split tracking files)
- A unified chat-style input that routes food/activity/questions via GPT‑5.2
- Authenticated staged onboarding:
  - broad goals chat (diet + fitness)
  - iterative fitness checklist proposal with explicit “accept”
  - iterative calorie/macro goal proposal with explicit “accept”
  - auto-route to the main UI after acceptance
- Weekly fitness checklist updates (`current_week`)
- Settings chat for editing profile context, checklist template, and diet/fitness philosophy
- A basic dashboard for browsing:
  - food events + daily totals for a selected date
  - a full `food_log` table across all days (including each day’s notes)
  - optional “recalculate from events” rollups

### Run
1. `npm install`
2. `cp .env.example .env` and set `OPENAI_API_KEY`
3. `npm run dev`
4. Open `http://localhost:3000`

### Build (optional)
1. `npm run build`
2. `npm start`

### Environment variables
- `OPENAI_API_KEY` (required)
- `OPENAI_MODEL` (optional; defaults to `gpt-5.2`)
- `OPENAI_ASSISTANT_MODEL` (optional; defaults to `OPENAI_MODEL`)
- `OPENAI_INGEST_MODEL` (optional; defaults to `gpt-5.2`)
- `PORT` (optional; defaults to `3000`)
- `TRACKING_FOOD_FILE` (optional; defaults to repo `tracking-food.json`)
- `TRACKING_ACTIVITY_FILE` (optional; defaults to repo `tracking-activity.json`)
- `TRACKING_PROFILE_FILE` (optional; defaults to repo `tracking-profile.json`)
- `TRACKING_RULES_FILE` (optional; defaults to repo `tracking-rules.json`)

### Endpoints
- `GET /` → React UI (Food / Fitness / Dashboard)
- `GET /api/onboarding/state` → returns onboarding completion state, progress, and next prompt
- `POST /api/onboarding/chat` → JSON body: `message` + optional `messages`
  - Stage-aware onboarding chat:
    - goals conversation (diet + fitness goals, with clarifying questions)
    - checklist iteration (returns proposal + accept action)
    - diet target iteration (returns proposal + accept action)
- `POST /api/onboarding/confirm` → JSON body: `action` (`accept_checklist` or `accept_diet`) + optional `proposal`
  - Applies accepted onboarding proposal and advances stage
  - Completing `accept_diet` marks onboarding complete and routes user to main app
- `POST /api/onboarding/dev/restart` (dev-only) → resets onboarding metadata for the current signed-in user and re-enters onboarding flow
- `GET /api/context` → returns suggested log date (rollover-aware) + philosophy snippets
- `POST /api/food/log` → multipart form:
  - optional `image` (if present, uses vision)
  - optional `description` (if no image, required; if image is present, used as additional context)
  - optional `date` and `notes`
  - Appends a `food_events` entry and updates the matching `food_log` row (adds the meal totals)
  - Recalculates `food_log.status` (on-track) and `food_log.healthy` with GPT‑5 after each added meal for that date
  - Returns the created event + the estimate + running totals for that date (from `food_events`) + updated `food_log` row
- `POST /api/food/photo` → multipart upload (`image`) + optional `date`, `notes`, and `description` (legacy; still supported)
- `POST /api/food/manual` → JSON body: `description` + optional `date` and `notes` (legacy; still supported)
- `GET /api/food/events?date=YYYY-MM-DD` → events for that date + running totals + existing `food_log` row (if present)
- `POST /api/food/rollup` → JSON body: `date` + optional `overwrite`
  - Recalculates a `food_log` row *from `food_events`* (useful if you want the daily totals to equal the sum of events)
  - By default it will **not overwrite** an existing non-auto-generated `food_log` entry unless `overwrite: true`
- `POST /api/food/sync` → JSON body: `date` + optional `only_unsynced` (default `true`)
  - Adds existing `food_events` totals into the matching `food_log` row (useful for events created before auto-sync existed)
  - Marks synced events with `applied_to_food_log: true` to avoid double counting
- `GET /api/fitness/current` → current week checklist (rollover-aware)
- `POST /api/fitness/current/item` → JSON body: `category` (any key present in the user’s current-week checklist), `index`, `checked`, `details`
  - Recomputes `current_week.summary` after each activity change as a workout-only progress summary + rest-of-week plan (no diet guidance).
- `POST /api/fitness/current/summary` → JSON body: `summary`
- `POST /api/assistant/ask` → JSON body: `question` + optional `date` + optional `messages`
  - Answers questions using OpenAI, contextualized by the split tracking files (diet/fitness philosophy + recent logs)
- `POST /api/assistant/ingest` → multipart form: `message` + optional `image`, `date`, `messages`
  - GPT‑5.2 decides if the input is food, activity, or a question; logs the result or answers/clarifies
  - For image inputs, routing inspects image content (for example meal photos vs Strava/workout screenshots)
- `POST /api/settings/chat` → JSON body: `message` + optional `messages`
  - GPT‑5.2 settings assistant that can answer settings questions and propose structured updates to:
    - `user_profile` (generic profile)
    - `diet_philosophy` and `fitness_philosophy` (goals/philosophy)
    - `current_week` checklist categories/items template
  - Returns `requires_confirmation` + proposal payload when high-impact changes are requested
- `POST /api/settings/confirm` → JSON body: `proposal` + optional `apply_mode` (`"now"` or `"next_week"`)
  - Applies a previously proposed settings change with explicit user confirmation
  - Checklist changes can be applied immediately or staged for next week rollover
- `GET /api/fitness/history?limit=N` → recent `fitness_weeks`

## Food event logging format
Photo + manual logs append to `tracking-food.json.food_events` with:
- `id` (uuid)
- `date` (effective date used for the log)
- `logged_at` (Seattle-local ISO string)
- `rollover_applied` (true if effective date differs from “today” in Seattle time)
- `source` (e.g. `"photo"` or `"manual"`)
- `description` (short meal title)
- `input_text` (user-provided description text, if any)
- `notes` (user-supplied)
- `nutrients` (macros + micros; some may be `null`)
- `items` (itemized breakdown)
- `model`, `confidence`
- `applied_to_food_log` (true if the event totals were applied into `food_log`)

## OpenAI nutrition inference (photo + text)
Implementation: `src/visionNutrition.js`
- Uses the OpenAI Responses API with a strict Zod schema for structured output.
- Photo flow uses `input_image`; manual flow uses text-only input.
- Produces **itemized** nutrients and **totals**. Totals are normalized to match the sum of items.
- Sets micronutrients to `null` when they’re genuinely not inferable from image/context (rather than guessing).

## File layout
- `tracking-food.json` — food events + daily food log
- `tracking-activity.json` — weekly fitness checklist data
- `tracking-profile.json` — generic user profile + legacy transition-context mirror
- `tracking-rules.json` — metadata + diet/fitness philosophy + assistant prompt/routing rules (JSON backend or migration source)
- `src/server.js` — Express server (API + serves React)
- `src/trackingData.js` — reading/writing + rollover-aware date + fitness week helpers + rollups
- `src/visionNutrition.js` — OpenAI nutrition estimation (photo + text)
- `client/` — React app (Vite)
- `dist/` — production build output (generated)

## Intended interaction model (assistant + app)
Project intent includes a workflow where:
- When you mention eating food or doing activities, the tracker should **immediately** update the split tracking files.
- Advice should be contextualized by reading recent patterns from the tracking files first.

(Current code implements a unified chat-style input with GPT‑5.2 routing, photo + manual meal logging → `food_events` + auto-updated `food_log`, current-week fitness checklist updates, and optional “recalculate from events” rollups.)

## Next steps (likely)
- Add “quick add” without OpenAI for foods with numeric definitions (e.g., soy milk / fish oil / chili per-serving).
- Add edit/delete for `food_events` (and recompute totals).
- Expand dashboards: weekly adherence, cardio volume, glute sessions, calorie/macro averages, weight trend.
- Add safety rails: warn on sustained under-eating, high systemic training stress, or accidental upper-body training stimulus.
