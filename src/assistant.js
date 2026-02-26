import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import { normalizeChecklistCategories } from "./checklistPolicy.js";
import {
  getFitnessCategories,
  getFitnessCategoryLabel,
  getFitnessCategoryKeys,
} from "./fitnessChecklist.js";
import { normalizeGoalsText } from "./goalsText.js";
import { getOpenAIClient } from "./openaiClient.js";
import {
  ensureCurrentWeek,
  getDailyTotalsForDate,
  getFoodDayForDate,
  getSuggestedLogDate,
  listFoodDays,
  readTrackingData,
} from "./trackingData.js";

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function getTrackingProfile(tracking) {
  const safe = asObject(tracking);
  if (safe.profile && typeof safe.profile === "object" && !Array.isArray(safe.profile)) {
    return safe.profile;
  }
  return safe;
}

function getTrackingRules(tracking) {
  const safe = asObject(tracking);
  if (safe.rules && typeof safe.rules === "object" && !Array.isArray(safe.rules)) {
    return safe.rules;
  }
  return safe;
}

function getTrackingMetadata(tracking) {
  const rules = getTrackingRules(tracking);
  if (rules.metadata && typeof rules.metadata === "object" && !Array.isArray(rules.metadata)) {
    return rules.metadata;
  }
  return asObject(asObject(tracking).metadata);
}

function getDietPhilosophy(tracking) {
  const rules = getTrackingRules(tracking);
  return rules.diet_philosophy ?? asObject(tracking).diet_philosophy ?? null;
}

function getFitnessPhilosophy(tracking) {
  const rules = getTrackingRules(tracking);
  return rules.fitness_philosophy ?? asObject(tracking).fitness_philosophy ?? null;
}

function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

