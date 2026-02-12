import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import { getFitnessCategoryKeys, getFitnessCategoryLabel, resolveFitnessCategoryKey } from "./fitnessChecklist.js";
import { getOpenAIClient } from "./openaiClient.js";
import { readTrackingDataPostgres, writeTrackingDataPostgres } from "./trackingDataPostgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, "..");
const TRACKING_BACKEND = String(process.env.TRACKING_BACKEND || "json").toLowerCase();
const USE_POSTGRES_BACKEND = TRACKING_BACKEND === "postgres";
const LEGACY_TRACKING_FILE = process.env.TRACKING_DATA_FILE
  ? path.resolve(process.env.TRACKING_DATA_FILE)
  : path.resolve(DEFAULT_DATA_DIR, "tracking-data.json");
const TRACKING_FOOD_FILE = process.env.TRACKING_FOOD_FILE
  ? path.resolve(process.env.TRACKING_FOOD_FILE)
  : path.resolve(DEFAULT_DATA_DIR, "tracking-food.json");
const TRACKING_ACTIVITY_FILE = process.env.TRACKING_ACTIVITY_FILE
  ? path.resolve(process.env.TRACKING_ACTIVITY_FILE)
  : path.resolve(DEFAULT_DATA_DIR, "tracking-activity.json");
const TRACKING_PROFILE_FILE = process.env.TRACKING_PROFILE_FILE
  ? path.resolve(process.env.TRACKING_PROFILE_FILE)
  : path.resolve(DEFAULT_DATA_DIR, "tracking-profile.json");
const TRACKING_RULES_FILE = process.env.TRACKING_RULES_FILE
  ? path.resolve(process.env.TRACKING_RULES_FILE)
  : path.resolve(DEFAULT_DATA_DIR, "tracking-rules.json");
const USE_LEGACY_FILE =
  Boolean(process.env.TRACKING_DATA_FILE) &&
  !process.env.TRACKING_FOOD_FILE &&
  !process.env.TRACKING_ACTIVITY_FILE &&
  !process.env.TRACKING_PROFILE_FILE &&
  !process.env.TRACKING_RULES_FILE;
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_FOOD_LOG_NOTE_PREFIX = "Daily summary:";
const LEGACY_AUTO_FOOD_LOG_NOTES = new Set(["Auto-updated from food_events.", "Auto-generated from food_events."]);

const FoodDayFlagsSchema = z.object({
  status: z.enum(["🟢", "🟡", "❌", "⚪"]),
  healthy: z.enum(["🟢", "🟡", "❌", "⚪"]),
  reasoning: z.string(),
});

const FoodDayFlagsFormat = zodTextFormat(FoodDayFlagsSchema, "food_day_flags");

function seattleParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    tz: get("timeZoneName"), // e.g. "GMT-8"
  };
}

function offsetFromTzName(tzName) {
  if (!tzName || !tzName.startsWith("GMT")) return "Z";
  const sign = tzName[3] === "-" ? "-" : "+";
  const rest = tzName.slice(4); // "8" or "05:30"
  const [hRaw, mRaw] = rest.split(":");
  const h = String(hRaw ?? "0").padStart(2, "0");
  const m = String(mRaw ?? "00").padStart(2, "0");
  return `${sign}${h}:${m}`;
}

