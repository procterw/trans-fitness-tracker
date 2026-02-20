import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import { normalizeChecklistCategories } from "./checklistPolicy.js";
import { getFitnessCategories, getFitnessCategoryLabel, getFitnessCategoryKeys } from "./fitnessChecklist.js";
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
  "For activity details, standardize to minutes, optional intensity, and notes.",
  "If duration is unknown, set duration_min to null. If intensity is not mentioned, set it to null.",
  "Put any remaining specifics (distance, location, modifiers) into notes.",
  "For vague activity text, still return a selection when a checklist item mapping is possible; otherwise return clarify.",
  "If the user appears to be answering a prior clarification, use the chat history to map to the right item.",
  "Return only the JSON that matches the provided schema.",
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

const DEFAULT_SETTINGS_ASSISTANT_INSTRUCTIONS = [
  "You are a settings assistant for a health and fitness tracker.",
  "You are not a person. Do not roleplay as one.",
  "The user can update four settings profile texts: general, fitness, diet, and agent.",
  "The user can also manage training phases/blocks.",
  "For phase changes, use changes.training_block with optional id, name, description, checklist_categories, and apply_timing (immediate or next_week).",
  "Use checklist_categories at the top level only for backward compatibility; prefer changes.training_block.",
  "Always return JSON matching the schema.",
  "If the request is unclear, keep changes as null and ask one concise follow-up question.",
  "For profile updates, return full replacement text only for fields that should change.",
  "Only modify fields the user requested; leave all others unchanged.",
  "Never remove existing settings unless the user explicitly asks to remove or replace them.",
  "When a checklist is requested, provide checklist_categories with full category and item details under changes.training_block.",
  "For checklist edits that are clearly actionable (for example adding or removing a concrete workout session), infer the best category when it is obvious.",
  "Only ask a category clarification when the activity is ambiguous and could plausibly belong to multiple categories.",
  "When the user specifies 'now' or 'this week', set apply_timing=immediate. When they specify next week or later, set apply_timing=next_week.",
  "For a pure phase switch without edits, set changes.training_block.id to the target block id.",
  "Do not return diet_philosophy_patch or fitness_philosophy_patch.",
  "Use plain text for each profile field. Preserve meaningful formatting and line breaks.",
  "Keep assistant_message professional, concise, practical, and non-judgmental.",
  "Avoid exclamation points, emoji, and overly casual language.",
  "Never include markdown code fences in assistant_message.",
  "If the user asks a pure question (no settings change), provide guidance and keep all changes null.",
  "If the user asks to view/show/list current profile settings, include a followup_question asking if they want to make changes.",
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

const SettingsTrainingBlockSchema = z.object({
  id: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  apply_timing: z.enum(["immediate", "next_week"]).nullable(),
  checklist_categories: z.array(SettingsChecklistCategorySchema).nullable(),
});

const SettingsChangesSchema = z.object({
  general: z.string().nullable(),
  fitness: z.string().nullable(),
  diet: z.string().nullable(),
  agent: z.string().nullable(),
  checklist_categories: z.array(SettingsChecklistCategorySchema).nullable(),
  training_block: SettingsTrainingBlockSchema.nullable().optional(),
});

const SettingsAssistantResponseSchema = z.object({
  assistant_message: z.string(),
  followup_question: z.string().nullable(),
  changes: SettingsChangesSchema,
});

const SettingsAssistantResponseFormat = zodTextFormat(SettingsAssistantResponseSchema, "settings_assistant_response");

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

function buildTrainingBlocksSnapshot(tracking) {
  const trainingBlocks = getTrackingMetadata(tracking)?.training_blocks;
  const blocks = Array.isArray(trainingBlocks?.blocks) ? trainingBlocks.blocks : [];
  const activeId = typeof trainingBlocks?.active_block_id === "string" ? trainingBlocks.active_block_id : null;
  return {
    active_block_id: activeId,
    blocks: blocks.map((block) => ({
      id: typeof block?.id === "string" ? block.id : "",
      name: typeof block?.name === "string" ? block.name : "",
      description: typeof block?.description === "string" ? block.description : "",
      checklist_categories: buildChecklistTemplateSnapshot({
        category_order: Array.isArray(block?.category_order) ? block.category_order : [],
        category_labels: block?.category_labels ?? {},
        ...(block?.checklist && typeof block.checklist === "object" ? block.checklist : {}),
      }),
    })),
  };
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
    schema: IngestDecisionSchema,
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

function normalizeSettingsProfileChange(value) {
  if (typeof value !== "string") return null;
  return value.replace(/\r\n/g, "\n");
}

function normalizeSettingsChecklistProposal(value) {
  const raw = normalizeChecklistCategories(value);
  return raw ? raw : null;
}

function normalizeSettingsTrainingBlockChange(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!raw) return null;
  const out = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : null,
    name: typeof raw.name === "string" ? raw.name.trim() : null,
    description: typeof raw.description === "string" ? raw.description.trim() : null,
    apply_timing: raw.apply_timing === "immediate" || raw.apply_timing === "next_week" ? raw.apply_timing : null,
    checklist_categories: normalizeSettingsChecklistProposal(raw.checklist_categories),
  };
  const hasValue = Object.values(out).some((entry) => {
    if (Array.isArray(entry)) return entry.length > 0;
    if (typeof entry === "string") return entry.length > 0;
    return entry !== null && entry !== undefined;
  });
  return hasValue ? out : null;
}

