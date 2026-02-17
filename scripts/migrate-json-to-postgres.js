#!/usr/bin/env node
import "dotenv/config";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import { toFitnessChecklistStorage } from "../src/fitnessChecklist.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;

const TRACKING_FOOD_FILE = process.env.TRACKING_FOOD_FILE
  ? path.resolve(process.env.TRACKING_FOOD_FILE)
  : path.resolve(repoRoot, "tracking-food.json");
const TRACKING_ACTIVITY_FILE = process.env.TRACKING_ACTIVITY_FILE
  ? path.resolve(process.env.TRACKING_ACTIVITY_FILE)
  : path.resolve(repoRoot, "tracking-activity.json");
const TRACKING_PROFILE_FILE = process.env.TRACKING_PROFILE_FILE
  ? path.resolve(process.env.TRACKING_PROFILE_FILE)
  : path.resolve(repoRoot, "tracking-profile.json");
const TRACKING_RULES_FILE = process.env.TRACKING_RULES_FILE
  ? path.resolve(process.env.TRACKING_RULES_FILE)
  : path.resolve(repoRoot, "tracking-rules.json");

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Missing required environment variable: ${name}`);
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function toNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isUuid(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hashToUuid(seed) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const variantNibble = ["8", "9", "a", "b"][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function eventFingerprint(eventRow) {
  return JSON.stringify([
    eventRow.date ?? null,
    eventRow.logged_at ?? null,
    eventRow.source ?? null,
    eventRow.description ?? null,
    eventRow.input_text ?? null,
    eventRow.notes ?? null,
  ]);
}

function chunk(items, size = INSERT_CHUNK_SIZE) {
  if (!items.length) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function fetchAllRowsForUser({ client, table, columns, userId, orderBy, ascending = true }) {
  const rows = [];
  let offset = 0;

  while (true) {
    let query = client.from(table).select(columns).eq("user_id", userId).range(offset, offset + PAGE_SIZE - 1);
    if (orderBy) query = query.order(orderBy, { ascending });

    const { data, error } = await query;
    if (error) throw new Error(`Supabase select from ${table} failed: ${error.message}`);

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

async function upsertInChunks({ client, table, rows, onConflict }) {
  const chunks = chunk(rows);
  for (const c of chunks) {
    const { error } = await client.from(table).upsert(c, { onConflict });
    if (error) throw new Error(`Supabase upsert into ${table} failed: ${error.message}`);
  }
}

async function insertInChunks({ client, table, rows }) {
  const chunks = chunk(rows);
  for (const c of chunks) {
    const { error } = await client.from(table).insert(c);
    if (error) throw new Error(`Supabase insert into ${table} failed: ${error.message}`);
  }
}

function mapFoodLogRow(userId, row) {
  const micronutrients = asObject(row?.micronutrients);
  const legacyMicros = asObject(row?.micronutrients_legacy);

  const fiber = toNumberOrNull(row?.fiber_g) ?? toNumberOrNull(micronutrients.fiber_g) ?? toNumberOrNull(legacyMicros.fiber_g);
  const potassium = toNumberOrNull(row?.potassium_mg) ?? toNumberOrNull(micronutrients.potassium_mg) ?? toNumberOrNull(legacyMicros.potassium_mg);
  const magnesium = toNumberOrNull(row?.magnesium_mg) ?? toNumberOrNull(micronutrients.magnesium_mg) ?? toNumberOrNull(legacyMicros.magnesium_mg);
  const omega3 =
    toNumberOrNull(row?.omega3_mg) ??
    toNumberOrNull(micronutrients.omega3_mg) ??
    toNumberOrNull(legacyMicros.omega3_mg) ??
    toNumberOrNull(legacyMicros.omega_3_mg);
  const calcium = toNumberOrNull(row?.calcium_mg) ?? toNumberOrNull(micronutrients.calcium_mg) ?? toNumberOrNull(legacyMicros.calcium_mg);
  const iron = toNumberOrNull(row?.iron_mg) ?? toNumberOrNull(micronutrients.iron_mg) ?? toNumberOrNull(legacyMicros.iron_mg);

  return {
    user_id: userId,
    date: toDateString(row?.date),
    day_of_week: row?.day_of_week ?? null,
    weight_lb: toNumberOrNull(row?.weight_lb),
    calories: toNumberOrNull(row?.calories),
    fat_g: toNumberOrNull(row?.fat_g),
    carbs_g: toNumberOrNull(row?.carbs_g),
    protein_g: toNumberOrNull(row?.protein_g),
    fiber_g: fiber,
    potassium_mg: potassium,
    magnesium_mg: magnesium,
    omega3_mg: omega3,
    calcium_mg: calcium,
    iron_mg: iron,
    status: row?.status ?? null,
    notes: row?.notes ?? null,
    healthy: row?.healthy ?? null,
    updated_at: new Date().toISOString(),
  };
}

function mapFoodEventRow(userId, row, index) {
  const date = toDateString(row?.date);
  if (!date) return null;

  let id = typeof row?.id === "string" && row.id.trim() ? row.id.trim() : "";
  if (!isUuid(id)) {
    id = hashToUuid(
      JSON.stringify({
        date,
        logged_at: row?.logged_at ?? null,
        source: row?.source ?? null,
        description: row?.description ?? null,
        input_text: row?.input_text ?? null,
        notes: row?.notes ?? null,
        nutrients: row?.nutrients ?? null,
        items: row?.items ?? row?.raw_items ?? null,
        idx: index,
      }),
    );
  }

  return {
    id,
    user_id: userId,
    date,
    logged_at: row?.logged_at ?? new Date(`${date}T12:00:00Z`).toISOString(),
    rollover_applied: row?.rollover_applied === true,
    source: row?.source ?? "manual",
    description: row?.description ?? null,
    input_text: row?.input_text ?? null,
    notes: row?.notes ?? null,
    nutrients: asObject(row?.nutrients),
    items: asArray(row?.items ?? row?.raw_items),
    model: row?.model ?? null,
    confidence: row?.confidence ?? null,
    applied_to_food_log: row?.applied_to_food_log === true,
  };
}

function mapFitnessWeekRow(userId, row) {
  const weekStart = toDateString(row?.week_start);
  if (!weekStart) return null;
  const { checklist, categoryOrder } = toFitnessChecklistStorage(asObject(row));

  return {
    user_id: userId,
    week_start: weekStart,
    week_label: row?.week_label ?? "",
    summary: row?.summary ?? "",
    checklist,
    category_order: categoryOrder,
  };
}

function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

function mapProfileBlobs(profileData) {
  const safe = asObject(profileData);
  return {
    user_profile: normalizeProfileText(safe.user_profile),
    training_profile: normalizeProfileText(safe.training_profile),
    diet_profile: normalizeProfileText(safe.diet_profile),
    agent_profile: normalizeProfileText(safe.agent_profile),
  };
}

async function main() {
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const userId = (process.env.USER_ID || process.env.TRACKING_DEFAULT_USER_ID || "").trim();
  if (!userId) {
    throw new Error("Missing user id. Set USER_ID or TRACKING_DEFAULT_USER_ID.");
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [foodData, activityData, profileData, rulesData] = await Promise.all([
    readJsonOrDefault(TRACKING_FOOD_FILE, {}),
    readJsonOrDefault(TRACKING_ACTIVITY_FILE, {}),
    readJsonOrDefault(TRACKING_PROFILE_FILE, {}),
    readJsonOrDefault(TRACKING_RULES_FILE, {}),
  ]);

  const profileBlobs = mapProfileBlobs(profileData);
  const currentWeek = asObject(activityData.current_week);

  const profileUpsert = await client.from("user_profiles").upsert(
    {
      user_id: userId,
      user_profile: profileBlobs,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (profileUpsert.error) throw new Error(`Supabase upsert user_profiles failed: ${profileUpsert.error.message}`);

  const rulesUpsert = await client.from("user_rules").upsert(
    {
      user_id: userId,
      rules_data: asObject(rulesData),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (rulesUpsert.error) throw new Error(`Supabase upsert user_rules failed: ${rulesUpsert.error.message}`);

  if (currentWeek.week_start) {
    const { checklist, categoryOrder } = toFitnessChecklistStorage(currentWeek);
    const { error } = await client.from("fitness_current").upsert(
      {
        user_id: userId,
        week_start: toDateString(currentWeek.week_start),
        week_label: currentWeek.week_label ?? "",
        summary: currentWeek.summary ?? "",
        checklist,
        category_order: categoryOrder,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error(`Supabase upsert fitness_current failed: ${error.message}`);
  }

  const foodLogRows = asArray(foodData.food_log)
    .map((row) => mapFoodLogRow(userId, row))
    .filter((row) => row.date);
  await upsertInChunks({ client, table: "food_log", rows: foodLogRows, onConflict: "user_id,date" });

  const rawFoodEventRows = asArray(foodData.food_events)
    .map((row, idx) => mapFoodEventRow(userId, row, idx))
    .filter(Boolean);
  const existingFoodEvents = await fetchAllRowsForUser({
    client,
    table: "food_events",
    columns: "id,date,logged_at,source,description,input_text,notes",
    userId,
    orderBy: "logged_at",
    ascending: true,
  });
  const existingIds = new Set(existingFoodEvents.map((row) => row.id));
  const existingFingerprints = new Set(
    existingFoodEvents.map((row) =>
      eventFingerprint({
        date: toDateString(row.date),
        logged_at: row.logged_at,
        source: row.source,
        description: row.description,
        input_text: row.input_text,
        notes: row.notes,
      }),
    ),
  );
  const dedupedToInsert = [];
  const seenIdsInRun = new Set();
  const seenFingerprintsInRun = new Set();
  let skippedFoodEventCount = 0;

  for (const row of rawFoodEventRows) {
    const fp = eventFingerprint(row);
    if (existingIds.has(row.id) || existingFingerprints.has(fp) || seenIdsInRun.has(row.id) || seenFingerprintsInRun.has(fp)) {
      skippedFoodEventCount += 1;
      continue;
    }
    seenIdsInRun.add(row.id);
    seenFingerprintsInRun.add(fp);
    dedupedToInsert.push(row);
  }
  await insertInChunks({ client, table: "food_events", rows: dedupedToInsert });

  const rawFitnessWeekRows = asArray(activityData.fitness_weeks)
    .map((row) => mapFitnessWeekRow(userId, row))
    .filter(Boolean);
  const existingFitnessWeeks = await fetchAllRowsForUser({
    client,
    table: "fitness_weeks",
    columns: "week_start",
    userId,
    orderBy: "week_start",
    ascending: true,
  });
  const existingWeekStarts = new Set(existingFitnessWeeks.map((row) => toDateString(row.week_start)));
  const weeksToInsert = [];
  let skippedFitnessWeeks = 0;

  for (const row of rawFitnessWeekRows) {
    if (existingWeekStarts.has(row.week_start)) {
      skippedFitnessWeeks += 1;
      continue;
    }
    existingWeekStarts.add(row.week_start);
    weeksToInsert.push(row);
  }
  await insertInChunks({ client, table: "fitness_weeks", rows: weeksToInsert });

  const stats = {
    user_id: userId,
    food_log_source: asArray(foodData.food_log).length,
    food_log_upserted: foodLogRows.length,
    food_events_source: asArray(foodData.food_events).length,
    food_events_inserted: dedupedToInsert.length,
    food_events_skipped_existing: skippedFoodEventCount,
    fitness_weeks_source: asArray(activityData.fitness_weeks).length,
    fitness_weeks_inserted: weeksToInsert.length,
    fitness_weeks_skipped_existing: skippedFitnessWeeks,
    current_week_upserted: Boolean(currentWeek.week_start),
    profile_upserted: true,
    rules_upserted: true,
  };

  console.log("JSON -> Postgres migration complete.");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