export function formatSeattleIso(date = new Date()) {
  const p = seattleParts(date);
  const offset = offsetFromTzName(p.tz);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}${offset}`;
}

export function getSeattleDateString(date = new Date()) {
  const p = seattleParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

export function getSuggestedLogDate(now = new Date()) {
  const p = seattleParts(now);
  const hour = Number(p.hour);
  const rolloverCutoffHour = 5;
  const effective = hour < rolloverCutoffHour ? new Date(now.getTime() - 6 * 60 * 60 * 1000) : now;
  return getSeattleDateString(effective);
}

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeCycleHormonalContext(value) {
  const safe = asObject(value);
  return {
    relevant: safe.relevant === true,
    context_type: typeof safe.context_type === "string" ? safe.context_type : "",
    phase_or_cycle_day: typeof safe.phase_or_cycle_day === "string" ? safe.phase_or_cycle_day : null,
    symptom_patterns: asStringArray(safe.symptom_patterns),
    training_nutrition_adjustments: asStringArray(safe.training_nutrition_adjustments),
  };
}

function normalizeUserProfile(value) {
  const safe = asObject(value);
  const safeModules = asObject(safe.modules);
  const transFromProfile = asObject(safeModules.trans_care);

  return {
    ...safe,
    schema_version: Number.isInteger(safe.schema_version) ? safe.schema_version : 1,
    general: asObject(safe.general),
    medical: {
      ...asObject(safe.medical),
      history: asStringArray(asObject(safe.medical).history),
      medications: asStringArray(asObject(safe.medical).medications),
      surgeries: asStringArray(asObject(safe.medical).surgeries),
      allergies: asStringArray(asObject(safe.medical).allergies),
      cycle_hormonal_context: normalizeCycleHormonalContext(asObject(asObject(safe.medical).cycle_hormonal_context)),
    },
    nutrition: {
      ...asObject(safe.nutrition),
      food_restrictions: asStringArray(asObject(safe.nutrition).food_restrictions),
      food_allergies: asStringArray(asObject(safe.nutrition).food_allergies),
      preferences: asStringArray(asObject(safe.nutrition).preferences),
      recipes_refs: asStringArray(asObject(safe.nutrition).recipes_refs),
    },
    fitness: {
      ...asObject(safe.fitness),
      experience_level: typeof asObject(safe.fitness).experience_level === "string" ? asObject(safe.fitness).experience_level : "",
      injuries_limitations: asStringArray(asObject(safe.fitness).injuries_limitations),
      equipment_access: asStringArray(asObject(safe.fitness).equipment_access),
    },
    goals: {
      ...asObject(safe.goals),
      diet_goals: asStringArray(asObject(safe.goals).diet_goals),
      fitness_goals: asStringArray(asObject(safe.goals).fitness_goals),
      health_goals: asStringArray(asObject(safe.goals).health_goals),
    },
    behavior: {
      ...asObject(safe.behavior),
      motivation_barriers: asStringArray(asObject(safe.behavior).motivation_barriers),
      adherence_triggers: asStringArray(asObject(safe.behavior).adherence_triggers),
    },
    modules: {
      ...safeModules,
      trans_care: transFromProfile,
    },
    assistant_preferences: {
      ...asObject(safe.assistant_preferences),
      tone: typeof asObject(safe.assistant_preferences).tone === "string" ? asObject(safe.assistant_preferences).tone : "supportive",
      verbosity:
        typeof asObject(safe.assistant_preferences).verbosity === "string"
          ? asObject(safe.assistant_preferences).verbosity
          : "concise",
    },
    metadata: {
      ...asObject(safe.metadata),
      updated_at: typeof asObject(safe.metadata).updated_at === "string" ? asObject(safe.metadata).updated_at : null,
      settings_version: Number.isInteger(asObject(safe.metadata).settings_version)
        ? asObject(safe.metadata).settings_version
        : 1,
    },
  };
}

function normalizeProfileDataPayload(data) {
  if (!data || typeof data !== "object") return data;

  const userProfile = normalizeUserProfile(data.user_profile);
  data.user_profile = userProfile;
  delete data.transition_context;
  return data;
}

function normalizeChecklistCategory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const item = typeof entry?.item === "string" ? entry.item.trim() : "";
      if (!item) return null;
      return {
        item,
        checked: entry?.checked === true,
        details: typeof entry?.details === "string" ? entry.details : "",
      };
    })
    .filter(Boolean);
}

function normalizeFitnessWeekShape(value, { requireWeekStart = true } = {}) {
  const week = asObject(value);
  const weekStart = isIsoDateString(week.week_start) ? week.week_start : null;
  if (requireWeekStart && !weekStart) return null;

  const weekLabelRaw = typeof week.week_label === "string" ? week.week_label.trim() : "";
  const normalized = {
    ...(weekStart ? { week_start: weekStart } : {}),
    week_label: weekLabelRaw || (weekStart ? weekLabelFromStart(weekStart) : ""),
    summary: typeof week.summary === "string" ? week.summary : "",
  };

  const categoryOrder = getFitnessCategoryKeys(week);
  const labelsRaw = asObject(week.category_labels);
  const categoryLabels = {};
  for (const key of categoryOrder) {
    normalized[key] = normalizeChecklistCategory(week[key]);
    const label = typeof labelsRaw[key] === "string" ? labelsRaw[key].trim() : "";
    if (label) categoryLabels[key] = label;
  }
  if (categoryOrder.length) normalized.category_order = categoryOrder;
  if (Object.keys(categoryLabels).length) normalized.category_labels = categoryLabels;

  return normalized;
}

function normalizeChecklistTemplate(value) {
  const safe = asObject(value);
  const categoryOrder = Array.isArray(safe.category_order)
    ? safe.category_order.filter((key) => typeof key === "string" && key.trim())
    : [];
  if (!categoryOrder.length) return null;

  const labelsRaw = asObject(safe.category_labels);
  const out = {
    category_order: [],
    category_labels: {},
  };

  for (const keyRaw of categoryOrder) {
    const key = keyRaw.trim();
    if (!key || out.category_order.includes(key)) continue;
    const list = Array.isArray(safe[key]) ? safe[key] : [];
    const items = list
      .map((entry) => (typeof entry?.item === "string" ? entry.item.trim() : ""))
      .filter(Boolean)
      .map((item) => ({ item }));
    if (!items.length) continue;
    out.category_order.push(key);
    out[key] = items;
    const label = typeof labelsRaw[key] === "string" ? labelsRaw[key].trim() : "";
    if (label) out.category_labels[key] = label;
  }

  if (!out.category_order.length) return null;
  if (!Object.keys(out.category_labels).length) delete out.category_labels;
  return out;
}

function sanitizeActivityDataPayload(data) {
  if (!data || typeof data !== "object") return data;

  data.current_week = normalizeFitnessWeekShape(data.current_week, { requireWeekStart: false });

  const fitnessWeeks = Array.isArray(data.fitness_weeks) ? data.fitness_weeks : [];
  data.fitness_weeks = fitnessWeeks
    .map((week) => normalizeFitnessWeekShape(week, { requireWeekStart: true }))
    .filter(Boolean);

  const metadata = asObject(data.metadata);
  const template = normalizeChecklistTemplate(metadata.checklist_template);
  if (template) metadata.checklist_template = template;
  else delete metadata.checklist_template;
  data.metadata = metadata;

  return data;
}

function parseIsoDateAsUtcNoon(dateStr) {
  if (!isIsoDateString(dateStr)) throw new Error(`Invalid date string: ${dateStr}`);
  return new Date(`${dateStr}T12:00:00Z`);
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekStartMonday(dateStr) {
  const d = parseIsoDateAsUtcNoon(dateStr);
  const day = d.getUTCDay(); // 0=Sun,1=Mon,...6=Sat
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return formatIsoDate(d);
}

function weekLabelFromStart(weekStart) {
  const start = parseIsoDateAsUtcNoon(weekStart);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(start)}-${fmt(end)}`;
}

