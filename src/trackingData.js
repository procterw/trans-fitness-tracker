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
const LEGACY_EXTRA_NUMERIC_KEYS = ["potassium_mg", "magnesium_mg", "omega3_mg", "calcium_mg", "iron_mg"];

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

function dayOfWeekFromDateString(dateStr) {
  const d = parseIsoDateAsUtcNoon(dateStr);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d);
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
    block_name: normalizeOptionalText(safe.block_name || safe.name),
    block_details: normalizeOptionalText(safe.block_details || safe.description),
    workouts,
  };
}

function normalizeWeekWorkout(entry) {
  const safe = asObject(entry);
  const name = normalizeText(safe.name || safe.item);
  if (!name) return null;
  return {
    name,
    details: normalizeOptionalText(safe.details),
    completed: safe.completed === true || safe.checked === true,
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
    summary: normalizeOptionalText(safe.summary),
  };
}

function normalizeDietDay(row) {
  const safe = asObject(row);
  const date = isIsoDateString(safe.date) ? safe.date : null;
  if (!date) return null;
  const out = {
    date,
    weight_lb: toNumberOrNull(safe.weight_lb),
    complete: safe.complete === true,
    details: normalizeOptionalText(safe.details || safe.notes),
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

function metadataBlockToCanonical(block) {
  const safe = asObject(block);
  const blockId = normalizeText(safe.id || safe.block_id);
  if (!blockId) return null;

  const workouts = [];
  const checklist = asObject(safe.checklist);
  const order = asArray(safe.category_order).filter((k) => typeof k === "string" && k.trim());
  const labels = asObject(safe.category_labels);
  for (const key of order) {
    const list = asArray(checklist[key]);
    const label = normalizeText(labels[key]) || key;
    for (const item of list) {
      const safeItem = asObject(item);
      const name = normalizeText(safeItem.item || safeItem.name);
      if (!name) continue;
      workouts.push({
        name,
        description: normalizeOptionalText(safeItem.description),
        category: label,
        optional: false,
      });
    }
  }

  return normalizeBlock({
    block_id: blockId,
    block_start: safe.block_start,
    block_name: safe.name || safe.block_name,
    block_details: safe.description || safe.block_details,
    workouts,
  });
}

function legacyWeekRows(legacyWeek) {
  const safe = asObject(legacyWeek);
  if (Array.isArray(safe.workouts)) return safe.workouts;

  const rows = [];
  for (const key of getFitnessCategoryKeys(safe)) {
    const list = asArray(safe[key]);
    for (const item of list) {
      const safeItem = asObject(item);
      rows.push({
        name: safeItem.item,
        details: safeItem.details,
        completed: safeItem.checked === true,
      });
    }
  }
  return rows;
}

function legacyWeekToCanonical(legacyWeek, activeBlockId = "") {
  const safe = asObject(legacyWeek);
  const weekStart = isIsoDateString(safe.week_start) ? safe.week_start : null;
  if (!weekStart) return null;

  const workouts = [];
  const seen = new Set();
  for (const row of legacyWeekRows(safe)) {
    const normalized = normalizeWeekWorkout(row);
    if (!normalized) continue;
    const token = normalized.name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    workouts.push(normalized);
  }

  return normalizeWeek({
    week_start: weekStart,
    week_end: isIsoDateString(safe.week_end) ? safe.week_end : getWeekEndSunday(weekStart),
    block_id: safe.block_id || safe.training_block_id || activeBlockId,
    workouts,
    summary: safe.summary,
  });
}

function mergeLegacyIntoCanonical({ canonical, legacy }) {
  const out = {
    profile: normalizeProfileData(canonical.profile),
    activity: {
      blocks: canonicalizeBlocks(canonical.activity?.blocks),
      weeks: canonicalizeWeeks(canonical.activity?.weeks),
    },
    food: {
      days: canonicalizeDays(canonical.food?.days),
    },
    rules: ensureMetadataFields(canonical.rules),
  };

  const old = asObject(legacy);

  if (!out.profile.general && typeof old.user_profile === "string") out.profile.general = old.user_profile;
  if (!out.profile.fitness && typeof old.training_profile === "string") out.profile.fitness = old.training_profile;
  if (!out.profile.diet && typeof old.diet_profile === "string") out.profile.diet = old.diet_profile;
  if (!out.profile.agent && typeof old.agent_profile === "string") out.profile.agent = old.agent_profile;

  if (!out.food.days.length && Array.isArray(old.food_log)) {
    out.food.days = canonicalizeDays(old.food_log.map((row) => ({
      date: row?.date,
      weight_lb: row?.weight_lb,
      calories: row?.calories,
      fat_g: row?.fat_g,
      carbs_g: row?.carbs_g,
      protein_g: row?.protein_g,
      fiber_g: row?.fiber_g,
      complete: row?.complete === true,
      details: row?.details ?? row?.notes ?? "",
    })));
  }

  const metadata = asObject(out.rules.metadata);
  const legacyBlocks = asArray(metadata?.training_blocks?.blocks).map(metadataBlockToCanonical).filter(Boolean);
  if (!out.activity.blocks.length && legacyBlocks.length) {
    out.activity.blocks = canonicalizeBlocks(legacyBlocks);
  }

  if (!out.activity.weeks.length) {
    const activeBlockId = normalizeText(metadata?.training_blocks?.active_block_id);
    const fromHistory = asArray(old.fitness_weeks).map((row) => legacyWeekToCanonical(row, activeBlockId)).filter(Boolean);
    const currentWeek = legacyWeekToCanonical(old.current_week, activeBlockId);
    const rows = [...fromHistory];
    if (currentWeek && !rows.some((row) => row.week_start === currentWeek.week_start)) rows.push(currentWeek);
    out.activity.weeks = canonicalizeWeeks(rows);
  }

  out.rules = ensureMetadataFields({
    ...out.rules,
    metadata: {
      ...asObject(old.metadata),
      ...asObject(out.rules.metadata),
    },
    diet_philosophy: Object.keys(asObject(old.diet_philosophy)).length ? asObject(old.diet_philosophy) : out.rules.diet_philosophy,
    fitness_philosophy: Object.keys(asObject(old.fitness_philosophy)).length
      ? asObject(old.fitness_philosophy)
      : out.rules.fitness_philosophy,
    assistant_rules: Object.keys(asObject(old.assistant_rules)).length ? asObject(old.assistant_rules) : out.rules.assistant_rules,
  });

  return out;
}

function normalizeCanonicalData(candidate) {
  const safe = asObject(candidate);
  const canonical = {
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

  return mergeLegacyIntoCanonical({ canonical, legacy: safe });
}

function upsertWeek(weeks, nextWeek) {
  const out = [...asArray(weeks).filter((week) => week && week.week_start !== nextWeek.week_start), nextWeek];
  out.sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));
  return out;
}

function ensureCurrentWeekInCanonical(canonical, now = new Date()) {
  const seattleDate = getSeattleDateString(now);
  const weekStart = getWeekStartMonday(seattleDate);
  const safe = normalizeCanonicalData(canonical);

  let current = safe.activity.weeks.find((week) => week.week_start === weekStart) || null;
  if (current) return { data: safe, currentWeek: current, changed: false };

  const metadata = asObject(safe.rules.metadata);
  const activeBlockId =
    normalizeText(metadata?.training_blocks?.active_block_id) ||
    normalizeText(safe.activity.blocks[safe.activity.blocks.length - 1]?.block_id);
  const activeBlock = safe.activity.blocks.find((block) => block.block_id === activeBlockId) || safe.activity.blocks[safe.activity.blocks.length - 1] || null;

  current = {
    week_start: weekStart,
    week_end: getWeekEndSunday(weekStart),
    block_id: normalizeText(activeBlock?.block_id),
    workouts: asArray(activeBlock?.workouts).map((workout) => ({
      name: workout.name,
      details: "",
      completed: false,
    })),
    summary: "",
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
  const activeBlockId = activeFromMeta || normalizeText(blocks[blocks.length - 1]?.block_id) || null;

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
    };
  });

  return {
    week_start: safeWeek.week_start,
    week_label: weekLabelFromStart(safeWeek.week_start),
    summary: normalizeOptionalText(safeWeek.summary),
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

function canonicalDayToLegacyRow(day) {
  const safe = normalizeDietDay(day);
  if (!safe) return null;
  const row = {
    date: safe.date,
    day_of_week: dayOfWeekFromDateString(safe.date),
    weight_lb: safe.weight_lb,
    calories: safe.calories,
    fat_g: safe.fat_g,
    carbs_g: safe.carbs_g,
    protein_g: safe.protein_g,
    fiber_g: safe.fiber_g,
    status: safe.complete ? "🟢" : "⚪",
    healthy: safe.complete ? "🟢" : "⚪",
    notes: normalizeOptionalText(safe.details),
  };
  for (const key of LEGACY_EXTRA_NUMERIC_KEYS) row[key] = null;
  return row;
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

  const currentWeekStart = getWeekStartMonday(getSeattleDateString(now));
  const currentWeek = data.activity.weeks.find((week) => week.week_start === currentWeekStart) || null;
  const historyWeeks = data.activity.weeks.filter((week) => week.week_start !== currentWeekStart);

  const blockById = new Map(data.activity.blocks.map((block) => [block.block_id, block]));

  const metadata = metadataTrainingBlocksFromCanonical(data.activity, asObject(data.rules.metadata));
  const rules = {
    ...data.rules,
    metadata,
  };

  const payload = {
    ...rules,
    general: data.profile.general,
    fitness: data.profile.fitness,
    diet: data.profile.diet,
    agent: data.profile.agent,
    profile: data.profile,
    blocks: data.activity.blocks,
    weeks: data.activity.weeks,
    training: data.activity,
    days: data.food.days,
    diet_data: data.food,

    // Temporary compatibility aliases for the existing server and assistant paths.
    user_profile: data.profile.general,
    training_profile: data.profile.fitness,
    diet_profile: data.profile.diet,
    agent_profile: data.profile.agent,
    food_log: data.food.days.map(canonicalDayToLegacyRow).filter(Boolean),
    food_events: [],
    current_week: currentWeek ? canonicalWeekToLegacy(currentWeek, blockById.get(currentWeek.block_id)) : null,
    fitness_weeks: historyWeeks
      .map((week) => canonicalWeekToLegacy(week, blockById.get(week.block_id)))
      .filter(Boolean),
  };

  return { payload, canonical: data, changed: ensured.changed };
}

function extractCanonicalFromIncoming(data) {
  const safe = asObject(data);
  const profile = {
    general: normalizeOptionalText(safe.general || safe?.profile?.general || safe.user_profile),
    fitness: normalizeOptionalText(safe.fitness || safe?.profile?.fitness || safe.training_profile),
    diet: normalizeOptionalText(safe.diet || safe?.profile?.diet || safe.diet_profile),
    agent: normalizeOptionalText(safe.agent || safe?.profile?.agent || safe.agent_profile),
  };

  const blocks = canonicalizeBlocks(safe.blocks || safe?.training?.blocks || safe?.activity?.blocks);
  const weeks = canonicalizeWeeks(safe.weeks || safe?.training?.weeks || safe?.activity?.weeks);

  const days = canonicalizeDays(
    safe.days ||
      safe?.diet_data?.days ||
      safe?.food?.days ||
      asArray(safe.food_log).map((row) => ({
        date: row?.date,
        weight_lb: row?.weight_lb,
        calories: row?.calories,
        fat_g: row?.fat_g,
        carbs_g: row?.carbs_g,
        protein_g: row?.protein_g,
        fiber_g: row?.fiber_g,
        complete: row?.complete === true,
        details: row?.details ?? row?.notes ?? "",
      })),
  );

  const derivedFromLegacy = mergeLegacyIntoCanonical({
    canonical: {
      profile,
      activity: { blocks, weeks },
      food: { days },
      rules: normalizeRulesData(safe.rules || safe),
    },
    legacy: safe,
  });

  return normalizeCanonicalData(derivedFromLegacy);
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

    // fallback if files still contain old shape
    ...foodRaw,
    ...activityRaw,
    ...profileRaw,
    ...rulesRaw,
  });

  return canonical;
}

