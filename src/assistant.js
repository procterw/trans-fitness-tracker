import { getOpenAIClient } from "./openaiClient.js";
import {
  ensureCurrentWeek,
  getDailyFoodEventTotals,
  getFoodEventsForDate,
  getFoodLogForDate,
  getSuggestedLogDate,
  listFoodLog,
  readTrackingData,
} from "./trackingData.js";

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function pickTransitionContext(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  return {
    core_goal: typeof ctx.core_goal === "string" ? ctx.core_goal : null,
    comparison_set: typeof ctx.comparison_set === "string" ? ctx.comparison_set : null,
    primary_current_work: typeof ctx.primary_current_work === "string" ? ctx.primary_current_work : null,
    principle: typeof ctx?.timeline_and_expectations?.principle === "string" ? ctx.timeline_and_expectations.principle : null,
  };
}

function sanitizeMessages(messages) {
  const safe = [];
  for (const m of messages) {
    const role = m?.role === "user" || m?.role === "assistant" ? m.role : null;
    const content = typeof m?.content === "string" ? m.content : null;
    if (!role || !content) continue;
    safe.push({ role, content });
  }
  return safe.slice(-12);
}

export async function askAssistant({ question, date = null, messages = [] }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const selectedDate = isIsoDateString(date) ? date : getSuggestedLogDate();
  const [foodLogRow, eventsForDate, totalsForDate, recentFoodLog] = await Promise.all([
    getFoodLogForDate(selectedDate),
    getFoodEventsForDate(selectedDate),
    getDailyFoodEventTotals(selectedDate),
    listFoodLog({ limit: 14 }),
  ]);

  const context = {
    timezone: "America/Los_Angeles",
    selected_date: selectedDate,
    diet_philosophy: tracking.diet_philosophy ?? null,
    fitness_philosophy: tracking.fitness_philosophy ?? null,
    transition_context: pickTransitionContext(tracking.transition_context),
    food_log_for_date: foodLogRow,
    food_events_for_date: eventsForDate,
    day_totals_from_events: totalsForDate,
    recent_food_log: recentFoodLog,
    current_week: tracking.current_week ?? null,
  };

  const system = [
    "You are a helpful assistant for a personal health & fitness tracker.",
    "The user is tracking trans feminization goals with a calm-surplus diet and endurance-biased fitness.",
    "Use the provided JSON context as the source of truth. Do not invent dates, totals, or events.",
    "If the context does not contain the information needed, say what is missing and ask a clarifying question.",
    "When referencing numbers, use the units as shown (kcal, g, mg).",
    "Be concise and supportive; prefer short actionable next steps.",
  ].join(" ");

  const input = [
    { role: "system", content: system },
    { role: "developer", content: `Context JSON:\n${JSON.stringify(context, null, 2)}` },
  ];

  const safeMessages = sanitizeMessages(messages);
  for (const m of safeMessages) input.push(m);

  input.push({ role: "user", content: question });

  const response = await client.responses.create({ model, input });
  return (response.output_text || "").trim();
}