function pickSettingsProfiles(tracking) {
  const profile = getTrackingProfile(tracking);
  const root = asObject(tracking);
  const general = normalizeProfileText(profile.general ?? root.general);
  const fitness = normalizeProfileText(profile.fitness ?? root.fitness);
  const diet = normalizeProfileText(profile.diet ?? root.diet);
  const agent = normalizeProfileText(profile.agent ?? root.agent);
  return {
    general,
    fitness,
    diet,
    agent,
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

function cleanUserMessage(value, { fallback = "" } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || fallback;
}

const DEFAULT_INGEST_CLASSIFIER_INSTRUCTIONS = [
  "You classify a user's message for a health & fitness tracker.",
  "You are not a person. Do not roleplay as one.",
  "The user has a single input box that can be used to log food, log an activity, or ask a question.",
  "Choose exactly one intent: food, activity, question, or clarify.",
  "If the message is ambiguous or could be multiple intents, ask a clarifying question instead of logging.",
  "If there is an attached image, inspect the image itself and use it for intent classification.",
  "If the image appears to show a meal or food, prefer intent=food.",
  "If the image appears to show workout tracking data (Strava/Garmin/Fitbit/Apple Workout screenshots, pace maps, splits, heart-rate charts), prefer intent=activity.",
  "If image-only input is unclear, return intent=clarify with a short question.",
  "If the user asks to import/upload/migrate historical logs or pastes multi-day JSON/CSV data, do not classify as food logging; use intent=question or clarify.",
  "Do not classify as a single food log when the message includes multiple distinct calendar dates.",
  "For activity intent, select one or more checklist items using the provided category + index.",
  "For activity intent, category must exactly match one of the checklist category keys in the context JSON.",
  "If multiple activities are mentioned, return multiple selections.",
  "Summarize activity details in a sensible way based on activity type and the user input (for example: distance + time + pace for run/walk, rounds/sets + reps/load for strength, duration + terrain for rides, and notes for anything uncategorized).",
  "Put any additional specifics (duration, distance, location, modifiers) into notes.",
  "For vague activity text, still return a selection when a checklist item mapping is possible; otherwise return clarify.",
  "If the user appears to be answering a prior clarification, use the chat history to map to the right item.",
  "Return a final assistant-facing response in assistant_message for direct display.",
  "For food intent, do not guess nutrients and do not include nutrient numbers in schema payload.",
  "For food intent, include a short description + notes to support deterministic estimation.",
  "If the user is clarifying details for a meal that was just logged, set food.event_id to that existing meal event id from context so the entry is updated instead of duplicated.",
  "For food intent, set requires_estimate=true when a text-to-estimate path is needed and false when image/photo path is used.",
  "For clarify intent, keep intent exactly clarify and provide clarifying_question.",
  "Return only the JSON that matches the provided schema.",
  "Never emit schema fields outside the declared structure.",
];

const DEFAULT_QA_ASSISTANT_INSTRUCTIONS = [
  "You are a tracking and analysis assistant for a personal health & fitness tracker.",
  "You are not a person. Do not roleplay as one.",
  "Use general, fitness, and diet profile texts as primary personalization context.",
  "Use the provided JSON context as the source of truth. Do not invent dates, totals, or entries.",
  "Do not claim system permission limitations (for example, saying you cannot write or delete).",
  "If data is missing, state exactly what is missing instead of guessing.",
  "Consider today's food and activity, and the broader week/training block context.",
  "If the context does not contain the information needed, say what is missing and ask a clarifying question.",
  "When referencing numbers, use the units as shown (kcal, g, mg).",
  "Be professional, concise, supportive, non-judgmental, and honest.",
  "Avoid exclamation points, emoji, and overly casual language.",
];

const DEFAULT_MEAL_ENTRY_RESPONSE_INSTRUCTIONS = [
  "You write the assistant response immediately after a meal entry is logged.",
  "Return only JSON matching the schema.",
  "The final chat response supports markdown.",
  "You are not a person. Do not roleplay as one.",
  "Do not literally repeat or quote the user's raw meal description text.",
  "Use bold markdown for food names and gram/portion amounts when available, for example **salmon (120 g)**.",
  "Clearly state that nutrition values are estimates, not exact measurements.",
  "confirmation: clearly confirm the entry was logged (date/source). Keep it concise.",
  "nutrition_summary: use a short markdown bullet list with calories and macros (carbs, fat, protein) and fiber for both the logged meal and current day totals.",
  "day_fit_summary: briefly explain how this fits into the day using available goals, activity context, and what else has been eaten. Include short non-prescriptive guidance for the rest of the day.",
  "nutrition_summary and day_fit_summary must read as separate paragraphs in the final message.",
  "Tone must be professional, concise, supportive, non-judgmental, and honest.",
  "Do not encourage unhealthy eating patterns or caloric restriction behavior.",
  "Set followup_question only if one specific answer is required to materially improve nutrition accuracy.",
  "Do not ask routine or optional follow-up questions; if accuracy would not meaningfully change, set followup_question to null.",
  "Do not invent missing data. If data is missing, say so briefly in day_fit_summary.",
];

const DEFAULT_ONBOARDING_ASSISTANT_INSTRUCTIONS = [
  "You are an onboarding assistant for a health and fitness tracker.",
  "Your job is to collect enough user profile context to personalize the app quickly.",
  "Ask one focused question at a time and keep responses concise.",
  "Always return JSON matching the schema.",
  "For user_profile_patch: return either null or a valid JSON object string with only changed fields.",
  "When the user describes goals, write to user_profile_patch.goals_text (overall_goals, fitness_goals, diet_goals).",
  "Treat goals_text as the primary goals source; legacy goals arrays are compatibility-only.",
  "Never remove existing user data unless the user explicitly asks to replace it.",
  "Use answered_keys to mark which onboarding slots were answered in this turn, even when the answer is 'none' or 'no'.",
  "If the user provides multiple details in one message, include all relevant updates in one patch.",
  "If context is already sufficient, acknowledge completion and set followup_question to null.",
  "Do not include markdown code fences in assistant_message.",
];

const DEFAULT_ONBOARDING_CHECKLIST_INSTRUCTIONS = [
  "You are creating a fitness checklist during onboarding for a health and fitness tracker.",
  "Always return JSON matching the schema.",
  "Generate or revise checklist_categories based on the user's goals and feedback.",
  "Checklist content must be workouts and activity sessions the user can complete and check off.",
  "Do not include food, eating, meals, nutrition, or diet tasks in checklist categories or items.",
  "Do not include planning/admin/recovery-support tasks such as scheduling calendar blocks, generic warmup reminders, logging sets/reps, or generic rest-day reminders.",
  "Do not include exercise-programming directives (for example: include/add/progress patterns, set/rep prescriptions, load progression instructions).",
  "Checklist categories should be practical and concise, with clear action-oriented items.",
  "Every checklist item should describe a concrete activity session (what to do) instead of process guidance (how to manage training).",
  "Each checkbox must represent exactly one session. If the target is 3 sessions, output 3 separate checklist items.",
  "Return the full desired checklist_categories array each time.",
  "If the user asks for changes, revise accordingly rather than asking to confirm first.",
  "assistant_message should summarize the proposed checklist and invite iteration.",
  "followup_question should be null unless one specific detail is necessary.",
  "Do not include markdown code fences in assistant_message.",
];

const CHECKLIST_SESSION_GUARDRAILS = [
  "Checklist items must be concrete activity sessions that can be completed and checked off.",
  "Do not include planning/admin/recovery-support items such as scheduling calendar blocks, generic warmup reminders, logging sets/reps, or generic rest-day reminders.",
  "Do not include exercise-programming directives such as include/add/progress instructions, set/rep prescriptions, or load progression rules.",
  "Prefer specific sessions with enough detail to perform the workout.",
  "Each checkbox must represent one completed session; never combine multiple weekly sessions into one checklist item.",
];

const DEFAULT_ONBOARDING_DIET_INSTRUCTIONS = [
  "You are defining calorie and macro goals during onboarding for a health and fitness tracker.",
  "Always return JSON matching the schema.",
  "Return diet_philosophy_patch as a valid JSON object string with only fields that should change.",
  "Focus on calories and macros (protein, carbs, fat) and keep the patch practical.",
  "assistant_message should summarize the proposed calorie/macro targets and invite iteration.",
  "followup_question should be null unless one specific detail is needed.",
  "Do not include markdown code fences in assistant_message.",
];

const DEFAULT_MODEL = "gpt-5.2";
const ONBOARDING_ANSWERED_KEYS = new Set([
  "timezone",
  "diet_goals",
  "fitness_goals",
  "health_goals",
  "fitness_experience",
  "equipment_access",
  "injuries_limitations",
  "food_preferences",
]);

function normalizeInstructionList(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return cleaned.length ? cleaned : fallback;
}

function readAssistantRuleInstructions(tracking, sectionKey, fallback) {
  const rules = getTrackingRules(tracking);
  const configured = rules?.assistant_rules?.[sectionKey]?.instructions ?? tracking?.assistant_rules?.[sectionKey]?.instructions;
  return normalizeInstructionList(configured, fallback);
}

function getAssistantModel() {
  return process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

function getIngestModel() {
  return process.env.OPENAI_INGEST_MODEL || DEFAULT_MODEL;
}

function buildAgentProfileInstruction(tracking) {
  const profiles = pickSettingsProfiles(tracking);
  const agentProfile = normalizeProfileText(profiles.agent);
  if (!agentProfile.trim()) return "";
  return `Agent profile (apply these rules):\n${agentProfile}`;
}

function buildSystemInstructions({ tracking, sectionKey, fallback, extraInstructions = [] }) {
  const base = readAssistantRuleInstructions(tracking, sectionKey, fallback).concat(extraInstructions).join(" ");
  const agentInstruction = buildAgentProfileInstruction(tracking);
  return agentInstruction ? `${base}\n\n${agentInstruction}` : base;
}

function buildModelInput({ system, contextLabel = "Context JSON", context, messages = [], userContent }) {
  const input = [
    { role: "system", content: system },
    { role: "developer", content: `${contextLabel}:\n${JSON.stringify(context, null, 2)}` },
  ];

  const safeMessages = sanitizeMessages(messages);
  for (const m of safeMessages) input.push(m);
  input.push({ role: "user", content: userContent });
  return input;
}

function extractResponseTextDelta(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  if (chunk.type === "response.output_text.delta") {
    if (typeof chunk.delta === "string" && chunk.delta.length) return chunk.delta;
    if (typeof chunk.text === "string" && chunk.text.length) return chunk.text;
  }
  return "";
}

async function streamResponseText({ client, model, input, onText }) {
  const stream = client.responses.stream({
    model,
    input,
  });

  let answer = "";
  for await (const chunk of stream) {
    const delta = extractResponseTextDelta(chunk);
    if (!delta) continue;
    answer += delta;
    if (typeof onText === "function") onText(delta);
  }

  const finalResponse =
    typeof stream.finalResponse === "function" ? await stream.finalResponse() : null;
  const finalText = typeof finalResponse?.output_text === "string" ? finalResponse.output_text : "";
  if (finalText && finalText !== answer) {
    answer = finalText;
  }
  return answer.trim();
}

function extractJsonCandidate(value) {
  if (typeof value !== "string") return "";
  const raw = value.trim();
  if (!raw) return "";

  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) return raw.slice(firstBrace, lastBrace + 1).trim();

  return raw;
}

function parseJsonText({ text, schema, errorMessage }) {
  const candidate = extractJsonCandidate(text);
  if (!candidate) throw new Error(errorMessage);

  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(errorMessage);
  }

  const result = schema.safeParse(parsed);
  if (!result.success) throw new Error(errorMessage);
  return result.data;
}

function extractResponseText(response) {
  if (!response || typeof response !== "object") return "";
  if (typeof response.output_text === "string") return response.output_text;

  const output = Array.isArray(response.output) ? response.output : [];
  for (const item of output) {
    if (!item || item.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string" && part.text.trim()) {
        return part.text;
      }
    }
  }
  return "";
}

