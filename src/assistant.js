import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import { getFitnessCategories, getFitnessCategoryLabel, getFitnessCategoryKeys } from "./fitnessChecklist.js";
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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function pickUserProfileSummary(profile) {
  const userProfile = asObject(profile);
  const general = asObject(userProfile.general);
  const goals = asObject(userProfile.goals);
  const behavior = asObject(userProfile.behavior);
  const medical = asObject(userProfile.medical);
  const cycle = asObject(medical.cycle_hormonal_context);
  const transContext = asObject(asObject(userProfile.modules).trans_care);

  return {
    general: {
      age: typeof general.age === "number" ? general.age : null,
      height_cm: typeof general.height_cm === "number" ? general.height_cm : null,
      weight_lb_baseline: typeof general.weight_lb_baseline === "number" ? general.weight_lb_baseline : null,
      timezone: typeof general.timezone === "string" ? general.timezone : null,
    },
    goals: {
      diet_goals: Array.isArray(goals.diet_goals) ? goals.diet_goals : [],
      fitness_goals: Array.isArray(goals.fitness_goals) ? goals.fitness_goals : [],
      health_goals: Array.isArray(goals.health_goals) ? goals.health_goals : [],
    },
    behavior: {
      motivation_barriers: Array.isArray(behavior.motivation_barriers) ? behavior.motivation_barriers : [],
      adherence_triggers: Array.isArray(behavior.adherence_triggers) ? behavior.adherence_triggers : [],
    },
    cycle_hormonal_context: {
      relevant: cycle.relevant === true,
      context_type: typeof cycle.context_type === "string" ? cycle.context_type : "",
      phase_or_cycle_day: typeof cycle.phase_or_cycle_day === "string" ? cycle.phase_or_cycle_day : null,
      symptom_patterns: Array.isArray(cycle.symptom_patterns) ? cycle.symptom_patterns : [],
      training_nutrition_adjustments: Array.isArray(cycle.training_nutrition_adjustments)
        ? cycle.training_nutrition_adjustments
        : [],
    },
    trans_care: Object.keys(transContext).length ? pickTransitionContext(transContext) : null,
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
  "Use the user_profile context as primary for personalization. Not all users are trans, so avoid assumptions.",
  "If trans_care context exists, incorporate it; otherwise stay generic.",
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

const DEFAULT_SETTINGS_ASSISTANT_INSTRUCTIONS = [
  "You are a settings assistant for a health and fitness tracker.",
  "The user can update their checklist template, diet goals, fitness goals, and profile context.",
  "Always return JSON matching the schema.",
  "If the request is unclear, keep changes as null and ask one concise follow-up question.",
  "Use minimal patches: include only fields that should change.",
  "For user_profile_patch, diet_philosophy_patch, and fitness_philosophy_patch: return either null or a valid JSON object string.",
  "Use user_profile_patch for profile updates.",
  "Never include markdown code fences in assistant_message.",
  "For checklist edits, return the full desired checklist_categories array when making checklist changes.",
  "Checklist category keys should be short snake_case strings.",
  "Checklist item strings should be concise and action-oriented.",
  "If the user asks a pure question (no settings change), provide guidance and keep all changes null.",
  "If the user asks to view/show/list their current goals, rules, checklist, or profile settings, include a followup_question asking if they want to make any changes.",
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

const JsonPatchStringSchema = z.string().nullable();

const SettingsChecklistCategorySchema = z.object({
  key: z.string().min(1),
  label: z.string().nullable(),
  items: z.array(z.string().min(1)),
});

const SettingsChangesSchema = z.object({
  user_profile_patch: JsonPatchStringSchema,
  diet_philosophy_patch: JsonPatchStringSchema,
  fitness_philosophy_patch: JsonPatchStringSchema,
  checklist_categories: z.array(SettingsChecklistCategorySchema).nullable(),
});

const SettingsAssistantResponseSchema = z.object({
  assistant_message: z.string(),
  followup_question: z.string().nullable(),
  changes: SettingsChangesSchema,
});

const SettingsAssistantResponseFormat = zodTextFormat(SettingsAssistantResponseSchema, "settings_assistant_response");

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

function buildChecklistTemplateSnapshot(currentWeek) {
  const safeWeek = currentWeek && typeof currentWeek === "object" ? currentWeek : {};
  const keys = getFitnessCategoryKeys(safeWeek);
  return keys.map((key) => {
    const list = Array.isArray(safeWeek[key]) ? safeWeek[key] : [];
    return {
      key,
      label: getFitnessCategoryLabel(safeWeek, key),
      items: list
        .map((item) => (typeof item?.item === "string" ? item.item.trim() : ""))
        .filter(Boolean),
    };
  });
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
    user_profile: pickUserProfileSummary(tracking.user_profile),
    diet_philosophy: tracking.diet_philosophy ?? null,
    fitness_philosophy: tracking.fitness_philosophy ?? null,
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
    user_profile: pickUserProfileSummary(tracking.user_profile),
    diet_philosophy: tracking.diet_philosophy ?? null,
    fitness_philosophy: tracking.fitness_philosophy ?? null,
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

function normalizeSettingsPatch(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeSettingsCategories(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((entry) => {
      const key = typeof entry?.key === "string" ? entry.key.trim() : "";
      if (!key) return null;
      const labelRaw = typeof entry?.label === "string" ? entry.label.trim() : "";
      const items = Array.isArray(entry?.items)
        ? entry.items
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : [];
      if (!items.length) return null;
      return {
        key,
        label: labelRaw || null,
        items,
      };
    })
    .filter(Boolean);
  return cleaned.length ? cleaned : null;
}

function messageLooksLikeSettingsReadRequest(message) {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (!text) return false;

  const asksToView = /(show|see|list|view|display|what are|what's|current)/.test(text);
  const settingsTopic =
    /(diet|nutrition|rules?|goals?|checklist|fitness|profile|settings)/.test(text);
  return asksToView && settingsTopic;
}

function messageLooksLikeChecklistReadRequest(message) {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (!text) return false;
  const asksToView = /(show|see|list|view|display|what are|what's|current)/.test(text);
  const checklistTopic = /(checklist|workout checklist|activity checklist|routine)/.test(text);
  return asksToView && checklistTopic;
}

function formatChecklistTemplateMarkdown(checklistTemplate) {
  const categories = Array.isArray(checklistTemplate) ? checklistTemplate : [];
  if (!categories.length) return "I don't have a checklist template yet.";

  const lines = ["Here is your current workout checklist structure:"];
  for (const category of categories) {
    const label = typeof category?.label === "string" && category.label.trim() ? category.label.trim() : category?.key || "Category";
    lines.push(`- **${label}**`);
    const items = Array.isArray(category?.items) ? category.items : [];
    if (!items.length) {
      lines.push("  - [ ] (no items)");
      continue;
    }
    for (const item of items) {
      const itemText = typeof item === "string" ? item.trim() : "";
      if (!itemText) continue;
      lines.push(`  - [ ] ${itemText}`);
    }
  }
  return lines.join("\n");
}

export async function askSettingsAssistant({ message, messages = [] }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-5.2";

  await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const context = {
    timezone: "America/Los_Angeles",
    user_profile: tracking.user_profile ?? null,
    diet_philosophy: tracking.diet_philosophy ?? null,
    fitness_philosophy: tracking.fitness_philosophy ?? null,
    checklist_template: buildChecklistTemplateSnapshot(tracking.current_week ?? null),
  };

  const system = readAssistantRuleInstructions(
    tracking,
    "settings_assistant",
    DEFAULT_SETTINGS_ASSISTANT_INSTRUCTIONS,
  ).join(" ");

  const input = [
    { role: "system", content: system },
    { role: "developer", content: `Settings context JSON:\n${JSON.stringify(context, null, 2)}` },
  ];

  const safeMessages = sanitizeMessages(messages);
  for (const m of safeMessages) input.push(m);
  input.push({ role: "user", content: typeof message === "string" ? message.trim() : "" });

  const response = await client.responses.parse({
    model,
    input,
    text: { format: SettingsAssistantResponseFormat },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error("OpenAI response did not include parsed settings output.");

  const changes = {
    user_profile_patch: normalizeSettingsPatch(parsed?.changes?.user_profile_patch),
    diet_philosophy_patch: normalizeSettingsPatch(parsed?.changes?.diet_philosophy_patch),
    fitness_philosophy_patch: normalizeSettingsPatch(parsed?.changes?.fitness_philosophy_patch),
    checklist_categories: normalizeSettingsCategories(parsed?.changes?.checklist_categories),
  };

  const hasChanges = Boolean(
    changes.user_profile_patch ||
      changes.diet_philosophy_patch ||
      changes.fitness_philosophy_patch ||
      changes.checklist_categories,
  );

  let assistantMessage = cleanRichText(parsed.assistant_message);
  if (!hasChanges && messageLooksLikeChecklistReadRequest(message)) {
    assistantMessage = formatChecklistTemplateMarkdown(context.checklist_template);
  }

  let followupQuestion = cleanText(parsed.followup_question ?? "") || null;
  if (!hasChanges && !followupQuestion && messageLooksLikeSettingsReadRequest(message)) {
    followupQuestion = "Would you like me to make any changes to these settings?";
  }

  return {
    assistant_message: assistantMessage,
    followup_question: followupQuestion,
    changes,
  };
}