async function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  const tmpPath = path.join(dir, `.tmp.${path.basename(filePath)}.${crypto.randomUUID()}`);
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrDefault(filePath, fallback = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

function splitTrackingData(data) {
  const {
    metadata,
    food_log,
    food_events,
    current_week,
    fitness_weeks,
    diet_philosophy,
    fitness_philosophy,
    user_profile,
    ...rest
  } = data ?? {};

  const rulesMeta = typeof metadata === "object" && metadata ? { ...metadata } : {};
  rulesMeta.data_files = {
    food: path.basename(TRACKING_FOOD_FILE),
    activity: path.basename(TRACKING_ACTIVITY_FILE),
    profile: path.basename(TRACKING_PROFILE_FILE),
    rules: path.basename(TRACKING_RULES_FILE),
  };
  if (rulesMeta.data_file === "tracking-data.json") {
    rulesMeta.data_file = "tracking-data.json (legacy)";
  }

  return {
    food: {
      food_log: Array.isArray(food_log) ? food_log : [],
      food_events: Array.isArray(food_events) ? food_events : [],
    },
    activity: {
      current_week: current_week && typeof current_week === "object" ? current_week : null,
      fitness_weeks: Array.isArray(fitness_weeks) ? fitness_weeks : [],
    },
    profile: {
      user_profile: user_profile && typeof user_profile === "object" ? user_profile : {},
    },
    rules: {
      metadata: rulesMeta,
      diet_philosophy: diet_philosophy && typeof diet_philosophy === "object" ? diet_philosophy : {},
      fitness_philosophy: fitness_philosophy && typeof fitness_philosophy === "object" ? fitness_philosophy : {},
      ...rest,
    },
  };
}

function mergeTrackingData({ food, activity, profile, rules }) {
  return {
    ...(rules ?? {}),
    ...(food ?? {}),
    ...(activity ?? {}),
    ...(profile ?? {}),
  };
}

async function writeSplitFiles(split) {
  await Promise.all([
    atomicWriteJson(TRACKING_FOOD_FILE, split.food),
    atomicWriteJson(TRACKING_ACTIVITY_FILE, split.activity),
    atomicWriteJson(TRACKING_PROFILE_FILE, split.profile),
    atomicWriteJson(TRACKING_RULES_FILE, split.rules),
  ]);
}

function normalizeLocalRules(rulesData) {
  return splitTrackingData(asObject(rulesData)).rules;
}

async function readLocalRulesData() {
  const rawRules = await readJsonOrDefault(TRACKING_RULES_FILE, {});
  return normalizeLocalRules(rawRules);
}

async function writeLocalRulesData(data) {
  const split = splitTrackingData(asObject(data));
  await atomicWriteJson(TRACKING_RULES_FILE, split.rules);
}

async function ensureSplitFiles() {
  const [foodExists, activityExists, profileExists, rulesExists] = await Promise.all([
    fileExists(TRACKING_FOOD_FILE),
    fileExists(TRACKING_ACTIVITY_FILE),
    fileExists(TRACKING_PROFILE_FILE),
    fileExists(TRACKING_RULES_FILE),
  ]);

  if (foodExists || activityExists || profileExists || rulesExists) {
    return;
  }

  const legacyExists = await fileExists(LEGACY_TRACKING_FILE);
  if (!legacyExists) {
    await writeSplitFiles(
      splitTrackingData({
        metadata: {},
        food_log: [],
        food_events: [],
        current_week: null,
        fitness_weeks: [],
        diet_philosophy: {},
        fitness_philosophy: {},
        user_profile: {},
      }),
    );
    return;
  }

  const legacyData = await readJsonOrDefault(LEGACY_TRACKING_FILE, {});
  normalizeProfileDataPayload(legacyData);
  const split = splitTrackingData(legacyData);
  await writeSplitFiles(split);
}

export async function readTrackingData() {
  if (USE_POSTGRES_BACKEND) {
    const [userData, localRules] = await Promise.all([readTrackingDataPostgres(), readLocalRulesData()]);
    const merged = {
      ...asObject(userData),
      ...asObject(localRules),
    };
    sanitizeActivityDataPayload(merged);
    normalizeProfileDataPayload(merged);
    return merged;
  }

  if (USE_LEGACY_FILE) {
    const raw = await fs.readFile(LEGACY_TRACKING_FILE, "utf8");
    const parsed = asObject(JSON.parse(raw));
    sanitizeActivityDataPayload(parsed);
    normalizeProfileDataPayload(parsed);
    return parsed;
  }
  await ensureSplitFiles();
  const [food, activity, profile, rules] = await Promise.all([
    readJsonOrDefault(TRACKING_FOOD_FILE, {}),
    readJsonOrDefault(TRACKING_ACTIVITY_FILE, {}),
    readJsonOrDefault(TRACKING_PROFILE_FILE, {}),
    readJsonOrDefault(TRACKING_RULES_FILE, {}),
  ]);
  const merged = mergeTrackingData({ food, activity, profile, rules });
  sanitizeActivityDataPayload(merged);
  normalizeProfileDataPayload(merged);
  return merged;
}

export async function writeTrackingData(data) {
  const payload = asObject(data);
  sanitizeActivityDataPayload(payload);
  normalizeProfileDataPayload(payload);

  if (USE_POSTGRES_BACKEND) {
    await writeTrackingDataPostgres(payload);
    await writeLocalRulesData(payload);
    return;
  }

  if (USE_LEGACY_FILE) {
    await atomicWriteJson(LEGACY_TRACKING_FILE, payload);
    return;
  }
  await ensureSplitFiles();
  const split = splitTrackingData(payload);
  await writeSplitFiles(split);
}

function ensureCurrentWeekInData(data, now = new Date()) {
  const seattleDate = getSeattleDateString(now);
  const weekStart = getWeekStartMonday(seattleDate);

  const hasCurrent = data.current_week && typeof data.current_week === "object";
  if (hasCurrent && data.current_week.week_start === weekStart) {
    return { current_week: data.current_week, changed: false };
  }

  if (!Array.isArray(data.fitness_weeks)) data.fitness_weeks = [];

  const prevCurrent = hasCurrent ? data.current_week : null;
  if (prevCurrent?.week_start && !data.fitness_weeks.some((w) => w && w.week_start === prevCurrent.week_start)) {
    data.fitness_weeks.push(prevCurrent);
  }

  const metadata = asObject(data.metadata);
  const persistedTemplate = normalizeChecklistTemplate(metadata.checklist_template);
  const template = asObject(persistedTemplate ?? prevCurrent ?? data.fitness_weeks[data.fitness_weeks.length - 1] ?? {});
  const categoryOrder = getFitnessCategoryKeys(template);
  const templateLabels = asObject(template.category_labels);
  const resetCategory = (key) => {
    const arr = Array.isArray(template[key]) ? template[key] : [];
    return arr
      .map((it) => ({
        item: typeof it?.item === "string" ? it.item : "",
        checked: false,
        details: "",
      }))
      .filter((it) => it.item);
  };

  const nextWeek = {
    week_start: weekStart,
    week_label: weekLabelFromStart(weekStart),
    summary: "",
  };
  for (const key of categoryOrder) {
    nextWeek[key] = resetCategory(key);
  }
  if (categoryOrder.length) nextWeek.category_order = categoryOrder;
  if (Object.keys(templateLabels).length) nextWeek.category_labels = templateLabels;

  data.current_week = nextWeek;

  return { current_week: data.current_week, changed: true };
}

export async function ensureCurrentWeek(now = new Date()) {
  const data = await readTrackingData();
  const { current_week, changed } = ensureCurrentWeekInData(data, now);
  if (changed) {
    if (data.metadata && typeof data.metadata === "object") {
      data.metadata.last_updated = formatSeattleIso(now);
    }
    await writeTrackingData(data);
  }
  return current_week;
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sum(values) {
  return values.reduce((acc, v) => acc + toNumber(v), 0);
}

function sumNullable(values) {
  if (values.some((v) => v === null || v === undefined)) return null;
  return sum(values);
}

function computeFoodTotalsFromNutrients(nutrients) {
  return {
    calories: sum(nutrients.map((n) => n.calories)),
    fat_g: sum(nutrients.map((n) => n.fat_g)),
    carbs_g: sum(nutrients.map((n) => n.carbs_g)),
    protein_g: sum(nutrients.map((n) => n.protein_g)),
    // Null means "unknown/incomplete" rather than "zero".
    fiber_g: sumNullable(nutrients.map((n) => n.fiber_g)),
    potassium_mg: sumNullable(nutrients.map((n) => n.potassium_mg)),
    magnesium_mg: sumNullable(nutrients.map((n) => n.magnesium_mg)),
    omega3_mg: sumNullable(nutrients.map((n) => n.omega3_mg)),
    calcium_mg: sumNullable(nutrients.map((n) => n.calcium_mg)),
    iron_mg: sumNullable(nutrients.map((n) => n.iron_mg)),
  };
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 128) throw new Error("Invalid idempotency key: too long");
  return trimmed;
}

const FOOD_NUTRIENT_KEYS = [
  "calories",
  "fat_g",
  "carbs_g",
  "protein_g",
  "fiber_g",
  "potassium_mg",
  "magnesium_mg",
  "omega3_mg",
  "calcium_mg",
  "iron_mg",
];

function nutrientSignature(nutrients) {
  if (!nutrients || typeof nutrients !== "object") return "";
  return FOOD_NUTRIENT_KEYS.map((key) => {
    const value = nutrients[key];
    if (value === null) return `${key}:null`;
    if (typeof value === "number" && Number.isFinite(value)) return `${key}:${value.toFixed(6)}`;
    return `${key}:x`;
  }).join("|");
}

function normalizeFoodEventText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function findRecentDuplicateFoodEvent(events, candidate, { withinMs = 15000 } = {}) {
  const candidateLoggedAt = Date.parse(candidate?.logged_at ?? "");
  if (!Number.isFinite(candidateLoggedAt)) return null;
  const candidateNutrients = nutrientSignature(candidate?.nutrients);

  for (const event of Array.isArray(events) ? events : []) {
    if (!event || event.date !== candidate.date) continue;
    if ((event.source ?? null) !== (candidate.source ?? null)) continue;
    if (normalizeFoodEventText(event.description) !== normalizeFoodEventText(candidate.description)) continue;
    if (normalizeFoodEventText(event.input_text) !== normalizeFoodEventText(candidate.input_text)) continue;
    if (normalizeFoodEventText(event.notes) !== normalizeFoodEventText(candidate.notes)) continue;
    if (nutrientSignature(event.nutrients) !== candidateNutrients) continue;

    const eventLoggedAt = Date.parse(event.logged_at ?? "");
    if (!Number.isFinite(eventLoggedAt)) continue;
    if (Math.abs(candidateLoggedAt - eventLoggedAt) <= withinMs) return event;
  }
  return null;
}

function dayOfWeekFromDateString(dateStr) {
  const d = parseIsoDateAsUtcNoon(dateStr);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d);
}

