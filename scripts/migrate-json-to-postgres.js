#!/usr/bin/env node
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

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

function normalizeProfile(profileData) {
  const safe = asObject(profileData);
  return {
    general: normalizeProfileText(safe.general),
    fitness: normalizeProfileText(safe.fitness),
    diet: normalizeProfileText(safe.diet),
    agent: normalizeProfileText(safe.agent),
  };
}

function normalizeActivity(activityData) {
  const safe = asObject(activityData);
  return {
    blocks: asArray(safe.blocks),
    weeks: asArray(safe.weeks),
  };
}

function normalizeFood(foodData) {
  const safe = asObject(foodData);
  return {
    days: asArray(safe.days),
  };
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
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

  const canonicalProfile = normalizeProfile(profileData);
  const canonicalActivity = normalizeActivity(activityData);
  const canonicalFood = normalizeFood(foodData);
  const canonicalRules = asObject(rulesData);

  const canonicalPayload = {
    profile: canonicalProfile,
    activity: canonicalActivity,
    food: canonicalFood,
    rules: canonicalRules,
  };

  const profileUpsert = await client.from("user_profiles").upsert(
    {
      user_id: userId,
      user_profile: canonicalProfile,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (profileUpsert.error) throw new Error(`Supabase upsert user_profiles failed: ${profileUpsert.error.message}`);

  const rulesUpsert = await client.from("user_rules").upsert(
    {
      user_id: userId,
      rules_data: canonicalPayload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (rulesUpsert.error) throw new Error(`Supabase upsert user_rules failed: ${rulesUpsert.error.message}`);

  const stats = {
    user_id: userId,
    food_days_source: canonicalFood.days.length,
    activity_blocks_source: canonicalActivity.blocks.length,
    activity_weeks_source: canonicalActivity.weeks.length,
    profile_upserted: true,
    rules_upserted: true,
  };

  console.log("JSON -> Postgres canonical migration complete.");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
