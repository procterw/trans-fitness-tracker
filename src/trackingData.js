import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const TRACKING_FILE = path.resolve(process.cwd(), "tracking-data.json");
const TIME_ZONE = "America/Los_Angeles";

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

  await writeTrackingData(data);
  return event;
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
