import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

import { fromFitnessChecklistStorage, toFitnessChecklistStorage } from "./fitnessChecklist.js";
import { getCurrentTrackingUserId } from "./trackingUser.js";

const PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 500;

let cachedClient = null;

function getSupabaseAdminClient() {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url) throw new Error("SUPABASE_URL is required when TRACKING_BACKEND=postgres.");
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required when TRACKING_BACKEND=postgres.");
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cachedClient;
}

function resolveTrackingUserId() {
  const fromContext = getCurrentTrackingUserId();
  if (fromContext) return fromContext;

  const fallback = process.env.TRACKING_DEFAULT_USER_ID || "";
  if (fallback.trim()) return fallback.trim();

  throw new Error(
    "Missing tracking user id for Postgres backend. Provide auth token (preferred) or set TRACKING_DEFAULT_USER_ID.",
  );
}

function assertNoError(label, error) {
  if (!error) return;
  throw new Error(`Supabase ${label} failed: ${error.message}`);
}

function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function fetchUserProfileRow({ client, userId }) {
  return client
    .from("user_profiles")
    .select("user_id,user_profile,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
}

function toNumberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function mapFoodEventFromRow(row) {
  return {
    id: row.id,
    date: toDateString(row.date),
    logged_at: row.logged_at,
    rollover_applied: Boolean(row.rollover_applied),
    source: row.source,
    description: row.description,
    input_text: row.input_text,
    notes: row.notes,
    nutrients: row.nutrients ?? {},
    model: row.model,
    confidence: row.confidence,
    items: asArray(row.items),
    applied_to_food_log: Boolean(row.applied_to_food_log),
  };
}

function mapFoodLogFromRow(row) {
  const micronutrients = row.micronutrients && typeof row.micronutrients === "object" ? row.micronutrients : {};

  const pick = (value, fallbackKey) => {
    const direct = toNumberOrNull(value);
    if (direct !== null) return direct;
    return toNumberOrNull(micronutrients?.[fallbackKey]);
  };

  return {
    date: toDateString(row.date),
    day_of_week: row.day_of_week ?? null,
    weight_lb: toNumberOrNull(row.weight_lb),
    calories: toNumberOrNull(row.calories),
    fat_g: toNumberOrNull(row.fat_g),
    carbs_g: toNumberOrNull(row.carbs_g),
    protein_g: toNumberOrNull(row.protein_g),
    fiber_g: pick(row.fiber_g, "fiber_g"),
    potassium_mg: pick(row.potassium_mg, "potassium_mg"),
    magnesium_mg: pick(row.magnesium_mg, "magnesium_mg"),
    omega3_mg: pick(row.omega3_mg, "omega3_mg"),
    calcium_mg: pick(row.calcium_mg, "calcium_mg"),
    iron_mg: pick(row.iron_mg, "iron_mg"),
    status: row.status ?? null,
    notes: row.notes ?? null,
    healthy: row.healthy ?? null,
  };
}

function mapCurrentWeekFromRow(row) {
  if (!row) return null;
  const checklist = fromFitnessChecklistStorage({
    checklist: asObject(row.checklist),
    categoryOrder: asArray(row.category_order),
  });

  return {
    week_start: toDateString(row.week_start),
    week_label: row.week_label ?? "",
    summary: row.summary ?? "",
    ...checklist,
  };
}

function mapFitnessWeekFromRow(row) {
  const checklist = fromFitnessChecklistStorage({
    checklist: asObject(row.checklist),
    categoryOrder: asArray(row.category_order),
  });

  return {
    week_start: toDateString(row.week_start),
    week_label: row.week_label ?? "",
    summary: row.summary ?? "",
    ...checklist,
  };
}

async function fetchAllRowsForUser({ client, table, columns, userId, orderBy, ascending = true }) {
  const rows = [];
  let offset = 0;

  while (true) {
    let query = client
      .from(table)
      .select(columns)
      .eq("user_id", userId)
      .range(offset, offset + PAGE_SIZE - 1);

    if (orderBy) query = query.order(orderBy, { ascending });

    const { data, error } = await query;
    assertNoError(`select from ${table}`, error);

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

function chunkArray(items, size = INSERT_CHUNK_SIZE) {
  if (!Array.isArray(items) || !items.length) return [];
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function replaceRowsForUser({ client, table, userId, rows }) {
  const { error: deleteError } = await client.from(table).delete().eq("user_id", userId);
  assertNoError(`delete from ${table}`, deleteError);

  const chunks = chunkArray(rows);
  for (const chunk of chunks) {
    const { error: insertError } = await client.from(table).insert(chunk);
    assertNoError(`insert into ${table}`, insertError);
  }
}

export async function readTrackingDataPostgres() {
  const client = getSupabaseAdminClient();
  const userId = resolveTrackingUserId();

  const [foodEventsRows, foodLogRows, fitnessWeeksRows] = await Promise.all([
    fetchAllRowsForUser({
      client,
      table: "food_events",
      columns:
        "id,user_id,date,logged_at,rollover_applied,source,description,input_text,notes,nutrients,items,model,confidence,applied_to_food_log,created_at",
      userId,
      orderBy: "logged_at",
      ascending: true,
    }),
    fetchAllRowsForUser({
      client,
      table: "food_log",
      columns:
        "user_id,date,day_of_week,weight_lb,calories,fat_g,carbs_g,protein_g,fiber_g,potassium_mg,magnesium_mg,omega3_mg,calcium_mg,iron_mg,status,notes,healthy,micronutrients,updated_at",
      userId,
      orderBy: "date",
      ascending: true,
    }),
    fetchAllRowsForUser({
      client,
      table: "fitness_weeks",
      columns: "id,user_id,week_start,week_label,summary,checklist,category_order,created_at",
      userId,
      orderBy: "week_start",
      ascending: true,
    }),
  ]);

  const [fitnessCurrentResult, profileResult] = await Promise.all([
    client
      .from("fitness_current")
      .select("user_id,week_start,week_label,summary,checklist,category_order,updated_at")
      .eq("user_id", userId)
      .maybeSingle(),
    fetchUserProfileRow({ client, userId }),
  ]);

  assertNoError("select from fitness_current", fitnessCurrentResult.error);
  assertNoError("select from user_profiles", profileResult.error);

  return {
    food_log: foodLogRows.map(mapFoodLogFromRow),
    food_events: foodEventsRows.map(mapFoodEventFromRow),
    current_week: mapCurrentWeekFromRow(fitnessCurrentResult.data),
    fitness_weeks: fitnessWeeksRows.map(mapFitnessWeekFromRow),
    user_profile:
      profileResult.data?.user_profile && typeof profileResult.data.user_profile === "object"
        ? profileResult.data.user_profile
        : {},
  };
}

export async function writeTrackingDataPostgres(data) {
  const client = getSupabaseAdminClient();
  const userId = resolveTrackingUserId();

  const foodEvents = asArray(data?.food_events)
    .filter((row) => row && typeof row === "object" && row.date)
    .map((row) => ({
      id: typeof row.id === "string" && row.id ? row.id : crypto.randomUUID(),
      user_id: userId,
      date: toDateString(row.date),
      logged_at: row.logged_at ?? new Date().toISOString(),
      rollover_applied: Boolean(row.rollover_applied),
      source: row.source ?? "manual",
      description: row.description ?? null,
      input_text: row.input_text ?? null,
      notes: row.notes ?? null,
      nutrients: row.nutrients ?? null,
      items: asArray(row.items),
      model: row.model ?? null,
      confidence: row.confidence ?? null,
      applied_to_food_log: row.applied_to_food_log === true,
    }));

  const foodLog = asArray(data?.food_log)
    .filter((row) => row && typeof row === "object" && row.date)
    .map((row) => ({
      user_id: userId,
      date: toDateString(row.date),
      day_of_week: row.day_of_week ?? null,
      weight_lb: toNumberOrNull(row.weight_lb),
      calories: toNumberOrNull(row.calories),
      fat_g: toNumberOrNull(row.fat_g),
      carbs_g: toNumberOrNull(row.carbs_g),
      protein_g: toNumberOrNull(row.protein_g),
      fiber_g: toNumberOrNull(row.fiber_g),
      potassium_mg: toNumberOrNull(row.potassium_mg),
      magnesium_mg: toNumberOrNull(row.magnesium_mg),
      omega3_mg: toNumberOrNull(row.omega3_mg),
      calcium_mg: toNumberOrNull(row.calcium_mg),
      iron_mg: toNumberOrNull(row.iron_mg),
      status: row.status ?? null,
      notes: row.notes ?? null,
      healthy: row.healthy ?? null,
      micronutrients: {
        fiber_g: toNumberOrNull(row.fiber_g),
        potassium_mg: toNumberOrNull(row.potassium_mg),
        magnesium_mg: toNumberOrNull(row.magnesium_mg),
        omega3_mg: toNumberOrNull(row.omega3_mg),
        calcium_mg: toNumberOrNull(row.calcium_mg),
        iron_mg: toNumberOrNull(row.iron_mg),
      },
    }));

  const fitnessWeeks = asArray(data?.fitness_weeks)
    .filter((row) => row && typeof row === "object" && row.week_start)
    .map((row) => {
      const { checklist, categoryOrder } = toFitnessChecklistStorage(row);
      return {
        user_id: userId,
        week_start: toDateString(row.week_start),
        week_label: row.week_label ?? "",
        summary: row.summary ?? "",
        checklist,
        category_order: categoryOrder,
      };
    });

  const currentWeek = data?.current_week && typeof data.current_week === "object" ? data.current_week : null;
  const userProfile = data?.user_profile && typeof data.user_profile === "object" ? data.user_profile : {};
  const profilePayload = {
    user_id: userId,
    user_profile: userProfile,
    updated_at: new Date().toISOString(),
  };

  const profileResult = await client.from("user_profiles").upsert(profilePayload, { onConflict: "user_id" });
  assertNoError("upsert user_profiles", profileResult.error);

  if (currentWeek && currentWeek.week_start) {
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
    assertNoError("upsert fitness_current", error);
  } else {
    const { error } = await client.from("fitness_current").delete().eq("user_id", userId);
    assertNoError("delete from fitness_current", error);
  }

  await replaceRowsForUser({ client, table: "food_events", userId, rows: foodEvents });
  await replaceRowsForUser({ client, table: "food_log", userId, rows: foodLog });
  await replaceRowsForUser({ client, table: "fitness_weeks", userId, rows: fitnessWeeks });
}
