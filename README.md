# Health & Fitness Tracker (photo nutrition logging)

Minimal local web app that:
- Lets you upload a meal photo
- Uses the OpenAI API (vision) to estimate macros + key micronutrients
- Appends a `food_events` entry into `tracking-data.json`

## Setup
1. Install deps: `npm install`
2. Create env file: `cp .env.example .env` and set `OPENAI_API_KEY`
3. Start the server: `npm run dev`
4. Open: `http://localhost:3000`

## Data
- All tracking data lives in `tracking-data.json`
- Photo logs are appended to `food_events` (created automatically if missing)
