import "dotenv/config";

import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  askAssistant,
  askOnboardingAssistant,
  proposeOnboardingChecklist,
  proposeOnboardingDietGoals,
  askSettingsAssistant,
  composeMealEntryResponse,
  decideIngestAction,
} from "./assistant.js";
import { createSupabaseAuth } from "./auth/supabaseAuth.js";
import { formatChecklistCategoriesMarkdown, normalizeChecklistCategories } from "./checklistPolicy.js";
import { getFitnessCategoryKeys, resolveFitnessCategoryKey, toFitnessCategoryLabel } from "./fitnessChecklist.js";
import { generateWeeklyFitnessSummary } from "./fitnessSummary.js";
import { deriveGoalsListsFromGoalsText, normalizeGoalsText, parseGoalsTextToList } from "./goalsText.js";
import { runWithTrackingUser } from "./trackingUser.js";
import { estimateNutritionFromImage, estimateNutritionFromText } from "./visionNutrition.js";
import {
  addFoodEvent,
  ensureCurrentWeek,
  getFoodEventsForDate,
  getFoodLogForDate,
  getDailyFoodEventTotals,
  getSeattleDateString,
  getSuggestedLogDate,
  listFitnessWeeks,
  listFoodLog,
  readTrackingData,
  rollupFoodLogFromEvents,
  syncFoodEventsToFoodLog,
  updateFoodEvent,
  updateCurrentWeekItems,
  updateCurrentWeekItem,
  updateCurrentWeekSummary,
  formatSeattleIso,
  writeTrackingData,
} from "./trackingData.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const authRequired = String(process.env.SUPABASE_AUTH_REQUIRED || "").toLowerCase() === "true";
const onboardingDevToolsEnabled =
  String(process.env.ENABLE_ONBOARDING_DEV_TOOLS || "").toLowerCase() === "true" ||
  process.env.NODE_ENV !== "production";
const supabaseAuth = createSupabaseAuth({
  supabaseUrl: process.env.SUPABASE_URL || "",
  required: authRequired,
});
app.use("/api", supabaseAuth);
app.use("/api", (req, _res, next) => {
  runWithTrackingUser(req.user?.id ?? null, () => next());
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..", "client");
const distDir = path.resolve(__dirname, "..", "dist");

async function logFoodFromInputs({ file, descriptionText, notes, date, eventId = null, clientRequestId = null }) {
  const trimmedDescription = typeof descriptionText === "string" ? descriptionText.trim() : "";
  const trimmedNotes = typeof notes === "string" ? notes.trim() : "";
  const normalizedEventId = typeof eventId === "string" && eventId.trim() ? eventId.trim() : null;
  const normalizedRequestId =
    typeof clientRequestId === "string" && clientRequestId.trim() ? clientRequestId.trim() : null;

  if (!file && !trimmedDescription) {
    throw new Error("Provide either an image or a meal description.");
  }

  const effectiveDate = date ?? getSuggestedLogDate();

  const userNotesForModel = [trimmedDescription, trimmedNotes].filter(Boolean).join("\n");

  const source = file ? "photo" : "manual";
  const estimate = file
    ? await estimateNutritionFromImage({
        imageBuffer: file.buffer,
        imageMimeType: file.mimetype,
        userNotes: userNotesForModel,
      })
    : await estimateNutritionFromText({
        mealText: trimmedDescription,
        userNotes: trimmedNotes,
      });

  const writeResult = normalizedEventId
    ? await updateFoodEvent({
        id: normalizedEventId,
        date: effectiveDate,
        source,
        description: estimate.meal_title,
        input_text: trimmedDescription || null,
        notes: trimmedNotes,
        nutrients: estimate.totals,
        model: estimate.model,
        confidence: estimate.confidence,
        raw_items: estimate.items,
        idempotency_key: normalizedRequestId,
      })
    : await addFoodEvent({
        date: effectiveDate,
        source,
        description: estimate.meal_title,
        input_text: trimmedDescription || null,
        notes: trimmedNotes,
        nutrients: estimate.totals,
        model: estimate.model,
        confidence: estimate.confidence,
        raw_items: estimate.items,
        idempotency_key: normalizedRequestId,
      });

  const { event, food_log, log_action } = writeResult;

  const totalsForDay = await getDailyFoodEventTotals(effectiveDate);

  return {
    ok: true,
    date: effectiveDate,
    event,
    estimate,
    day_totals_from_events: totalsForDay,
    food_log,
    log_action: log_action ?? (normalizedEventId ? "updated" : "created"),
  };
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatActivityDetails(selection) {
  const parts = [];
  if (typeof selection?.duration_min === "number" && Number.isFinite(selection.duration_min)) {
    parts.push(`${Math.round(selection.duration_min)} min`);
  }
  if (selection?.intensity) parts.push(selection.intensity);
  if (typeof selection?.notes === "string" && selection.notes.trim()) {
    parts.push(selection.notes.trim());
  }
  return parts.join(" • ") || "Logged";
}

function findActivityByLabel(currentWeek, targetLabel) {
  const normalized = normalizeLabel(targetLabel);
  if (!normalized) return null;

  for (const categoryKey of getFitnessCategoryKeys(currentWeek)) {
    const list = Array.isArray(currentWeek?.[categoryKey]) ? currentWeek[categoryKey] : [];
    const index = list.findIndex((it) => normalizeLabel(it?.item) === normalized);
    if (index >= 0) return { categoryKey, list, index };
  }

  return null;
}

function resolveActivitySelections(selections, currentWeek) {
  const resolved = [];
  const errors = [];
  const dedupe = new Map();
  const categoryKeys = getFitnessCategoryKeys(currentWeek);

  if (!Array.isArray(selections) || selections.length === 0) {
    return { resolved, errors: ["No activity selections."] };
  }

  for (const sel of selections) {
    let category = resolveFitnessCategoryKey(currentWeek, sel?.category);
    let list = Array.isArray(currentWeek?.[category]) ? currentWeek[category] : [];
    if (!list.length) {
      const fallbackByLabel = findActivityByLabel(currentWeek, sel?.label);
      if (fallbackByLabel) {
        category = fallbackByLabel.categoryKey;
        list = fallbackByLabel.list;
      } else {
        const categoryHint = categoryKeys.length ? ` Available categories: ${categoryKeys.join(", ")}.` : "";
        errors.push(`No items found for category: ${sel?.category}.${categoryHint}`);
        continue;
      }
    }

    let index = Number.isInteger(sel?.index) ? sel.index : -1;
    if (!list[index]) {
      const target = normalizeLabel(sel?.label);
      if (target) {
        const foundIndex = list.findIndex((it) => normalizeLabel(it?.item) === target);
        if (foundIndex >= 0) index = foundIndex;
        else {
          const fallbackByLabel = findActivityByLabel(currentWeek, target);
          if (fallbackByLabel) {
            category = fallbackByLabel.categoryKey;
            list = fallbackByLabel.list;
            index = fallbackByLabel.index;
          }
        }
      }
    }

    if (!list[index]) {
      errors.push(`Could not map activity to category ${category}.`);
      continue;
    }

    const label = typeof list[index]?.item === "string" ? list[index].item : sel?.label || "Activity";
    const details = formatActivityDetails(sel);
    const key = `${category}:${index}`;
    dedupe.set(key, { category, index, label, details });
  }

  for (const value of dedupe.values()) resolved.push(value);
  return { resolved, errors };
}

function formatPlainText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function fmtNutrient(value, unit, { round = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = round ? Math.round(value) : Number.isInteger(value) ? value : Number(value.toFixed(1));
  return `${n} ${unit}`;
}

function formatMealEntryAssistantMessage(sections) {
  const lines = [sections?.confirmation, sections?.nutrition_summary, sections?.day_fit_summary]
    .map((value) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : ""))
    .filter(Boolean);
  return lines.join("\n\n");
}

function summarizeFoodResult(payload) {
  const title = formatPlainText(payload?.estimate?.meal_title) || "meal";
  const date = formatPlainText(payload?.date);
  const totals = payload?.estimate?.totals ?? {};
  const dayTotals = payload?.day_totals_from_events ?? {};

  const calories = fmtNutrient(totals.calories, "kcal", { round: true });
  const carbs = fmtNutrient(totals.carbs_g, "g carbs");
  const fat = fmtNutrient(totals.fat_g, "g fat");
  const protein = fmtNutrient(totals.protein_g, "g protein");
  const fiber = fmtNutrient(totals.fiber_g, "g fiber");

  const dayCalories = fmtNutrient(dayTotals.calories, "kcal", { round: true });
  const dayCarbs = fmtNutrient(dayTotals.carbs_g, "g carbs");
  const dayFat = fmtNutrient(dayTotals.fat_g, "g fat");
  const dayProtein = fmtNutrient(dayTotals.protein_g, "g protein");
  const dayFiber = fmtNutrient(dayTotals.fiber_g, "g fiber");

  const confirmation = date ? `Logged **${title}** for ${date}.` : `Logged **${title}**.`;
  const mealParts = [calories, carbs, fat, protein, fiber].filter(Boolean);
  const dayParts = [dayCalories, dayCarbs, dayFat, dayProtein, dayFiber].filter(Boolean);
  const nutritionSummary = [
    mealParts.length ? `- Meal: ${mealParts.join(", ")}` : "- Meal: estimate saved",
    dayParts.length ? `- Day so far: ${dayParts.join(", ")}` : "- Day so far: awaiting more entries",
  ].join("\n");
  const dayFitSummary =
    "This supports consistency best when the rest of today stays aligned with your planned activity and calm-surplus targets.";

  return {
    assistant_message: [confirmation, nutritionSummary, dayFitSummary].join("\n\n"),
    followup_question: null,
  };
}

function summarizeActivityUpdates(updates) {
  if (!updates.length) return "Logged activity.";
  const parts = updates.map((u) => (u.details ? `${u.label} (${u.details})` : u.label));
  return `Logged activity: ${parts.join("; ")}.`;
}

async function refreshCurrentWeekSummaryForActivity(currentWeek) {
  const summary = generateWeeklyFitnessSummary(currentWeek);
  const previous = typeof currentWeek?.summary === "string" ? currentWeek.summary.trim() : "";
  if (summary.trim() === previous) return currentWeek;
  return updateCurrentWeekSummary(summary);
}

function isExistingActivityEntry(currentWeek, update) {
  const item = currentWeek?.[update?.category]?.[update?.index];
  if (!item || typeof item !== "object") return false;
  const hasDetails = typeof item.details === "string" && item.details.trim().length > 0;
  return Boolean(item.checked) || hasDetails;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isPlainObject(value) ? value : {};
}

function mergeObjectPatch(base, patch) {
  if (!isPlainObject(base)) return structuredClone(patch);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeObjectPatch(out[key], value);
    else out[key] = structuredClone(value);
  }
  return out;
}

function hasGoalsTextPatch(patch) {
  if (!isPlainObject(patch)) return false;
  const goalsText = isPlainObject(patch.goals_text) ? patch.goals_text : null;
  if (!goalsText) return false;
  return ["overall_goals", "fitness_goals", "diet_goals"].some((key) => key in goalsText);
}

function applyGoalTextDerivation(profile, { now = new Date() } = {}) {
  const safeProfile = isPlainObject(profile) ? profile : {};
  const legacyGoals = asObject(safeProfile.goals);
  const goalsText = normalizeGoalsText(asObject(safeProfile.goals_text), { legacyGoals });
  const derived = deriveGoalsListsFromGoalsText({ goalsText, legacyGoals });
  const metadata = asObject(safeProfile.metadata);
  return {
    ...safeProfile,
    goals_text: goalsText,
    goals: {
      ...legacyGoals,
      diet_goals: derived.diet_goals,
      fitness_goals: derived.fitness_goals,
      health_goals: derived.health_goals,
    },
    metadata: {
      ...metadata,
      goals_text_updated_at: formatSeattleIso(now),
      goals_derivation_version: 1,
    },
  };
}

const ONBOARDING_STAGE_ORDER = ["goals", "checklist", "diet"];
const ONBOARDING_STAGE_SET = new Set([...ONBOARDING_STAGE_ORDER, "complete"]);
const ONBOARDING_CONFIRM_ACTION = {
  checklist: "accept_checklist",
  diet: "accept_diet",
};
const ONBOARDING_PROMPTS = {
  goals:
    "Tell me broadly about your fitness and diet goals. Include as much detail as you want, and I'll ask clarifying questions if needed.",
  checklist:
    "Here's a draft fitness checklist based on your goals. Tell me what to change, then press Accept when it looks right.",
  diet:
    "Here's a draft calorie and macro target outline. Tell me what to change, then press Accept when it looks right.",
};

function hasNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.some((entry) => hasNonEmptyString(entry));
}

function normalizeGoalList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const text = typeof entry === "string" ? entry.trim() : "";
    if (!text) continue;
    const token = text.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(text);
  }
  return out;
}

