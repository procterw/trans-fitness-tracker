#!/usr/bin/env node
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const dryRun = process.argv.includes("--dry-run");
const skipJson = process.argv.includes("--skip-json");
const skipPostgres = process.argv.includes("--skip-postgres");

const trackingFoodFile = process.env.TRACKING_FOOD_FILE
  ? path.resolve(process.env.TRACKING_FOOD_FILE)
  : path.resolve(projectRoot, "tracking-food.json");
const trackingActivityFile = process.env.TRACKING_ACTIVITY_FILE
  ? path.resolve(process.env.TRACKING_ACTIVITY_FILE)
  : path.resolve(projectRoot, "tracking-activity.json");
const trackingProfileFile = process.env.TRACKING_PROFILE_FILE
  ? path.resolve(process.env.TRACKING_PROFILE_FILE)
  : path.resolve(projectRoot, "tracking-profile.json");
const trackingRulesFile = process.env.TRACKING_RULES_FILE
  ? path.resolve(process.env.TRACKING_RULES_FILE)
  : path.resolve(projectRoot, "tracking-rules.json");

function nowIso() {
  return new Date().toISOString();
}

function buildJsonResetPayload() {
  return {
    food: { days: [] },
    activity: { blocks: [], weeks: [] },
    profile: {
      general: "",
      fitness: "",
      diet: "",
      agent: "",
    },
    rules: {
      metadata: {
        last_updated: nowIso(),
        data_files: {
          food: path.basename(trackingFoodFile),
          activity: path.basename(trackingActivityFile),
          profile: path.basename(trackingProfileFile),
          rules: path.basename(trackingRulesFile),
        },
        settings_version: 0,
        settings_history: [],
      },
      diet_philosophy: {},
      fitness_philosophy: {},
      assistant_rules: {},
    },
  };
}

async function writeJson(filePath, payload) {
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function resetJsonFiles() {
  const payload = buildJsonResetPayload();
  const writes = [
    { file: trackingFoodFile, payload: payload.food },
    { file: trackingActivityFile, payload: payload.activity },
    { file: trackingProfileFile, payload: payload.profile },
    { file: trackingRulesFile, payload: payload.rules },
  ];

  if (dryRun) {
    for (const row of writes) {
      process.stdout.write(`[dry-run] would write ${row.file}\n`);
    }
    return { wrote: 0, planned: writes.length, dryRun: true };
  }

  await Promise.all(writes.map((row) => writeJson(row.file, row.payload)));
  return { wrote: writes.length, planned: writes.length, dryRun: false };
}

function missingTable(error) {
  return error?.code === "42P01" || (typeof error?.message === "string" && /does not exist/i.test(error.message));
}

async function clearTable(client, table) {
  const { error, count } = await client.from(table).delete({ count: "exact" }).not("user_id", "is", null);
  if (missingTable(error)) return { table, skipped: true, reason: "missing_table" };
  if (error) throw new Error(`Failed clearing ${table}: ${error.message}`);
  return { table, cleared: count ?? null, skipped: false };
}

async function resetPostgres() {
  const url = process.env.SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRoleKey) {
    return { skipped: true, reason: "missing_credentials", clearedTables: [] };
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tables = [
    "food_events",
    "food_log",
    "fitness_current",
    "fitness_weeks",
    "diet_days",
    "training_blocks",
    "training_weeks",
    "user_profiles",
    "user_rules",
  ];

  if (dryRun) {
    for (const table of tables) {
      process.stdout.write(`[dry-run] would clear Postgres table ${table}\n`);
    }
    return { skipped: false, reason: null, clearedTables: [] };
  }

  const clearedTables = [];
  for (const table of tables) {
    const result = await clearTable(client, table);
    clearedTables.push(result);
  }
  return { skipped: false, reason: null, clearedTables };
}

function printUsage() {
  process.stdout.write("Usage: node scripts/reset-simplified-dev-data.js [--dry-run] [--skip-json] [--skip-postgres]\n");
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    printUsage();
    return;
  }

  process.stdout.write("Starting destructive simplified-data reset...\n");
  if (dryRun) process.stdout.write("Dry run enabled: no files or database rows will be modified.\n");

  const jsonResult = skipJson ? { skipped: true, wrote: 0 } : await resetJsonFiles();
  const postgresResult = skipPostgres ? { skipped: true, reason: "flag", clearedTables: [] } : await resetPostgres();

  if (jsonResult.skipped) process.stdout.write("JSON reset skipped.\n");
  else if (jsonResult.dryRun) {
    process.stdout.write(`JSON reset dry run complete. Files that would be written: ${jsonResult.planned}\n`);
  } else {
    process.stdout.write(`JSON reset complete. Files written: ${jsonResult.wrote}\n`);
  }

  if (postgresResult.skipped) {
    const reason = postgresResult.reason === "missing_credentials" ? "missing Supabase credentials" : "flag";
    process.stdout.write(`Postgres reset skipped (${reason}).\n`);
  } else {
    for (const table of postgresResult.clearedTables) {
      if (table.skipped) process.stdout.write(`Postgres: skipped ${table.table} (table missing)\n`);
      else process.stdout.write(`Postgres: cleared ${table.table}${table.cleared === null ? "" : ` (${table.cleared} rows)`}\n`);
    }
  }

  if (!dryRun) {
    process.stdout.write("Reset complete. Existing dev tracking data has been deleted.\n");
  } else {
    process.stdout.write("Dry run complete.\n");
  }
}

main().catch((error) => {
  process.stderr.write(`Reset failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
