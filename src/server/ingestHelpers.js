import { getFitnessCategoryKeys, resolveFitnessCategoryKey } from "../fitnessChecklist.js";
import { generateWeeklyFitnessSummary } from "../fitnessSummary.js";
import {
  addFoodEvent,
  getDailyTotalsForDate,
  getSuggestedLogDate,
  updateFoodEvent,
  updateCurrentWeekSummary,
} from "../trackingData.js";
import { estimateNutritionFromImage, estimateNutritionFromText } from "../visionNutrition.js";

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTextValue(value, { fallback = "" } = {}) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  return text.length ? text : fallback;
}

function normalizeDateOrNull(value) {
  const text = normalizeTextValue(value, { fallback: "" });
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid date: ${text}`);
  }
  return text;
}

function parseIngestEventId(value, { strict = true } = {}) {
  const text = normalizeTextValue(value);
  if (!text) return null;
  if (!UUID_LIKE_RE.test(text)) {
    if (strict) throw new Error("Invalid event id");
    return null;
  }
  return text;
}

export async function logFoodFromInputs({ file, descriptionText, notes, date, eventId = null, clientRequestId = null }) {
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

  const { event, day, log_action } = writeResult;
  const totalsForDay = await getDailyTotalsForDate(effectiveDate);

  return {
    ok: true,
    date: effectiveDate,
    event,
    estimate,
    day_totals: totalsForDay,
    day,
    log_action: log_action ?? (normalizedEventId ? "updated" : "created"),
  };
}

export function validateIngestActivityDecision(activity) {
  const result = {
    ok: true,
    errors: [],
  };
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    result.ok = false;
    result.errors.push("Missing activity selections.");
    return result;
  }

  const selections = Array.isArray(activity?.selections) ? activity.selections : null;
  if (!selections || !selections.length) {
    result.ok = false;
    result.errors.push("No activity selections.");
    return result;
  }

  for (const selection of selections) {
    if (!selection || typeof selection !== "object" || Array.isArray(selection)) {
      result.ok = false;
      result.errors.push("Invalid activity selection.");
      return result;
    }

    if (typeof selection?.category !== "string" || !selection.category.trim()) {
      result.ok = false;
      result.errors.push("Activity selection is missing category.");
      return result;
    }

    if (!Number.isInteger(selection?.index) || selection.index < 0) {
      result.ok = false;
      result.errors.push(`No valid checklist index for ${selection?.category || "activity"}.`);
      return result;
    }

    if (typeof selection?.label !== "string" || !selection.label.trim()) {
      result.ok = false;
      result.errors.push("Activity selection is missing label.");
      return result;
    }
  }

  return result;
}

export async function writeFoodEventFromIngestDecision({
  decision,
  file,
  requestDate = null,
  requestEventId = null,
  requestRecentFoodEventId = null,
  clientRequestId = null,
}) {
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new Error("Invalid food action payload.");
  }

  if (!decision.food || typeof decision.food !== "object" || Array.isArray(decision.food)) {
    throw new Error("Invalid food action payload.");
  }

  const foodDecision = decision.food;
  const requiresEstimate = foodDecision.requires_estimate === true;
  const description = normalizeTextValue(foodDecision.description);
  const estimatedDescription = normalizeTextValue(foodDecision.estimated_description);
  const descriptionForEstimator = description || estimatedDescription;
  const notes = normalizeTextValue(foodDecision.notes);
  const isCorrection = foodDecision.is_correction === true;
  // Prefer explicit request event id (client/UI context). Model event ids are best-effort only.
  const requestEventIdParsed = parseIngestEventId(requestEventId);
  const modelEventIdParsed = parseIngestEventId(foodDecision.event_id, { strict: false });
  const recentEventIdParsed = parseIngestEventId(requestRecentFoodEventId, { strict: false });
  const eventId = requestEventIdParsed || modelEventIdParsed || (isCorrection ? recentEventIdParsed : null);
  const date = normalizeDateOrNull(foodDecision.date) || normalizeDateOrNull(requestDate) || null;

  if (requiresEstimate && (!descriptionForEstimator || file)) {
    throw new Error("Food description is required for estimation.");
  }

  const payload = await logFoodFromInputs({
    file,
    descriptionText: descriptionForEstimator || "",
    notes,
    date,
    eventId,
    clientRequestId,
  });

  return payload;
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

export function resolveActivitySelections(selections, currentWeek) {
  const resolved = [];
  const errors = [];
  const dedupe = new Map();
  const categoryKeys = getFitnessCategoryKeys(currentWeek);

  if (!Array.isArray(selections) || selections.length === 0) {
    return { resolved, errors: ["No activity selections."] };
  }

  for (const sel of selections) {
    // Prefer explicit category/index, then fall back to label-based matching.
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

export function formatMealEntryAssistantMessage(sections) {
  const lines = [sections?.confirmation, sections?.nutrition_summary, sections?.day_fit_summary]
    .map((value) => (typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : ""))
    .filter(Boolean);
  return lines.join("\n\n");
}

export function summarizeFoodResult(payload) {
  const title = formatPlainText(payload?.estimate?.meal_title) || "meal";
  const date = formatPlainText(payload?.date);
  const totals = payload?.estimate?.totals ?? {};
  const dayTotals = payload?.day_totals ?? {};

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

export function summarizeActivityLoadForDate(currentWeek, date) {
  if (!currentWeek || typeof currentWeek !== "object") return null;
  if (!isIsoDateString(date)) return null;

  let sessions = 0;
  for (const categoryKey of getFitnessCategoryKeys(currentWeek)) {
    const list = Array.isArray(currentWeek?.[categoryKey]) ? currentWeek[categoryKey] : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const itemDate = typeof item.date === "string" ? item.date.trim() : "";
      if (item.completed === true && itemDate === date) sessions += 1;
    }
  }
  return sessions;
}

export function buildFoodAssistantMessage({ payload, sessionsToday = null }) {
  const totals = payload?.estimate?.totals ?? {};
  const dayTotals = payload?.day_totals ?? {};

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

  const mealParts = [calories, carbs, fat, protein, fiber].filter(Boolean);
  const dayParts = [dayCalories, dayCarbs, dayFat, dayProtein, dayFiber].filter(Boolean);

  const nutritionSummary = [
    mealParts.length ? `- Meal estimate: ${mealParts.join(", ")}` : "- Meal estimate: saved",
    dayParts.length ? `- Day totals: ${dayParts.join(", ")}` : "- Day totals: awaiting more entries",
  ].join("\n");

  const proteinValue = Number(dayTotals.protein_g);
  const carbValue = Number(dayTotals.carbs_g);
  const fiberValue = Number(dayTotals.fiber_g);
  const sessionCount = Number.isInteger(sessionsToday) && sessionsToday >= 0 ? sessionsToday : null;

  const activitySummary =
    sessionCount === null
      ? "Activity today: not available."
      : sessionCount === 0
        ? "Activity today: no sessions logged yet."
        : sessionCount === 1
          ? "Activity today: 1 session logged."
          : `Activity today: ${sessionCount} sessions logged.`;

  let fitSummary = "";
  if (sessionCount !== null && sessionCount >= 2) {
    fitSummary =
      (Number.isFinite(proteinValue) && proteinValue < 100) || (Number.isFinite(carbValue) && carbValue < 180)
        ? "Assessment: higher-activity day with intake currently light for recovery; prioritize protein and carbohydrate in the next meal."
        : "Assessment: higher-activity day with intake reasonably aligned for recovery if remaining meals stay balanced.";
  } else if (sessionCount === 1) {
    fitSummary =
      Number.isFinite(proteinValue) && proteinValue < 90
        ? "Assessment: moderate-activity day with protein still below a strong target; bias the next meal toward protein."
        : "Assessment: moderate-activity day with intake tracking well so far; keep protein and fiber steady in remaining meals.";
  } else {
    fitSummary =
      Number.isFinite(fiberValue) && fiberValue < 20
        ? "Assessment: lower-activity day with room to improve fiber density later in the day."
        : "Assessment: lower-activity day with intake profile generally balanced so far.";
  }

  return [nutritionSummary, `${activitySummary} ${fitSummary}`].join("\n\n");
}

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function shiftIsoDate(dateString, deltaDays) {
  if (!isIsoDateString(dateString)) return dateString;
  const [year, month, day] = dateString.split("-").map((part) => Number(part));
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function extractIsoDates(text) {
  const matches = typeof text === "string" ? text.match(/\b\d{4}-\d{2}-\d{2}\b/g) : [];
  return Array.from(new Set((matches ?? []).map((entry) => entry.trim())));
}

export function resolveClearFoodDate({ message, selectedDate }) {
  const baseDate = isIsoDateString(selectedDate) ? selectedDate.trim() : getSuggestedLogDate();
  const isoDates = extractIsoDates(message);
  if (isoDates.length === 1) return isoDates[0];

  const lower = typeof message === "string" ? message.toLowerCase() : "";
  if (/\byesterday\b/.test(lower)) return shiftIsoDate(baseDate, -1);
  return baseDate;
}

export function isClearFoodCommand(message) {
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  const hasClearVerb = /\b(clear|delete|remove|erase|reset)\b/.test(lower);
  if (!hasClearVerb) return false;
  const hasFoodCue = /\b(food|meal|entries|intake|calories|macros|food log|day totals?)\b/.test(lower);
  return hasFoodCue;
}

export function summarizeActivityUpdates(updates) {
  if (!updates.length) return "Logged activity.";
  const parts = updates.map((u) => (u.details ? `${u.label} (${u.details})` : u.label));
  return `Logged activity: ${parts.join("; ")}.`;
}

export async function refreshCurrentWeekSummaryForActivity(currentWeek) {
  const summary = generateWeeklyFitnessSummary(currentWeek);
  const previous =
    typeof currentWeek?.ai_summary === "string"
      ? currentWeek.ai_summary.trim()
      : typeof currentWeek?.summary === "string"
        ? currentWeek.summary.trim()
        : "";
  if (summary.trim() === previous) return currentWeek;
  return updateCurrentWeekSummary(summary);
}

export function isExistingActivityEntry(currentWeek, update) {
  const item = currentWeek?.[update?.category]?.[update?.index];
  if (!item || typeof item !== "object") return false;
  const hasDetails = typeof item.details === "string" && item.details.trim().length > 0;
  const hasDate = typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date.trim());
  return Boolean(item.completed) || hasDetails || hasDate;
}
