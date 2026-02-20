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
- `tracking-food.json` — `days`
- `tracking-activity.json` — `blocks` + `weeks`
- `tracking-profile.json` — profile text blobs (`general`, `fitness`, `diet`, `agent`)
- `tracking-rules.json` — `metadata`, `diet_philosophy`, `fitness_philosophy`, `assistant_rules` (JSON backend / local fallback source)
These files are optional when `TRACKING_BACKEND=postgres`; empty template files are valid for future local JSON development.

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
- First-visit settings bootstrap:
  - on first authenticated visit, the app seeds minimal starter profile text + checklist defaults
  - the app opens on Settings once (not gated), and users can navigate anywhere immediately
  - settings supports direct textarea editing and chat-driven profile/checklist edits without UI confirmation
- Weekly fitness checklist updates (`week` payload over canonical activity weeks)
- Settings for editing four profile text blobs (`general`, `fitness`, `diet`, `agent`)
- A basic dashboard for browsing:
  - day details + daily totals for a selected date
  - a full days table across all dates

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
- `POST /api/settings/bootstrap` → JSON body: optional `client_timezone`
  - Idempotently seeds starter profile/checklist defaults for first-time users
  - Returns `seeded_now`, `already_seeded`, `default_open_view`, starter summary, and optional updated profiles
- `GET /api/settings/state` → returns current profile text blobs + `settings_version`
  - also returns `training_blocks` summary (`active_block_id`, block list)
- `POST /api/settings/profiles` → JSON body with any of:
  - `general`, `fitness`, `diet`, `agent` (all text)
  - Directly applies textarea edits and updates settings history/version
- `GET /api/context` → returns suggested log date (rollover-aware) + philosophy snippets
- `GET /api/user/export` → returns all user tracking data for export/download
  - includes `exported_at`, authenticated `user_id`, and full tracking payload (`data`)
- `POST /api/user/import/analyze` → multipart form with `file` and/or pasted JSON text field (`raw_text`)
  - Parses canonical JSON payloads (including current export envelope) and returns shape detection, per-domain importability summary, warnings, preview metadata, and an `import_token`
- `POST /api/user/import/confirm` → JSON body: `import_token`, `confirm_text`
  - Requires typed confirmation (`IMPORT`) and applies a domain-scoped direct replace for validated domains
  - Returns `applied_domains`, `skipped_domains`, `warnings`, and import `stats`
- `POST /api/food/log` → multipart form:
  - optional `image` (if present, uses vision)
  - optional `description` (if no image, required; if image is present, used as additional context)
  - optional `date` and `notes`
  - Updates the matching day row in `tracking-food.json.days`
  - Returns the estimate, normalized meal event metadata, updated day totals, and updated day row
- `GET /api/food/day?date=YYYY-MM-DD` → day row + day totals for that date
- `POST /api/food/day` → direct write/update of a day row (`date`, nutrients, `complete`, `details`)
- `GET /api/food/log` → list of day rows (supports `limit`, `from`, `to`)
- `GET /api/fitness/current` → rollover-aware canonical current week payload (`week`)
  - `week` shape: `{ week_start, week_end, week_label, block_id, block_start, block_end, block_name, block_details, workouts[], summary }`
  - `workouts[]` rows: `{ name, description, category, optional, details, completed }`
- `POST /api/fitness/current/item` → JSON body: `workout_index`, `checked`, `details`
  - Updates one workout row in the current week and refreshes weekly summary text.
- `POST /api/fitness/current/summary` → JSON body: `summary` (manual summary override)
- `POST /api/assistant/ask` → JSON body: `question` + optional `date` + optional `messages`
  - Answers questions using OpenAI, contextualized by the split tracking files (diet/fitness philosophy + recent logs)
- `POST /api/assistant/ingest` → multipart form: `message` + optional `image`, `date`, `messages`
  - GPT‑5.2 decides if the input is food, activity, or a question; logs the result or answers/clarifies
  - For image inputs, routing inspects image content (for example meal photos vs Strava/workout screenshots)
- `POST /api/settings/chat` → JSON body: `message` + optional `messages`
  - GPT‑5.2 settings assistant that can answer settings questions and propose updates to:
    - `general`, `fitness`, `diet`, `agent`
    - `training_block` (`id`, `name`, `description`, `apply_timing`, `checklist_categories`)
  - Applies recognized profile/checklist changes directly and returns the applied result
- `POST /api/settings/confirm` → JSON body: `proposal`
  - Applies a previously proposed settings change for manual confirmation workflows
- `GET /api/fitness/history?limit=N` → recent canonical week snapshots (`weeks[]`), each with block metadata and `workouts[]`

## Day logging format
Photo + manual logs update one row in `tracking-food.json.days`:
- `date`
- `weight_lb`
- `calories`, `fat_g`, `carbs_g`, `protein_g`, `fiber_g`
- `complete`
- `details` (free text; includes the human-readable food narrative)

Meal responses still include lightweight event metadata (`id`, `source`, `description`, `logged_at`) for chat continuity, but persistent storage is day-centric.

## OpenAI nutrition inference (photo + text)
Implementation: `src/visionNutrition.js`
- Uses the OpenAI Responses API with a strict Zod schema for structured output.
- Photo flow uses `input_image`; manual flow uses text-only input.
- Produces **itemized** nutrients and **totals**. Totals are normalized to match the sum of items.
- Sets micronutrients to `null` when they’re genuinely not inferable from image/context (rather than guessing).

## File layout
- `tracking-food.json` — day rows (`days`)
- `tracking-activity.json` — training blocks + week snapshots
- `tracking-profile.json` — canonical settings profile text blobs (`general`, `fitness`, `diet`, `agent`)
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

(Current code implements a unified chat-style input with GPT‑5.2 routing, photo + manual meal logging that updates `days`, current-week fitness checklist updates, and day-centric diet browsing.)

## Next steps (likely)
- Add “quick add” without OpenAI for foods with numeric definitions (e.g., soy milk / fish oil / chili per-serving).
- Add edit/delete for day detail lines with optional nutrient recompute.
- Expand dashboards: weekly adherence, cardio volume, glute sessions, calorie/macro averages, weight trend.
- Add safety rails: warn on sustained under-eating, high systemic training stress, or accidental upper-body training stimulus.