async function streamStructuredResponse({ client, model, input, schema, onText, errorMessage }) {
  const output = await streamResponseText({
    client,
    model,
    input,
    onText,
  });

  return parseJsonText({ text: output, schema, errorMessage });
}

async function parseStructuredResponse({ client, model, input, format, schema = null, errorMessage }) {
  const response = await client.responses.parse({
    model,
    input,
    text: { format },
  });

  const parsed = response.output_parsed;
  if (parsed) return parsed;
  if (schema) {
    return parseJsonText({ text: extractResponseText(response), schema, errorMessage });
  }

  throw new Error(errorMessage);
}

const ActivitySelectionSchema = z.object({
  category: z.string().min(1),
  index: z.number().int().nonnegative(),
  label: z.string(),
  duration_min: z.number().int().positive().nullable(),
  intensity: z.enum(["easy", "moderate", "hard"]).nullable(),
  notes: z.string().nullable(),
});

const IngestFoodDecisionSchema = z.object({
  description: z.string(),
  notes: z.string(),
  event_id: z.string().nullable(),
  date: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be an ISO date string or null")]),
  requires_estimate: z.boolean(),
  estimated_description: z.string().nullable().optional(),
});

const IngestActivityDecisionSchema = z.object({
  selections: z.array(ActivitySelectionSchema),
  followup_question: z.string().nullable(),
});

