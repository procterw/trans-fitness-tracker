import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import { getFitnessCategories } from "./fitnessChecklist.js";
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

const DEFAULT_INGEST_CLASSIFIER_INSTRUCTIONS = [
  "You classify a user's message for a health & fitness tracker.",
  "The user has a single input box that can be used to log food, log an activity, or ask a question.",
  "Choose exactly one intent: food, activity, question, or clarify.",
  "If the message is ambiguous or could be multiple intents, ask a clarifying question instead of logging.",
  "If there is an attached image and no clear question, prefer intent=food.",
  "For activity intent, select one or more checklist items using the provided category + index.",
  "For activity intent, category must exactly match one of the checklist category keys in the context JSON.",
  "If multiple activities are mentioned, return multiple selections.",
  "For activity details, standardize to minutes and optional intensity.",
  "If duration is unknown, set duration_min to null. If intensity is not mentioned, set it to null.",
  "Put any remaining specifics (distance, location, modifiers) into notes.",
  "If the user appears to be answering a prior clarification, use the chat history to map to the right item.",
  "Return only the JSON that matches the provided schema.",
];

const DEFAULT_QA_ASSISTANT_INSTRUCTIONS = [
  "You are a helpful assistant for a personal health & fitness tracker.",
  "The user is tracking trans feminization goals with a calm-surplus diet and endurance-biased fitness.",
  "Use the provided JSON context as the source of truth. Do not invent dates, totals, or events.",
  "If the context does not contain the information needed, say what is missing and ask a clarifying question.",
  "When referencing numbers, use the units as shown (kcal, g, mg).",
  "Be concise and supportive; prefer short actionable next steps.",
];

const DEFAULT_MEAL_ENTRY_RESPONSE_INSTRUCTIONS = [
  "You write the assistant response immediately after a meal entry is logged.",
  "Return only JSON matching the schema.",
  "The final chat response supports markdown.",
  "Do not literally repeat or quote the user's raw meal description text.",
  "Use bold markdown for food names and gram/portion amounts when available, for example **salmon (120 g)**.",
  "confirmation: clearly confirm the entry was logged (date/source). Keep it concise.",
  "nutrition_summary: use a short markdown bullet list with calories and macros (carbs, fat, protein) and fiber for both the logged meal and current day totals.",
  "day_fit_summary: briefly explain how this fits into the day using available goals, activity context, and what else has been eaten.",
  "nutrition_summary and day_fit_summary must read as separate paragraphs in the final message.",
  "Tone must be helpful, concise, and non-judgmental.",
  "Set followup_question only if one specific answer is required to materially improve nutrition accuracy.",
  "Do not ask routine or optional follow-up questions; if accuracy would not meaningfully change, set followup_question to null.",
  "Do not invent missing data. If data is missing, say so briefly in day_fit_summary.",
];

function normalizeInstructionList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function readAssistantRuleInstructions(tracking, sectionKey, fallback) {
  const configured = tracking?.assistant_rules?.[sectionKey]?.instructions;
  return normalizeInstructionList(configured, fallback);
}

const ActivitySelectionSchema = z.object({
  category: z.string().min(1),
  index: z.number().int().nonnegative(),
  label: z.string(),
  duration_min: z.number().int().positive().nullable(),
  intensity: z.enum(["easy", "moderate", "hard"]).nullable(),
  notes: z.string().nullable(),
});

const IngestDecisionSchema = z.object({
  intent: z.enum(["food", "activity", "question", "clarify"]),
  confidence: z.number().min(0).max(1),
  question: z.string().nullable(),
  clarifying_question: z.string().nullable(),
  activity: z
    .object({
      selections: z.array(ActivitySelectionSchema),
      followup_question: z.string().nullable(),
    })
    .nullable(),
});

const IngestDecisionFormat = zodTextFormat(IngestDecisionSchema, "ingest_decision");

const MealEntryResponseSchema = z.object({
  confirmation: z.string(),
  nutrition_summary: z.string(),
  day_fit_summary: z.string(),
  followup_question: z.string().nullable(),
});

const MealEntryResponseFormat = zodTextFormat(MealEntryResponseSchema, "meal_entry_response");

