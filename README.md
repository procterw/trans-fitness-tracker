# Health & Fitness Tracker

Minimal local web app that:
- Logs meals (photo and/or manual description) into `tracking-data.json.food_events`
- Uses the OpenAI API to estimate macros + key micronutrients
- Updates `tracking-data.json.food_log` when meals are logged
- Lets you update the weekly fitness checklist (`current_week`)
- Includes a basic dashboard for daily totals + optional “recalculate from events” rollups
- Includes a simple Q&A assistant (contextualized by `tracking-data.json`)

## Setup
1. Install deps: `npm install`
2. Create env file: `cp .env.example .env` and set `OPENAI_API_KEY`
3. Start the server: `npm run dev`
4. Open: `http://localhost:3000`

## Production build (optional)
1. `npm run build`
2. `npm start`

## Data
- All tracking data lives in `tracking-data.json`
- Meal logs are appended to `food_events` (created automatically if missing)
- If you logged events before `food_log` syncing existed, use Dashboard → “Sync unsynced events”.