async function writeCanonicalTrackingData(canonical) {
  const safe = normalizeCanonicalData(canonical);
  safe.rules = ensureMetadataFields(safe.rules);
  safe.rules.metadata.last_updated = formatSeattleIso(new Date());

  if (USE_POSTGRES_BACKEND) {
    const legacyPayload = buildReadPayloadFromCanonical(safe).payload;
    await writeTrackingDataPostgres(legacyPayload);
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

  const existing = canonical.food.days.find((row) => row.date === date) || normalizeDietDay({ date, complete: false, details: "" });
  const merged = mergeNutrientsIntoDay(existing, nutrients);

  const detailsInput = [normalizeText(description), normalizeText(input_text), normalizeText(notes)].filter(Boolean).join(" | ");
  merged.details = appendDayDetails(existing.details, detailsInput, loggedAt);

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
    applied_to_food_log: true,
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

  const existing = canonical.food.days.find((row) => row.date === date) || normalizeDietDay({ date, complete: false, details: "" });
  const replaced = replaceDayTotals(existing, nutrients);
  const detailsInput = ["updated", normalizeText(description), normalizeText(input_text), normalizeText(notes)]
    .filter(Boolean)
    .join(" | ");
  replaced.details = appendDayDetails(existing.details, detailsInput, loggedAt);

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
    applied_to_food_log: true,
  };

  return {
    event,
    day: replaced,
    log_action: "updated",
  };
}