const IngestUnifiedSchema = z.object({
  intent: z.enum(["food", "activity", "question", "clarify"]),
  confidence: z.number().min(0).max(1),
  assistant_message: z.string(),
  followup_question: z.string().nullable(),
  clarifying_question: z.string().nullable(),
  food: IngestFoodDecisionSchema.nullable(),
  activity: IngestActivityDecisionSchema.nullable(),
  question: z.string().nullable(),
});

const IngestDecisionFormat = zodTextFormat(IngestUnifiedSchema, "ingest_decision");

const MealEntryResponseSchema = z.object({
  confirmation: z.string(),
  nutrition_summary: z.string(),
  day_fit_summary: z.string(),
  followup_question: z.string().nullable(),
});

const MealEntryResponseFormat = zodTextFormat(MealEntryResponseSchema, "meal_entry_response");

const JsonPatchStringSchema = z.string().nullable();

const OnboardingAnsweredKeySchema = z.enum([
  "timezone",
  "diet_goals",
  "fitness_goals",
  "health_goals",
  "fitness_experience",
  "equipment_access",
  "injuries_limitations",
  "food_preferences",
]);

const OnboardingAssistantResponseSchema = z.object({
  assistant_message: z.string(),
  followup_question: z.string().nullable(),
  user_profile_patch: JsonPatchStringSchema,
  answered_keys: z.array(OnboardingAnsweredKeySchema),
});

const OnboardingAssistantResponseFormat = zodTextFormat(
  OnboardingAssistantResponseSchema,
  "onboarding_assistant_response",
);

const SettingsChecklistCategorySchema = z.object({
  key: z.string().min(1),
  label: z.string().nullable(),
  items: z.array(z.string().min(1)),
});

const OnboardingChecklistProposalSchema = z.object({
  assistant_message: z.string(),
  followup_question: z.string().nullable(),
  checklist_categories: z.array(SettingsChecklistCategorySchema),
});

