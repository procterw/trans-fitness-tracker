import { createClient } from "@supabase/supabase-js";

import { getCurrentTrackingUserId } from "./trackingUser.js";

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

function normalizeProfile(profile) {
  const safe = asObject(profile);
  return {
    general: normalizeProfileText(safe.general),
    fitness: normalizeProfileText(safe.fitness),
    diet: normalizeProfileText(safe.diet),
    agent: normalizeProfileText(safe.agent),
  };
}

function normalizeCanonicalPayload(data) {
  const safe = asObject(data);
  const activity = asObject(safe.activity);
  const food = asObject(safe.food);

  return {
    profile: normalizeProfile(asObject(safe.profile)),
    activity: {
      blocks: asArray(activity.blocks),
      weeks: asArray(activity.weeks),
    },
    food: {
      days: asArray(food.days),
    },
    rules: asObject(safe.rules),
  };
}

async function fetchUserProfileRow({ client, userId }) {
  return client
    .from("user_profiles")
    .select("user_id,user_profile,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
}

async function fetchUserRulesRow({ client, userId }) {
  return client
    .from("user_rules")
    .select("user_id,rules_data,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
}

export async function readTrackingDataPostgres() {
  const client = getSupabaseAdminClient();
  const userId = resolveTrackingUserId();

  const [profileResult, rulesResult] = await Promise.all([
    fetchUserProfileRow({ client, userId }),
    fetchUserRulesRow({ client, userId }),
  ]);

  assertNoError("select from user_profiles", profileResult.error);
  assertNoError("select from user_rules", rulesResult.error);

  const rulesData = asObject(rulesResult.data?.rules_data);
  const profileFromRules = asObject(rulesData.profile);
  const profileSource = Object.keys(profileFromRules).length ? profileFromRules : asObject(profileResult.data?.user_profile);

  return {
    ...rulesData,
    profile: normalizeProfile(profileSource),
    activity: asObject(rulesData.activity),
    food: asObject(rulesData.food),
    rules: asObject(rulesData.rules),
  };
}

export async function writeTrackingDataPostgres(data) {
  const client = getSupabaseAdminClient();
  const userId = resolveTrackingUserId();
  const canonical = normalizeCanonicalPayload(data);

  const profilePayload = {
    user_id: userId,
    user_profile: canonical.profile,
    updated_at: new Date().toISOString(),
  };
  const rulesPayload = {
    user_id: userId,
    rules_data: canonical,
    updated_at: new Date().toISOString(),
  };

  const profileResult = await client.from("user_profiles").upsert(profilePayload, { onConflict: "user_id" });
  assertNoError("upsert user_profiles", profileResult.error);

  const rulesResult = await client.from("user_rules").upsert(rulesPayload, { onConflict: "user_id" });
  assertNoError("upsert user_rules", rulesResult.error);
}