function normalizeSettingsAssistantOutput(
  parsed,
  { message = "", currentWeek = null } = {},
) {
  const rawMessage = typeof message === "string" ? message : "";
  const changes = {
    general: normalizeSettingsProfileChange(parsed?.changes?.general),
    fitness: normalizeSettingsProfileChange(parsed?.changes?.fitness),
    diet: normalizeSettingsProfileChange(parsed?.changes?.diet),
    agent: normalizeSettingsProfileChange(parsed?.changes?.agent),
    checklist_categories: normalizeSettingsChecklistProposal(parsed?.changes?.checklist_categories),
    training_block: normalizeSettingsTrainingBlockChange(parsed?.changes?.training_block),
  };

  const hasChanges = Boolean(
    changes.general ||
      changes.fitness ||
      changes.diet ||
      changes.agent ||
      (Array.isArray(changes.checklist_categories) && changes.checklist_categories.length) ||
      changes.training_block,
  );

  let assistantMessage = cleanRichText(parsed.assistant_message);

  let followupQuestion = cleanText(parsed.followup_question ?? "") || null;
  if (!hasChanges && !followupQuestion && messageLooksLikeSettingsReadRequest(message)) {
    followupQuestion = "Would you like me to make any changes to these settings?";
  }

  const inferred = applyChecklistInferenceFallback({
    parsed: {
      assistant_message: assistantMessage,
      followup_question: followupQuestion,
      changes,
    },
    message: rawMessage,
    currentWeek,
  });

  const withTemplate = applyChecklistTemplateFallback({
    parsed: inferred,
    message: rawMessage,
    currentWeek,
  });

  return {
    assistant_message: withTemplate.assistant_message,
    followup_question: withTemplate.followup_question,
    changes: withTemplate.changes,
  };
}

const SETTINGS_CHECKLIST_CATEGORY_KEYWORDS = {
  cardio: ["run", "jog", "walk", "cardio", "cycle", "bike", "bicycle", "cycling", "spin", "treadmill", "sprint", "rowing", "rower"],
  strength: ["squat", "squats", "lunge", "lunges", "deadlift", "deadlifts", "bridge", "glute", "hip", "hips", "strength", "leg press", "lower-body", "lower body", "resistance", "weight", "weights", "kettlebell"],
  mobility: ["mobility", "stretch", "stretching", "yoga", "ankle", "hip opener", "hip-open", "foam", "mobility routine"],
};

