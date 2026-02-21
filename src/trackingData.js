import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import { getFitnessCategoryKeys, resolveFitnessCategoryKey } from "./fitnessChecklist.js";
import { readTrackingDataPostgres, writeTrackingDataPostgres } from "./trackingDataPostgres.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DATA_DIR = path.resolve(__dirname, "..");
const TRACKING_BACKEND = String(process.env.TRACKING_BACKEND || "json").toLowerCase();
const USE_POSTGRES_BACKEND = TRACKING_BACKEND === "postgres";

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

const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CATEGORY_KEY = "workouts";

const DAY_NUMERIC_KEYS = ["calories", "fat_g", "carbs_g", "protein_g", "fiber_g"];
const DAY_STATUS_VALUES = new Set(["green", "yellow", "red", "incomplete"]);

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
    tz: get("timeZoneName"),
  };
}

function offsetFromTzName(tzName) {
  if (!tzName || !tzName.startsWith("GMT")) return "Z";
  const sign = tzName[3] === "-" ? "-" : "+";
  const rest = tzName.slice(4);
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

function parseIsoDateAsUtcNoon(dateStr) {
  if (!isIsoDateString(dateStr)) throw new Error(`Invalid date string: ${dateStr}`);
  return new Date(`${dateStr}T12:00:00Z`);
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekStartMonday(dateStr) {
  const d = parseIsoDateAsUtcNoon(dateStr);
  const day = d.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return formatIsoDate(d);
}

function getWeekEndSunday(weekStart) {
  const start = parseIsoDateAsUtcNoon(weekStart);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return formatIsoDate(end);
}

function weekLabelFromStart(weekStart) {
  const start = parseIsoDateAsUtcNoon(weekStart);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const fmt = (d) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `${fmt(start)}-${fmt(end)}`;
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n").trim();
}

function normalizeOptionalText(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

function normalizeDayStatus(value) {
  if (value === null || value === undefined) return "incomplete";
  const text = normalizeText(value).toLowerCase();
  return DAY_STATUS_VALUES.has(text) ? text : "incomplete";
}

function toNumberOrNull(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function normalizeProfileData(profile) {
  const safe = asObject(profile);
  return {
    general: normalizeOptionalText(safe.general),
    fitness: normalizeOptionalText(safe.fitness),
    diet: normalizeOptionalText(safe.diet),
    agent: normalizeOptionalText(safe.agent),
  };
}

function normalizeWorkoutDefinition(entry) {
  const safe = asObject(entry);
  const name = normalizeText(safe.name || safe.item);
  if (!name) return null;
  return {
    name,
    description: normalizeOptionalText(safe.description),
    category: normalizeOptionalText(safe.category) || "General",
    optional: safe.optional === true,
  };
}

function normalizeBlock(entry) {
  const safe = asObject(entry);
  const blockId = normalizeText(safe.block_id || safe.id);
  if (!blockId) return null;
  const blockStart = isIsoDateString(safe.block_start) ? safe.block_start : getSeattleDateString();
  const blockEnd = isIsoDateString(safe.block_end) ? safe.block_end : "";
  const workouts = [];
  const seen = new Set();
  for (const row of asArray(safe.workouts)) {
    const normalized = normalizeWorkoutDefinition(row);
    if (!normalized) continue;
    const token = normalized.name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    workouts.push(normalized);
  }
  return {
    block_id: blockId,
    block_start: blockStart,
    block_end: blockEnd,
    block_name: normalizeOptionalText(safe.block_name || safe.name),
    block_details: normalizeOptionalText(safe.block_details || safe.description),
    workouts,
  };
}

function normalizeWeekWorkout(entry) {
  const safe = asObject(entry);
  const name = normalizeText(safe.name || safe.item);
  if (!name) return null;
  const date = isIsoDateString(safe.date) ? safe.date : null;
  return {
    name,
    details: normalizeOptionalText(safe.details),
    completed: safe.completed === true || safe.checked === true,
    date,
  };
}

function normalizeWeek(entry, { requireStart = true } = {}) {
  const safe = asObject(entry);
  const weekStart = isIsoDateString(safe.week_start) ? safe.week_start : null;
  if (requireStart && !weekStart) return null;

  const workouts = [];
  const seen = new Set();
  for (const row of asArray(safe.workouts)) {
    const normalized = normalizeWeekWorkout(row);
    if (!normalized) continue;
    const token = normalized.name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    workouts.push(normalized);
  }

  return {
    week_start: weekStart || getWeekStartMonday(getSeattleDateString()),
    week_end: isIsoDateString(safe.week_end) ? safe.week_end : getWeekEndSunday(weekStart || getSeattleDateString()),
    block_id: normalizeOptionalText(safe.block_id || safe.training_block_id),
    workouts,
    ai_summary: normalizeOptionalText(safe.ai_summary || safe.summary),
    context: normalizeOptionalText(safe.context),
  };
}

function normalizeDietDay(row) {
  const safe = asObject(row);
  const date = isIsoDateString(safe.date) ? safe.date : null;
  if (!date) return null;
  const out = {
    date,
    weight_lb: toNumberOrNull(safe.weight_lb),
    status: normalizeDayStatus(safe.status || safe.on_track),
    ai_summary: normalizeOptionalText(safe.ai_summary || safe.details || safe.notes),
  };
  for (const key of DAY_NUMERIC_KEYS) {
    out[key] = toNumberOrNull(safe[key]);
  }
  return out;
}

function emptyCanonicalData() {
  return {
    profile: {
      general: "",
      fitness: "",
      diet: "",
      agent: "",
    },
    activity: {
      blocks: [],
      weeks: [],
    },
    food: {
      days: [],
    },
    rules: {
      metadata: {},
      diet_philosophy: {},
      fitness_philosophy: {},
      assistant_rules: {},
    },
  };
}

function normalizeMetadata(value) {
  const safe = asObject(value);
  return { ...safe };
}

function normalizeRulesData(value) {
  const safe = asObject(value);
  const { metadata, diet_philosophy, fitness_philosophy, assistant_rules, ...rest } = safe;
  return {
    metadata: normalizeMetadata(metadata),
    diet_philosophy: asObject(diet_philosophy),
    fitness_philosophy: asObject(fitness_philosophy),
    assistant_rules: asObject(assistant_rules),
    ...rest,
  };
}

function ensureMetadataFields(rules) {
  const out = normalizeRulesData(rules);
  const metadata = asObject(out.metadata);
  metadata.data_files = {
    food: path.basename(TRACKING_FOOD_FILE),
    activity: path.basename(TRACKING_ACTIVITY_FILE),
    profile: path.basename(TRACKING_PROFILE_FILE),
    rules: path.basename(TRACKING_RULES_FILE),
  };
  if (!Number.isInteger(metadata.settings_version)) metadata.settings_version = 0;
  if (!Array.isArray(metadata.settings_history)) metadata.settings_history = [];
  if (typeof metadata.last_updated !== "string" || !metadata.last_updated.trim()) {
    metadata.last_updated = formatSeattleIso(new Date());
  }
  out.metadata = metadata;
  return out;
}

function canonicalizeBlocks(blocks) {
  const out = [];
  const seen = new Set();
  for (const row of asArray(blocks)) {
    const normalized = normalizeBlock(row);
    if (!normalized) continue;
    const token = normalized.block_id.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(normalized);
  }
  return out;
}

function canonicalizeWeeks(weeks) {
  const out = [];
  const seen = new Set();
  for (const row of asArray(weeks)) {
    const normalized = normalizeWeek(row, { requireStart: true });
    if (!normalized) continue;
    const token = normalized.week_start;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(normalized);
  }
  out.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
  return out;
}

function canonicalizeDays(days) {
  const out = [];
  const seen = new Set();
  for (const row of asArray(days)) {
    const normalized = normalizeDietDay(row);
    if (!normalized) continue;
    if (seen.has(normalized.date)) continue;
    seen.add(normalized.date);
    out.push(normalized);
  }
  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

function normalizeCanonicalData(candidate) {
  const safe = asObject(candidate);
  return {
    profile: normalizeProfileData(asObject(safe.profile)),
    activity: {
      blocks: canonicalizeBlocks(asArray(asObject(safe.activity).blocks)),
      weeks: canonicalizeWeeks(asArray(asObject(safe.activity).weeks)),
    },
    food: {
      days: canonicalizeDays(asArray(asObject(safe.food).days)),
    },
    rules: ensureMetadataFields(safe.rules),
  };
}

function upsertWeek(weeks, nextWeek) {
  const out = [...asArray(weeks).filter((week) => week && week.week_start !== nextWeek.week_start), nextWeek];
  out.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
  return out;
}

function pickPreferredBlockForDate(blocks, targetDate) {
  const safeBlocks = canonicalizeBlocks(blocks);
  const day = isIsoDateString(targetDate) ? targetDate : getSeattleDateString();
  if (!safeBlocks.length) return null;

  const active = safeBlocks.filter((block) => {
    const start = isIsoDateString(block.block_start) ? block.block_start : "";
    if (!start) return false;
    if (start > day) return false;
    return true;
  });

  const sortByLatestStart = (a, b) => String(b.block_start || "").localeCompare(String(a.block_start || ""));
  const activeByStart = active.sort(sortByLatestStart);
  if (activeByStart.length) return activeByStart[0];

  const past = safeBlocks
    .filter((block) => isIsoDateString(block.block_start) && block.block_start <= day)
    .sort(sortByLatestStart);
  if (past.length) return past[0];

  const future = safeBlocks
    .filter((block) => isIsoDateString(block.block_start) && block.block_start > day)
    .sort((a, b) => String(a.block_start || "").localeCompare(String(b.block_start || "")));
  if (future.length) return future[0];

  return safeBlocks[safeBlocks.length - 1] || null;
}

function ensureCurrentWeekInCanonical(canonical, now = new Date()) {
  const seattleDate = getSeattleDateString(now);
  const weekStart = getWeekStartMonday(seattleDate);
  const safe = normalizeCanonicalData(canonical);

  let current = safe.activity.weeks.find((week) => week.week_start === weekStart) || null;
  if (current) return { data: safe, currentWeek: current, changed: false };

  const activeBlock =
    pickPreferredBlockForDate(safe.activity.blocks, seattleDate) ||
    safe.activity.blocks[safe.activity.blocks.length - 1] ||
    null;

  current = {
    week_start: weekStart,
    week_end: getWeekEndSunday(weekStart),
    block_id: normalizeText(activeBlock?.block_id),
    workouts: asArray(activeBlock?.workouts).map((workout) => ({
      name: workout.name,
      details: "",
      completed: false,
      date: null,
    })),
    ai_summary: "",
    context: "",
  };

  safe.activity.weeks = upsertWeek(safe.activity.weeks, normalizeWeek(current));
  return {
    data: safe,
    currentWeek: safe.activity.weeks.find((week) => week.week_start === weekStart),
    changed: true,
  };
}

function checklistTemplateFromBlock(block) {
  const safe = normalizeBlock(block);
  if (!safe) return null;
  const out = {
    category_order: [DEFAULT_CATEGORY_KEY],
    category_labels: {
      [DEFAULT_CATEGORY_KEY]: "Workouts",
    },
    [DEFAULT_CATEGORY_KEY]: [],
  };
  for (const workout of safe.workouts) {
    out[DEFAULT_CATEGORY_KEY].push({ item: workout.name, description: workout.description || "" });
  }
  return out;
}

function metadataTrainingBlocksFromCanonical(activity, metadata = {}) {
  const safeMetadata = asObject(metadata);
  const blocks = canonicalizeBlocks(asArray(activity?.blocks));
  const blockPayload = blocks.map((block) => {
    const template = checklistTemplateFromBlock(block);
    return {
      id: block.block_id,
      name: block.block_name,
      description: block.block_details,
      workouts: asArray(block.workouts).map((row) => ({
        name: normalizeOptionalText(row?.name),
        description: normalizeOptionalText(row?.description),
        category: normalizeOptionalText(row?.category) || DEFAULT_CATEGORY_KEY,
        optional: row?.optional === true,
      })),
      block_start: block.block_start,
      block_end: block.block_end,
      category_order: template?.category_order ?? [DEFAULT_CATEGORY_KEY],
      category_labels: template?.category_labels ?? { [DEFAULT_CATEGORY_KEY]: "Workouts" },
      checklist:
        template
          ? {
              [DEFAULT_CATEGORY_KEY]: asArray(template[DEFAULT_CATEGORY_KEY]).map((entry) => ({
                item: entry.item,
                description: entry.description,
                checked: false,
                details: "",
              })),
            }
          : { [DEFAULT_CATEGORY_KEY]: [] },
      created_at: typeof safeMetadata?.training_blocks?.blocks?.find((row) => row?.id === block.block_id)?.created_at === "string"
        ? safeMetadata.training_blocks.blocks.find((row) => row?.id === block.block_id).created_at
        : formatSeattleIso(new Date()),
      updated_at: formatSeattleIso(new Date()),
    };
  });

  const activeFromMeta = normalizeText(safeMetadata?.training_blocks?.active_block_id);
  const activeFromDate = normalizeText(pickPreferredBlockForDate(blocks, getSeattleDateString())?.block_id);
  const activeBlockId = activeFromDate || activeFromMeta || normalizeText(blocks[blocks.length - 1]?.block_id) || null;

  const outMeta = {
    ...safeMetadata,
    training_blocks: {
      active_block_id: activeBlockId,
      blocks: blockPayload,
    },
  };

  const activeBlock = blocks.find((block) => block.block_id === activeBlockId) || blocks[blocks.length - 1] || null;
  const template = checklistTemplateFromBlock(activeBlock);
  if (template) outMeta.checklist_template = template;
  else delete outMeta.checklist_template;

  return outMeta;
}

function canonicalWeekToLegacy(week, block) {
  const safeWeek = normalizeWeek(week);
  if (!safeWeek) return null;
  const safeBlock = normalizeBlock(block);
  const definitionByName = new Map(asArray(safeBlock?.workouts).map((row) => [row.name, row]));

  const workoutItems = asArray(safeWeek.workouts).map((row) => {
    const def = definitionByName.get(row.name);
    return {
      item: row.name,
      description: normalizeOptionalText(def?.description),
      checked: row.completed === true,
      details: normalizeOptionalText(row.details),
      date: isIsoDateString(row.date) ? row.date : null,
    };
  });

  return {
    week_start: safeWeek.week_start,
    week_label: weekLabelFromStart(safeWeek.week_start),
    summary: normalizeOptionalText(safeWeek.ai_summary),
    ai_summary: normalizeOptionalText(safeWeek.ai_summary),
    context: normalizeOptionalText(safeWeek.context),
    training_block_id: normalizeOptionalText(safeWeek.block_id),
    training_block_name: normalizeOptionalText(safeBlock?.block_name),
    training_block_description: normalizeOptionalText(safeBlock?.block_details),
    [DEFAULT_CATEGORY_KEY]: workoutItems,
    category_order: [DEFAULT_CATEGORY_KEY],
    category_labels: {
      [DEFAULT_CATEGORY_KEY]: "Workouts",
    },
  };
}

function canonicalWeekToView(week, block) {
  const safeWeek = normalizeWeek(week);
  if (!safeWeek) return null;
  const safeBlock = normalizeBlock(block);

  const definitionByName = new Map(
    asArray(safeBlock?.workouts)
      .map((row) => {
        const name = normalizeText(row?.name);
        return name ? [name.toLowerCase(), row] : null;
      })
      .filter(Boolean),
  );

  const workouts = [];
  const seen = new Set();
  for (const workout of asArray(safeWeek.workouts)) {
    const name = normalizeText(workout?.name);
    if (!name) continue;
    const token = name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    const def = definitionByName.get(token);
    workouts.push({
      name,
      description: normalizeOptionalText(def?.description),
      category: normalizeOptionalText(def?.category) || "General",
      optional: def?.optional === true,
      details: normalizeOptionalText(workout?.details),
      completed: workout?.completed === true,
      date: isIsoDateString(workout?.date) ? workout.date : null,
    });
  }

  for (const def of asArray(safeBlock?.workouts)) {
    const name = normalizeText(def?.name);
    if (!name) continue;
    const token = name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    workouts.push({
      name,
      description: normalizeOptionalText(def?.description),
      category: normalizeOptionalText(def?.category) || "General",
      optional: def?.optional === true,
      details: "",
      completed: false,
      date: null,
    });
  }

  return {
    week_start: safeWeek.week_start,
    week_end: safeWeek.week_end,
    week_label: weekLabelFromStart(safeWeek.week_start),
    block_id: normalizeOptionalText(safeWeek.block_id),
    block_start: normalizeOptionalText(safeBlock?.block_start),
    block_end: normalizeOptionalText(safeBlock?.block_end),
    block_name: normalizeOptionalText(safeBlock?.block_name),
    block_details: normalizeOptionalText(safeBlock?.block_details),
    workouts,
    ai_summary: normalizeOptionalText(safeWeek.ai_summary),
    context: normalizeOptionalText(safeWeek.context),
    summary: normalizeOptionalText(safeWeek.ai_summary),
  };
}

function legacyTotalsFromDay(day) {
  const safe = normalizeDietDay(day);
  if (!safe) return {
    calories: 0,
    fat_g: 0,
    carbs_g: 0,
    protein_g: 0,
    fiber_g: null,
    potassium_mg: null,
    magnesium_mg: null,
    omega3_mg: null,
    calcium_mg: null,
    iron_mg: null,
  };

  return {
    calories: safe.calories ?? 0,
    fat_g: safe.fat_g ?? 0,
    carbs_g: safe.carbs_g ?? 0,
    protein_g: safe.protein_g ?? 0,
    fiber_g: safe.fiber_g,
    potassium_mg: null,
    magnesium_mg: null,
    omega3_mg: null,
    calcium_mg: null,
    iron_mg: null,
  };
}

function buildReadPayloadFromCanonical(canonical, { now = new Date() } = {}) {
  const normalized = normalizeCanonicalData(canonical);
  const ensured = ensureCurrentWeekInCanonical(normalized, now);
  const data = ensured.data;

  const metadata = metadataTrainingBlocksFromCanonical(data.activity, asObject(data.rules.metadata));
  const rules = {
    ...data.rules,
    metadata,
  };

  const payload = {
    profile: data.profile,
    rules,
    activity: data.activity,
    food: data.food,
  };

  return { payload, canonical: data, changed: ensured.changed };
}

function extractCanonicalFromIncoming(data) {
  const safe = asObject(data);
  return normalizeCanonicalData({
    profile: asObject(safe.profile),
    activity: asObject(safe.activity),
    food: asObject(safe.food),
    rules: asObject(safe.rules),
  });
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

async function writeSplitCanonical(canonical) {
  const safe = normalizeCanonicalData(canonical);
  await Promise.all([
    atomicWriteJson(TRACKING_FOOD_FILE, { days: safe.food.days }),
    atomicWriteJson(TRACKING_ACTIVITY_FILE, { blocks: safe.activity.blocks, weeks: safe.activity.weeks }),
    atomicWriteJson(TRACKING_PROFILE_FILE, safe.profile),
    atomicWriteJson(TRACKING_RULES_FILE, ensureMetadataFields(safe.rules)),
  ]);
}

async function ensureSplitFiles() {
  const [foodExists, activityExists, profileExists, rulesExists] = await Promise.all([
    fileExists(TRACKING_FOOD_FILE),
    fileExists(TRACKING_ACTIVITY_FILE),
    fileExists(TRACKING_PROFILE_FILE),
    fileExists(TRACKING_RULES_FILE),
  ]);

  if (foodExists || activityExists || profileExists || rulesExists) return;
  await writeSplitCanonical(emptyCanonicalData());
}

async function readCanonicalTrackingData() {
  if (USE_POSTGRES_BACKEND) {
    const raw = await readTrackingDataPostgres();
    const canonical = extractCanonicalFromIncoming(raw);
    return normalizeCanonicalData(canonical);
  }

  await ensureSplitFiles();

  const [foodRaw, activityRaw, profileRaw, rulesRaw] = await Promise.all([
    readJsonOrDefault(TRACKING_FOOD_FILE, {}),
    readJsonOrDefault(TRACKING_ACTIVITY_FILE, {}),
    readJsonOrDefault(TRACKING_PROFILE_FILE, {}),
    readJsonOrDefault(TRACKING_RULES_FILE, {}),
  ]);

  const canonical = normalizeCanonicalData({
    profile: profileRaw,
    activity: activityRaw,
    food: foodRaw,
    rules: rulesRaw,
  });

  return canonical;
}

async function writeCanonicalTrackingData(canonical) {
  const safe = normalizeCanonicalData(canonical);
  safe.rules = ensureMetadataFields(safe.rules);
  safe.rules.metadata.last_updated = formatSeattleIso(new Date());

  if (USE_POSTGRES_BACKEND) {
    await writeTrackingDataPostgres(safe);
    return;
  }

  await writeSplitCanonical(safe);
}

function appendDayDetails(previous, nextEntry, nowIso) {
  const prior = normalizeOptionalText(previous);
  const entry = normalizeText(nextEntry);
  if (!entry) return prior;
  const token = nowIso.slice(11, 16);
  const line = `- ${token} ${entry}`;
  if (!prior) return line;
  return `${prior}\n${line}`;
}

function upsertDietDay(days, nextDay) {
  const out = [...asArray(days).filter((day) => day && day.date !== nextDay.date), normalizeDietDay(nextDay)].filter(Boolean);
  out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return out;
}

function mergeNutrientsIntoDay(day, nutrients) {
  const out = normalizeDietDay(day) || normalizeDietDay({ date: day?.date || getSuggestedLogDate() });
  for (const key of DAY_NUMERIC_KEYS) {
    const current = toNumberOrNull(out?.[key]);
    const incoming = toNumberOrNull(asObject(nutrients)[key]);
    if (incoming === null) continue;
    out[key] = (current ?? 0) + incoming;
  }
  return out;
}

function replaceDayTotals(day, nutrients) {
  const out = normalizeDietDay(day) || normalizeDietDay({ date: day?.date || getSuggestedLogDate() });
  for (const key of DAY_NUMERIC_KEYS) {
    out[key] = toNumberOrNull(asObject(nutrients)[key]);
  }
  return out;
}

function findCurrentWeek(canonical, now = new Date()) {
  const weekStart = getWeekStartMonday(getSeattleDateString(now));
  return asArray(canonical.activity?.weeks).find((week) => week.week_start === weekStart) || null;
}

function currentWeekHistory(canonical, now = new Date()) {
  const weekStart = getWeekStartMonday(getSeattleDateString(now));
  return asArray(canonical.activity?.weeks).filter((week) => week.week_start !== weekStart);
}

export async function readTrackingData() {
  const canonical = await readCanonicalTrackingData();
  const built = buildReadPayloadFromCanonical(canonical);

  if (built.changed) {
    await writeCanonicalTrackingData(built.canonical);
  }

  return built.payload;
}

export async function writeTrackingData(data) {
  const canonical = extractCanonicalFromIncoming(data);
  const ensured = ensureCurrentWeekInCanonical(canonical);
  await writeCanonicalTrackingData(ensured.data);
}

export async function ensureCurrentWeek(now = new Date()) {
  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical, now);
  if (ensured.changed) await writeCanonicalTrackingData(ensured.data);
  const block = ensured.data.activity.blocks.find((row) => row.block_id === ensured.currentWeek?.block_id) || null;
  return ensured.currentWeek ? canonicalWeekToLegacy(ensured.currentWeek, block) : null;
}

export async function getCurrentActivityWeek(now = new Date()) {
  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical, now);
  if (ensured.changed) await writeCanonicalTrackingData(ensured.data);
  const block = ensured.data.activity.blocks.find((row) => row.block_id === ensured.currentWeek?.block_id) || null;
  return ensured.currentWeek ? canonicalWeekToView(ensured.currentWeek, block) : null;
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

  const canonical = await readCanonicalTrackingData();
  const now = new Date();
  const loggedAt = formatSeattleIso(now);

  const existing =
    canonical.food.days.find((row) => row.date === date) || normalizeDietDay({ date, status: "incomplete", ai_summary: "" });
  const merged = mergeNutrientsIntoDay(existing, nutrients);

  const detailsInput = [normalizeText(description), normalizeText(input_text), normalizeText(notes)].filter(Boolean).join(" | ");
  merged.ai_summary = appendDayDetails(existing.ai_summary, detailsInput, loggedAt);

  canonical.food.days = upsertDietDay(canonical.food.days, merged);
  canonical.rules.metadata = {
    ...asObject(canonical.rules.metadata),
    last_updated: loggedAt,
  };

  await writeCanonicalTrackingData(canonical);

  const event = {
    id: crypto.randomUUID(),
    date,
    logged_at: loggedAt,
    rollover_applied: date !== getSeattleDateString(now),
    source: normalizeText(source) || "manual",
    description: normalizeOptionalText(description),
    input_text: typeof input_text === "string" ? input_text : null,
    notes: normalizeOptionalText(notes),
    nutrients: { ...legacyTotalsFromDay(merged), ...asObject(nutrients) },
    model: model ?? null,
    confidence: confidence ?? null,
    items: asArray(raw_items),
    idempotency_key: typeof idempotency_key === "string" && idempotency_key.trim() ? idempotency_key.trim() : null,
  };

  return {
    event,
    day: merged,
    log_action: "created",
  };
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

  const canonical = await readCanonicalTrackingData();
  const now = new Date();
  const loggedAt = formatSeattleIso(now);

  const existing =
    canonical.food.days.find((row) => row.date === date) || normalizeDietDay({ date, status: "incomplete", ai_summary: "" });
  const replaced = replaceDayTotals(existing, nutrients);
  const detailsInput = ["updated", normalizeText(description), normalizeText(input_text), normalizeText(notes)]
    .filter(Boolean)
    .join(" | ");
  replaced.ai_summary = appendDayDetails(existing.ai_summary, detailsInput, loggedAt);

  canonical.food.days = upsertDietDay(canonical.food.days, replaced);
  canonical.rules.metadata = {
    ...asObject(canonical.rules.metadata),
    last_updated: loggedAt,
  };

  await writeCanonicalTrackingData(canonical);

  const event = {
    id,
    date,
    logged_at: loggedAt,
    rollover_applied: date !== getSeattleDateString(now),
    source: normalizeText(source) || "manual",
    description: normalizeOptionalText(description),
    input_text: typeof input_text === "string" ? input_text : null,
    notes: normalizeOptionalText(notes),
    nutrients: { ...legacyTotalsFromDay(replaced), ...asObject(nutrients) },
    model: model ?? null,
    confidence: confidence ?? null,
    items: asArray(raw_items),
    idempotency_key: typeof idempotency_key === "string" && idempotency_key.trim() ? idempotency_key.trim() : null,
  };

  return {
    event,
    day: replaced,
    log_action: "updated",
  };
}

export async function getDailyTotalsForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return legacyTotalsFromDay(day);
}

export async function clearFoodEntriesForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);

  const canonical = await readCanonicalTrackingData();
  const before = canonical.food.days.length;
  canonical.food.days = canonical.food.days.filter((row) => row.date !== date);
  const removed = before - canonical.food.days.length;

  if (removed > 0) {
    canonical.rules.metadata = {
      ...asObject(canonical.rules.metadata),
      last_updated: formatSeattleIso(new Date()),
    };
    await writeCanonicalTrackingData(canonical);
  }

  return {
    date,
    removed_count: removed,
    day: null,
  };
}

function legacyCurrentWeekForUpdate(canonical, now = new Date()) {
  const currentWeek = findCurrentWeek(canonical, now);
  if (!currentWeek) return null;
  const block = canonical.activity.blocks.find((row) => row.block_id === currentWeek.block_id) || null;
  return canonicalWeekToLegacy(currentWeek, block);
}

function weekFromLegacyPatch(legacyWeek, fallbackWeek, blockId) {
  const safeLegacy = asObject(legacyWeek);
  const safeFallback = normalizeWeek(fallbackWeek) || normalizeWeek({ week_start: getWeekStartMonday(getSeattleDateString()) });

  const rows = asArray(safeLegacy[DEFAULT_CATEGORY_KEY]);
  const workouts = rows
    .map((row, index) => {
      const safeRow = asObject(row);
      const fallback = asArray(safeFallback.workouts)[index] || null;
      const name = normalizeText(safeRow.item || safeRow.name || fallback?.name);
      if (!name) return null;
      return {
        name,
        details: normalizeOptionalText(safeRow.details || fallback?.details),
        completed: safeRow.checked === true || safeRow.completed === true,
        date: isIsoDateString(safeRow.date) ? safeRow.date : isIsoDateString(fallback?.date) ? fallback.date : null,
      };
    })
    .filter(Boolean);

  return normalizeWeek({
    week_start: safeFallback.week_start,
    week_end: safeFallback.week_end,
    block_id: blockId || safeFallback.block_id,
    workouts,
    ai_summary:
      typeof safeLegacy.ai_summary === "string"
        ? safeLegacy.ai_summary
        : typeof safeLegacy.summary === "string"
          ? safeLegacy.summary
          : safeFallback.ai_summary,
    context: typeof safeLegacy.context === "string" ? safeLegacy.context : safeFallback.context,
  });
}

export async function updateCurrentWeekItem({ category, index, checked, details, date = null }) {
  if (typeof category !== "string" || !category.trim()) throw new Error(`Invalid category: ${category}`);
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid index: ${index}`);
  if (typeof checked !== "boolean") throw new Error("Invalid checked value");
  if (typeof details !== "string") throw new Error("Invalid details value");
  if (!(date === null || isIsoDateString(date))) throw new Error(`Invalid date: ${date}`);

  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical);
  const current = ensured.currentWeek;
  if (!current) throw new Error("Missing current week");

  const legacyCurrent = legacyCurrentWeekForUpdate(ensured.data);
  if (!legacyCurrent) throw new Error("Missing current week");

  const categoryKey = resolveFitnessCategoryKey(legacyCurrent, category);
  if (!categoryKey) throw new Error(`Invalid category: ${category}`);
  const list = asArray(legacyCurrent[categoryKey]);
  if (!list[index]) throw new Error("Item not found");

  list[index] = {
    ...asObject(list[index]),
    checked,
    details,
    date: date ?? (isIsoDateString(asObject(list[index]).date) ? asObject(list[index]).date : null),
  };
  legacyCurrent[categoryKey] = list;

  const patched = weekFromLegacyPatch(legacyCurrent, current, current.block_id);
  ensured.data.activity.weeks = upsertWeek(ensured.data.activity.weeks, patched);
  ensured.data.rules.metadata = {
    ...asObject(ensured.data.rules.metadata),
    last_updated: formatSeattleIso(new Date()),
  };

  await writeCanonicalTrackingData(ensured.data);

  const block = ensured.data.activity.blocks.find((row) => row.block_id === patched.block_id) || null;
  return canonicalWeekToLegacy(patched, block);
}

export async function updateCurrentWeekItems(updates) {
  if (!Array.isArray(updates) || !updates.length) throw new Error("Missing updates");

  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical);
  const current = ensured.currentWeek;
  if (!current) throw new Error("Missing current week");

  const legacyCurrent = legacyCurrentWeekForUpdate(ensured.data);
  if (!legacyCurrent) throw new Error("Missing current week");

  for (const update of updates) {
    if (typeof update?.category !== "string" || !update.category.trim()) {
      throw new Error(`Invalid category: ${update?.category}`);
    }
    if (!Number.isInteger(update?.index) || update.index < 0) throw new Error(`Invalid index: ${update?.index}`);
    if (typeof update?.checked !== "boolean") throw new Error("Invalid checked value");
    if (typeof update?.details !== "string") throw new Error("Invalid details value");
    if (!(update?.date === undefined || update?.date === null || isIsoDateString(update.date))) {
      throw new Error(`Invalid date: ${update?.date}`);
    }

    const categoryKey = resolveFitnessCategoryKey(legacyCurrent, update.category);
    if (!categoryKey) throw new Error(`Invalid category: ${update.category}`);

    const list = asArray(legacyCurrent[categoryKey]);
    if (!list[update.index]) throw new Error("Item not found");
    list[update.index] = {
      ...asObject(list[update.index]),
      checked: update.checked,
      details: update.details,
      date:
        update?.date === undefined
          ? isIsoDateString(asObject(list[update.index]).date)
            ? asObject(list[update.index]).date
            : null
          : update.date,
    };
    legacyCurrent[categoryKey] = list;
  }

  const patched = weekFromLegacyPatch(legacyCurrent, current, current.block_id);
  ensured.data.activity.weeks = upsertWeek(ensured.data.activity.weeks, patched);
  ensured.data.rules.metadata = {
    ...asObject(ensured.data.rules.metadata),
    last_updated: formatSeattleIso(new Date()),
  };

  await writeCanonicalTrackingData(ensured.data);

  const block = ensured.data.activity.blocks.find((row) => row.block_id === patched.block_id) || null;
  return canonicalWeekToLegacy(patched, block);
}

export async function updateCurrentWeekSummary(summary) {
  if (typeof summary !== "string") throw new Error("Invalid summary");

  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical);
  const current = ensured.currentWeek;
  if (!current) throw new Error("Missing current week");

  const next = normalizeWeek({
    ...current,
    ai_summary: summary,
  });
  ensured.data.activity.weeks = upsertWeek(ensured.data.activity.weeks, next);
  ensured.data.rules.metadata = {
    ...asObject(ensured.data.rules.metadata),
    last_updated: formatSeattleIso(new Date()),
  };

  await writeCanonicalTrackingData(ensured.data);

  const block = ensured.data.activity.blocks.find((row) => row.block_id === next.block_id) || null;
  return canonicalWeekToLegacy(next, block);
}

export async function updateCurrentWeekContext(context) {
  const text = normalizeOptionalText(context);

  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical);
  const current = ensured.currentWeek;
  if (!current) throw new Error("Missing current week");

  const next = normalizeWeek({
    ...current,
    context: text,
  });
  ensured.data.activity.weeks = upsertWeek(ensured.data.activity.weeks, next);
  ensured.data.rules.metadata = {
    ...asObject(ensured.data.rules.metadata),
    last_updated: formatSeattleIso(new Date()),
  };

  await writeCanonicalTrackingData(ensured.data);

  const block = ensured.data.activity.blocks.find((row) => row.block_id === next.block_id) || null;
  return canonicalWeekToLegacy(next, block);
}

export async function listFitnessWeeks({ limit = 12 } = {}) {
  const canonical = await readCanonicalTrackingData();
  const history = currentWeekHistory(canonical);
  const safeLimit = Math.max(0, Number(limit) || 0);
  const picked = safeLimit > 0 ? history.slice(-safeLimit) : history;

  const blockById = new Map(canonical.activity.blocks.map((block) => [block.block_id, block]));
  return picked.map((week) => canonicalWeekToLegacy(week, blockById.get(week.block_id))).filter(Boolean);
}

export async function listActivityWeeks({ limit = 12 } = {}) {
  const canonical = await readCanonicalTrackingData();
  const history = currentWeekHistory(canonical);
  const safeLimit = Math.max(0, Number(limit) || 0);
  const picked = safeLimit > 0 ? history.slice(-safeLimit) : history;

  const blockById = new Map(canonical.activity.blocks.map((block) => [block.block_id, block]));
  return picked.map((week) => canonicalWeekToView(week, blockById.get(week.block_id))).filter(Boolean);
}

export async function updateCurrentActivityWorkout({ index, completed, details, date = null }) {
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid workout index: ${index}`);
  if (typeof completed !== "boolean") throw new Error("Invalid completed value");
  if (typeof details !== "string") throw new Error("Invalid details value");
  if (!(date === null || isIsoDateString(date))) throw new Error(`Invalid date: ${date}`);

  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical);
  const current = ensured.currentWeek;
  if (!current) throw new Error("Missing current week");

  const workouts = asArray(current.workouts).map((row) => ({
    name: normalizeText(row?.name),
    details: normalizeOptionalText(row?.details),
    completed: row?.completed === true,
    date: isIsoDateString(row?.date) ? row.date : null,
  }));
  const target = workouts[index];
  if (!target || !target.name) throw new Error("Workout not found");

  workouts[index] = {
    ...target,
    details: normalizeOptionalText(details),
    completed,
    date: date ?? target.date ?? null,
  };

  const next = normalizeWeek({
    ...current,
    workouts,
  });
  ensured.data.activity.weeks = upsertWeek(ensured.data.activity.weeks, next);
  ensured.data.rules.metadata = {
    ...asObject(ensured.data.rules.metadata),
    last_updated: formatSeattleIso(new Date()),
  };
  await writeCanonicalTrackingData(ensured.data);

  const block = ensured.data.activity.blocks.find((row) => row.block_id === next.block_id) || null;
  return canonicalWeekToView(next, block);
}