function extractGoalSummary(userProfile) {
  const profile = isPlainObject(userProfile) ? userProfile : {};
  const goals = isPlainObject(profile.goals) ? profile.goals : {};
  const goalsText = normalizeGoalsText(asObject(profile.goals_text), { legacyGoals: goals });
  const derivedGoals = deriveGoalsListsFromGoalsText({ goalsText, legacyGoals: goals });
  return {
    diet_goals: normalizeGoalList(derivedGoals.diet_goals),
    fitness_goals: normalizeGoalList(derivedGoals.fitness_goals),
    health_goals: normalizeGoalList(derivedGoals.health_goals),
    goals_text: goalsText,
    overall_goals_list: parseGoalsTextToList(goalsText.overall_goals),
  };
}

function normalizeOnboardingStage(value) {
  const stage = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ONBOARDING_STAGE_SET.has(stage) ? stage : "goals";
}

function normalizeOnboardingChecklistCategories(value) {
  return normalizeChecklistCategories(value);
}

function normalizeOnboardingChecklistProposal(value) {
  if (!isPlainObject(value)) return null;
  const categories = normalizeOnboardingChecklistCategories(value.checklist_categories);
  if (!categories?.length) return null;
  return { checklist_categories: categories };
}

function normalizeOnboardingDietProposal(value) {
  if (!isPlainObject(value)) return null;
  if (!isPlainObject(value.diet_philosophy_patch) || !Object.keys(value.diet_philosophy_patch).length) return null;
  return { diet_philosophy_patch: structuredClone(value.diet_philosophy_patch) };
}

function getOnboardingMeta(userProfile) {
  const profile = isPlainObject(userProfile) ? userProfile : {};
  const metadata = isPlainObject(profile.metadata) ? profile.metadata : {};
  const onboarding = isPlainObject(metadata.onboarding) ? metadata.onboarding : {};
  return {
    stage: normalizeOnboardingStage(onboarding.stage),
    started_at: hasNonEmptyString(onboarding.started_at) ? onboarding.started_at.trim() : null,
    completed_at: hasNonEmptyString(onboarding.completed_at) ? onboarding.completed_at.trim() : null,
    checklist_proposal: normalizeOnboardingChecklistProposal(onboarding.checklist_proposal),
    diet_proposal: normalizeOnboardingDietProposal(onboarding.diet_proposal),
  };
}