function buildChecklistSnapshot(currentWeek) {
  return getFitnessCategories(currentWeek).map((category) => ({
    key: category.key,
    label: category.label,
    items: category.items.map((item, index) => ({
      index,
      label: typeof item?.item === "string" ? item.item : "",
    })),
  }));
}

export async function decideIngestAction({ message, hasImage = false, date = null, messages = [] }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_INGEST_MODEL || "gpt-5.2";

  await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const selectedDate = isIsoDateString(date) ? date : getSuggestedLogDate();
  const checklistCategories = buildChecklistSnapshot(tracking.current_week ?? null);

  const system = readAssistantRuleInstructions(tracking, "ingest_classifier", DEFAULT_INGEST_CLASSIFIER_INSTRUCTIONS).join(
    " ",
  );

  const context = {
    timezone: "America/Los_Angeles",
    selected_date: selectedDate,
    has_image: hasImage,
    checklist_categories: checklistCategories,
  };

  const input = [
    { role: "system", content: system },
    { role: "developer", content: `Context JSON:\n${JSON.stringify(context, null, 2)}` },
  ];

  const safeMessages = sanitizeMessages(messages);
  for (const m of safeMessages) input.push(m);

  const safeMessage = typeof message === "string" ? message.trim() : "";
  input.push({ role: "user", content: safeMessage || (hasImage ? "[Image attached]" : "(empty)") });

  const response = await client.responses.parse({
    model,
    input,
    text: { format: IngestDecisionFormat },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error("OpenAI response did not include parsed output.");
  return parsed;
}

export async function askAssistant({ question, date = null, messages = [] }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-5.2";

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

  const system = readAssistantRuleInstructions(tracking, "qa_assistant", DEFAULT_QA_ASSISTANT_INSTRUCTIONS).join(" ");

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

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function cleanRichText(value) {
  if (typeof value !== "string") return "";
  const lines = value
    .replace(/\r\n/g, "\n")
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]{2,}/g, " "));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export async function composeMealEntryResponse({ payload, date = null, messages = [] }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-5.2";

  await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const payloadDate = typeof payload?.date === "string" && payload.date.trim() ? payload.date.trim() : null;
  const selectedDate = isIsoDateString(date) ? date : payloadDate && isIsoDateString(payloadDate) ? payloadDate : getSuggestedLogDate();

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
    current_week: tracking.current_week ?? null,
    food_log_for_date: foodLogRow,
    food_events_for_date: eventsForDate,
    day_totals_from_events: totalsForDate,
    recent_food_log: recentFoodLog,
    logged_meal: {
      date: payload?.date ?? selectedDate,
      source: payload?.event?.source ?? null,
      description: payload?.event?.description ?? payload?.estimate?.meal_title ?? null,
      input_text: payload?.event?.input_text ?? null,
      notes: payload?.event?.notes ?? null,
      confidence: payload?.estimate?.confidence ?? payload?.event?.confidence ?? null,
      nutrients: payload?.estimate?.totals ?? payload?.event?.nutrients ?? null,
      items: Array.isArray(payload?.estimate?.items)
        ? payload.estimate.items.slice(0, 6).map((it) => ({
            name: typeof it?.name === "string" ? it.name : "",
            portion: typeof it?.portion === "string" ? it.portion : "",
          }))
        : [],
    },
  };

  const system = readAssistantRuleInstructions(
    tracking,
    "meal_entry_response",
    DEFAULT_MEAL_ENTRY_RESPONSE_INSTRUCTIONS,
  ).join(" ");

  const input = [
    { role: "system", content: system },
    { role: "developer", content: `Context JSON:\n${JSON.stringify(context, null, 2)}` },
  ];

  const safeMessages = sanitizeMessages(messages);
  for (const m of safeMessages) input.push(m);

  input.push({
    role: "user",
    content: "A meal was just logged. Generate the post-log response now.",
  });

  const response = await client.responses.parse({
    model,
    input,
    text: { format: MealEntryResponseFormat },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error("OpenAI response did not include parsed meal entry output.");

  const followup = cleanText(parsed.followup_question ?? "");
  return {
    confirmation: cleanRichText(parsed.confirmation),
    nutrition_summary: cleanRichText(parsed.nutrition_summary),
    day_fit_summary: cleanRichText(parsed.day_fit_summary),
    followup_question: followup || null,
  };
}
