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

export function looksLikeBulkFoodImportText(message) {
  if (typeof message !== "string") return false;
  const lower = message.toLowerCase();
  const uniqueDates = extractIsoDates(message).length;
  const hasImportCue = /\b(import|upload|migrate|backfill|historical|history|json|csv|data file|data\.json)\b/.test(lower);
  const hasStructuredCue =
    /"days"\s*:|^\s*[{[]/m.test(message) ||
    /\b(calories|protein|carbs|fat)\b[\s:=-]*\d+/i.test(message);

  if (hasImportCue && (uniqueDates >= 2 || hasStructuredCue || message.length >= 600)) return true;
  if (uniqueDates >= 4 && /\b(calories|protein|carbs|fat)\b/i.test(message)) return true;
  return false;
}

export function summarizeActivityUpdates(updates) {
  if (!updates.length) return "Logged activity.";
  const parts = updates.map((u) => (u.details ? `${u.label} (${u.details})` : u.label));
  return `Logged activity: ${parts.join("; ")}.`;
}

export async function refreshCurrentWeekSummaryForActivity(currentWeek) {
  const summary = generateWeeklyFitnessSummary(currentWeek);
  const previous = typeof currentWeek?.summary === "string" ? currentWeek.summary.trim() : "";
  if (summary.trim() === previous) return currentWeek;
  return updateCurrentWeekSummary(summary);
}

export function isExistingActivityEntry(currentWeek, update) {
  const item = currentWeek?.[update?.category]?.[update?.index];
  if (!item || typeof item !== "object") return false;
  const hasDetails = typeof item.details === "string" && item.details.trim().length > 0;
  return Boolean(item.checked) || hasDetails;
}