function hasGoalContext(userProfile) {
  const profile = isPlainObject(userProfile) ? userProfile : {};
  const goals = isPlainObject(profile.goals) ? profile.goals : {};
  const goalsText = normalizeGoalsText(asObject(profile.goals_text), { legacyGoals: goals });
  const derived = deriveGoalsListsFromGoalsText({ goalsText, legacyGoals: goals });
  return hasNonEmptyArray(derived.diet_goals) && hasNonEmptyArray(derived.fitness_goals);
}

function hasChecklistConfigured(currentWeek) {
  const week = isPlainObject(currentWeek) ? currentWeek : {};
  const keys = getFitnessCategoryKeys(week);
  if (!keys.length) return false;
  return keys.some((key) => {
    const list = Array.isArray(week[key]) ? week[key] : [];
    return list.some((item) => hasNonEmptyString(item?.item));
  });
}

function hasDietTargetsConfigured(dietPhilosophy) {
  const diet = isPlainObject(dietPhilosophy) ? dietPhilosophy : {};
  const calories = isPlainObject(diet.calories) ? diet.calories : {};
  const protein = isPlainObject(diet.protein) ? diet.protein : {};
  return hasNonEmptyString(calories.target) && hasNonEmptyString(protein.target_g);
}

function resolveOnboardingStage({ userProfile, currentWeek, dietPhilosophy }) {
  const onboarding = getOnboardingMeta(userProfile);
  if (onboarding.completed_at || onboarding.stage === "complete") return "complete";
  if (onboarding.stage === "checklist" || onboarding.stage === "diet") return onboarding.stage;

  const canBypass =
    !onboarding.started_at &&
    hasGoalContext(userProfile) &&
    hasChecklistConfigured(currentWeek) &&
    hasDietTargetsConfigured(dietPhilosophy);
  if (canBypass) return "complete";
  return "goals";
}

