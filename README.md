# Health & Fitness Tracker

Minimal local web app that:
- Logs meals (photo + manual description) into `tracking-data.json.food_events`
- Uses the OpenAI API to estimate macros + key micronutrients
- Lets you update the weekly fitness checklist (`current_week`)
- Includes a basic dashboard for daily totals + optional rollups to `food_log`

## Setup
1. Install deps: `npm install`
2. Create env file: `cp .env.example .env` and set `OPENAI_API_KEY`
3. Start the server: `npm run dev`
4. Open: `http://localhost:3000`

## Data
- All tracking data lives in `tracking-data.json`
- Meal logs are appended to `food_events` (created automatically if missing)