const OnboardingChecklistProposalFormat = zodTextFormat(
  OnboardingChecklistProposalSchema,
  "onboarding_checklist_proposal",
);

const OnboardingDietProposalSchema = z.object({
  assistant_message: z.string(),
  followup_question: z.string().nullable(),
  diet_philosophy_patch: JsonPatchStringSchema,
});

const OnboardingDietProposalFormat = zodTextFormat(OnboardingDietProposalSchema, "onboarding_diet_proposal");

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
        .map((item) => {
          const label = typeof item?.item === "string" ? item.item.trim() : "";
          if (!label) return "";
          const description = typeof item?.description === "string" ? item.description.trim() : "";
          return description ? `${label} - ${description}` : label;
        })
        .filter(Boolean),
    };
  });
}

export async function decideIngestAction({
  message,
  hasImage = false,
  imageBuffer = null,
  imageMimeType = null,
  date = null,
  messages = [],
  clientOverride = null,
}) {
  const client = clientOverride ?? getOpenAIClient();
  const model = getIngestModel();

  const currentWeek = await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const selectedDate = isIsoDateString(date) ? date : getSuggestedLogDate();
  const checklistCategories = buildChecklistSnapshot(currentWeek ?? {});
  const [dayForDate, totalsForDate, recentDays] = await Promise.all([
    getFoodDayForDate(selectedDate),
    getDailyTotalsForDate(selectedDate),
    listFoodDays({ limit: 14 }),
  ]);

  const system = buildSystemInstructions({
    tracking,
    sectionKey: "ingest_classifier",
    fallback: DEFAULT_INGEST_CLASSIFIER_INSTRUCTIONS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    selected_date: selectedDate,
    has_image: hasImage,
    checklist_categories: checklistCategories,
    profiles: pickSettingsProfiles(tracking),
    week: currentWeek ?? {},
    day_for_date: dayForDate,
    day_totals: totalsForDate,
    recent_days: recentDays,
  };

  const safeMessage = cleanUserMessage(message);
  const canAttachImage =
    Boolean(imageBuffer) &&
    typeof imageMimeType === "string" &&
    imageMimeType.startsWith("image/") &&
    Buffer.isBuffer(imageBuffer);
  let userContent = safeMessage || (hasImage ? "[Image attached]" : "(empty)");
  if (canAttachImage) {
    const dataUrl = `data:${imageMimeType};base64,${imageBuffer.toString("base64")}`;
    userContent = [
      { type: "input_text", text: safeMessage || "[Image attached]" },
      { type: "input_image", image_url: dataUrl, detail: "high" },
    ];
  }

  const input = buildModelInput({
    system,
    context,
    messages,
    userContent,
  });

  const parsed = await parseStructuredResponse({
    client,
    model,
    input,
    format: IngestDecisionFormat,
    schema: IngestUnifiedSchema,
    errorMessage: "OpenAI response did not include parsed output.",
  });
  return parsed;
}

export async function askAssistant({ question, date = null, messages = [] }) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const currentWeek = await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const selectedDate = isIsoDateString(date) ? date : getSuggestedLogDate();
  const [dayForDate, totalsForDate, recentDays] = await Promise.all([
    getFoodDayForDate(selectedDate),
    getDailyTotalsForDate(selectedDate),
    listFoodDays({ limit: 14 }),
  ]);
  const context = {
    timezone: "America/Los_Angeles",
    selected_date: selectedDate,
    profiles: pickSettingsProfiles(tracking),
    diet_philosophy: getDietPhilosophy(tracking),
    fitness_philosophy: getFitnessPhilosophy(tracking),
    day_for_date: dayForDate,
    day_totals: totalsForDate,
    recent_days: recentDays,
    week: currentWeek ?? {},
  };

  const system = buildSystemInstructions({
    tracking,
    sectionKey: "qa_assistant",
    fallback: DEFAULT_QA_ASSISTANT_INSTRUCTIONS,
  });
  const input = buildModelInput({
    system,
    context,
    messages,
    userContent: question,
  });

  const response = await client.responses.create({ model, input });
  return (response.output_text || "").trim();
}