function normalizeClientTimezone(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
    return hasNonEmptyString(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function applyClientTimezone(userProfile, clientTimezone) {
  const timezone = normalizeClientTimezone(clientTimezone);
  const profile = isPlainObject(userProfile) ? structuredClone(userProfile) : {};
  const general = isPlainObject(profile.general) ? { ...profile.general } : {};
  const existingTimezone = hasNonEmptyString(general.timezone) ? general.timezone.trim() : "";

  if (!timezone || existingTimezone) {
    return { profile, changed: false };
  }

  general.timezone = timezone;
  profile.general = general;
  return { profile, changed: true };
}

function updateOnboardingMetadata(
  userProfile,
  { stage = null, checklistProposal, dietProposal, clearChecklistProposal = false, clearDietProposal = false, completed = false, now = new Date() } = {},
) {
  const nextProfile = isPlainObject(userProfile) ? structuredClone(userProfile) : {};
  const metadata = isPlainObject(nextProfile.metadata) ? nextProfile.metadata : {};
  const onboarding = isPlainObject(metadata.onboarding) ? metadata.onboarding : {};

  const timestamp = formatSeattleIso(now);
  const normalizedStage = stage ? normalizeOnboardingStage(stage) : null;
  if (!hasNonEmptyString(onboarding.started_at)) onboarding.started_at = timestamp;
  if (normalizedStage) onboarding.stage = normalizedStage;

  if (checklistProposal !== undefined) onboarding.checklist_proposal = checklistProposal;
  if (dietProposal !== undefined) onboarding.diet_proposal = dietProposal;
  if (clearChecklistProposal) delete onboarding.checklist_proposal;
  if (clearDietProposal) delete onboarding.diet_proposal;

  if (completed) {
    onboarding.stage = "complete";
    if (!hasNonEmptyString(onboarding.completed_at)) onboarding.completed_at = timestamp;
  } else if (normalizedStage && normalizedStage !== "complete") {
    delete onboarding.completed_at;
  }

  onboarding.last_active_at = timestamp;
  metadata.onboarding = onboarding;
  metadata.updated_at = timestamp;
  nextProfile.metadata = metadata;
  return nextProfile;
}

function restartOnboardingMetadata(userProfile, { now = new Date() } = {}) {
  const nextProfile = isPlainObject(userProfile) ? structuredClone(userProfile) : {};
  const metadata = isPlainObject(nextProfile.metadata) ? nextProfile.metadata : {};
  const timestamp = formatSeattleIso(now);
  metadata.onboarding = {
    stage: "goals",
    started_at: timestamp,
    last_active_at: timestamp,
  };
  metadata.updated_at = timestamp;
  nextProfile.metadata = metadata;
  return nextProfile;
}

function checklistProposalToMarkdown(proposal) {
  const categories = normalizeOnboardingChecklistCategories(proposal?.checklist_categories);
  if (!categories?.length) return "";
  return formatChecklistCategoriesMarkdown(categories, { heading: "Proposed fitness checklist:" });
}

function dietProposalToMarkdown(proposal) {
  const patch = isPlainObject(proposal?.diet_philosophy_patch) ? proposal.diet_philosophy_patch : null;
  if (!patch) return "";
  const calories = isPlainObject(patch.calories) ? patch.calories : {};
  const protein = isPlainObject(patch.protein) ? patch.protein : {};
  const carbs = isPlainObject(patch.carbs) ? patch.carbs : {};
  const fat = isPlainObject(patch.fat) ? patch.fat : {};

  const lines = ["Proposed calorie and macro goals:"];
  if (hasNonEmptyString(calories.target)) lines.push(`- Calories: **${calories.target.trim()}**`);
  if (hasNonEmptyString(protein.target_g)) lines.push(`- Protein: **${protein.target_g.trim()} g**`);
  if (hasNonEmptyString(carbs.target_g)) lines.push(`- Carbs: **${carbs.target_g.trim()} g**`);
  if (hasNonEmptyString(fat.target_g)) lines.push(`- Fat: **${fat.target_g.trim()} g**`);
  if (lines.length === 1) lines.push("- (No explicit calorie/macro targets found in proposal)");
  return lines.join("\n");
}

function buildOnboardingResponse({
  stage,
  assistantMessage,
  followupQuestion = null,
  proposal = null,
  confirmAction = null,
  savedProfile = false,
  updatedProfile = null,
}) {
  const normalizedStage = normalizeOnboardingStage(stage);
  const onboardingComplete = normalizedStage === "complete";
  const stageIndexRaw = ONBOARDING_STAGE_ORDER.indexOf(normalizedStage);
  const stepIndex = onboardingComplete
    ? ONBOARDING_STAGE_ORDER.length
    : stageIndexRaw >= 0
      ? stageIndexRaw + 1
      : 1;
  const stepTotal = ONBOARDING_STAGE_ORDER.length;
  return {
    ok: true,
    needs_onboarding: !onboardingComplete,
    onboarding_complete: onboardingComplete,
    stage: normalizedStage,
    step_index: stepIndex,
    step_total: stepTotal,
    assistant_message: assistantMessage,
    followup_question: followupQuestion,
    requires_confirmation: Boolean(proposal && confirmAction),
    confirm_action: proposal && confirmAction ? confirmAction : null,
    proposal: proposal ?? null,
    saved_profile: savedProfile,
    updated_profile: updatedProfile,
  };
}

function normalizeChecklistCategoryKey(raw) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || "category";
}

function normalizeItemToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function applyChecklistCategories(currentWeek, categories) {
  const safeWeek = currentWeek && typeof currentWeek === "object" ? currentWeek : {};
  const oldKeys = getFitnessCategoryKeys(safeWeek);
  const oldLabels = isPlainObject(safeWeek.category_labels) ? safeWeek.category_labels : {};

  const oldByCategoryAndItem = new Map();
  for (const key of oldKeys) {
    const list = Array.isArray(safeWeek[key]) ? safeWeek[key] : [];
    const itemMap = new Map();
    for (const item of list) {
      const label = typeof item?.item === "string" ? item.item.trim() : "";
      if (!label) continue;
      const token = normalizeItemToken(label);
      if (!token || itemMap.has(token)) continue;
      itemMap.set(token, {
        checked: item?.checked === true,
        details: typeof item?.details === "string" ? item.details : "",
      });
    }
    oldByCategoryAndItem.set(key, itemMap);
  }

  const nextWeek = {
    week_start: typeof safeWeek.week_start === "string" ? safeWeek.week_start : "",
    week_label: typeof safeWeek.week_label === "string" ? safeWeek.week_label : "",
    summary: typeof safeWeek.summary === "string" ? safeWeek.summary : "",
  };

  const usedKeys = new Set();
  const categoryOrder = [];
  const categoryLabels = {};
  for (const category of categories) {
    const baseKey = normalizeChecklistCategoryKey(category?.key);
    let key = baseKey;
    let i = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}_${i}`;
      i += 1;
    }
    usedKeys.add(key);

    const oldItemMap = oldByCategoryAndItem.get(key) ?? new Map();
    const seenItems = new Set();
    const itemRows = [];
    const items = Array.isArray(category?.items) ? category.items : [];
    for (const itemLabelRaw of items) {
      const itemLabel = typeof itemLabelRaw === "string" ? itemLabelRaw.trim() : "";
      if (!itemLabel) continue;
      const token = normalizeItemToken(itemLabel);
      if (!token || seenItems.has(token)) continue;
      seenItems.add(token);
      const existing = oldItemMap.get(token);
      itemRows.push({
        item: itemLabel,
        checked: Boolean(existing?.checked),
        details: typeof existing?.details === "string" ? existing.details : "",
      });
    }
    if (!itemRows.length) continue;

    categoryOrder.push(key);
    nextWeek[key] = itemRows;
    const labelRaw = typeof category?.label === "string" ? category.label.trim() : "";
    const fallbackLabel = typeof oldLabels[key] === "string" ? oldLabels[key] : toFitnessCategoryLabel(key);
    categoryLabels[key] = labelRaw || fallbackLabel;
  }

  nextWeek.category_order = categoryOrder;
  nextWeek.category_labels = categoryLabels;
  return nextWeek;
}

function extractChecklistTemplate(week) {
  if (!isPlainObject(week)) return null;
  const keys = getFitnessCategoryKeys(week);
  if (!keys.length) return null;
  const labels = isPlainObject(week.category_labels) ? week.category_labels : {};
  const template = {
    category_order: [],
    category_labels: {},
  };
  for (const key of keys) {
    const list = Array.isArray(week[key]) ? week[key] : [];
    const items = list
      .map((entry) => (typeof entry?.item === "string" ? entry.item.trim() : ""))
      .filter(Boolean)
      .map((item) => ({ item }));
    if (!items.length) continue;
    template.category_order.push(key);
    template[key] = items;
    const label = typeof labels[key] === "string" ? labels[key].trim() : "";
    if (label) template.category_labels[key] = label;
  }
  if (!template.category_order.length) return null;
  if (!Object.keys(template.category_labels).length) delete template.category_labels;
  return template;
}

function hasPendingSettingsChanges(changes) {
  return Boolean(
    changes?.user_profile_patch ||
      changes?.diet_philosophy_patch ||
      changes?.fitness_philosophy_patch ||
      changes?.checklist_categories,
  );
}

function isValidSettingsProposal(value) {
  if (!isPlainObject(value)) return false;
  const keys = [
    "user_profile_patch",
    "diet_philosophy_patch",
    "fitness_philosophy_patch",
    "checklist_categories",
  ];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) return false;
  }
  if (value.user_profile_patch !== null && value.user_profile_patch !== undefined && !isPlainObject(value.user_profile_patch)) return false;
  if (value.diet_philosophy_patch !== null && value.diet_philosophy_patch !== undefined && !isPlainObject(value.diet_philosophy_patch)) return false;
  if (value.fitness_philosophy_patch !== null && value.fitness_philosophy_patch !== undefined && !isPlainObject(value.fitness_philosophy_patch)) return false;
  if (value.checklist_categories !== null && value.checklist_categories !== undefined && !Array.isArray(value.checklist_categories)) return false;
  return true;
}

async function applySettingsChanges({ proposal, applyMode = "now" }) {
  if (!isValidSettingsProposal(proposal)) throw new Error("Invalid settings proposal payload.");
  const mode = applyMode === "next_week" ? "next_week" : "now";
  const normalizedChecklistCategories =
    proposal.checklist_categories === null || proposal.checklist_categories === undefined
      ? null
      : normalizeChecklistCategories(proposal.checklist_categories);
  if (proposal.checklist_categories && !normalizedChecklistCategories?.length) {
    throw new Error("Checklist changes must only include workout or activity items.");
  }

  await ensureCurrentWeek();
  const data = await readTrackingData();
  const changesApplied = [];

  if (proposal.user_profile_patch) {
    data.user_profile = mergeObjectPatch(data.user_profile ?? {}, proposal.user_profile_patch);
    if (hasGoalsTextPatch(proposal.user_profile_patch)) {
      data.user_profile = applyGoalTextDerivation(data.user_profile, { now: new Date() });
    }
    changesApplied.push("Updated generic user profile.");
  }

  if (proposal.diet_philosophy_patch) {
    data.diet_philosophy = mergeObjectPatch(data.diet_philosophy ?? {}, proposal.diet_philosophy_patch);
    changesApplied.push("Updated diet goals/philosophy.");
  }
  if (proposal.fitness_philosophy_patch) {
    data.fitness_philosophy = mergeObjectPatch(data.fitness_philosophy ?? {}, proposal.fitness_philosophy_patch);
    changesApplied.push("Updated fitness goals/philosophy.");
  }

  if (normalizedChecklistCategories) {
    const remappedWeek = applyChecklistCategories(data.current_week ?? {}, normalizedChecklistCategories);
    const template = extractChecklistTemplate(remappedWeek);
    if (template) {
      const metadata = isPlainObject(data.metadata) ? data.metadata : {};
      metadata.checklist_template = template;
      data.metadata = metadata;
      if (mode === "now") {
        data.current_week = remappedWeek;
        changesApplied.push("Updated checklist template for current week and future weeks.");
      } else {
        changesApplied.push("Scheduled checklist template update for next week.");
      }
    }
  }

  if (changesApplied.length) {
    const metadata = isPlainObject(data.metadata) ? data.metadata : {};
    const appliedAt = formatSeattleIso(new Date());
    const effectiveFrom = normalizedChecklistCategories && mode === "next_week"
      ? "next_week_rollover"
      : getSeattleDateString(new Date());
    const currentVersion = Number.isInteger(metadata.settings_version) ? metadata.settings_version : 0;
    const nextVersion = currentVersion + 1;
    const domains = [];
    if (proposal.user_profile_patch) domains.push("user_profile");
    if (proposal.diet_philosophy_patch) domains.push("diet_philosophy");
    if (proposal.fitness_philosophy_patch) domains.push("fitness_philosophy");
    if (normalizedChecklistCategories) domains.push("checklist_template");
    const event = {
      version: nextVersion,
      applied_at: appliedAt,
      effective_from: effectiveFrom,
      checklist_apply_mode: normalizedChecklistCategories ? mode : null,
      domains,
    };
    const previous = Array.isArray(metadata.settings_history) ? metadata.settings_history : [];
    metadata.settings_version = nextVersion;
    metadata.settings_history = [...previous.slice(-19), event];
    metadata.last_updated = appliedAt;
    data.metadata = metadata;
    await writeTrackingData(data);
    return {
      changesApplied,
      updated: {
        current_week: data.current_week ?? null,
        user_profile: data.user_profile ?? null,
        diet_philosophy: data.diet_philosophy ?? null,
        fitness_philosophy: data.fitness_philosophy ?? null,
      },
      settingsVersion: nextVersion,
      effectiveFrom,
    };
  }

  return {
    changesApplied,
    updated: null,
    settingsVersion: Number.isInteger(data?.metadata?.settings_version) ? data.metadata.settings_version : null,
    effectiveFrom: null,
  };
}

function getCurrentOnboardingState(data) {
  const profile = isPlainObject(data?.user_profile) ? data.user_profile : {};
  const stage = resolveOnboardingStage({
    userProfile: profile,
    currentWeek: data?.current_week ?? null,
    dietPhilosophy: data?.diet_philosophy ?? null,
  });
  const onboardingMeta = getOnboardingMeta(profile);
  return { profile, stage, onboardingMeta };
}

async function buildChecklistDraft({ message = "", messages = [], data, profile, currentProposal = null }) {
  const proposalResult = await proposeOnboardingChecklist({
    message,
    messages,
    userProfile: profile,
    currentWeek: data?.current_week ?? null,
    currentProposal,
  });
  const proposal = { checklist_categories: proposalResult.checklist_categories };
  const markdown = checklistProposalToMarkdown(proposal);
  return {
    proposal,
    assistantMessage: [proposalResult.assistant_message, markdown].filter(Boolean).join("\n\n"),
    followupQuestion:
      proposalResult.followup_question ??
      "Tell me what to change, then press Accept checklist when this looks right.",
  };
}

async function buildDietDraft({ message = "", messages = [], data, profile, currentProposal = null }) {
  const proposalResult = await proposeOnboardingDietGoals({
    message,
    messages,
    userProfile: profile,
    dietPhilosophy: data?.diet_philosophy ?? null,
    currentProposal,
  });
  const proposal = { diet_philosophy_patch: proposalResult.diet_philosophy_patch };
  const markdown = dietProposalToMarkdown(proposal);
  return {
    proposal,
    assistantMessage: [proposalResult.assistant_message, markdown].filter(Boolean).join("\n\n"),
    followupQuestion:
      proposalResult.followup_question ??
      "Tell me what to change, then press Accept diet goals when this looks right.",
  };
}

app.get("/api/onboarding/state", async (req, res) => {
  try {
    await ensureCurrentWeek();
    const data = await readTrackingData();

    let profile = isPlainObject(data.user_profile) ? data.user_profile : {};
    let savedProfile = false;

    const clientTimezone = typeof req.query?.client_timezone === "string" ? req.query.client_timezone : "";
    const timezoneApplied = applyClientTimezone(profile, clientTimezone);
    if (timezoneApplied.changed) {
      profile = timezoneApplied.profile;
      savedProfile = true;
    }

    const runtime = getCurrentOnboardingState({ ...data, user_profile: profile });
    const stage = runtime.stage;
    const onboardingMeta = runtime.onboardingMeta;

    if (stage === "complete") {
      if (savedProfile) {
        data.user_profile = profile;
        await writeTrackingData(data);
      }
      return res.json(
        buildOnboardingResponse({
          stage,
          assistantMessage: "Setup complete. You're ready to use the tracker.",
          followupQuestion: null,
          savedProfile,
          updatedProfile: savedProfile ? profile : null,
        }),
      );
    }

    if (stage === "goals") {
      if (savedProfile) {
        profile = updateOnboardingMetadata(profile, { stage: "goals" });
        data.user_profile = profile;
        await writeTrackingData(data);
      }
      return res.json(
        buildOnboardingResponse({
          stage,
          assistantMessage: ONBOARDING_PROMPTS.goals,
          followupQuestion:
            "What are your fitness and diet goals right now? Include any constraints or preferences.",
          savedProfile,
          updatedProfile: savedProfile ? profile : null,
        }),
      );
    }

    if (stage === "checklist") {
      let proposal = onboardingMeta.checklist_proposal;
      let assistantMessage = ONBOARDING_PROMPTS.checklist;
      let followupQuestion = "Tell me what to change, or press Accept checklist.";

      if (!proposal) {
        const draft = await buildChecklistDraft({ data, profile, message: "", messages: [] });
        proposal = draft.proposal;
        assistantMessage = draft.assistantMessage;
        followupQuestion = draft.followupQuestion;
        profile = updateOnboardingMetadata(profile, { stage: "checklist", checklistProposal: proposal });
        data.user_profile = profile;
        savedProfile = true;
      } else {
        const markdown = checklistProposalToMarkdown(proposal);
        assistantMessage = [assistantMessage, markdown].filter(Boolean).join("\n\n");
      }

      if (savedProfile) await writeTrackingData(data);
      return res.json(
        buildOnboardingResponse({
          stage,
          assistantMessage,
          followupQuestion,
          proposal,
          confirmAction: ONBOARDING_CONFIRM_ACTION.checklist,
          savedProfile,
          updatedProfile: savedProfile ? profile : null,
        }),
      );
    }

    // stage === "diet"
    let proposal = onboardingMeta.diet_proposal;
    let assistantMessage = ONBOARDING_PROMPTS.diet;
    let followupQuestion = "Tell me what to change, or press Accept diet goals.";

    if (!proposal) {
      const draft = await buildDietDraft({ data, profile, message: "", messages: [] });
      proposal = draft.proposal;
      assistantMessage = draft.assistantMessage;
      followupQuestion = draft.followupQuestion;
      profile = updateOnboardingMetadata(profile, { stage: "diet", dietProposal: proposal });
      data.user_profile = profile;
      savedProfile = true;
    } else {
      const markdown = dietProposalToMarkdown(proposal);
      assistantMessage = [assistantMessage, markdown].filter(Boolean).join("\n\n");
    }

    if (savedProfile) await writeTrackingData(data);
    return res.json(
      buildOnboardingResponse({
        stage,
        assistantMessage,
        followupQuestion,
        proposal,
        confirmAction: ONBOARDING_CONFIRM_ACTION.diet,
        savedProfile,
        updatedProfile: savedProfile ? profile : null,
      }),
    );
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/onboarding/chat", async (req, res) => {
  try {
    await ensureCurrentWeek();
    const data = await readTrackingData();

    let profile = isPlainObject(data.user_profile) ? data.user_profile : {};
    const clientTimezone = typeof req.body?.client_timezone === "string" ? req.body.client_timezone : "";
    const timezoneApplied = applyClientTimezone(profile, clientTimezone);
    if (timezoneApplied.changed) profile = timezoneApplied.profile;

    const runtime = getCurrentOnboardingState({ ...data, user_profile: profile });
    const stage = runtime.stage;
    const onboardingMeta = runtime.onboardingMeta;
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    if (stage === "complete") {
      if (timezoneApplied.changed) {
        data.user_profile = profile;
        await writeTrackingData(data);
      }
      return res.json(
        buildOnboardingResponse({
          stage,
          assistantMessage: "Setup is already complete. Taking you to your tracker.",
          followupQuestion: null,
          savedProfile: timezoneApplied.changed,
          updatedProfile: timezoneApplied.changed ? profile : null,
        }),
      );
    }

    if (!message) {
      return res.json(
        buildOnboardingResponse({
          stage,
          assistantMessage: ONBOARDING_PROMPTS[stage] ?? "Ready when you are.",
          followupQuestion: stage === "goals" ? "Share your fitness and diet goals." : "Tell me what to adjust.",
          proposal: stage === "checklist" ? onboardingMeta.checklist_proposal : stage === "diet" ? onboardingMeta.diet_proposal : null,
          confirmAction: stage === "checklist" ? ONBOARDING_CONFIRM_ACTION.checklist : stage === "diet" ? ONBOARDING_CONFIRM_ACTION.diet : null,
          savedProfile: false,
          updatedProfile: null,
        }),
      );
    }

    if (stage === "goals") {
      const result = await askOnboardingAssistant({
        message,
        messages,
        onboardingState: { stage, prompt: ONBOARDING_PROMPTS.goals },
        userProfile: profile,
      });

      const patch =
        isPlainObject(result?.user_profile_patch) && Object.keys(result.user_profile_patch).length
          ? result.user_profile_patch
          : null;
      if (patch) profile = mergeObjectPatch(profile, patch);
      if (patch && hasGoalsTextPatch(patch)) {
        profile = applyGoalTextDerivation(profile, { now: new Date() });
      }
      profile = updateOnboardingMetadata(profile, { stage: "goals" });

      if (hasGoalContext(profile)) {
        const draft = await buildChecklistDraft({ message: "", messages: [], data, profile, currentProposal: null });
        profile = updateOnboardingMetadata(profile, {
          stage: "checklist",
          checklistProposal: draft.proposal,
          clearDietProposal: true,
        });
        data.user_profile = profile;
        await writeTrackingData(data);

        return res.json(
          buildOnboardingResponse({
            stage: "checklist",
            assistantMessage: draft.assistantMessage,
            followupQuestion: draft.followupQuestion,
            proposal: draft.proposal,
            confirmAction: ONBOARDING_CONFIRM_ACTION.checklist,
            savedProfile: true,
            updatedProfile: profile,
          }),
        );
      }

      data.user_profile = profile;
      await writeTrackingData(data);
      return res.json(
        buildOnboardingResponse({
          stage: "goals",
          assistantMessage:
            result.assistant_message ||
            "Thanks. Share more about both fitness and diet goals, and I'll draft your checklist next.",
          followupQuestion:
            result.followup_question ||
            "Anything else about your priorities, constraints, or preferences for workouts and nutrition?",
          savedProfile: true,
          updatedProfile: profile,
        }),
      );
    }

    if (stage === "checklist") {
      const draft = await buildChecklistDraft({
        message,
        messages,
        data,
        profile,
        currentProposal: onboardingMeta.checklist_proposal,
      });
      profile = updateOnboardingMetadata(profile, { stage: "checklist", checklistProposal: draft.proposal });
      data.user_profile = profile;
      await writeTrackingData(data);

      return res.json(
        buildOnboardingResponse({
          stage: "checklist",
          assistantMessage: draft.assistantMessage,
          followupQuestion: draft.followupQuestion,
          proposal: draft.proposal,
          confirmAction: ONBOARDING_CONFIRM_ACTION.checklist,
          savedProfile: true,
          updatedProfile: profile,
        }),
      );
    }

    // stage === "diet"
    const draft = await buildDietDraft({
      message,
      messages,
      data,
      profile,
      currentProposal: onboardingMeta.diet_proposal,
    });
    profile = updateOnboardingMetadata(profile, { stage: "diet", dietProposal: draft.proposal });
    data.user_profile = profile;
    await writeTrackingData(data);

    return res.json(
      buildOnboardingResponse({
        stage: "diet",
        assistantMessage: draft.assistantMessage,
        followupQuestion: draft.followupQuestion,
        proposal: draft.proposal,
        confirmAction: ONBOARDING_CONFIRM_ACTION.diet,
        savedProfile: true,
        updatedProfile: profile,
      }),
    );
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/onboarding/confirm", async (req, res) => {
  try {
    await ensureCurrentWeek();
    const data = await readTrackingData();

    let profile = isPlainObject(data.user_profile) ? data.user_profile : {};
    const clientTimezone = typeof req.body?.client_timezone === "string" ? req.body.client_timezone : "";
    const timezoneApplied = applyClientTimezone(profile, clientTimezone);
    if (timezoneApplied.changed) profile = timezoneApplied.profile;

    const runtime = getCurrentOnboardingState({ ...data, user_profile: profile });
    const stage = runtime.stage;
    const onboardingMeta = runtime.onboardingMeta;
    const action = typeof req.body?.action === "string" ? req.body.action.trim().toLowerCase() : "";
    const rawProposal = isPlainObject(req.body?.proposal) ? req.body.proposal : null;

    if (stage === "complete") {
      if (timezoneApplied.changed) {
        data.user_profile = profile;
        await writeTrackingData(data);
      }
      return res.json(
        buildOnboardingResponse({
          stage: "complete",
          assistantMessage: "Setup is already complete.",
          followupQuestion: null,
          savedProfile: timezoneApplied.changed,
          updatedProfile: timezoneApplied.changed ? profile : null,
        }),
      );
    }

    if (action === ONBOARDING_CONFIRM_ACTION.checklist) {
      if (stage !== "checklist") {
        return res.status(400).json({ ok: false, error: "Checklist acceptance is only available during checklist setup." });
      }

      const proposal =
        normalizeOnboardingChecklistProposal(rawProposal) ?? normalizeOnboardingChecklistProposal(onboardingMeta.checklist_proposal);
      if (!proposal) return res.status(400).json({ ok: false, error: "Missing or invalid checklist proposal." });

      const remappedWeek = applyChecklistCategories(data.current_week ?? {}, proposal.checklist_categories);
      const template = extractChecklistTemplate(remappedWeek);
      if (!template) return res.status(400).json({ ok: false, error: "Checklist proposal produced no valid template." });

      const metadata = isPlainObject(data.metadata) ? data.metadata : {};
      metadata.checklist_template = template;
      metadata.last_updated = formatSeattleIso(new Date());
      data.metadata = metadata;
      data.current_week = remappedWeek;

      const draft = await buildDietDraft({ message: "", messages: [], data, profile, currentProposal: null });
      profile = updateOnboardingMetadata(profile, {
        stage: "diet",
        clearChecklistProposal: true,
        dietProposal: draft.proposal,
      });

      data.user_profile = profile;
      await writeTrackingData(data);

      return res.json(
        buildOnboardingResponse({
          stage: "diet",
          assistantMessage: draft.assistantMessage,
          followupQuestion: draft.followupQuestion,
          proposal: draft.proposal,
          confirmAction: ONBOARDING_CONFIRM_ACTION.diet,
          savedProfile: true,
          updatedProfile: profile,
        }),
      );
    }

    if (action === ONBOARDING_CONFIRM_ACTION.diet) {
      if (stage !== "diet") {
        return res.status(400).json({ ok: false, error: "Diet acceptance is only available during diet setup." });
      }

      const proposal =
        normalizeOnboardingDietProposal(rawProposal) ?? normalizeOnboardingDietProposal(onboardingMeta.diet_proposal);
      if (!proposal) return res.status(400).json({ ok: false, error: "Missing or invalid diet proposal." });

      data.diet_philosophy = mergeObjectPatch(data.diet_philosophy ?? {}, proposal.diet_philosophy_patch);
      const metadata = isPlainObject(data.metadata) ? data.metadata : {};
      metadata.last_updated = formatSeattleIso(new Date());
      data.metadata = metadata;

      profile = updateOnboardingMetadata(profile, {
        completed: true,
        clearChecklistProposal: true,
        clearDietProposal: true,
      });
      data.user_profile = profile;
      await writeTrackingData(data);

      return res.json(
        buildOnboardingResponse({
          stage: "complete",
          assistantMessage: "Great. Your checklist and diet goals are set. Taking you to the main app now.",
          followupQuestion: null,
          savedProfile: true,
          updatedProfile: profile,
        }),
      );
    }

    return res.status(400).json({ ok: false, error: "Unknown confirmation action." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/onboarding/dev/restart", async (req, res) => {
  try {
    if (!onboardingDevToolsEnabled) {
      return res.status(404).json({ ok: false, error: "Not found." });
    }

    await ensureCurrentWeek();
    const data = await readTrackingData();

    let profile = isPlainObject(data.user_profile) ? data.user_profile : {};
    const clientTimezone = typeof req.body?.client_timezone === "string" ? req.body.client_timezone : "";
    const timezoneApplied = applyClientTimezone(profile, clientTimezone);
    if (timezoneApplied.changed) profile = timezoneApplied.profile;

    profile = restartOnboardingMetadata(profile);
    data.user_profile = profile;
    await writeTrackingData(data);

    return res.json(
      buildOnboardingResponse({
        stage: "goals",
        assistantMessage: ONBOARDING_PROMPTS.goals,
        followupQuestion:
          "What are your fitness and diet goals right now? Include any constraints or preferences.",
        savedProfile: true,
        updatedProfile: profile,
      }),
    );
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/context", async (_req, res) => {
  try {
    await ensureCurrentWeek();
    const data = await readTrackingData();
    const goalSummary = extractGoalSummary(data.user_profile);
    res.json({
      ok: true,
      suggested_date: getSuggestedLogDate(),
      diet_philosophy: data.diet_philosophy ?? null,
      fitness_philosophy: data.fitness_philosophy ?? null,
      user_profile_goals: goalSummary,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/assistant/ask", async (req, res) => {
  try {
    const question = typeof req.body?.question === "string" && req.body.question.trim() ? req.body.question.trim() : null;
    if (!question) return res.status(400).json({ ok: false, error: "Missing field: question" });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const answer = await askAssistant({ question, date, messages });
    res.json({ ok: true, answer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/settings/chat", async (req, res) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ ok: false, error: "Missing field: message" });
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const result = await askSettingsAssistant({ message, messages });

    const changes = result?.changes ?? {};
    const goalsTextChanged = hasGoalsTextPatch(changes.user_profile_patch);
    if (goalsTextChanged && !Array.isArray(changes.checklist_categories)) {
      try {
        await ensureCurrentWeek();
        const data = await readTrackingData();
        const patchedProfile = applyGoalTextDerivation(
          mergeObjectPatch(data.user_profile ?? {}, changes.user_profile_patch ?? {}),
          { now: new Date() },
        );
        const checklistDraft = await proposeOnboardingChecklist({
          message: "Create an updated weekly workout checklist from my latest goals text.",
          messages,
          userProfile: patchedProfile,
          currentWeek: data.current_week ?? null,
          currentProposal: null,
        });
        changes.checklist_categories = checklistDraft.checklist_categories;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Checklist suggestion generation failed after goals_text update.", err);
      }
    }
    const hasProposal = hasPendingSettingsChanges(changes);
    const proposalId = hasProposal ? crypto.randomUUID() : null;
    const checklistPreview = Array.isArray(changes?.checklist_categories)
      ? formatChecklistCategoriesMarkdown(changes.checklist_categories, {
          heading: "Updated workout checklist to review before confirming:",
        })
      : "";
    const assistantMessage = [
      typeof result?.assistant_message === "string" ? result.assistant_message.trim() : "",
      checklistPreview,
      hasProposal ? "Proposed settings changes are ready. Confirm to apply." : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    res.json({
      ok: true,
      assistant_message: assistantMessage,
      followup_question: result.followup_question ?? null,
      requires_confirmation: hasProposal,
      proposal_id: proposalId,
      proposal: hasProposal ? changes : null,
      changes_applied: [],
      updated: null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/settings/confirm", async (req, res) => {
  try {
    const proposal = req.body?.proposal;
    if (!isValidSettingsProposal(proposal) || !hasPendingSettingsChanges(proposal)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid proposal." });
    }
    const applyModeRaw = typeof req.body?.apply_mode === "string" ? req.body.apply_mode.trim() : "now";
    const applyMode = applyModeRaw === "next_week" ? "next_week" : "now";

    const applied = await applySettingsChanges({ proposal, applyMode });
    res.json({
      ok: true,
      changes_applied: applied.changesApplied,
      updated: applied.updated,
      settings_version: applied.settingsVersion,
      effective_from: applied.effectiveFrom,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidationError =
      message === "Invalid settings proposal payload." ||
      message === "Checklist changes must only include workout or activity items.";
    res.status(isValidationError ? 400 : 500).json({ ok: false, error: message });
  }
});

app.post("/api/assistant/ingest", upload.single("image"), async (req, res) => {
  try {
    const file = req.file ?? null;
    if (file && !file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message && !file) return res.status(400).json({ ok: false, error: "Provide a message or an image." });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const eventId = typeof req.body?.event_id === "string" && req.body.event_id.trim() ? req.body.event_id.trim() : null;
    const clientRequestId =
      typeof req.body?.client_request_id === "string" && req.body.client_request_id.trim()
        ? req.body.client_request_id.trim()
        : null;
    let messages = [];
    if (typeof req.body?.messages === "string" && req.body.messages.trim()) {
      try {
        const parsed = JSON.parse(req.body.messages);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    }

    const decision = await decideIngestAction({
      message,
      hasImage: Boolean(file),
      imageBuffer: file?.buffer ?? null,
      imageMimeType: file?.mimetype ?? null,
      date,
      messages,
    });
    const confidence = typeof decision?.confidence === "number" ? decision.confidence : 0;
    const intent = decision?.intent ?? "clarify";

    if (confidence < 0.55 && intent !== "clarify") {
      return res.json({
        ok: true,
        action: "clarify",
        assistant_message:
          decision?.clarifying_question ??
          "Do you want to log food, log an activity, or ask a question?",
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer: null,
      });
    }

    if (intent === "question") {
      const questionText = decision?.question?.trim() || message;
      const answer = await askAssistant({ question: questionText, date, messages });
      return res.json({
        ok: true,
        action: "question",
        assistant_message: answer,
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer,
      });
    }

    if (intent === "food") {
      const payload = await logFoodFromInputs({
        file,
        descriptionText: message,
        notes: "",
        date,
        eventId,
        clientRequestId,
      });
      let mealResponse = summarizeFoodResult(payload);
      try {
        const generated = await composeMealEntryResponse({
          payload,
          date: payload?.date ?? date,
          messages,
        });
        const assistantMessage = formatMealEntryAssistantMessage(generated);
        mealResponse = {
          assistant_message: assistantMessage || summarizeFoodResult(payload).assistant_message,
          followup_question: generated?.followup_question ?? null,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Meal response generation failed, using fallback summary.", err);
      }

      return res.json({
        ok: true,
        action: "food",
        assistant_message: mealResponse.assistant_message,
        followup_question: mealResponse.followup_question,
        food_result: payload,
        activity_updates: null,
        answer: null,
        date: payload?.date ?? null,
        log_action: payload?.log_action ?? null,
      });
    }

    if (intent === "activity") {
      const currentWeek = await ensureCurrentWeek();
      const { resolved, errors } = resolveActivitySelections(decision?.activity?.selections, currentWeek);
      if (!resolved.length || errors.length) {
        return res.json({
          ok: true,
          action: "clarify",
          assistant_message:
            decision?.activity?.followup_question ??
            decision?.clarifying_question ??
            "Which checklist item should I log this under?",
          followup_question: null,
          food_result: null,
          activity_updates: null,
          answer: null,
        });
      }

      const updates = resolved.map((u) => ({
        category: u.category,
        index: u.index,
        checked: true,
        details: u.details,
      }));
      const hasExistingEntries = updates.some((u) => isExistingActivityEntry(currentWeek, u));

      const updatedWeek = await updateCurrentWeekItems(updates);
      const summarizedWeek = await refreshCurrentWeekSummaryForActivity(updatedWeek);

      return res.json({
        ok: true,
        action: "activity",
        activity_log_state: hasExistingEntries ? "updated" : "saved",
        assistant_message: summarizeActivityUpdates(resolved),
        followup_question: decision?.activity?.followup_question ?? null,
        food_result: null,
        activity_updates: resolved,
        current_week: summarizedWeek,
        answer: null,
      });
    }

    return res.json({
      ok: true,
      action: "clarify",
      assistant_message:
        decision?.clarifying_question ?? "Do you want to log food, log an activity, or ask a question?",
      followup_question: null,
      food_result: null,
      activity_updates: null,
      answer: null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/food/events", async (req, res) => {
  try {
    const date = typeof req.query?.date === "string" && req.query.date.trim() ? req.query.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing query param: date" });
    const events = await getFoodEventsForDate(date);
    const totalsForDay = await getDailyFoodEventTotals(date);
    const logRow = await getFoodLogForDate(date);
    res.json({ ok: true, date, events, day_totals_from_events: totalsForDay, food_log: logRow });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/food/log", async (req, res) => {
  try {
    const limitRaw = typeof req.query?.limit === "string" ? req.query.limit.trim() : null;
    const from = typeof req.query?.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
    const to = typeof req.query?.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;
    const limit = limitRaw ? Number(limitRaw) : 0;
    const rows = await listFoodLog({ limit, from, to });
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/rollup", async (req, res) => {
  try {
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing field: date" });
    const overwrite = typeof req.body?.overwrite === "boolean" ? req.body.overwrite : false;
    const result = await rollupFoodLogFromEvents(date, { overwrite });
    res.json({ ok: true, date, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/sync", async (req, res) => {
  try {
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing field: date" });
    const onlyUnsynced = typeof req.body?.only_unsynced === "boolean" ? req.body.only_unsynced : true;
    const result = await syncFoodEventsToFoodLog({ date, onlyUnsynced });
    res.json({ ok: true, date, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/log", upload.single("image"), async (req, res) => {
  try {
    const file = req.file ?? null;
    if (file && !file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    const descriptionText = typeof req.body?.description === "string" ? req.body.description : "";
    const eventId = typeof req.body?.event_id === "string" && req.body.event_id.trim() ? req.body.event_id.trim() : null;
    const clientRequestId =
      typeof req.body?.client_request_id === "string" && req.body.client_request_id.trim()
        ? req.body.client_request_id.trim()
        : null;

    const payload = await logFoodFromInputs({ file, descriptionText, notes, date, eventId, clientRequestId });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isInputError =
      msg === "Provide either an image or a meal description." ||
      msg === "Missing nutrients" ||
      msg.startsWith("Invalid date:") ||
      msg.startsWith("Food event not found:") ||
      msg === "Invalid event id";
    res.status(isInputError ? 400 : 500).json({ ok: false, error: msg });
  }
});

app.post("/api/food/photo", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "Missing image file field: image" });
    if (!file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    const descriptionText = typeof req.body?.description === "string" ? req.body.description : "";
    const eventId = typeof req.body?.event_id === "string" && req.body.event_id.trim() ? req.body.event_id.trim() : null;
    const clientRequestId =
      typeof req.body?.client_request_id === "string" && req.body.client_request_id.trim()
        ? req.body.client_request_id.trim()
        : null;

    const payload = await logFoodFromInputs({ file, descriptionText, notes, date, eventId, clientRequestId });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isInputError =
      msg === "Provide either an image or a meal description." ||
      msg === "Missing nutrients" ||
      msg.startsWith("Invalid date:") ||
      msg.startsWith("Food event not found:") ||
      msg === "Invalid event id";
    res.status(isInputError ? 400 : 500).json({ ok: false, error: msg });
  }
});

app.post("/api/food/manual", async (req, res) => {
  try {
    const description =
      typeof req.body?.description === "string" && req.body.description.trim() ? req.body.description.trim() : null;
    if (!description) return res.status(400).json({ ok: false, error: "Missing field: description" });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    const eventId = typeof req.body?.event_id === "string" && req.body.event_id.trim() ? req.body.event_id.trim() : null;
    const clientRequestId =
      typeof req.body?.client_request_id === "string" && req.body.client_request_id.trim()
        ? req.body.client_request_id.trim()
        : null;

    const payload = await logFoodFromInputs({
      file: null,
      descriptionText: description,
      notes,
      date,
      eventId,
      clientRequestId,
    });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isInputError =
      msg === "Provide either an image or a meal description." ||
      msg === "Missing nutrients" ||
      msg.startsWith("Invalid date:") ||
      msg.startsWith("Food event not found:") ||
      msg === "Invalid event id";
    res.status(isInputError ? 400 : 500).json({ ok: false, error: msg });
  }
});

app.get("/api/fitness/current", async (_req, res) => {
  try {
    const current = await ensureCurrentWeek();
    res.json({ ok: true, current_week: current });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/fitness/current/item", async (req, res) => {
  try {
    const category = typeof req.body?.category === "string" ? req.body.category : null;
    const index = typeof req.body?.index === "number" ? req.body.index : Number(req.body?.index);
    const checked = typeof req.body?.checked === "boolean" ? req.body.checked : null;
    const details = typeof req.body?.details === "string" ? req.body.details : "";

    if (!category) return res.status(400).json({ ok: false, error: "Missing field: category" });
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ ok: false, error: "Invalid field: index" });
    if (checked === null) return res.status(400).json({ ok: false, error: "Missing field: checked" });

    const current = await updateCurrentWeekItem({ category, index, checked, details });
    const summarized = await refreshCurrentWeekSummaryForActivity(current);
    res.json({ ok: true, current_week: summarized });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/fitness/current/summary", async (req, res) => {
  try {
    const summary = typeof req.body?.summary === "string" ? req.body.summary : "";
    const current = await updateCurrentWeekSummary(summary);
    res.json({ ok: true, current_week: current });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/fitness/history", async (req, res) => {
  try {
    const limitRaw = typeof req.query?.limit === "string" ? req.query.limit : null;
    const limit = limitRaw ? Number(limitRaw) : 12;
    const weeks = await listFitnessWeeks({ limit });
    res.json({ ok: true, weeks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

async function start() {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    app.use(express.static(distDir, { index: false }));
    app.use(async (req, res) => {
      if (req.originalUrl.startsWith("/api")) {
        return res.status(404).json({ ok: false, error: "Not found" });
      }
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);

    app.use(async (req, res, next) => {
      try {
        const url = req.originalUrl;
        if (url.startsWith("/api")) {
          return res.status(404).json({ ok: false, error: "Not found" });
        }
        const template = await fs.readFile(path.join(clientRoot, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err);
        next(err);
      }
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Tracker listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