function normalizeForLookup(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function splitWords(value) {
  return normalizeForLookup(value).split(" ").filter(Boolean);
}

function inferChecklistCategoryFromText(text, currentWeek) {
  const normalizedText = normalizeForLookup(text);
  const tokens = splitWords(normalizedText);
  const keys = getFitnessCategoryKeys(currentWeek ?? null);
  if (!keys.length) return "cardio";

  const lowerText = normalizedText;
  const categoryAliases = new Map();
  categoryAliases.set("cardio", "cardio");
  categoryAliases.set("strength", "strength");
  categoryAliases.set("mobility", "mobility");

  for (const canonical of keys) {
    const canonicalNormalized = normalizeForLookup(canonical);
    categoryAliases.set(canonicalNormalized, canonical);
    const label = normalizeForLookup(getFitnessCategoryLabel(currentWeek, canonical));
    if (label) categoryAliases.set(label, canonical);
  const fallback = canonical === "lowerbody" ? normalizeForLookup("strength") : null;
  if (fallback) categoryAliases.set(fallback, canonical);
  }

  const explicitMatch = new RegExp(`\\b(cardio|strength|mobility)\\b`).exec(lowerText);
  if (explicitMatch?.[1]) return explicitMatch[1];

  for (const [keyword, canonical] of Object.entries(SETTINGS_CHECKLIST_CATEGORY_KEYWORDS)) {
    for (const alias of [keyword, ...SETTINGS_CHECKLIST_CATEGORY_KEYWORDS[keyword]]) {
      if (!alias) continue;
      const normalizedAlias = normalizeForLookup(alias);
      if (!normalizedAlias) continue;
      if (tokens.includes(normalizedAlias) || new RegExp(`\\b${normalizedAlias}\\b`).test(lowerText)) {
        const preferred = categoryAliases.get(normalizedAlias) ?? canonical;
        if (preferred === canonical) return canonical;
      }
    }
  }

  if (Array.from(categoryAliases.keys()).includes("cardio") && keys.includes("cardio")) return "cardio";
  return keys[0];
}

function stripLeadingArticle(value) {
  return String(value || "")
    .replace(/^(?:a|an|the)\s+/i, "")
    .trim();
}

function extractChecklistItemFromMessage(message) {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return null;
  const normalized = text.toLowerCase();
  const candidates = [
    normalized.match(/(?:add|include|insert|append|add to)\s+(?:an?\s+)?(.*?)(?:\s+to\s+the\s+checklist.*)?$/i),
    normalized.match(/(?:add|include|insert|append|add to)\s+(?:an?\s+)?([a-z0-9].*?)\s+(?:under|to)\s+[a-z]+/i),
    normalized.match(/(?:add|include|insert|append|add to)\s+(?:an?\s+)?([a-z0-9].*)$/i),
  ];

  const matched = candidates.find((match) => match && match[1]);
  if (!matched) return null;
  const itemText = matched[1]
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/\s+/g, " ")
    .replace(/\s*(under|to)\s+(the\s+)?(cardio|strength|mobility|checklist|workout\s*checklist|routine)\b.*$/i, "")
    .replace(/[.!?]+$/u, "")
    .trim();
  return itemText ? stripLeadingArticle(itemText) : null;
}

function inferChecklistFromMessage({ message, currentWeek }) {
  const lower = typeof message === "string" ? message.toLowerCase() : "";
  if (!lower) return null;

  const addPattern = /\b(add|include|insert|append)\b/;
  if (!addPattern.test(lower)) return null;
  const checklistCuePattern =
    /\b(checklist|workout|training|cardio|strength|mobility|session|routine|phase|block)\b/;
  if (!checklistCuePattern.test(lower)) return null;

  const itemText = extractChecklistItemFromMessage(message);
  if (!itemText) return null;
  if (itemText.length < 3) return null;

  const safeWeek = currentWeek && typeof currentWeek === "object" ? currentWeek : null;
  const snapshot = buildChecklistTemplateSnapshot(safeWeek);
  if (!snapshot.length) return null;

  const categoryKey = inferChecklistCategoryFromText(itemText + " " + lower, safeWeek);
  const targetCategory = snapshot.find((entry) => entry.key === categoryKey);
  if (!targetCategory) return null;

  const existing = new Set((targetCategory.items || []).map((value) => normalizeForLookup(value)));
  const normalizedItem = itemText.replace(/\s+/g, " ").trim();
  if (existing.has(normalizeForLookup(normalizedItem))) return null;

  const inferred = snapshot.map((entry) =>
    entry.key === targetCategory.key
      ? { ...entry, items: [...(entry.items || []), normalizedItem] }
      : entry,
  );
  return {
    checklist_categories: inferred,
    itemText: normalizedItem,
    categoryLabel: targetCategory.label,
  };
}