export async function streamAssistantResponse({ question, date = null, messages = [], onText }) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const currentWeek = await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const selectedDate = isIsoDateString(date) ? date : getSuggestedLogDate();
  const [dayForDate, totalsForDate, recentDays] = await Promise.all([
    getFoodDayForDate(selectedDate),
    getDailyTotalsForDate(selectedDate),
    listFoodDays({ limit: 14 }),
  ]);
  const context = {
    timezone: "America/Los_Angeles",
    selected_date: selectedDate,
    profiles: pickSettingsProfiles(tracking),
    diet_philosophy: getDietPhilosophy(tracking),
    fitness_philosophy: getFitnessPhilosophy(tracking),
    day_for_date: dayForDate,
    day_totals: totalsForDate,
    recent_days: recentDays,
    week: currentWeek ?? {},
  };

  const system = buildSystemInstructions({
    tracking,
    sectionKey: "qa_assistant",
    fallback: DEFAULT_QA_ASSISTANT_INSTRUCTIONS,
  });
  const input = buildModelInput({
    system,
    context,
    messages,
    userContent: question,
  });

  return streamResponseText({
    client,
    model,
    input,
    onText,
  });
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

function normalizeOnboardingAssistantOutput(parsed) {
  return {
    assistant_message: cleanRichText(parsed.assistant_message),
    followup_question: cleanText(parsed.followup_question ?? "") || null,
    user_profile_patch: normalizeSettingsPatch(parsed.user_profile_patch),
    answered_keys: normalizeOnboardingAnsweredKeys(parsed.answered_keys),
  };
}

export async function composeMealEntryResponse({ payload, date = null, messages = [] }) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const currentWeek = await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const payloadDate = typeof payload?.date === "string" && payload.date.trim() ? payload.date.trim() : null;
  const selectedDate = isIsoDateString(date) ? date : payloadDate && isIsoDateString(payloadDate) ? payloadDate : getSuggestedLogDate();

  const [dayForDate, totalsForDate, recentDays] = await Promise.all([
    getFoodDayForDate(selectedDate),
    getDailyTotalsForDate(selectedDate),
    listFoodDays({ limit: 14 }),
  ]);
  const context = {
    timezone: "America/Los_Angeles",
    selected_date: selectedDate,
    profiles: pickSettingsProfiles(tracking),
    diet_philosophy: getDietPhilosophy(tracking),
    fitness_philosophy: getFitnessPhilosophy(tracking),
    week: currentWeek ?? {},
    day_for_date: dayForDate,
    day_totals: totalsForDate,
    recent_days: recentDays,
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

  const system = buildSystemInstructions({
    tracking,
    sectionKey: "meal_entry_response",
    fallback: DEFAULT_MEAL_ENTRY_RESPONSE_INSTRUCTIONS,
  });
  const input = buildModelInput({
    system,
    context,
    messages,
    userContent: "A meal was just logged. Generate the post-log response now.",
  });

  const parsed = await parseStructuredResponse({
    client,
    model,
    input,
    format: MealEntryResponseFormat,
    schema: MealEntryResponseSchema,
    errorMessage: "OpenAI response did not include parsed meal entry output.",
  });

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

function normalizeOnboardingAnsweredKeys(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => ONBOARDING_ANSWERED_KEYS.has(entry));
}

function pickOnboardingProfileContext(profile) {
  const safe = asObject(profile);
  const general = asObject(safe.general);
  const goals = asObject(safe.goals);
  const goalsText = normalizeGoalsText(asObject(safe.goals_text), { legacyGoals: goals });
  const nutrition = asObject(safe.nutrition);
  const fitness = asObject(safe.fitness);
  const preferences = asObject(safe.assistant_preferences);

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
    goals_text: goalsText,
    nutrition: {
      food_restrictions: Array.isArray(nutrition.food_restrictions) ? nutrition.food_restrictions : [],
      food_allergies: Array.isArray(nutrition.food_allergies) ? nutrition.food_allergies : [],
      preferences: Array.isArray(nutrition.preferences) ? nutrition.preferences : [],
    },
    fitness: {
      experience_level: typeof fitness.experience_level === "string" ? fitness.experience_level : "",
      injuries_limitations: Array.isArray(fitness.injuries_limitations) ? fitness.injuries_limitations : [],
      equipment_access: Array.isArray(fitness.equipment_access) ? fitness.equipment_access : [],
    },
    assistant_preferences: {
      tone: typeof preferences.tone === "string" ? preferences.tone : null,
      verbosity: typeof preferences.verbosity === "string" ? preferences.verbosity : null,
    },
  };
}