function isAutoGeneratedFoodLogNote(note) {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (!trimmed) return true;
  if (LEGACY_AUTO_FOOD_LOG_NOTES.has(trimmed)) return true;
  return trimmed.startsWith(AUTO_FOOD_LOG_NOTE_PREFIX);
}

function parseNumericRange(value) {
  if (typeof value === "number" && Number.isFinite(value)) return { min: value, max: value };
  if (typeof value !== "string") return null;
  const nums = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  if (nums.length === 1) return { min: nums[0], max: nums[0] };
  const [a, b] = nums;
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

function shiftIsoDate(dateStr, deltaDays) {
  const d = parseIsoDateAsUtcNoon(dateStr);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return formatIsoDate(d);
}

function getWeekForDate(data, date) {
  const weekStart = getWeekStartMonday(date);
  const currentWeek = data?.current_week && typeof data.current_week === "object" ? data.current_week : null;
  if (currentWeek?.week_start === weekStart) return currentWeek;
  const weeks = Array.isArray(data?.fitness_weeks) ? data.fitness_weeks : [];
  for (let i = weeks.length - 1; i >= 0; i -= 1) {
    const week = weeks[i];
    if (week?.week_start === weekStart) return week;
  }
  return null;
}

function summarizeActivityContextForDate(data, date) {
  const week = getWeekForDate(data, date);
  if (!week) return null;

  const hardPattern = /\b(quality|hard|long|race|threshold|tempo|interval|marathon|half marathon|heavy)\b/i;
  const keys = getFitnessCategoryKeys(week);
  const categoryParts = [];
  let totalChecked = 0;
  let hardSignals = 0;

  for (const key of keys) {
    const list = Array.isArray(week?.[key]) ? week[key] : [];
    const checkedItems = list.filter((it) => it?.checked === true);
    if (!checkedItems.length) continue;
    totalChecked += checkedItems.length;
    const label = getFitnessCategoryLabel(week, key);
    categoryParts.push(`${label} ${checkedItems.length}`);
    for (const item of checkedItems) {
      const hay = `${item?.item ?? ""} ${item?.details ?? ""}`;
      if (hardPattern.test(hay)) hardSignals += 1;
    }
  }

  if (!totalChecked) return null;
  return { totalChecked, categoryParts, hardSignals };
}

function groupEventsByDate(events) {
  const map = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    if (!isIsoDateString(event?.date)) continue;
    const list = map.get(event.date) ?? [];
    list.push(event);
    map.set(event.date, list);
  }
  return map;
}

