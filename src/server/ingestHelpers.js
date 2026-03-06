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

const SESSION_HINT_WORDS = ["another", "again", "next"];
const SESSION_NUMBER_WORDS = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};

const SESSION_KEYWORD_TO_TOKEN = new Map([
  ["glute", "glute"],
  ["glutes", "glute"],
  ["mobility", "mobility"],
  ["prehab", "mobility"],
]);

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

function normalizeWorkoutLabel(workout) {
  return typeof workout?.item === "string"
    ? workout.item.trim()
    : typeof workout?.name === "string"
      ? workout.name.trim()
      : "";
}

function buildWorkoutCatalog(currentWeek) {
  const categoryKeys = getFitnessCategoryKeys(currentWeek);
  const out = [];
  for (const category of categoryKeys) {
    const list = Array.isArray(currentWeek?.[category]) ? currentWeek[category] : [];
    for (let index = 0; index < list.length; index += 1) {
      const row = list[index];
      const label = normalizeWorkoutLabel(row);
      if (!label) continue;
      out.push({
        category,
        index,
        label,
        normalizedLabel: normalizeLabel(label),
        completed: row?.completed === true,
        order: out.length,
      });
    }
  }
  return out;
}

function parseSessionNumber(value) {
  const text = typeof value === "string" ? value.toLowerCase() : "";
  const explicitNumber = text.match(/\b(?:session|workout)\s*(?:#\s*)?(\d{1,2})\b/i);
  if (explicitNumber) return Number(explicitNumber[1]);
  const wordMatch = text.match(/\b(?:session|workout)\s*(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/i);
  if (!wordMatch) return null;
  return SESSION_NUMBER_WORDS[wordMatch[1]];
}

function extractSessionIndexFromLabel(normalizedLabel) {
  const match = normalizedLabel.match(/\bsession\s*(\d{1,2})\b/i);
  if (!match) return null;
  return Number(match[1]);
}

function inferSelectionFromMessageWithCatalog(message, catalog) {
  if (!catalog.length) return [];
  const text = typeof message === "string" ? message.toLowerCase() : "";
  if (!text) return [];
  if (!/\b(gym|workout|session)\b/.test(text)) return [];

  const sessionLikeEntries = catalog.filter((entry) => /\bsession\b/.test(entry.normalizedLabel));
  const pool = sessionLikeEntries.length ? sessionLikeEntries : catalog;

  const explicitSession = parseSessionNumber(text);
  if (explicitSession) {
    const explicitMatches = pool.filter((entry) => extractSessionIndexFromLabel(entry.normalizedLabel) === explicitSession);
    if (explicitMatches.length === 1) {
      const match = explicitMatches[0];
      return [{ category: match.category, index: match.index, label: match.label }];
    }
    if (explicitMatches.length > 1) return [];
  }

  for (const [keyword, normalizedKeyword] of SESSION_KEYWORD_TO_TOKEN.entries()) {
    if (!text.includes(keyword)) continue;
    const keywordMatches = pool.filter((entry) => entry.normalizedLabel.includes(normalizedKeyword));
    if (keywordMatches.length === 1) {
      const match = keywordMatches[0];
      return [{ category: match.category, index: match.index, label: match.label }];
    }
    if (keywordMatches.length > 1) {
      const incompleteKeywordMatches = keywordMatches.filter((entry) => !entry.completed);
      if (incompleteKeywordMatches.length === 1) {
        const match = incompleteKeywordMatches[0];
        return [{ category: match.category, index: match.index, label: match.label }];
      }
    }
  }

  const includesAnother = new RegExp(`\\b(?:${SESSION_HINT_WORDS.join("|")})\\b`, "i").test(text);
  if (!includesAnother) return [];

  const completedPoolEntries = pool.filter((entry) => entry.completed);
  if (completedPoolEntries.length) {
    const lastCompletedOrder = Math.max(...completedPoolEntries.map((entry) => entry.order));
    const nextEntry = pool.find((entry) => !entry.completed && entry.order > lastCompletedOrder);
    if (nextEntry) return [{ category: nextEntry.category, index: nextEntry.index, label: nextEntry.label }];
  }

  const incomplete = pool.filter((entry) => !entry.completed);
  if (incomplete.length === 1) {
    const match = incomplete[0];
    return [{ category: match.category, index: match.index, label: match.label }];
  }

  return [];
}

export function inferActivitySelectionFromMessage(message, currentWeek) {
  const catalog = buildWorkoutCatalog(currentWeek);
  return inferSelectionFromMessageWithCatalog(message, catalog);
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
  const summary = summarizeActivityContextForDate(currentWeek, date);
  return summary ? summary.sessions : null;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseDurationMinutes(text) {
  if (typeof text !== "string") return null;
  const lower = text.toLowerCase();
  let total = 0;
  let matched = false;

  const hourRegex = /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/g;
  for (const match of lower.matchAll(hourRegex)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    total += value * 60;
    matched = true;
  }

  const minuteRegex = /(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/g;
  for (const match of lower.matchAll(minuteRegex)) {
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    total += value;
    matched = true;
  }

  if (!matched) {
    const clockMatch = lower.match(/\b(\d{1,2})\s*:\s*(\d{2})\b/);
    if (clockMatch) {
      const hours = Number(clockMatch[1]);
      const minutes = Number(clockMatch[2]);
      if (Number.isFinite(hours) && Number.isFinite(minutes)) total = hours * 60 + minutes;
      matched = total > 0;
    }
  }

  if (!matched || total <= 0) return null;
  return Math.round(total);
}

function isLikelyEnduranceSession({ categoryKey, label, details }) {
  const category = normalizeLabel(categoryKey);
  if (category === "cardio" || category === "endurance") return true;
  const text = `${normalizeLabel(label)} ${normalizeLabel(details)}`;
  return /\b(run|walk|jog|cycle|bike|ride|swim|row|rowing|hike|elliptical|stair|cardio|aerobic|endurance)\b/.test(text);
}

export function summarizeActivityContextForDate(currentWeek, date) {
  if (!currentWeek || typeof currentWeek !== "object") return null;
  if (!isIsoDateString(date)) return null;

  let sessions = 0;
  let totalMinutes = 0;
  let enduranceSessions = 0;
  let enduranceMinutes = 0;
  for (const categoryKey of getFitnessCategoryKeys(currentWeek)) {
    const list = Array.isArray(currentWeek?.[categoryKey]) ? currentWeek[categoryKey] : [];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const itemDate = typeof item.date === "string" ? item.date.trim() : "";
      if (item.completed !== true || itemDate !== date) continue;
      sessions += 1;
      const label = normalizeWorkoutLabel(item);
      const details = normalizeTextValue(item?.details);
      const minutes = parseDurationMinutes(details);
      if (typeof minutes === "number" && minutes > 0) {
        totalMinutes += minutes;
      }
      if (isLikelyEnduranceSession({ categoryKey, label, details })) {
        enduranceSessions += 1;
        if (typeof minutes === "number" && minutes > 0) enduranceMinutes += minutes;
      }
    }
  }

  return {
    sessions,
    total_minutes: totalMinutes > 0 ? totalMinutes : null,
    endurance_sessions: enduranceSessions,
    endurance_minutes: enduranceMinutes > 0 ? enduranceMinutes : null,
  };
}

function gatherUserPreferenceText(userContext) {
  const safe = safeObject(userContext);
  const profile = safeObject(safe.profile);
  const rules = safeObject(safe.rules);
  const dietPhilosophy = safeObject(rules.diet_philosophy || safe.diet_philosophy);
  const fitnessPhilosophy = safeObject(rules.fitness_philosophy || safe.fitness_philosophy);

  const parts = [];
  for (const value of [profile.general, profile.fitness, profile.diet]) {
    if (typeof value === "string" && value.trim()) parts.push(value.trim());
  }
  if (Object.keys(dietPhilosophy).length) parts.push(JSON.stringify(dietPhilosophy));
  if (Object.keys(fitnessPhilosophy).length) parts.push(JSON.stringify(fitnessPhilosophy));
  return parts.join("\n").toLowerCase();
}

function inferPreferenceSignals(userContext) {
  const text = gatherUserPreferenceText(userContext);
  return {
    energy_focus:
      /\b(calm surplus|surplus|energy sufficiency|steady energy|energy availability|consistency)\b/.test(text),
    endurance_focus: /\b(endurance|cardio|aerobic|running|cycling|long run|long ride)\b/.test(text),
    moderate_protein_focus:
      /\b(moderate protein|lower protein|avoid high protein|slow atrophy|atrophy|protein moderation)\b/.test(text),
  };
}

function buildDayFitLine({ dayTotals, activityContext, userContext }) {
  const signals = inferPreferenceSignals(userContext);
  const calories = toNumberOrNull(dayTotals?.calories);
  const carbs = toNumberOrNull(dayTotals?.carbs_g);
  const protein = toNumberOrNull(dayTotals?.protein_g);
  const fiber = toNumberOrNull(dayTotals?.fiber_g);

  const sessions = Number.isInteger(activityContext?.sessions)
    ? activityContext.sessions
    : Number.isInteger(activityContext)
      ? activityContext
      : 0;
  const enduranceSessions = Number.isInteger(activityContext?.endurance_sessions) ? activityContext.endurance_sessions : 0;
  const enduranceMinutes = toNumberOrNull(activityContext?.endurance_minutes);
  const enduranceLoad = enduranceSessions > 0 || (typeof enduranceMinutes === "number" && enduranceMinutes >= 45);

  const parts = [];
  if (signals.energy_focus && typeof calories === "number") {
    if (calories < 1900) parts.push("Energy intake is still light for your steady-energy/surplus preference.");
    else if (calories < 2800) parts.push("Energy intake is trending toward your steady-energy target.");
    else parts.push("Energy intake is strong for your surplus-oriented target.");
  }

  if (typeof carbs === "number") {
    if (carbs >= 220 && (enduranceLoad || signals.endurance_focus)) {
      const enduranceDetail =
        typeof enduranceMinutes === "number" && enduranceMinutes >= 45
          ? ` and ~${Math.round(enduranceMinutes)} min endurance work`
          : enduranceSessions > 0
            ? " and endurance work"
            : "";
      parts.push(`Higher-carb intake looks well matched to today's activity${enduranceDetail}.`);
    } else if (carbs >= 220) {
      parts.push("Carb intake is high versus logged activity so far.");
    } else if (carbs < 150 && enduranceLoad) {
      parts.push("Carbs are on the lighter side for today's endurance load.");
    }
  }

  if (signals.moderate_protein_focus && typeof protein === "number") {
    if (protein <= 95) parts.push(`Protein is staying moderate at ${Math.round(protein)} g.`);
    else if (protein > 120) parts.push(`Protein is elevated at ${Math.round(protein)} g versus your moderate-protein preference.`);
  }

  if (typeof fiber === "number" && fiber < 15) {
    parts.push("Fiber is still low for the day.");
  }

  if (!parts.length) {
    if (sessions > 0) {
      return `Day fit: nutrition is on track so far relative to ${sessions} logged activity session${sessions === 1 ? "" : "s"}.`;
    }
    return "Day fit: nutrition is building; more entries through the day will improve the read on target alignment.";
  }

  return `Day fit: ${parts.join(" ")}`;
}

export function buildFoodAssistantMessage({ payload, sessionsToday = null, activityContext = null, userContext = null }) {
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

  const mealParts = [calories, carbs, fat, protein, fiber].filter(Boolean);
  const dayParts = [dayCalories, dayCarbs, dayFat, dayProtein, dayFiber].filter(Boolean);

  const lines = [];
  const mealLine = mealParts.length ? `Estimated meal: ${mealParts.join(", ")}.` : "Estimated meal saved.";
  const dayLine = dayParts.length ? `Day total${date ? ` (${date})` : ""}: ${dayParts.join(", ")}.` : "Day totals are still building.";
  lines.push(mealLine, dayLine);

  const resolvedActivityContext =
    activityContext && typeof activityContext === "object"
      ? activityContext
      : Number.isInteger(sessionsToday)
        ? { sessions: sessionsToday }
        : null;
  lines.push(buildDayFitLine({ dayTotals, activityContext: resolvedActivityContext, userContext }));

  return lines.join("\n");
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
    typeof currentWeek?.summary === "string" ? currentWeek.summary.trim() : "";
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
