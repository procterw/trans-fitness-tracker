# Health & Fitness Tracker

Minimal local web app that:
- Logs meals (photo and/or manual description) into `tracking-food.json.food_events`
- Uses the OpenAI API to estimate macros + key micronutrients
- Updates `tracking-food.json.food_log` when meals are logged
- Lets you update the weekly fitness checklist (`current_week`)
- Includes a basic dashboard for daily totals + optional “recalculate from events” rollups
- Includes a simple Q&A assistant (contextualized by the split tracking files)

## Setup
1. Install deps: `npm install`
2. Create env file: `cp .env.example .env` and set `OPENAI_API_KEY`
3. Start the server: `npm run dev`
4. Open: `http://localhost:3000`

## Production build (optional)
1. `npm run build`
2. `npm start`

## Data
- Tracking data is split across `tracking-food.json`, `tracking-activity.json`, `tracking-profile.json`, and `tracking-rules.json`
- Meal logs are appended to `food_events` (created automatically if missing)
- If you logged events before `food_log` syncing existed, use Dashboard → “Sync unsynced events”.

## Supabase (optional, multi-user)
You can enable Google login + Postgres storage via Supabase. The React login UI is gated by `VITE_SUPABASE_ENABLED` and the API auth requirement is gated by `SUPABASE_AUTH_REQUIRED`.

Required env vars:
- Client: `VITE_SUPABASE_ENABLED`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Server: `SUPABASE_AUTH_REQUIRED`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- Tracking backend switch: `TRACKING_BACKEND=json|postgres`
- Optional local fallback user when auth is off: `TRACKING_DEFAULT_USER_ID`

Backfill existing local JSON data into Postgres:
1. Set `TRACKING_DEFAULT_USER_ID` (or pass `USER_ID=...` inline).
2. Run `npm run migrate:postgres`.
3. Re-run the same command safely; it is idempotent.