export async function syncFoodEventsToFoodLog({ date }) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return {
    synced_count: 0,
    day,
  };
}

export async function getDailyTotalsForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return legacyTotalsFromDay(day);
}

export async function getDailyFoodEventTotals(date) {
  return getDailyTotalsForDate(date);
}

export async function getFoodEventsForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  return [];
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
      };
    })
    .filter(Boolean);

  return normalizeWeek({
    week_start: safeFallback.week_start,
    week_end: safeFallback.week_end,
    block_id: blockId || safeFallback.block_id,
    workouts,
    summary: typeof safeLegacy.summary === "string" ? safeLegacy.summary : safeFallback.summary,
  });
}

export async function updateCurrentWeekItem({ category, index, checked, details }) {
  if (typeof category !== "string" || !category.trim()) throw new Error(`Invalid category: ${category}`);
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid index: ${index}`);
  if (typeof checked !== "boolean") throw new Error("Invalid checked value");
  if (typeof details !== "string") throw new Error("Invalid details value");

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

    const categoryKey = resolveFitnessCategoryKey(legacyCurrent, update.category);
    if (!categoryKey) throw new Error(`Invalid category: ${update.category}`);

    const list = asArray(legacyCurrent[categoryKey]);
    if (!list[update.index]) throw new Error("Item not found");
    list[update.index] = {
      ...asObject(list[update.index]),
      checked: update.checked,
      details: update.details,
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
    summary,
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
      updated_at: typeof block.updated_at === "string" ? block.updated_at : "",
    })),
  };
}

export async function listFoodLog({ limit = 0, from = null, to = null } = {}) {
  if (from !== null && !isIsoDateString(from)) throw new Error(`Invalid from date: ${from}`);
  if (to !== null && !isIsoDateString(to)) throw new Error(`Invalid to date: ${to}`);

  const canonical = await readCanonicalTrackingData();
  let rows = canonical.food.days.map(canonicalDayToLegacyRow).filter(Boolean);

  if (from) rows = rows.filter((row) => row.date >= from);
  if (to) rows = rows.filter((row) => row.date <= to);

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const safeLimit = Math.max(0, Number(limit) || 0);
  if (safeLimit > 0) rows = rows.slice(0, safeLimit);

  return rows;
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

export async function getFoodLogForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return day ? canonicalDayToLegacyRow(day) : null;
}

export async function getFoodDayForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return day ? normalizeDietDay(day) : null;
}

export async function rollupFoodLogFromEvents(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const canonical = await readCanonicalTrackingData();
  const day = canonical.food.days.find((row) => row.date === date) || null;
  return day ? canonicalDayToLegacyRow(day) : null;
}