export async function askOnboardingAssistant({ message, messages = [], onboardingState = null, userProfile = null }) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const tracking = await readTrackingData();
  const system = buildSystemInstructions({
    tracking,
    sectionKey: "onboarding_assistant",
    fallback: DEFAULT_ONBOARDING_ASSISTANT_INSTRUCTIONS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    onboarding_state: onboardingState && typeof onboardingState === "object" ? onboardingState : null,
    user_profile: pickOnboardingProfileContext(userProfile),
    profiles: pickSettingsProfiles(tracking),
  };

  const input = buildModelInput({
    system,
    contextLabel: "Onboarding context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message),
  });

  const parsed = await parseStructuredResponse({
    client,
    model,
    input,
    format: OnboardingAssistantResponseFormat,
    schema: OnboardingAssistantResponseSchema,
    errorMessage: "OpenAI response did not include parsed onboarding output.",
  });

  return normalizeOnboardingAssistantOutput(parsed);
}

export async function streamOnboardingAssistant({
  message,
  messages = [],
  onboardingState = null,
  userProfile = null,
  onText,
}) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const tracking = await readTrackingData();
  const system = buildSystemInstructions({
    tracking,
    sectionKey: "onboarding_assistant",
    fallback: DEFAULT_ONBOARDING_ASSISTANT_INSTRUCTIONS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    onboarding_state: onboardingState && typeof onboardingState === "object" ? onboardingState : null,
    user_profile: pickOnboardingProfileContext(userProfile),
    profiles: pickSettingsProfiles(tracking),
  };

  const input = buildModelInput({
    system,
    contextLabel: "Onboarding context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message),
  });

  const parsed = await streamStructuredResponse({
    client,
    model,
    input,
    schema: OnboardingAssistantResponseSchema,
    onText,
    errorMessage: "OpenAI response did not include parsed onboarding output.",
  });

  return normalizeOnboardingAssistantOutput(parsed);
}

export async function proposeOnboardingChecklist({
  message = "",
  messages = [],
  userProfile = null,
  currentWeek = null,
  currentProposal = null,
}) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const tracking = await readTrackingData();
  const system = buildSystemInstructions({
    tracking,
    sectionKey: "onboarding_checklist",
    fallback: DEFAULT_ONBOARDING_CHECKLIST_INSTRUCTIONS,
    extraInstructions: CHECKLIST_SESSION_GUARDRAILS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    user_profile: pickOnboardingProfileContext(userProfile),
    profiles: pickSettingsProfiles(tracking),
    checklist_template: buildChecklistTemplateSnapshot(currentWeek ?? null),
    current_proposal: normalizeChecklistCategories(
      Array.isArray(currentProposal?.checklist_categories)
        ? currentProposal.checklist_categories
        : Array.isArray(currentProposal)
          ? currentProposal
          : null,
    ),
  };

  const input = buildModelInput({
    system,
    contextLabel: "Onboarding checklist context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message, {
      fallback: "Create an initial weekly fitness checklist proposal from my goals.",
    }),
  });

  const parsed = await parseStructuredResponse({
    client,
    model,
    input,
    format: OnboardingChecklistProposalFormat,
    schema: OnboardingChecklistProposalSchema,
    errorMessage: "OpenAI response did not include parsed onboarding checklist output.",
  });

  const checklistCategories = normalizeChecklistCategories(parsed.checklist_categories);
  if (!checklistCategories || !checklistCategories.length) {
    throw new Error("Checklist proposal did not include valid categories.");
  }

  return {
    assistant_message: cleanRichText(parsed.assistant_message),
    followup_question: cleanText(parsed.followup_question ?? "") || null,
    checklist_categories: checklistCategories,
  };
}