function buildDailyFoodLogAutoNote(data, date, row, context = {}) {
  const eventsByDate = context?.eventsByDate instanceof Map ? context.eventsByDate : groupEventsByDate(data?.food_events);
  const rowByDate =
    context?.rowByDate instanceof Map
      ? context.rowByDate
      : new Map((Array.isArray(data?.food_log) ? data.food_log : []).filter((r) => isIsoDateString(r?.date)).map((r) => [r.date, r]));

  const events = eventsByDate.get(date) ?? [];
  const descriptionCounts = new Map();
  for (const event of events) {
    const label = typeof event?.description === "string" ? event.description.trim() : "";
    if (!label) continue;
    descriptionCounts.set(label, (descriptionCounts.get(label) ?? 0) + 1);
  }
  const topFoods = Array.from(descriptionCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 4)
    .map(([label, count]) => (count > 1 ? `${label} x${count}` : label));

  const calories = typeof row?.calories === "number" && Number.isFinite(row.calories) ? row.calories : null;
  const protein = typeof row?.protein_g === "number" && Number.isFinite(row.protein_g) ? row.protein_g : null;
  const fiber = typeof row?.fiber_g === "number" && Number.isFinite(row.fiber_g) ? row.fiber_g : null;

  const caloriesRange = parseNumericRange(data?.diet_philosophy?.calories?.target);
  const proteinRange = parseNumericRange(data?.diet_philosophy?.protein?.target_g);
  const fiberFloor =
    typeof data?.diet_philosophy?.fiber?.floor_g === "number" && Number.isFinite(data.diet_philosophy.fiber.floor_g)
      ? data.diet_philosophy.fiber.floor_g
      : null;
  const trainingFloor =
    typeof data?.diet_philosophy?.calories?.training_day_floor === "number" &&
    Number.isFinite(data.diet_philosophy.calories.training_day_floor)
      ? data.diet_philosophy.calories.training_day_floor
      : null;
  const absoluteFloor =
    typeof data?.diet_philosophy?.calories?.absolute_floor === "number" &&
    Number.isFinite(data.diet_philosophy.calories.absolute_floor)
      ? data.diet_philosophy.calories.absolute_floor
      : null;
  const softCeiling =
    typeof data?.diet_philosophy?.calories?.soft_ceiling === "number" &&
    Number.isFinite(data.diet_philosophy.calories.soft_ceiling)
      ? data.diet_philosophy.calories.soft_ceiling
      : null;

  const fitParts = [];
  if (calories === null) {
    fitParts.push("calories missing");
  } else if (absoluteFloor !== null && calories < absoluteFloor) {
    fitParts.push(`${Math.round(calories)} kcal (below floor ${absoluteFloor})`);
  } else if (caloriesRange && calories >= caloriesRange.min && calories <= caloriesRange.max) {
    fitParts.push(`${Math.round(calories)} kcal (in calm-surplus target)`);
  } else if (caloriesRange && calories < caloriesRange.min) {
    fitParts.push(`${Math.round(calories)} kcal (below target)`);
  } else if (softCeiling !== null && calories > softCeiling) {
    fitParts.push(`${Math.round(calories)} kcal (above soft ceiling ${softCeiling})`);
  } else if (caloriesRange && calories > caloriesRange.max) {
    fitParts.push(`${Math.round(calories)} kcal (above target)`);
  } else {
    fitParts.push(`${Math.round(calories)} kcal`);
  }

  if (proteinRange && protein !== null) {
    if (protein >= proteinRange.min && protein <= proteinRange.max) fitParts.push(`protein ${Math.round(protein)} g (on target)`);
    else if (protein < proteinRange.min) fitParts.push(`protein ${Math.round(protein)} g (low vs target)`);
    else fitParts.push(`protein ${Math.round(protein)} g (high vs target)`);
  } else if (protein !== null) {
    fitParts.push(`protein ${Math.round(protein)} g`);
  } else {
    fitParts.push("protein missing");
  }

  if (fiberFloor !== null && fiber !== null) {
    if (fiber >= fiberFloor) fitParts.push(`fiber ${fiber.toFixed(1)} g (meets floor)`);
    else fitParts.push(`fiber ${fiber.toFixed(1)} g (below floor ${fiberFloor})`);
  } else if (fiber !== null) {
    fitParts.push(`fiber ${fiber.toFixed(1)} g`);
  }

  const activity = summarizeActivityContextForDate(data, date);
  let activityPart = "";
  if (activity) {
    const prevDate = shiftIsoDate(date, -1);
    const prevRow = rowByDate.get(prevDate);
    const prevCalories =
      typeof prevRow?.calories === "number" && Number.isFinite(prevRow.calories) ? Math.round(prevRow.calories) : null;

    const base = `Activity context: ${activity.totalChecked} sessions logged this week (${activity.categoryParts.join(", ")}).`;
    if (activity.hardSignals > 0 && trainingFloor !== null && calories !== null) {
      if (calories < trainingFloor && prevCalories !== null && prevCalories < trainingFloor) {
        activityPart = `${base} Hard sessions are present, and both today/yesterday are below training-day floor ${trainingFloor} kcal.`;
      } else if (calories < trainingFloor) {
        activityPart = `${base} Hard sessions are present; if one was today or yesterday, consider slightly more carbs/energy.`;
      } else {
        activityPart = `${base} Intake looks compatible with day-of/day-before fueling for harder sessions.`;
      }
    } else if (activity.hardSignals > 0) {
      activityPart = `${base} Hard sessions are present; use day-of/day-before fueling as needed.`;
    } else {
      activityPart = `${base} Keep intake steady for recovery and consistency.`;
    }
  }

  const summaryPart = topFoods.length
    ? `${AUTO_FOOD_LOG_NOTE_PREFIX} ${topFoods.join(", ")}.`
    : `${AUTO_FOOD_LOG_NOTE_PREFIX} ${events.length} meal${events.length === 1 ? "" : "s"} logged.`;
  const fitPart = fitParts.length ? `Goal fit: ${fitParts.join("; ")}.` : "";

  return [summaryPart, fitPart, activityPart].filter(Boolean).join(" ");
}

