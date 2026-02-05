import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const TRACKING_FILE = path.resolve(process.cwd(), "tracking-data.json");
const TIME_ZONE = "America/Los_Angeles";
const DAY_MS = 24 * 60 * 60 * 1000;

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

export async function readTrackingData() {
  const raw = await fs.readFile(TRACKING_FILE, "utf8");
  return JSON.parse(raw);
}

export async function writeTrackingData(data) {
  await atomicWriteJson(TRACKING_FILE, data);
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

  const template = prevCurrent ?? data.fitness_weeks[data.fitness_weeks.length - 1] ?? {};
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

  data.current_week = {
    week_start: weekStart,
    week_label: weekLabelFromStart(weekStart),
    cardio: resetCategory("cardio"),
    strength: resetCategory("strength"),
    mobility: resetCategory("mobility"),
    other: resetCategory("other"),
    summary: "",
  };

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

function dayOfWeekFromDateString(dateStr) {
  const d = parseIsoDateAsUtcNoon(dateStr);
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(d);
}

function mergeNutrient(currentValue, deltaValue) {
  if (typeof deltaValue === "number" && Number.isFinite(deltaValue)) {
    if (typeof currentValue === "number" && Number.isFinite(currentValue)) return currentValue + deltaValue;
    return deltaValue;
  }
  return currentValue ?? null;
}

function applyFoodEventToFoodLogInData(data, { date, nutrients, defaultNotes = "" }) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  if (!nutrients || typeof nutrients !== "object") throw new Error("Missing nutrients");

  if (!Array.isArray(data.food_log)) data.food_log = [];
  const idx = data.food_log.findIndex((row) => row && row.date === date);
  const prev = idx >= 0 ? data.food_log[idx] : null;

  const next = {
    date,
    day_of_week: prev?.day_of_week ?? dayOfWeekFromDateString(date),
    weight_lb: prev?.weight_lb ?? null,

    calories: mergeNutrient(prev?.calories, nutrients.calories),
    fat_g: mergeNutrient(prev?.fat_g, nutrients.fat_g),
    carbs_g: mergeNutrient(prev?.carbs_g, nutrients.carbs_g),
    protein_g: mergeNutrient(prev?.protein_g, nutrients.protein_g),

    fiber_g: mergeNutrient(prev?.fiber_g, nutrients.fiber_g),
    potassium_mg: mergeNutrient(prev?.potassium_mg, nutrients.potassium_mg),
    magnesium_mg: mergeNutrient(prev?.magnesium_mg, nutrients.magnesium_mg),
    omega3_mg: mergeNutrient(prev?.omega3_mg, nutrients.omega3_mg),
    calcium_mg: mergeNutrient(prev?.calcium_mg, nutrients.calcium_mg),
    iron_mg: mergeNutrient(prev?.iron_mg, nutrients.iron_mg),

    status: prev?.status ?? "⚪",
    notes: typeof prev?.notes === "string" ? prev.notes : defaultNotes,
  };

  if (idx >= 0) data.food_log[idx] = next;
  else data.food_log.push(next);
  return next;
}

export async function addFoodEvent({
  date,
  source,
  description,
  notes,
  nutrients,
  model,
  confidence,
  raw_items,
}) {
  const data = await readTrackingData();
  const now = new Date();
  const loggedAt = formatSeattleIso(now);
  const seattleDate = getSeattleDateString(now);

  if (!Array.isArray(data.food_events)) data.food_events = [];

  const event = {
    id: crypto.randomUUID(),
    date,
    logged_at: loggedAt,
    rollover_applied: date !== seattleDate,
    source,
    description,
    notes,
    nutrients,
    model,
    confidence,
    items: raw_items,
  };

  data.food_events.push(event);

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = loggedAt;
  }

  const foodLogRow = applyFoodEventToFoodLogInData(data, {
    date,
    nutrients,
    defaultNotes: "Auto-updated from food_events.",
  });
  event.applied_to_food_log = true;

  await writeTrackingData(data);
  return { event, food_log: foodLogRow };
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

    applyFoodEventToFoodLogInData(data, {
      date,
      nutrients: e.nutrients,
      defaultNotes: "Auto-updated from food_events.",
    });
    e.applied_to_food_log = true;
    syncedCount += 1;
  }

  if (syncedCount > 0 && data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = formatSeattleIso(new Date());
  }
  if (syncedCount > 0) {
    await writeTrackingData(data);
  }

  const foodLogRow = Array.isArray(data.food_log) ? data.food_log.find((r) => r && r.date === date) ?? null : null;
  return { synced_count: syncedCount, food_log: foodLogRow };
}

export async function getDailyFoodEventTotals(date) {
  const data = await readTrackingData();
  const events = Array.isArray(data.food_events) ? data.food_events : [];
  const nutrients = events.filter((e) => e && e.date === date && e.nutrients).map((e) => e.nutrients);

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

export async function getFoodEventsForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const data = await readTrackingData();
  const events = Array.isArray(data.food_events) ? data.food_events : [];
  return events.filter((e) => e && e.date === date);
}

export async function updateCurrentWeekItem({ category, index, checked, details }) {
  const allowed = new Set(["cardio", "strength", "mobility", "other"]);
  if (!allowed.has(category)) throw new Error(`Invalid category: ${category}`);
  if (!Number.isInteger(index) || index < 0) throw new Error(`Invalid index: ${index}`);
  if (typeof checked !== "boolean") throw new Error("Invalid checked value");
  if (typeof details !== "string") throw new Error("Invalid details value");

  const data = await readTrackingData();
  const { current_week } = ensureCurrentWeekInData(data, new Date());
  const list = Array.isArray(current_week[category]) ? current_week[category] : [];
  if (!list[index]) throw new Error("Item not found");

  list[index] = {
    ...list[index],
    checked,
    details,
  };
  current_week[category] = list;

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

export async function getFoodLogForDate(date) {
  if (!isIsoDateString(date)) throw new Error(`Invalid date: ${date}`);
  const data = await readTrackingData();
  const log = Array.isArray(data.food_log) ? data.food_log : [];
  return log.find((d) => d && d.date === date) ?? null;
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

  const autoGeneratedNotes = "Auto-generated from food_events.";
  const isAutoGenerated = prev?.notes === autoGeneratedNotes || (typeof prev?.notes === "string" && prev.notes.startsWith(autoGeneratedNotes));
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
    notes: prev?.notes ?? autoGeneratedNotes,
  };

  if (idx >= 0) data.food_log[idx] = next;
  else data.food_log.push(next);

  if (data.metadata && typeof data.metadata === "object") {
    data.metadata.last_updated = formatSeattleIso(new Date());
  }
  await writeTrackingData(data);
  return { applied: true, food_log: next, totals_from_events: totals };
}
