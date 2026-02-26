#!/usr/bin/env node
import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const TRACKING_FOOD_FILE = process.env.TRACKING_FOOD_FILE
  ? path.resolve(process.env.TRACKING_FOOD_FILE)
  : path.resolve(repoRoot, "tracking-food.json");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || !args.has("--write");

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function normalizeFoodEntry(entry) {
  if (typeof entry === "string") {
    return normalizeText(entry);
  }

  if (!entry || typeof entry !== "object") {
    return "";
  }

  const safeEntry = asObject(entry);
  const name = normalizeText(
    safeEntry.name ||
      safeEntry.label ||
      safeEntry.item ||
      safeEntry.food ||
      safeEntry.text ||
      safeEntry.title ||
      safeEntry.entry,
  );
  if (!name) return "";

  const portion = normalizeText(safeEntry.portion || safeEntry.amount || safeEntry.qty || safeEntry.quantity);
  return portion ? `${name} (${portion})` : name;
}

function parseLegacyFoodSummary(summaryText) {
  const normalized = normalizeText(summaryText);
  if (!normalized) return [];

  const stripped = normalized.replace(/^foods and meals:\s*/i, "");
  if (!stripped) return [];

  const parsed = stripped.split(/[;\n]/).map((part) => normalizeText(part).replace(/\.$/, ""));
  return parsed.filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);
}

function normalizeFoodEntries(value) {
  const rawEntries = Array.isArray(value) ? value : typeof value === "string" ? [{ text: value }] : [];
  const normalized = rawEntries
    .map((entry) => normalizeFoodEntry(entry))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);

  return normalized;
}

function extractFoodEntries(day) {
  const safeDay = asObject(day);
  const existing = normalizeFoodEntries(safeDay.food_entries);
  if (existing.length) return { entries: existing, source: "food_entries" };

  const fallback = parseLegacyFoodSummary(safeDay.ai_summary || safeDay.details || safeDay.notes || safeDay.summary || "");
  if (fallback.length) return { entries: fallback, source: "legacy_summary" };

  return { entries: [], source: "none" };
}

async function readJsonOrDefault(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err?.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmpPath, filePath);
}

async function main() {
  const source = await readJsonOrDefault(TRACKING_FOOD_FILE, {});
  const safeSource = asObject(source);
  const days = asArray(safeSource.days);

  if (!days.length) {
    console.log("No food days found for backfill.");
    return;
  }

  let changed = 0;
  let byLegacy = 0;
  let alreadyStructured = 0;
  const nextDays = days.map((row) => {
    const safeRow = asObject(row);
    const date = typeof safeRow.date === "string" ? safeRow.date : "<missing-date>";
    const { entries, source } = extractFoodEntries(row);

    if (source === "food_entries") {
      alreadyStructured += 1;
      return safeRow;
    }
    if (!entries.length) {
      return safeRow;
    }

    byLegacy += 1;
    changed += 1;
    return {
      ...safeRow,
      food_entries: entries,
    };
  });

  console.log(`Backfill summary: total_days=${days.length}, already_structured=${alreadyStructured}, migrated=${byLegacy}, unchanged=${days.length - changed}`);
  if (!changed) {
    console.log("No rows required backfill.");
    return;
  }

  if (dryRun) {
    console.log("Dry run enabled; no changes written. Re-run with --write to persist changes.");
    return;
  }

  const next = {
    ...safeSource,
    days: nextDays,
  };
  await writeJsonAtomic(TRACKING_FOOD_FILE, next);
  console.log(`Wrote backfilled food entries to ${TRACKING_FOOD_FILE}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