function refreshAutoFoodLogNoteInData(data, date, { force = false, context = {} } = {}) {
  if (!Array.isArray(data?.food_log) || !isIsoDateString(date)) return null;
  const idx = data.food_log.findIndex((row) => row && row.date === date);
  if (idx < 0) return null;
  const prev = data.food_log[idx];
  const shouldUpdate = force || isAutoGeneratedFoodLogNote(prev?.notes);
  if (!shouldUpdate) return prev;

  const notes = buildDailyFoodLogAutoNote(data, date, prev, context);
  const next = {
    ...prev,
    notes,
  };
  data.food_log[idx] = next;
  return next;
}

async function recalculateFoodDayFlagsWithModel(data, date, row, context = {}) {
  if (!row || !isIsoDateString(date)) return null;
  const client = getOpenAIClient();
  const model = process.env.OPENAI_ASSISTANT_MODEL || process.env.OPENAI_MODEL || "gpt-5.2";

  const eventsByDate = context?.eventsByDate instanceof Map ? context.eventsByDate : groupEventsByDate(data?.food_events);
  const rowByDate =
    context?.rowByDate instanceof Map
      ? context.rowByDate
      : new Map((Array.isArray(data?.food_log) ? data.food_log : []).filter((r) => isIsoDateString(r?.date)).map((r) => [r.date, r]));
  const eventsForDate = (eventsByDate.get(date) ?? []).map((event) => ({
    description: event?.description ?? null,
    nutrients: event?.nutrients ?? null,
    source: event?.source ?? null,
  }));
  const prevDate = shiftIsoDate(date, -1);
  const previousDayFoodLog = rowByDate.get(prevDate) ?? null;
  const activityToday = summarizeActivityContextForDate(data, date);
  const activityYesterday = summarizeActivityContextForDate(data, prevDate);

  const system = [
    "You assign two daily diet flags for a health tracker.",
    "Return JSON only matching the schema.",
    "status means on-track overall for stated diet goals and activity context.",
    "healthy means quality/mix of foods eaten.",
    "status options:",
    "🟢 on track, 🟡 mixed, ❌ off track, ⚪ incomplete/insufficient data.",
    "healthy options:",
    "🟢 healthy day, 🟡 mixed quality day, ❌ low-quality/takeout-snack-heavy day, ⚪ incomplete/not enough data.",
    "Use both the day intake and activity context (same day and previous day) when relevant for fueling adequacy.",
    "Prefer diet_philosophy and healthy_flag_rubric from context as source of truth if present.",
    "reasoning must be one short sentence.",
  ].join(" ");

  const contextPayload = {
    timezone: TIME_ZONE,
    selected_date: date,
    diet_philosophy: data?.diet_philosophy ?? null,
    fitness_philosophy: data?.fitness_philosophy ?? null,
    food_log_for_date: row,
    previous_day_food_log: previousDayFoodLog,
    food_events_for_date: eventsForDate,
    activity_context: {
      today: activityToday,
      yesterday: activityYesterday,
    },
  };

  const response = await client.responses.parse({
    model,
    input: [
      { role: "system", content: system },
      { role: "developer", content: `Context JSON:\n${JSON.stringify(contextPayload, null, 2)}` },
      { role: "user", content: "Recalculate status and healthy flags for this day now." },
    ],
    text: { format: FoodDayFlagsFormat },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error("OpenAI response did not include parsed food day flags.");
  return parsed;
}

async function refreshFoodLogFlagsInData(data, date, { context = {} } = {}) {
  if (!Array.isArray(data?.food_log) || !isIsoDateString(date)) return null;
  const idx = data.food_log.findIndex((row) => row && row.date === date);
  if (idx < 0) return null;
  const row = data.food_log[idx];
  try {
    const flags = await recalculateFoodDayFlagsWithModel(data, date, row, context);
    if (!flags) return row;
    const next = {
      ...row,
      status: flags.status,
      healthy: flags.healthy,
    };
    data.food_log[idx] = next;
    return next;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Could not recalculate food flags for ${date}:`, err);
    return row;
  }
}

function buildFoodContext(data) {
  return {
    rowByDate: new Map(
      (Array.isArray(data?.food_log) ? data.food_log : [])
        .filter((row) => row && isIsoDateString(row.date))
        .map((row) => [row.date, row]),
    ),
    eventsByDate: groupEventsByDate(data?.food_events),
  };
}

function rebuildFoodLogRowFromEventsInData(data, date, { defaultNotes = "" } = {}) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  if (!Array.isArray(data.food_log)) data.food_log = [];
  if (!Array.isArray(data.food_events)) data.food_events = [];

  const nutrients = data.food_events.filter((e) => e && e.date === date && e.nutrients).map((e) => e.nutrients);
  const totals = computeFoodTotalsFromNutrients(nutrients);

  const idx = data.food_log.findIndex((row) => row && row.date === date);
  const prev = idx >= 0 ? data.food_log[idx] : null;
  const next = {
    date,
    day_of_week: prev?.day_of_week ?? dayOfWeekFromDateString(date),
    weight_lb: prev?.weight_lb ?? null,
    ...totals,
    status: prev?.status ?? "⚪",
    healthy: prev?.healthy ?? "⚪",
    notes: typeof prev?.notes === "string" ? prev.notes : defaultNotes,
  };
  if (idx >= 0) data.food_log[idx] = next;
  else data.food_log.push(next);
  return next;
}

async function finalizeFoodLogForDateInData(data, date, context) {
  let foodLogRow = refreshAutoFoodLogNoteInData(data, date, { context }) ?? null;
  foodLogRow = (await refreshFoodLogFlagsInData(data, date, { context })) ?? foodLogRow;
  return foodLogRow;
}

export async function addFoodEvent({
  date,
  source,
  description,
  input_text = null,
  notes,
  nutrients,
  model,
  confidence,
  raw_items,
  idempotency_key = null,
}) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  if (!nutrients || typeof nutrients !== "object") throw new Error("Missing nutrients");

  const data = await readTrackingData();
  const now = new Date();
  const loggedAt = formatSeattleIso(now);
  const seattleDate = getSeattleDateString(now);
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotency_key);

  if (!Array.isArray(data.food_events)) data.food_events = [];

  if (normalizedIdempotencyKey) {
    const existingEvent = data.food_events.find((entry) => entry?.idempotency_key === normalizedIdempotencyKey) ?? null;
    if (existingEvent) {
      const existingFoodLog =
        Array.isArray(data.food_log) && isIsoDateString(existingEvent?.date)
          ? data.food_log.find((row) => row && row.date === existingEvent.date) ?? null
          : null;
      return { event: existingEvent, food_log: existingFoodLog, log_action: "existing" };
    }
  } else {
    const duplicateEvent = findRecentDuplicateFoodEvent(
      data.food_events,
      {
        date,
        logged_at: loggedAt,
        source,
        description,
        input_text,
        notes,
        nutrients,
      },
      { withinMs: 15000 },
    );
    if (duplicateEvent) {
      const existingFoodLog =
        Array.isArray(data.food_log) && isIsoDateString(duplicateEvent?.date)
          ? data.food_log.find((row) => row && row.date === duplicateEvent.date) ?? null
          : null;
      return { event: duplicateEvent, food_log: existingFoodLog, log_action: "existing" };
    }
  }

  const event = {
    id: crypto.randomUUID(),
    date,
    logged_at: loggedAt,
    rollover_applied: date !== seattleDate,
    source,
    description,
    input_text,
    notes,
    nutrients,
    model,
    confidence,
    items: raw_items,
    idempotency_key: normalizedIdempotencyKey,
  };

  data.food_events.push(event);

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = loggedAt;
  }

  rebuildFoodLogRowFromEventsInData(data, date, { defaultNotes: "Auto-updated from food_events." });
  const context = buildFoodContext(data);
  const foodLogRow = await finalizeFoodLogForDateInData(data, date, context);
  event.applied_to_food_log = true;

  await writeTrackingData(data);
  return { event, food_log: foodLogRow, log_action: "created" };
}

export async function updateFoodEvent({
  id,
  date,
  source,
  description,
  input_text = null,
  notes,
  nutrients,
  model,
  confidence,
  raw_items,
  idempotency_key = null,
}) {
  if (typeof id !== "string" || !id.trim()) throw new Error("Invalid event id");
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  if (!nutrients || typeof nutrients !== "object") throw new Error("Missing nutrients");

  const data = await readTrackingData();
  if (!Array.isArray(data.food_events)) data.food_events = [];

  const idx = data.food_events.findIndex((event) => event?.id === id);
  if (idx < 0) throw new Error(`Food event not found: ${id}`);

  const now = new Date();
  const loggedAt = formatSeattleIso(now);
  const seattleDate = getSeattleDateString(now);
  const prev = data.food_events[idx];
  const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotency_key);

  const next = {
    ...prev,
    date,
    logged_at: typeof prev?.logged_at === "string" && prev.logged_at ? prev.logged_at : loggedAt,
    rollover_applied: date !== seattleDate,
    source,
    description,
    input_text,
    notes,
    nutrients,
    model,
    confidence,
    items: raw_items,
    idempotency_key: normalizedIdempotencyKey ?? prev?.idempotency_key ?? null,
    applied_to_food_log: true,
  };
  data.food_events[idx] = next;

  const affectedDates = Array.from(new Set([prev?.date, date].filter((d) => isIsoDateString(d))));
  for (const affectedDate of affectedDates) {
    rebuildFoodLogRowFromEventsInData(data, affectedDate, { defaultNotes: "Auto-updated from food_events." });
  }

  let context = buildFoodContext(data);
  for (const affectedDate of affectedDates) {
    await finalizeFoodLogForDateInData(data, affectedDate, context);
    context = buildFoodContext(data);
  }

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = loggedAt;
  }

  await writeTrackingData(data);
  const foodLogRow = Array.isArray(data.food_log) ? data.food_log.find((row) => row && row.date === date) ?? null : null;
  return { event: next, food_log: foodLogRow, log_action: "updated" };
}

export async function syncFoodEventsToFoodLog({ date, onlyUnsynced = true }) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);

  const data = await readTrackingData();
  const events = Array.isArray(data.food_events) ? data.food_events : [];
  const eventsForDate = events.filter((e) => e && e.date === date && e.nutrients);

  let syncedCount = 0;
  for (const e of eventsForDate) {
    const alreadySynced = e.applied_to_food_log === true;
    if (onlyUnsynced && alreadySynced) continue;
    e.applied_to_food_log = true;
    syncedCount += 1;
  }

  if (syncedCount > 0) {
    rebuildFoodLogRowFromEventsInData(data, date, { defaultNotes: "Auto-updated from food_events." });
    const context = buildFoodContext(data);
    await finalizeFoodLogForDateInData(data, date, context);
    if (data.metadata && typeof data.metadata === "object") {
      data.metadata.last_updated = formatSeattleIso(new Date());
    }
    await writeTrackingData(data);
  }

  const foodLogRow = Array.isArray(data.food_log) ? data.food_log.find((r) => r && r.date === date) ?? null : null;
  return { synced_count: syncedCount, food_log: foodLogRow };
}

export async function getDailyFoodEventTotals(date) {
  const data = await readTrackingData();
  const events = Array.isArray(data.food_events) ? data.food_events : [];
  const nutrients = events.filter((e) => e && e.date === date && e.nutrients).map((e) => e.nutrients);
  return computeFoodTotalsFromNutrients(nutrients);
}

export async function getFoodEventsForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const data = await readTrackingData();
  const events = Array.isArray(data.food_events) ? data.food_events : [];
  return events.filter((e) => e && e.date === date);
}

export async function updateCurrentWeekItem({ category, index, checked, details }) {
  if (typeof category !== "string" || !category.trim()) throw new Error(`Invalid category: ${category}`);
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid index: ${index}`);
  if (typeof checked !== "boolean") throw new Error("Invalid checked value");
  if (typeof details !== "string") throw new Error("Invalid details value");

  const data = await readTrackingData();
  const { current_week } = ensureCurrentWeekInData(data, new Date());
  const categoryKey = resolveFitnessCategoryKey(current_week, category);
  if (!categoryKey) throw new Error(`Invalid category: ${category}`);
  const list = Array.isArray(current_week[categoryKey]) ? current_week[categoryKey] : [];
  if (!list[index]) throw new Error("Item not found");

  list[index] = {
    ...list[index],
    checked,
    details,
  };
  current_week[categoryKey] = list;
  current_week.category_order = getFitnessCategoryKeys(current_week);

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = formatSeattleIso(new Date());
  }
  await writeTrackingData(data);
  return current_week;
}

export async function updateCurrentWeekItems(updates) {
  if (!Array.isArray(updates) || updates.length === 0) throw new Error("Missing updates");

  const validatedUpdates = [];
  for (const update of updates) {
    if (typeof update?.category !== "string" || !update.category.trim()) {
      throw new Error(`Invalid category: ${update?.category}`);
    }
    if (!Number.isInteger(update?.index) || update.index < 0) throw new Error(`Invalid index: ${update?.index}`);
    if (typeof update?.checked !== "boolean") throw new Error("Invalid checked value");
    if (typeof update?.details !== "string") throw new Error("Invalid details value");
    validatedUpdates.push(update);
  }

  const data = await readTrackingData();
  const { current_week } = ensureCurrentWeekInData(data, new Date());

  const resolvedUpdates = validatedUpdates.map((update) => {
    const categoryKey = resolveFitnessCategoryKey(current_week, update.category);
    if (!categoryKey) throw new Error(`Invalid category: ${update.category}`);
    return { ...update, categoryKey };
  });

  for (const update of resolvedUpdates) {
    const list = Array.isArray(current_week[update.categoryKey]) ? current_week[update.categoryKey] : [];
    if (!list[update.index]) throw new Error("Item not found");
    list[update.index] = {
      ...list[update.index],
      checked: update.checked,
      details: update.details,
    };
    current_week[update.categoryKey] = list;
  }
  current_week.category_order = getFitnessCategoryKeys(current_week);

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = formatSeattleIso(new Date());
  }
  await writeTrackingData(data);
  return current_week;
}