export async function streamOnboardingChecklist({
  message = "",
  messages = [],
  userProfile = null,
  currentWeek = null,
  currentProposal = null,
  onText,
}) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const tracking = await readTrackingData();
  const system = buildSystemInstructions({
    tracking,
    sectionKey: "onboarding_checklist",
    fallback: DEFAULT_ONBOARDING_CHECKLIST_INSTRUCTIONS,
    extraInstructions: CHECKLIST_SESSION_GUARDRAILS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    user_profile: pickOnboardingProfileContext(userProfile),
    profiles: pickSettingsProfiles(tracking),
    checklist_template: buildChecklistTemplateSnapshot(currentWeek ?? null),
    current_proposal: normalizeChecklistCategories(
      Array.isArray(currentProposal?.checklist_categories)
        ? currentProposal.checklist_categories
        : Array.isArray(currentProposal)
          ? currentProposal
          : null,
    ),
  };

  const input = buildModelInput({
    system,
    contextLabel: "Onboarding checklist context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message, {
      fallback: "Create an initial weekly fitness checklist proposal from my goals.",
    }),
  });

  const parsed = await streamStructuredResponse({
    client,
    model,
    input,
    schema: OnboardingChecklistProposalSchema,
    onText,
    errorMessage: "OpenAI response did not include parsed onboarding checklist output.",
  });

  const checklistCategories = normalizeChecklistCategories(parsed.checklist_categories);
  if (!checklistCategories || !checklistCategories.length) {
    throw new Error("Checklist proposal did not include valid categories.");
  }

  return {
    assistant_message: cleanRichText(parsed.assistant_message),
    followup_question: cleanText(parsed.followup_question ?? "") || null,
    checklist_categories: checklistCategories,
  };
}

export async function proposeOnboardingDietGoals({
  message = "",
  messages = [],
  userProfile = null,
  dietPhilosophy = null,
  currentProposal = null,
}) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const tracking = await readTrackingData();
  const system = buildSystemInstructions({
    tracking,
    sectionKey: "onboarding_diet",
    fallback: DEFAULT_ONBOARDING_DIET_INSTRUCTIONS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    user_profile: pickOnboardingProfileContext(userProfile),
    profiles: pickSettingsProfiles(tracking),
    current_diet_philosophy: dietPhilosophy && typeof dietPhilosophy === "object" ? dietPhilosophy : null,
    current_proposal_patch: normalizeSettingsPatch(currentProposal?.diet_philosophy_patch),
  };

  const input = buildModelInput({
    system,
    contextLabel: "Onboarding diet context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message, {
      fallback: "Create an initial calorie and macro goal proposal.",
    }),
  });

  const parsed = await parseStructuredResponse({
    client,
    model,
    input,
    format: OnboardingDietProposalFormat,
    schema: OnboardingDietProposalSchema,
    errorMessage: "OpenAI response did not include parsed onboarding diet output.",
  });

  const dietPatch = normalizeSettingsPatch(parsed.diet_philosophy_patch);
  if (!dietPatch || !Object.keys(dietPatch).length) {
    throw new Error("Diet proposal did not include a valid patch.");
  }

  return {
    assistant_message: cleanRichText(parsed.assistant_message),
    followup_question: cleanText(parsed.followup_question ?? "") || null,
    diet_philosophy_patch: dietPatch,
  };
}

export async function streamOnboardingDietGoals({
  message = "",
  messages = [],
  userProfile = null,
  dietPhilosophy = null,
  currentProposal = null,
  onText,
}) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const tracking = await readTrackingData();
  const system = buildSystemInstructions({
    tracking,
    sectionKey: "onboarding_diet",
    fallback: DEFAULT_ONBOARDING_DIET_INSTRUCTIONS,
  });

  const context = {
    timezone: "America/Los_Angeles",
    user_profile: pickOnboardingProfileContext(userProfile),
    profiles: pickSettingsProfiles(tracking),
    current_diet_philosophy: dietPhilosophy && typeof dietPhilosophy === "object" ? dietPhilosophy : null,
    current_proposal_patch: normalizeSettingsPatch(currentProposal?.diet_philosophy_patch),
  };

  const input = buildModelInput({
    system,
    contextLabel: "Onboarding diet context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message, {
      fallback: "Create an initial calorie and macro goal proposal.",
    }),
  });

  const parsed = await streamStructuredResponse({
    client,
    model,
    input,
    schema: OnboardingDietProposalSchema,
    onText,
    errorMessage: "OpenAI response did not include parsed onboarding diet output.",
  });

  const dietPatch = normalizeSettingsPatch(parsed.diet_philosophy_patch);
  if (!dietPatch || !Object.keys(dietPatch).length) {
    throw new Error("Diet proposal did not include a valid patch.");
  }

  return {
    assistant_message: cleanRichText(parsed.assistant_message),
    followup_question: cleanText(parsed.followup_question ?? "") || null,
    diet_philosophy_patch: dietPatch,
  };
}