function normalizeChecklistTitle(value) {
  return String(value || "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/^\-+|\-+$/g, "")
    .trim();
}

function resolveChecklistCategoryKeyFromHeading(heading, currentWeek) {
  const keys = getFitnessCategoryKeys(currentWeek ?? null);
  const lookup = normalizeForLookup(heading);
  if (!lookup) return "checklist";

  for (const key of keys) {
    if (normalizeForLookup(key) === lookup) return key;
    const label = normalizeForLookup(getFitnessCategoryLabel(currentWeek, key));
    if (label === lookup) return key;
    if (label && (lookup.includes(label) || label.includes(lookup))) return key;
  }

  return lookup.replace(/[^a-z0-9]+/g, "_") || "checklist";
}

function parseChecklistTemplateFromMessage({ message, currentWeek }) {
  if (typeof message !== "string") return null;

  const hasChecklistCue = /\b(checklist|workout plan|routine)\b/i.test(message);
  if (!hasChecklistCue) return null;

  const lines = message.replace(/\r\n/g, "\n").split("\n");
  const categories = [];
  const categoryByKey = new Map();
  const itemSignaturesByKey = new Map();
  let currentCategory = null;

  const extractHeading = (rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return null;
    const cleaned = normalizeChecklistTitle(trimmed);
    if (!cleaned || cleaned.length > 70) return null;
    if (!/:\s*$/.test(cleaned)) return null;
    return cleaned.replace(/:\s*$/u, "").trim();
  };

  const extractItem = (rawLine) => {
    const raw = rawLine.trim();
    if (!raw) return "";
    const withoutPrefix = raw
      .replace(/^\s*(?:[-*+•]\s*)?(?:\[[xX✓✔✅☐\u2610\s]\]\s*)?/u, "")
      .replace(/^\s*[✅✔☑️☑✖️✗☒\u2610\u2611\u2612⬜]\s*/u, "")
      .replace(/^\s*(?:\d+[.)]\s*)/u, "")
      .trim();
    return withoutPrefix.replace(/^\s*-\s*/u, "").trim();
  };

  for (const rawLine of lines) {
    const heading = extractHeading(rawLine);
    if (heading) {
      const key = resolveChecklistCategoryKeyFromHeading(heading, currentWeek);
      if (categoryByKey.has(key)) {
        currentCategory = categoryByKey.get(key);
      } else {
        currentCategory = { key, label: heading, items: [] };
        categoryByKey.set(key, currentCategory);
        categories.push(currentCategory);
      }
      continue;
    }

    if (!currentCategory) continue;

    const itemText = extractItem(rawLine);
    if (!itemText) continue;
    const signature = normalizeForLookup(itemText);
    if (!signature) continue;
    const seenForCategory = itemSignaturesByKey.get(currentCategory.key) || new Set();
    if (seenForCategory.has(signature)) continue;
    seenForCategory.add(signature);
    itemSignaturesByKey.set(currentCategory.key, seenForCategory);
    currentCategory.items.push(itemText);
  }

  const normalized = categories.filter((entry) => entry.items.length);
  if (!normalized.length) return null;
  return normalized;
}

function messageLooksLikeProfileEdit(message) {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (!text) return false;
  return /\b(user profile|training profile|diet profile|agent profile|profile)\b/.test(text);
}

function messageLooksLikeChecklistEdit(message) {
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (!text) return false;
  return /\b(checklist|workout|training block|phase|cardio|strength|mobility|session|routine)\b/.test(text);
}

function applyChecklistTemplateFallback({ parsed, message, currentWeek }) {
  const existingChecklist = parsed.changes?.checklist_categories;
  const hasChecklist = Array.isArray(existingChecklist) && existingChecklist.length;
  if (hasChecklist) return parsed;

  const template = parseChecklistTemplateFromMessage({ message, currentWeek });
  if (!template?.length) return parsed;

  return {
    ...parsed,
    assistant_message: "I replaced your current checklist with the template you provided.",
    followup_question: null,
    changes: {
      ...parsed.changes,
      checklist_categories: template,
    },
  };
}

function applyChecklistInferenceFallback({ parsed, message, currentWeek }) {
  const existingChecklist = parsed.changes?.checklist_categories;
  const hasChecklist = Array.isArray(existingChecklist) && existingChecklist.length;
  if (hasChecklist) return parsed;
  const hasProfileEdits = Boolean(
    parsed?.changes?.general ||
      parsed?.changes?.fitness ||
      parsed?.changes?.diet ||
      parsed?.changes?.agent,
  );
  if (hasProfileEdits) return parsed;
  if (parsed?.changes?.training_block) return parsed;
  if (messageLooksLikeProfileEdit(message) && !messageLooksLikeChecklistEdit(message)) return parsed;

  const inferred = inferChecklistFromMessage({ message, currentWeek });
  if (!inferred?.checklist_categories?.length) return parsed;

  const itemText = String(inferred.itemText || "").trim();
  const categoryLabel = String(inferred.categoryLabel || "checklist").trim() || "checklist";
  const inferredMessage = itemText
    ? `I added "${itemText}" to your ${categoryLabel} checklist.`
    : "I updated your checklist based on that request.";

  return {
    ...parsed,
    assistant_message: inferredMessage,
    followup_question: null,
    changes: { ...parsed.changes, checklist_categories: inferred.checklist_categories },
  };
}

function buildEmptySettingsChanges() {
  return {
    general: null,
    fitness: null,
    diet: null,
    agent: null,
    checklist_categories: null,
    training_block: null,
  };
}