export async function updateCurrentActivityWeekSummary(summary) {
  if (typeof summary !== "string") throw new Error("Invalid summary");

  const canonical = await readCanonicalTrackingData();
  const ensured = ensureCurrentWeekInCanonical(canonical);
  const current = ensured.currentWeek;
  if (!current) throw new Error("Missing current week");

  const next = normalizeWeek({
    ...current,
    ai_summary: summary,
  });
  ensured.data.activity.weeks = upsertWeek(ensured.data.activity.weeks, next);
  ensured.data.rules.metadata = {
    ...asObject(ensured.data.rules.metadata),
    last_updated: formatSeattleIso(new Date()),
  };
  await writeCanonicalTrackingData(ensured.data);

  const block = ensured.data.activity.blocks.find((row) => row.block_id === next.block_id) || null;
  return canonicalWeekToView(next, block);
}

export function summarizeTrainingBlocks(data) {
  const canonical = extractCanonicalFromIncoming(data);
  const metadata = metadataTrainingBlocksFromCanonical(canonical.activity, canonical.rules.metadata);
  const trainingBlocks = asObject(metadata.training_blocks);
  const blocks = asArray(trainingBlocks.blocks);

  return {
    active_block_id: normalizeOptionalText(trainingBlocks.active_block_id) || null,
    blocks: blocks.map((block) => ({
      id: normalizeOptionalText(block.id),
      name: normalizeOptionalText(block.name),
      description: normalizeOptionalText(block.description),
      category_order: asArray(block.category_order).filter((value) => typeof value === "string"),
      category_labels: asObject(block.category_labels),
      workouts: asArray(block.workouts).map((row) => ({
        name: normalizeOptionalText(row?.name),
        description: normalizeOptionalText(row?.description),
        category: normalizeOptionalText(row?.category),
        optional: row?.optional === true,
      })),
      block_start: isIsoDateString(block.block_start) ? block.block_start : "",
      block_end: isIsoDateString(block.block_end) ? block.block_end : "",
      updated_at: typeof block.updated_at === "string" ? block.updated_at : "",
    })),
  };
}

export async function listFoodDays({ limit = 0, from = null, to = null } = {}) {
  if (from !== null && !isIsoDateString(from)) throw new Error(`Invalid from date: ${from}`);
  if (to !== null && !isIsoDateString(to)) throw new Error(`Invalid to date: ${to}`);

  const canonical = await readCanonicalTrackingData();
  let rows = canonical.food.days.map((row) => normalizeDietDay(row)).filter(Boolean);

  if (from) rows = rows.filter((row) => row.date >= from);
  if (to) rows = rows.filter((row) => row.date <= to);

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const safeLimit = Math.max(0, Number(limit) || 0);
  if (safeLimit > 0) rows = rows.slice(0, safeLimit);

  return rows;
}

export async function getFoodDayForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return day ? normalizeDietDay(day) : null;
}