export async function updateCurrentWeekSummary(summary) {
  if (typeof summary !== "string") throw new Error("Invalid summary");
  const data = await readTrackingData();
  const { current_week } = ensureCurrentWeekInData(data, new Date());
  current_week.summary = summary;

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = formatSeattleIso(new Date());
  }
  await writeTrackingData(data);
  return current_week;
}

export async function listFitnessWeeks({ limit = 12 } = {}) {
  const data = await readTrackingData();
  const weeks = Array.isArray(data.fitness_weeks) ? data.fitness_weeks : [];
  const safeLimit = Math.max(0, Number(limit) || 0);
  return weeks.slice(-safeLimit);
}

export async function listFoodLog({ limit = 0, from = null, to = null } = {}) {
  const safeLimit = Math.max(0, Number(limit) || 0);
  if (from !== null && !isIsoDateString(from)) throw new Error(`Invalid from date: ${from}`);
  if (to !== null && !isIsoDateString(to)) throw new Error(`Invalid to date: ${to}`);

  const data = await readTrackingData();
  const log = Array.isArray(data.food_log) ? data.food_log : [];
  const context = {
    rowByDate: new Map(log.filter((row) => row && isIsoDateString(row.date)).map((row) => [row.date, row])),
    eventsByDate: groupEventsByDate(data.food_events),
  };

  let rows = log.filter((row) => row && typeof row === "object" && isIsoDateString(row.date));
  rows = rows.map((row) => {
    if (!isAutoGeneratedFoodLogNote(row?.notes)) return row;
    return {
      ...row,
      notes: buildDailyFoodLogAutoNote(data, row.date, row, context),
    };
  });
  if (from) rows = rows.filter((row) => row.date >= from);
  if (to) rows = rows.filter((row) => row.date <= to);

  rows = rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (safeLimit > 0) rows = rows.slice(0, safeLimit);

  return rows;
}