function coerceSettingsChanges(value) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    general: normalizeSettingsProfileChange(raw.general),
    fitness: normalizeSettingsProfileChange(raw.fitness),
    diet: normalizeSettingsProfileChange(raw.diet),
    agent: normalizeSettingsProfileChange(raw.agent),
    checklist_categories: normalizeSettingsChecklistProposal(raw.checklist_categories),
    training_block: normalizeSettingsTrainingBlockChange(raw.training_block),
  };
}

function buildSettingsAssistantFallback(text, { message = "", currentWeek = null } = {}) {
  const rawText = typeof text === "string" ? text : "";
  const candidate = extractJsonCandidate(rawText);
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const assistantMessage = cleanRichText(parsed.assistant_message ?? "");
        const followupQuestion = cleanText(parsed.followup_question ?? "") || null;
        const changes = coerceSettingsChanges(parsed.changes);
        const hasChanges = Boolean(
          changes.general ||
            changes.fitness ||
            changes.diet ||
            changes.agent ||
            (Array.isArray(changes.checklist_categories) && changes.checklist_categories.length) ||
            changes.training_block,
        );
        if (assistantMessage || followupQuestion || hasChanges) {
          const inferred = applyChecklistInferenceFallback({
            parsed: {
              assistant_message: assistantMessage || "I prepared a settings response.",
              followup_question: followupQuestion,
              changes,
            },
            message,
            currentWeek,
          });
          return inferred;
        }
      }
    } catch {
      // Fall through to text fallback.
    }
  }

  const fallbackMessage = cleanRichText(rawText);
  const looksJson = typeof candidate === "string" && candidate.trim().startsWith("{");
  return {
    assistant_message:
      looksJson
        ? "I could not parse structured settings changes from the model response. Please try again."
        : fallbackMessage || "I could not parse structured settings changes from the model response.",
    followup_question: null,
    changes: buildEmptySettingsChanges(),
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

export async function askSettingsAssistant({ message, messages = [] }) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const currentWeek = await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const context = {
    timezone: "America/Los_Angeles",
    ...pickSettingsProfiles(tracking),
    week: currentWeek ?? {},
    training_blocks: buildTrainingBlocksSnapshot(tracking),
  };

  const system = buildSystemInstructions({
    tracking,
    sectionKey: "settings_assistant",
    fallback: DEFAULT_SETTINGS_ASSISTANT_INSTRUCTIONS,
  });
  const input = buildModelInput({
    system,
    contextLabel: "Settings context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message),
  });

  let parsed;
  try {
    parsed = await parseStructuredResponse({
      client,
      model,
      input,
      format: SettingsAssistantResponseFormat,
      schema: SettingsAssistantResponseSchema,
      errorMessage: "OpenAI response did not include parsed settings output.",
    });
  } catch {
    const response = await client.responses.create({ model, input });
    parsed = buildSettingsAssistantFallback(response?.output_text ?? "", {
      message,
      currentWeek: currentWeek ?? {},
    });
  }

  return normalizeSettingsAssistantOutput(parsed, {
    message,
    currentWeek: currentWeek ?? {},
  });
}

export async function streamSettingsAssistant({ message, messages = [] }) {
  const client = getOpenAIClient();
  const model = getAssistantModel();

  const currentWeek = await ensureCurrentWeek();
  const tracking = await readTrackingData();

  const context = {
    timezone: "America/Los_Angeles",
    ...pickSettingsProfiles(tracking),
    week: currentWeek ?? {},
    training_blocks: buildTrainingBlocksSnapshot(tracking),
  };

  const system = buildSystemInstructions({
    tracking,
    sectionKey: "settings_assistant",
    fallback: DEFAULT_SETTINGS_ASSISTANT_INSTRUCTIONS,
  });
  const input = buildModelInput({
    system,
    contextLabel: "Settings context JSON",
    context,
    messages,
    userContent: cleanUserMessage(message),
  });

  // Do not stream structured JSON deltas into the UI; wait for the full text and parse once.
  const output = await streamResponseText({
    client,
    model,
    input,
  });

  let parsed;
  try {
    parsed = parseJsonText({
      text: output,
      schema: SettingsAssistantResponseSchema,
      errorMessage: "OpenAI response did not include parsed settings output.",
    });
  } catch {
    parsed = buildSettingsAssistantFallback(output, {
      message,
      currentWeek: currentWeek ?? {},
    });
  }

  return normalizeSettingsAssistantOutput(parsed, {
    message,
    currentWeek: currentWeek ?? {},
  });
}