export async function getFoodLogForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const data = await readTrackingData();
  const log = Array.isArray(data.food_log) ? data.food_log : [];
  const row = log.find((d) => d && d.date === date) ?? null;
  if (!row) return null;
  if (!isAutoGeneratedFoodLogNote(row?.notes)) return row;
  const context = {
    rowByDate: new Map(log.filter((r) => r && isIsoDateString(r.date)).map((r) => [r.date, r])),
    eventsByDate: groupEventsByDate(data.food_events),
  };
  return {
    ...row,
    notes: buildDailyFoodLogAutoNote(data, row.date, row, context),
  };
}

export async function rollupFoodLogFromEvents(date, { overwrite = false } = {}) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const data = await readTrackingData();
  const events = Array.isArray(data.food_events) ? data.food_events : [];
  const nutrients = events.filter((e) => e && e.date === date && e.nutrients).map((e) => e.nutrients);

  const totals = {
    calories: sum(nutrients.map((n) => n.calories)),
    fat_g: sum(nutrients.map((n) => n.fat_g)),
    carbs_g: sum(nutrients.map((n) => n.carbs_g)),
    protein_g: sum(nutrients.map((n) => n.protein_g)),
    fiber_g: sumNullable(nutrients.map((n) => n.fiber_g)),
    potassium_mg: sumNullable(nutrients.map((n) => n.potassium_mg)),
    magnesium_mg: sumNullable(nutrients.map((n) => n.magnesium_mg)),
    omega3_mg: sumNullable(nutrients.map((n) => n.omega3_mg)),
    calcium_mg: sumNullable(nutrients.map((n) => n.calcium_mg)),
    iron_mg: sumNullable(nutrients.map((n) => n.iron_mg)),
  };

  if (!Array.isArray(data.food_log)) data.food_log = [];

  const d = parseIsoDateAsUtcNoon(date);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d);

  const idx = data.food_log.findIndex((row) => row && row.date === date);
  const prev = idx >= 0 ? data.food_log[idx] : null;

  const isAutoGenerated = isAutoGeneratedFoodLogNote(prev?.notes);
  const canApply = overwrite || !prev || isAutoGenerated;
  if (!canApply) {
    return { applied: false, food_log: prev, totals_from_events: totals };
  }

  const next = {
    date,
    day_of_week: prev?.day_of_week ?? dayOfWeek,
    weight_lb: prev?.weight_lb ?? null,
    ...totals,
    status: prev?.status ?? "⚪",
    healthy: prev?.healthy ?? "⚪",
    notes: prev?.notes ?? "",
  };

  if (idx >= 0) data.food_log[idx] = next;
  else data.food_log.push(next);

  const refreshed = refreshAutoFoodLogNoteInData(data, date) ?? next;

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = formatSeattleIso(new Date());
  }
  await writeTrackingData(data);
  return { applied: true, food_log: refreshed, totals_from_events: totals };
}
