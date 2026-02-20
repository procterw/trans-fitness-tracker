import "dotenv/config";

import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  askAssistant,
  streamAssistantResponse,
  proposeOnboardingChecklist,
  streamOnboardingChecklist,
  askSettingsAssistant,
  streamSettingsAssistant,
  composeMealEntryResponse,
  decideIngestAction,
} from "./assistant.js";
import { createSupabaseAuth } from "./auth/supabaseAuth.js";
import { formatChecklistCategoriesMarkdown, normalizeChecklistCategories } from "./checklistPolicy.js";
import { getFitnessCategoryKeys, toFitnessCategoryLabel } from "./fitnessChecklist.js";
import { deriveGoalsListsFromGoalsText, normalizeGoalsText, parseGoalsTextToList } from "./goalsText.js";
import { analyzeImportPayload, applyImportPlan } from "./importData.js";
import {
  formatMealEntryAssistantMessage,
  isClearFoodCommand,
  isExistingActivityEntry,
  logFoodFromInputs,
  looksLikeBulkFoodImportText,
  refreshCurrentWeekSummaryForActivity,
  resolveActivitySelections,
  resolveClearFoodDate,
  summarizeActivityUpdates,
  summarizeFoodResult,
} from "./server/ingestHelpers.js";
import {
  enableSseHeaders,
  isStreamingRequest,
  sendStreamingAssistantChunk,
  sendStreamingAssistantDone,
  sendStreamingAssistantError,
} from "./server/streaming.js";
import { runWithTrackingUser } from "./trackingUser.js";
import {
  clearFoodEntriesForDate,
  ensureCurrentWeek,
  getCurrentActivityWeek,
  getSeattleDateString,
  getSuggestedLogDate,
  listActivityWeeks,
  listFoodDays,
  readTrackingData,
  summarizeTrainingBlocks,
  updateCurrentActivityWeekSummary,
  updateCurrentActivityWorkout,
  updateCurrentWeekItems,
  formatSeattleIso,
  writeTrackingData,
} from "./trackingData.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const authRequired = String(process.env.SUPABASE_AUTH_REQUIRED || "").toLowerCase() === "true";
const supabaseAuth = createSupabaseAuth({
  supabaseUrl: process.env.SUPABASE_URL || "",
  required: authRequired,
});
app.use("/api", supabaseAuth);
app.use("/api", (req, _res, next) => {
  runWithTrackingUser(req.user?.id ?? null, () => next());
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, fieldSize: 5 * 1024 * 1024 },
});
const IMPORT_SESSION_TTL_MS = 10 * 60 * 1000;
const importSessions = new Map();
const DAY_STATUS_VALUES = new Set(["green", "yellow", "red", "incomplete"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..", "client");
const distDir = path.resolve(__dirname, "..", "dist");

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asObject(value) {
  return isPlainObject(value) ? value : {};
}

function mergeObjectPatch(base, patch) {
  if (!isPlainObject(base)) return structuredClone(patch);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(out[key])) out[key] = mergeObjectPatch(out[key], value);
    else out[key] = structuredClone(value);
  }
  return out;
}

function hasGoalsTextPatch(patch) {
  if (!isPlainObject(patch)) return false;
  const goalsText = isPlainObject(patch.goals_text) ? patch.goals_text : null;
  if (!goalsText) return false;
  return ["overall_goals", "fitness_goals", "diet_goals"].some((key) => key in goalsText);
}

function cleanupImportSessions() {
  const now = Date.now();
  for (const [token, session] of importSessions.entries()) {
    if (!session || session.expiresAt <= now) {
      importSessions.delete(token);
    }
  }
}

function createImportSession({ plan, userId }) {
  cleanupImportSessions();
  const tokenId = crypto.randomUUID();
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 12);
  const token = `${tokenId}.${payloadHash}`;
  importSessions.set(token, {
    token,
    userId: userId ?? null,
    plan,
    payloadHash,
    expiresAt: Date.now() + IMPORT_SESSION_TTL_MS,
  });
  return token;
}

function consumeImportSession({ token, userId }) {
  cleanupImportSessions();
  const session = importSessions.get(token);
  if (!session) return null;
  if ((session.userId ?? null) !== (userId ?? null)) return null;
  importSessions.delete(token);
  return session;
}

function applyGoalTextDerivation(profile, { now = new Date() } = {}) {
  const safeProfile = isPlainObject(profile) ? profile : {};
  const priorGoals = asObject(safeProfile.goals);
  const goalsText = normalizeGoalsText(asObject(safeProfile.goals_text), { legacyGoals: priorGoals });
  const derived = deriveGoalsListsFromGoalsText({ goalsText, legacyGoals: priorGoals });
  const metadata = asObject(safeProfile.metadata);
  return {
    ...safeProfile,
    goals_text: goalsText,
    goals: {
      ...priorGoals,
      diet_goals: derived.diet_goals,
      fitness_goals: derived.fitness_goals,
      health_goals: derived.health_goals,
    },
    metadata: {
      ...metadata,
      goals_text_updated_at: formatSeattleIso(now),
      goals_derivation_version: 1,
    },
  };
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonEmptyArray(value) {
  return Array.isArray(value) && value.some((entry) => hasNonEmptyString(entry));
}

function normalizeDayStatusValue(value) {
  if (value === null || value === undefined || value === "") return "incomplete";
  if (typeof value !== "string") throw new Error("Invalid field: status");
  const text = value.trim().toLowerCase();
  if (!DAY_STATUS_VALUES.has(text)) throw new Error("Invalid field: status");
  return text;
}

function normalizeExportProfileText(value) {
  return typeof value === "string" ? value : "";
}

function toImportExportDataShape(data) {
  const safe = isPlainObject(data) ? data : {};
  const profile = asObject(safe.profile);
  const activity = asObject(safe.activity);
  const food = asObject(safe.food);
  return {
    user_profile: {
      general: normalizeExportProfileText(profile.general),
      fitness: normalizeExportProfileText(profile.fitness),
      diet: normalizeExportProfileText(profile.diet),
      agent: normalizeExportProfileText(profile.agent),
    },
    training: {
      blocks: Array.isArray(activity.blocks) ? activity.blocks : [],
      weeks: Array.isArray(activity.weeks) ? activity.weeks : [],
    },
    diet: Array.isArray(food.days) ? food.days : [],
  };
}

function normalizeGoalList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const text = typeof entry === "string" ? entry.trim() : "";
    if (!text) continue;
    const token = text.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(text);
  }
  return out;
}

function extractGoalSummary(userProfile) {
  const profile = isPlainObject(userProfile) ? userProfile : {};
  const goals = isPlainObject(profile.goals) ? profile.goals : {};
  const goalsText = normalizeGoalsText(asObject(profile.goals_text), { legacyGoals: goals });
  const derivedGoals = deriveGoalsListsFromGoalsText({ goalsText, legacyGoals: goals });
  return {
    diet_goals: normalizeGoalList(derivedGoals.diet_goals),
    fitness_goals: normalizeGoalList(derivedGoals.fitness_goals),
    health_goals: normalizeGoalList(derivedGoals.health_goals),
    goals_text: goalsText,
    overall_goals_list: parseGoalsTextToList(goalsText.overall_goals),
  };
}

function normalizeClientTimezone(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120) return null;
  try {
    const resolved = new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).resolvedOptions().timeZone;
    return hasNonEmptyString(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function applyClientTimezone(userProfile, clientTimezone) {
  const timezone = normalizeClientTimezone(clientTimezone);
  const profile = isPlainObject(userProfile) ? structuredClone(userProfile) : {};
  const general = isPlainObject(profile.general) ? { ...profile.general } : {};
  const existingTimezone = hasNonEmptyString(general.timezone) ? general.timezone.trim() : "";

  if (!timezone || existingTimezone) {
    return { profile, changed: false };
  }

  general.timezone = timezone;
  profile.general = general;
  return { profile, changed: true };
}

function normalizeChecklistCategoryKey(raw) {
  const normalized = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return normalized || "category";
}

function normalizeItemToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function splitChecklistItemAndDescription(rawValue) {
  const text = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!text) return { item: "", description: "" };

  const parts = text.split(/\s+-\s+/);
  if (parts.length < 2) return { item: text, description: "" };

  const item = parts.shift()?.trim() ?? "";
  const description = parts.join(" - ").trim();
  return {
    item,
    description: item && description ? description : "",
  };
}

function applyChecklistCategories(currentWeek, categories) {
  const safeWeek = currentWeek && typeof currentWeek === "object" ? currentWeek : {};
  const oldKeys = getFitnessCategoryKeys(safeWeek);
  const oldLabels = isPlainObject(safeWeek.category_labels) ? safeWeek.category_labels : {};

  const oldByCategoryAndItem = new Map();
  const oldByAnyItem = new Map();
  for (const key of oldKeys) {
    const list = Array.isArray(safeWeek[key]) ? safeWeek[key] : [];
    const itemMap = new Map();
    for (const item of list) {
      const parsed = splitChecklistItemAndDescription(item?.item);
      if (!parsed.item) continue;
      const token = normalizeItemToken(parsed.item);
      if (!token || itemMap.has(token)) continue;
      itemMap.set(token, {
        checked: item?.checked === true,
        details: typeof item?.details === "string" ? item.details : "",
        description:
          typeof item?.description === "string" && item.description.trim()
            ? item.description.trim()
            : parsed.description,
      });
      if (!oldByAnyItem.has(token)) oldByAnyItem.set(token, itemMap.get(token));
    }
    oldByCategoryAndItem.set(key, itemMap);
  }

  const nextWeek = {
    week_start: typeof safeWeek.week_start === "string" ? safeWeek.week_start : "",
    week_label: typeof safeWeek.week_label === "string" ? safeWeek.week_label : "",
    summary:
      typeof safeWeek.summary === "string"
        ? safeWeek.summary
        : typeof safeWeek.ai_summary === "string"
          ? safeWeek.ai_summary
          : "",
  };

  const usedKeys = new Set();
  const categoryOrder = [];
  const categoryLabels = {};
  for (const category of categories) {
    const baseKey = normalizeChecklistCategoryKey(category?.key);
    let key = baseKey;
    let i = 2;
    while (usedKeys.has(key)) {
      key = `${baseKey}_${i}`;
      i += 1;
    }
    usedKeys.add(key);

    const oldItemMap = oldByCategoryAndItem.get(key) ?? new Map();
    const seenItems = new Set();
    const itemRows = [];
    const items = Array.isArray(category?.items) ? category.items : [];
    for (const itemLabelRaw of items) {
      const parsed = splitChecklistItemAndDescription(itemLabelRaw);
      if (!parsed.item) continue;
      const token = normalizeItemToken(parsed.item);
      if (!token || seenItems.has(token)) continue;
      seenItems.add(token);
      const existing = oldItemMap.get(token) ?? oldByAnyItem.get(token);
      itemRows.push({
        item: parsed.item,
        description: parsed.description || (typeof existing?.description === "string" ? existing.description : ""),
        checked: Boolean(existing?.checked),
        details: typeof existing?.details === "string" ? existing.details : "",
      });
    }
    if (!itemRows.length) continue;

    categoryOrder.push(key);
    nextWeek[key] = itemRows;
    const labelRaw = typeof category?.label === "string" ? category.label.trim() : "";
    const fallbackLabel = typeof oldLabels[key] === "string" ? oldLabels[key] : toFitnessCategoryLabel(key);
    categoryLabels[key] = labelRaw || fallbackLabel;
  }

  nextWeek.category_order = categoryOrder;
  nextWeek.category_labels = categoryLabels;
  return nextWeek;
}

function extractChecklistTemplate(week) {
  if (!isPlainObject(week)) return null;
  const keys = getFitnessCategoryKeys(week);
  if (!keys.length) return null;
  const labels = isPlainObject(week.category_labels) ? week.category_labels : {};
  const template = {
    category_order: [],
    category_labels: {},
  };
  for (const key of keys) {
    const list = Array.isArray(week[key]) ? week[key] : [];
    const items = list
      .map((entry) => {
        const item = typeof entry?.item === "string" ? entry.item.trim() : "";
        if (!item) return null;
        const description = typeof entry?.description === "string" ? entry.description.trim() : "";
        return { item, description };
      })
      .filter(Boolean)
      .map(({ item, description }) => ({ item: description ? `${item} - ${description}` : item }));
    if (!items.length) continue;
    template.category_order.push(key);
    template[key] = items;
    const label = typeof labels[key] === "string" ? labels[key].trim() : "";
    if (label) template.category_labels[key] = label;
  }
  if (!template.category_order.length) return null;
  if (!Object.keys(template.category_labels).length) delete template.category_labels;
  return template;
}

function templateToChecklistObject(template) {
  const safeTemplate = isPlainObject(template) ? template : {};
  const categoryOrder = Array.isArray(safeTemplate.category_order) ? safeTemplate.category_order : [];
  const out = {};
  for (const key of categoryOrder) {
    const list = Array.isArray(safeTemplate[key]) ? safeTemplate[key] : [];
    const items = list
      .map((entry) => {
        const parsed = splitChecklistItemAndDescription(entry?.item);
        if (!parsed.item) return null;
        return parsed.description ? { item: parsed.item, description: parsed.description } : { item: parsed.item };
      })
      .filter(Boolean);
    if (items.length) out[key] = items;
  }
  return out;
}

function templateToChecklistCategories(template) {
  const safeTemplate = isPlainObject(template) ? template : {};
  const labels = isPlainObject(safeTemplate.category_labels) ? safeTemplate.category_labels : {};
  const keys = Array.isArray(safeTemplate.category_order) ? safeTemplate.category_order : [];
  return keys
    .map((key) => {
      const list = Array.isArray(safeTemplate[key]) ? safeTemplate[key] : [];
      const items = list
        .map((entry) => {
          const item = typeof entry?.item === "string" ? entry.item.trim() : "";
          if (!item) return "";
          const description = typeof entry?.description === "string" ? entry.description.trim() : "";
          return description ? `${item} - ${description}` : item;
        })
        .filter(Boolean);
      if (!items.length) return null;
      return {
        key,
        label: typeof labels[key] === "string" && labels[key].trim() ? labels[key].trim() : null,
        items,
      };
    })
    .filter(Boolean);
}

function checklistCategoriesToTemplate(categories, currentWeek = {}) {
  const remappedWeek = applyChecklistCategories(currentWeek, categories);
  return extractChecklistTemplate(remappedWeek);
}

function normalizeTrainingBlockName(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeTrainingBlockDescription(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizeTrainingBlockApplyTiming(value) {
  if (value === "immediate" || value === "next_week") return value;
  return null;
}

function buildSmartTrainingBlockName(blocks) {
  const count = Array.isArray(blocks) ? blocks.length : 0;
  return `Phase ${count + 1}`;
}

function buildSmartTrainingBlockDescription(template) {
  const safeTemplate = isPlainObject(template) ? template : {};
  const labels = isPlainObject(safeTemplate.category_labels) ? safeTemplate.category_labels : {};
  const keys = Array.isArray(safeTemplate.category_order) ? safeTemplate.category_order : [];
  const top = keys
    .slice(0, 3)
    .map((key) => {
      const label = typeof labels[key] === "string" ? labels[key].trim() : "";
      return label || toFitnessCategoryLabel(key);
    })
    .filter(Boolean);
  return top.length ? `Focus: ${top.join(", ")}` : "Training block";
}

function hasCurrentWeekProgress(currentWeek) {
  const safeWeek = isPlainObject(currentWeek) ? currentWeek : {};
  const keys = getFitnessCategoryKeys(safeWeek);
  for (const key of keys) {
    const list = Array.isArray(safeWeek[key]) ? safeWeek[key] : [];
    for (const item of list) {
      if (item?.checked === true) return true;
      if (typeof item?.details === "string" && item.details.trim()) return true;
    }
  }
  return false;
}

function findOpenEndedTrainingBlockIds(blocks) {
  const ids = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    const id = typeof block?.id === "string" ? block.id.trim() : "";
    if (!id) continue;
    const end = typeof block?.block_end === "string" ? block.block_end.trim() : "";
    if (end && isIsoDateString(end)) continue;
    ids.push(id);
  }
  return ids;
}

function normalizeStoredTrainingBlocks(metadata) {
  const safeMetadata = isPlainObject(metadata) ? metadata : {};
  const raw = isPlainObject(safeMetadata.training_blocks) ? safeMetadata.training_blocks : {};
  const rawBlocks = Array.isArray(raw.blocks) ? raw.blocks : [];
  const blocks = rawBlocks
    .map((block) => {
      const id = typeof block?.id === "string" && block.id.trim() ? block.id.trim() : null;
      const categoryOrder = Array.isArray(block?.category_order) ? block.category_order.filter((v) => typeof v === "string") : [];
      const checklist = isPlainObject(block?.checklist) ? block.checklist : {};
      if (!id || !categoryOrder.length) return null;
      return {
        id,
        name: normalizeTrainingBlockName(block?.name),
        description: normalizeTrainingBlockDescription(block?.description),
        block_start: typeof block?.block_start === "string" && isIsoDateString(block.block_start) ? block.block_start : "",
        block_end: typeof block?.block_end === "string" && isIsoDateString(block.block_end) ? block.block_end : "",
        category_order: categoryOrder,
        category_labels: isPlainObject(block?.category_labels) ? block.category_labels : {},
        checklist,
        created_at: typeof block?.created_at === "string" ? block.created_at : formatSeattleIso(new Date()),
        updated_at: typeof block?.updated_at === "string" ? block.updated_at : formatSeattleIso(new Date()),
      };
    })
    .filter(Boolean);
  const activeBlockId = typeof raw.active_block_id === "string" ? raw.active_block_id : null;
  return { active_block_id: activeBlockId, blocks };
}

function canonicalBlockFromStoredTrainingBlock(block, fallbackBlock = null) {
  const safeBlock = isPlainObject(block) ? block : {};
  const blockId = typeof safeBlock.id === "string" && safeBlock.id.trim() ? safeBlock.id.trim() : "";
  if (!blockId) return null;

  const checklist = isPlainObject(safeBlock.checklist) ? safeBlock.checklist : {};
  const rawOrder = Array.isArray(safeBlock.category_order) ? safeBlock.category_order : [];
  const categoryOrder = rawOrder.filter((value) => typeof value === "string" && value.trim());
  const categoryLabels = isPlainObject(safeBlock.category_labels) ? safeBlock.category_labels : {};
  const keys = categoryOrder.length ? categoryOrder : Object.keys(checklist);

  const workouts = [];
  const seen = new Set();
  for (const key of keys) {
    const list = Array.isArray(checklist[key]) ? checklist[key] : [];
    const fallbackCategory = typeof key === "string" ? key : "";
    const categoryLabel =
      typeof categoryLabels[key] === "string" && categoryLabels[key].trim()
        ? categoryLabels[key].trim()
        : toFitnessCategoryLabel(fallbackCategory);

    for (const entry of list) {
      const name = typeof entry?.item === "string" ? entry.item.trim() : typeof entry?.name === "string" ? entry.name.trim() : "";
      if (!name) continue;
      const token = name.toLowerCase();
      if (seen.has(token)) continue;
      seen.add(token);
      workouts.push({
        name,
        description: typeof entry?.description === "string" ? entry.description.trim() : "",
        category: categoryLabel || "General",
        optional: false,
      });
    }
  }

  const fallbackStart =
    typeof fallbackBlock?.block_start === "string" && isIsoDateString(fallbackBlock.block_start) ? fallbackBlock.block_start : "";
  const createdAtDate =
    typeof safeBlock.created_at === "string" && isIsoDateString(safeBlock.created_at.slice(0, 10))
      ? safeBlock.created_at.slice(0, 10)
      : "";
  const blockStart = fallbackStart || createdAtDate || getSeattleDateString(new Date());
  const explicitStart =
    typeof safeBlock.block_start === "string" && isIsoDateString(safeBlock.block_start) ? safeBlock.block_start : "";
  const fallbackEnd =
    typeof fallbackBlock?.block_end === "string" && isIsoDateString(fallbackBlock.block_end) ? fallbackBlock.block_end : "";
  const explicitEnd =
    typeof safeBlock.block_end === "string" && isIsoDateString(safeBlock.block_end) ? safeBlock.block_end : "";

  return {
    block_id: blockId,
    block_start: explicitStart || blockStart,
    block_end: explicitEnd || fallbackEnd,
    block_name: normalizeTrainingBlockName(safeBlock.name),
    block_details: normalizeTrainingBlockDescription(safeBlock.description),
    workouts,
  };
}

function syncCanonicalActivityBlocksFromStoredBlocks(data, storedBlocks) {
  if (!isPlainObject(data)) return [];
  if (!isPlainObject(data.activity)) data.activity = {};

  const existingBlocks = Array.isArray(data.activity.blocks) ? data.activity.blocks : [];
  const existingById = new Map(
    existingBlocks
      .map((block) => {
        const id = typeof block?.block_id === "string" && block.block_id.trim() ? block.block_id.trim() : "";
        return id ? [id, block] : null;
      })
      .filter(Boolean),
  );

  const next = [];
  const seen = new Set();
  for (const block of Array.isArray(storedBlocks) ? storedBlocks : []) {
    const id = typeof block?.id === "string" && block.id.trim() ? block.id.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const canonicalBlock = canonicalBlockFromStoredTrainingBlock(block, existingById.get(id) ?? null);
    if (!canonicalBlock) continue;
    next.push(canonicalBlock);
  }

  data.activity.blocks = next;
  return next;
}

function buildTrainingBlockFromTemplate({
  template,
  blockId = null,
  name = "",
  description = "",
  existing = null,
  blocks = [],
}) {
  const safeTemplate = isPlainObject(template) ? template : null;
  if (!safeTemplate) return null;
  const now = formatSeattleIso(new Date());
  const id = typeof blockId === "string" && blockId.trim() ? blockId.trim() : crypto.randomUUID();
  const createdAt = typeof existing?.created_at === "string" ? existing.created_at : now;
  const resolvedName = normalizeTrainingBlockName(name) || normalizeTrainingBlockName(existing?.name) || buildSmartTrainingBlockName(blocks);
  const resolvedDescription =
    normalizeTrainingBlockDescription(description) ||
    normalizeTrainingBlockDescription(existing?.description) ||
    buildSmartTrainingBlockDescription(safeTemplate);
  return {
    id,
    name: resolvedName,
    description: resolvedDescription,
    block_start:
      typeof existing?.block_start === "string" && isIsoDateString(existing.block_start)
        ? existing.block_start
        : createdAt.slice(0, 10),
    block_end:
      typeof existing?.block_end === "string" && isIsoDateString(existing.block_end)
        ? existing.block_end
        : "",
    category_order: safeTemplate.category_order,
    category_labels: isPlainObject(safeTemplate.category_labels) ? safeTemplate.category_labels : {},
    checklist: templateToChecklistObject(safeTemplate),
    created_at: createdAt,
    updated_at: now,
  };
}

function buildWeekFromTemplate(currentWeek, template) {
  const categories = templateToChecklistCategories(template);
  return applyChecklistCategories(currentWeek, categories);
}

function isIsoDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getWeekEndSundayFromStart(weekStart) {
  if (!isIsoDateString(weekStart)) return "";
  const [year, month, day] = weekStart.split("-").map((part) => Number(part));
  const start = new Date(Date.UTC(year, month - 1, day));
  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10);
}

function canonicalWeekFromChecklistTemplateWeek(templateWeek, fallbackWeek = null) {
  const safeTemplateWeek = isPlainObject(templateWeek) ? templateWeek : {};
  const safeFallback = isPlainObject(fallbackWeek) ? fallbackWeek : {};
  const weekStartRaw =
    typeof safeTemplateWeek.week_start === "string" && safeTemplateWeek.week_start.trim()
      ? safeTemplateWeek.week_start.trim()
      : typeof safeFallback.week_start === "string"
        ? safeFallback.week_start
        : "";
  if (!isIsoDateString(weekStartRaw)) return null;

  const fallbackWorkouts = new Map(
    (Array.isArray(safeFallback.workouts) ? safeFallback.workouts : [])
      .map((row) => {
        const name = typeof row?.name === "string" ? row.name.trim() : "";
        if (!name) return null;
        return [name.toLowerCase(), row];
      })
      .filter(Boolean),
  );

  const workouts = [];
  const seen = new Set();
  for (const key of getFitnessCategoryKeys(safeTemplateWeek)) {
    const list = Array.isArray(safeTemplateWeek[key]) ? safeTemplateWeek[key] : [];
    for (const row of list) {
      const name = typeof row?.item === "string" ? row.item.trim() : typeof row?.name === "string" ? row.name.trim() : "";
      if (!name) continue;
      const token = name.toLowerCase();
      if (seen.has(token)) continue;
      seen.add(token);
      const fallback = fallbackWorkouts.get(token);
      workouts.push({
        name,
        details:
          typeof row?.details === "string"
            ? row.details
            : typeof fallback?.details === "string"
              ? fallback.details
              : "",
        completed:
          row?.checked === true ||
          row?.completed === true ||
          fallback?.completed === true,
      });
    }
  }

  const nextWorkouts = workouts.length
    ? workouts
    : (Array.isArray(safeFallback.workouts) ? safeFallback.workouts : []).map((row) => ({
        name: typeof row?.name === "string" ? row.name : "",
        details: typeof row?.details === "string" ? row.details : "",
        completed: row?.completed === true,
      })).filter((row) => row.name);

  const blockId =
    typeof safeTemplateWeek.training_block_id === "string" && safeTemplateWeek.training_block_id.trim()
      ? safeTemplateWeek.training_block_id.trim()
      : typeof safeTemplateWeek.block_id === "string" && safeTemplateWeek.block_id.trim()
        ? safeTemplateWeek.block_id.trim()
        : typeof safeFallback.block_id === "string"
          ? safeFallback.block_id
          : "";

  return {
    week_start: weekStartRaw,
    week_end:
      typeof safeFallback.week_end === "string" && isIsoDateString(safeFallback.week_end)
        ? safeFallback.week_end
        : getWeekEndSundayFromStart(weekStartRaw),
    block_id: blockId,
    workouts: nextWorkouts,
    ai_summary:
      typeof safeTemplateWeek.ai_summary === "string"
        ? safeTemplateWeek.ai_summary
        : typeof safeTemplateWeek.summary === "string"
          ? safeTemplateWeek.summary
          : typeof safeFallback.ai_summary === "string"
            ? safeFallback.ai_summary
            : typeof safeFallback.summary === "string"
              ? safeFallback.summary
              : "",
  };
}

function upsertCanonicalWeekFromChecklistTemplateWeek(data, templateWeek) {
  if (!isPlainObject(data)) return null;
  if (!isPlainObject(data.activity)) data.activity = {};
  const existingWeeks = Array.isArray(data.activity.weeks) ? data.activity.weeks : [];
  const weekStart = typeof templateWeek?.week_start === "string" ? templateWeek.week_start : "";
  const fallbackWeek = existingWeeks.find((row) => row?.week_start === weekStart) ?? null;
  const canonicalWeek = canonicalWeekFromChecklistTemplateWeek(templateWeek, fallbackWeek);
  if (!canonicalWeek) return null;

  data.activity.weeks = [
    ...existingWeeks.filter((row) => row && row.week_start !== canonicalWeek.week_start),
    canonicalWeek,
  ].sort((a, b) => String(a.week_start).localeCompare(String(b.week_start)));

  return canonicalWeek;
}

function extractTemplateFromStoredBlock(block) {
  const safeBlock = isPlainObject(block) ? block : {};
  const categoryOrder = Array.isArray(safeBlock.category_order) ? safeBlock.category_order : [];
  const checklist = isPlainObject(safeBlock.checklist) ? safeBlock.checklist : {};
  if (!categoryOrder.length) return null;
  const out = {
    category_order: [],
    category_labels: {},
  };
  for (const key of categoryOrder) {
    const list = Array.isArray(checklist[key]) ? checklist[key] : [];
    const items = list
      .map((entry) => {
        const item = typeof entry?.item === "string" ? entry.item.trim() : "";
        const description = typeof entry?.description === "string" ? entry.description.trim() : "";
        if (!item) return null;
        return description ? { item, description } : { item };
      })
      .filter(Boolean);
    if (!items.length) continue;
    out.category_order.push(key);
    out[key] = items;
    const label = typeof safeBlock?.category_labels?.[key] === "string" ? safeBlock.category_labels[key].trim() : "";
    if (label) out.category_labels[key] = label;
  }
  if (!out.category_order.length) return null;
  if (!Object.keys(out.category_labels).length) delete out.category_labels;
  return out;
}

const SETTINGS_PROFILE_FIELDS = ["general", "fitness", "diet", "agent"];
const SETTINGS_PROFILE_INPUT_FIELDS = [...SETTINGS_PROFILE_FIELDS];
const SETTINGS_CHECKLIST_FIELD = "checklist_categories";
const SETTINGS_TRAINING_BLOCK_FIELD = "training_block";
const SETTINGS_PROPOSAL_FIELDS = [...SETTINGS_PROFILE_INPUT_FIELDS, SETTINGS_CHECKLIST_FIELD, SETTINGS_TRAINING_BLOCK_FIELD];
const SETTINGS_PROFILE_LABELS = {
  general: "general profile",
  fitness: "fitness profile",
  diet: "diet profile",
  agent: "agent profile",
  [SETTINGS_CHECKLIST_FIELD]: "training checklist template",
  [SETTINGS_TRAINING_BLOCK_FIELD]: "training block",
};

function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

function getTrackingProfile(data) {
  const safe = isPlainObject(data) ? data : {};
  return isPlainObject(safe.profile) ? safe.profile : safe;
}

function ensureTrackingProfile(data) {
  if (!isPlainObject(data.profile)) data.profile = {};
  return data.profile;
}

function getTrackingRules(data) {
  const safe = isPlainObject(data) ? data : {};
  return isPlainObject(safe.rules) ? safe.rules : safe;
}

function ensureTrackingRules(data) {
  if (!isPlainObject(data.rules)) data.rules = {};
  return data.rules;
}

function getTrackingMetadata(data) {
  const rules = getTrackingRules(data);
  if (isPlainObject(rules.metadata)) return rules.metadata;
  return asObject(data?.metadata);
}

function setTrackingMetadata(data, metadata) {
  const safeMetadata = isPlainObject(metadata) ? metadata : {};
  const rules = ensureTrackingRules(data);
  rules.metadata = safeMetadata;
  data.rules = rules;
  // Keep temporary top-level alias while older paths still reference it.
  data.metadata = safeMetadata;
}

function buildStarterChecklistCategories() {
  return normalizeChecklistCategories([
    {
      key: "cardio",
      label: "Cardio",
      items: ["Brisk walk (30 min)", "Brisk walk (30 min)", "Easy cardio session (30 min)"],
    },
    {
      key: "strength",
      label: "Strength",
      items: ["Lower-body strength session (20-30 min)", "Lower-body strength session (20-30 min)"],
    },
    {
      key: "mobility",
      label: "Mobility",
      items: ["Mobility routine (10-15 min)", "Mobility routine (10-15 min)"],
    },
  ]);
}

function buildStarterUserProfileText() {
  return [
    "Overall goals:",
    "- Build consistent nutrition and activity habits.",
    "",
    "Health context:",
    "- Add any key medical context, medications, or conditions here.",
    "",
    "Lifestyle:",
    "- Add schedule constraints and routines that matter for coaching.",
  ].join("\n");
}

function getSettingsProfiles(data) {
  const profile = getTrackingProfile(data);
  const general = normalizeProfileText(profile.general);
  const fitness = normalizeProfileText(profile.fitness);
  const diet = normalizeProfileText(profile.diet);
  const agent = normalizeProfileText(profile.agent);
  return {
    general,
    fitness,
    diet,
    agent,
  };
}

function readSettingsProfileInput(payload, canonicalField) {
  const safe = isPlainObject(payload) ? payload : {};
  if (typeof safe[canonicalField] === "string") return normalizeProfileText(safe[canonicalField]);
  return null;
}

function hasSeedMarker(data) {
  const metadata = asObject(getTrackingMetadata(data));
  return hasNonEmptyString(metadata.settings_seeded_at);
}

function applyStarterSeed(data, { now = new Date(), currentWeek = null } = {}) {
  let changed = false;
  let profileSeeded = false;
  let checklistSeeded = false;
  const timestamp = formatSeattleIso(now);
  const profiles = getSettingsProfiles(data);
  const metadata = { ...getTrackingMetadata(data) };
  const profile = ensureTrackingProfile(data);

  if (!hasNonEmptyString(profiles.general)) {
    profile.general = buildStarterUserProfileText();
    profileSeeded = true;
    changed = true;
  }
  if (!hasNonEmptyString(profiles.fitness)) profile.fitness = "";
  if (!hasNonEmptyString(profiles.diet)) profile.diet = "";
  if (!hasNonEmptyString(profiles.agent)) profile.agent = "";

  const existingTemplate = extractChecklistTemplate(asObject(getTrackingMetadata(data).checklist_template));
  if (!existingTemplate) {
    const categories = buildStarterChecklistCategories();
    const baseWeek = isPlainObject(currentWeek) ? currentWeek : {};
    const remappedWeek = applyChecklistCategories(baseWeek, categories);
    const template = extractChecklistTemplate(remappedWeek);
    if (template) {
      const existingBlocksState = normalizeStoredTrainingBlocks(metadata);
      if (!existingBlocksState.blocks.length) {
        const starterBlock = buildTrainingBlockFromTemplate({
          template,
          blocks: [],
        });
        if (starterBlock) {
          metadata.training_blocks = {
            active_block_id: starterBlock.id,
            blocks: [starterBlock],
          };
          remappedWeek.training_block_id = starterBlock.id;
          remappedWeek.training_block_name = starterBlock.name;
          remappedWeek.training_block_description = starterBlock.description;
          syncCanonicalActivityBlocksFromStoredBlocks(data, [starterBlock]);
        }
      }
      metadata.checklist_template = template;
      metadata.last_updated = timestamp;
      upsertCanonicalWeekFromChecklistTemplateWeek(data, remappedWeek);
      checklistSeeded = true;
      changed = true;
    }
  }

  if (!hasSeedMarker(data)) {
    metadata.settings_seeded_at = timestamp;
    metadata.settings_seed_version = 1;
    metadata.onboarding = {
      ...(isPlainObject(metadata.onboarding) ? metadata.onboarding : {}),
      stage: "complete",
      completed_at: timestamp,
      last_active_at: timestamp,
    };
    changed = true;
  }
  metadata.updated_at = timestamp;
  setTrackingMetadata(data, metadata);

  return {
    changed,
    summary: { profile_seeded: profileSeeded, checklist_seeded: checklistSeeded },
  };
}

function hasPendingSettingsChanges(changes) {
  if (!isPlainObject(changes)) return false;
  const hasProfileChange = SETTINGS_PROFILE_FIELDS.some((field) => typeof changes[field] === "string");
  const hasChecklistChange =
    Array.isArray(changes?.[SETTINGS_CHECKLIST_FIELD]) && changes[SETTINGS_CHECKLIST_FIELD].length > 0;
  const hasTrainingBlockChange = isPlainObject(changes?.[SETTINGS_TRAINING_BLOCK_FIELD]);
  return hasProfileChange || hasChecklistChange || hasTrainingBlockChange;
}

function isValidSettingsProposal(value) {
  if (!isPlainObject(value)) return false;
  for (const key of Object.keys(value)) {
    if (!SETTINGS_PROPOSAL_FIELDS.includes(key)) return false;
  }
  for (const field of SETTINGS_PROFILE_INPUT_FIELDS) {
    const fieldValue = value[field];
    if (fieldValue !== null && fieldValue !== undefined && typeof fieldValue !== "string") return false;
  }
  const checklistValue = value[SETTINGS_CHECKLIST_FIELD];
  if (!(checklistValue === null || checklistValue === undefined)) {
    const normalizedChecklist = normalizeChecklistCategories(checklistValue);
    if (!normalizedChecklist) return false;
  }
  const trainingBlockValue = value[SETTINGS_TRAINING_BLOCK_FIELD];
  if (trainingBlockValue === null || trainingBlockValue === undefined) return true;
  if (!isPlainObject(trainingBlockValue)) return false;
  const idValue = trainingBlockValue.id;
  if (idValue !== null && idValue !== undefined && typeof idValue !== "string") return false;
  const nameValue = trainingBlockValue.name;
  if (nameValue !== null && nameValue !== undefined && typeof nameValue !== "string") return false;
  const descriptionValue = trainingBlockValue.description;
  if (descriptionValue !== null && descriptionValue !== undefined && typeof descriptionValue !== "string") return false;
  const applyTimingValue = trainingBlockValue.apply_timing;
  if (
    applyTimingValue !== null &&
    applyTimingValue !== undefined &&
    applyTimingValue !== "immediate" &&
    applyTimingValue !== "next_week"
  ) {
    return false;
  }
  const checklistCategoriesValue = trainingBlockValue.checklist_categories;
  if (checklistCategoriesValue === null || checklistCategoriesValue === undefined) return true;
  const normalizedChecklist = normalizeChecklistCategories(checklistCategoriesValue);
  return !!normalizedChecklist;
}

function normalizeChecklistProposal(value) {
  const normalized = normalizeChecklistCategories(value);
  return normalized ? normalized : null;
}

function normalizeSettingsProposal(value) {
  const raw = isPlainObject(value) ? value : {};
  const out = {
    [SETTINGS_CHECKLIST_FIELD]: null,
    general: null,
    fitness: null,
    diet: null,
    agent: null,
    training_block: null,
  };
  out[SETTINGS_CHECKLIST_FIELD] = normalizeChecklistProposal(raw[SETTINGS_CHECKLIST_FIELD]);
  const rawTrainingBlock = isPlainObject(raw[SETTINGS_TRAINING_BLOCK_FIELD]) ? raw[SETTINGS_TRAINING_BLOCK_FIELD] : null;
  if (rawTrainingBlock) {
    const normalizedBlock = {
      id: typeof rawTrainingBlock.id === "string" && rawTrainingBlock.id.trim() ? rawTrainingBlock.id.trim() : null,
      name: typeof rawTrainingBlock.name === "string" ? normalizeTrainingBlockName(rawTrainingBlock.name) : null,
      description:
        typeof rawTrainingBlock.description === "string"
          ? normalizeTrainingBlockDescription(rawTrainingBlock.description)
          : null,
      apply_timing: normalizeTrainingBlockApplyTiming(rawTrainingBlock.apply_timing),
      checklist_categories: normalizeChecklistProposal(rawTrainingBlock.checklist_categories),
    };
    const hasBlockFields = Object.values(normalizedBlock).some((entry) => {
      if (Array.isArray(entry)) return entry.length > 0;
      if (typeof entry === "string") return entry.length > 0;
      return entry !== null && entry !== undefined;
    });
    out.training_block = hasBlockFields ? normalizedBlock : null;
  }
  for (const field of SETTINGS_PROFILE_FIELDS) {
    out[field] = readSettingsProfileInput(raw, field);
  }
  return out;
}

function appendSettingsHistoryEvent(data, { domains }) {
  const metadata = { ...getTrackingMetadata(data) };
  const appliedAt = formatSeattleIso(new Date());
  const effectiveFrom = getSeattleDateString(new Date());
  const currentVersion = Number.isInteger(metadata.settings_version) ? metadata.settings_version : 0;
  const nextVersion = currentVersion + 1;
  const event = {
    version: nextVersion,
    applied_at: appliedAt,
    effective_from: effectiveFrom,
    domains,
  };
  const previous = Array.isArray(metadata.settings_history) ? metadata.settings_history : [];
  metadata.settings_version = nextVersion;
  metadata.settings_history = [...previous.slice(-19), event];
  metadata.last_updated = appliedAt;
  setTrackingMetadata(data, metadata);
  return { settingsVersion: nextVersion, effectiveFrom };
}

async function applySettingsChanges({ proposal }) {
  if (!isValidSettingsProposal(proposal)) throw new Error("Invalid settings proposal payload.");
  const normalized = normalizeSettingsProposal(proposal);
  const ensuredCurrentWeek = await ensureCurrentWeek();
  const data = await readTrackingData();
  const changesApplied = [];
  const domains = [];
  const profile = ensureTrackingProfile(data);
  const currentProfiles = getSettingsProfiles(data);

  for (const field of SETTINGS_PROFILE_FIELDS) {
    const nextValue = normalized[field];
    if (typeof nextValue !== "string") continue;
    if (normalizeProfileText(currentProfiles[field]) === nextValue) continue;
    profile[field] = nextValue;
    domains.push(field);
    const label = SETTINGS_PROFILE_LABELS[field] ?? field;
    changesApplied.push(`Updated ${label}.`);
  }

  const metadata = { ...getTrackingMetadata(data) };
  const trainingBlocksState = normalizeStoredTrainingBlocks(metadata);
  const blocks = [...trainingBlocksState.blocks];
  let activeBlockId = trainingBlocksState.active_block_id;
  if (!activeBlockId && blocks.length) activeBlockId = blocks[blocks.length - 1].id;

  let currentWeek = (isPlainObject(ensuredCurrentWeek) ? ensuredCurrentWeek : null) || {};
  const requestedTemplate = normalized[SETTINGS_CHECKLIST_FIELD];
  const requestedBlockPatch = isPlainObject(normalized.training_block) ? normalized.training_block : null;
  const requestedBlockCategories = requestedBlockPatch?.checklist_categories ?? requestedTemplate ?? null;
  const requestedBlockTemplate =
    Array.isArray(requestedBlockCategories) && requestedBlockCategories.length
      ? checklistCategoriesToTemplate(requestedBlockCategories, currentWeek)
      : null;
  const requestedTiming = normalizeTrainingBlockApplyTiming(requestedBlockPatch?.apply_timing);

  let targetBlockId = activeBlockId;
  let targetBlockTemplate = null;
  let phaseShiftRequested = false;
  let trainingBlockChanged = false;

  if (requestedBlockPatch || requestedBlockTemplate) {
    const requestedId = typeof requestedBlockPatch?.id === "string" && requestedBlockPatch.id.trim() ? requestedBlockPatch.id.trim() : null;
    let selectedIndex = -1;
    if (requestedId) {
      selectedIndex = blocks.findIndex((block) => block.id === requestedId);
      if (selectedIndex < 0) throw new Error(`Unknown training block id: ${requestedId}`);
    } else if (
      requestedBlockPatch &&
      !requestedBlockTemplate &&
      (normalizeTrainingBlockName(requestedBlockPatch.name) || normalizeTrainingBlockDescription(requestedBlockPatch.description))
    ) {
      selectedIndex = blocks.findIndex((block) => block.id === activeBlockId);
    }

    if (selectedIndex >= 0) {
      const existing = blocks[selectedIndex];
      const baseTemplate = extractTemplateFromStoredBlock(existing);
      const finalTemplate = requestedBlockTemplate ?? baseTemplate;
      const updatedBlock = buildTrainingBlockFromTemplate({
        template: finalTemplate,
        blockId: existing.id,
        name: requestedBlockPatch?.name,
        description: requestedBlockPatch?.description,
        existing,
        blocks,
      });
      if (!updatedBlock) throw new Error("Training block is missing checklist categories.");
      const existingJson = JSON.stringify(existing);
      const updatedJson = JSON.stringify(updatedBlock);
      if (existingJson !== updatedJson) {
        blocks[selectedIndex] = updatedBlock;
        trainingBlockChanged = true;
      }
      targetBlockId = existing.id;
      targetBlockTemplate = finalTemplate;
      if (targetBlockId !== activeBlockId) phaseShiftRequested = true;
    } else if (requestedBlockTemplate) {
      const newBlock = buildTrainingBlockFromTemplate({
        template: requestedBlockTemplate,
        blockId: requestedBlockPatch?.id,
        name: requestedBlockPatch?.name,
        description: requestedBlockPatch?.description,
        blocks,
      });
      if (!newBlock) throw new Error("Training block checklist is required.");
      blocks.push(newBlock);
      trainingBlockChanged = true;
      targetBlockId = newBlock.id;
      targetBlockTemplate = requestedBlockTemplate;
      if (targetBlockId !== activeBlockId) phaseShiftRequested = true;
    }
  }

  const activeBlock = blocks.find((block) => block.id === targetBlockId) ?? null;
  const activeTemplate = targetBlockTemplate ?? extractTemplateFromStoredBlock(activeBlock);
  const currentHasProgress = hasCurrentWeekProgress(currentWeek);

  if (phaseShiftRequested && !requestedTiming && currentHasProgress) {
    const followupQuestion =
      "I can apply this phase switch now or start it next Monday. Do you want `immediate` or `next_week`?";
    return {
      changesApplied,
      updated: null,
      week: currentWeek,
      settingsVersion: Number.isInteger(getTrackingMetadata(data)?.settings_version)
        ? getTrackingMetadata(data).settings_version
        : null,
      effectiveFrom: null,
      followupQuestion,
      requiresTimingChoice: true,
    };
  }

  if (trainingBlockChanged || phaseShiftRequested) {
    const openEndedIds = findOpenEndedTrainingBlockIds(blocks);
    if (openEndedIds.length > 1) {
      throw new Error(
        `Invalid training block configuration: only one open-ended block is allowed (found ${openEndedIds.length}).`,
      );
    }
    activeBlockId = targetBlockId;
    metadata.training_blocks = {
      active_block_id: activeBlockId,
      blocks,
    };
    syncCanonicalActivityBlocksFromStoredBlocks(data, blocks);
    if (activeTemplate) metadata.checklist_template = activeTemplate;
    else delete metadata.checklist_template;
    domains.push(SETTINGS_TRAINING_BLOCK_FIELD);
    changesApplied.push(
      phaseShiftRequested
        ? requestedTiming === "next_week"
          ? "Scheduled training block change for next week."
          : "Switched training block."
        : "Updated training block.",
    );
  }

  const shouldApplyImmediateShift = phaseShiftRequested && requestedTiming !== "next_week";
  const shouldApplyCurrentWeekTemplate = shouldApplyImmediateShift || (activeBlockId && !phaseShiftRequested && requestedBlockTemplate);
  if (shouldApplyCurrentWeekTemplate && activeTemplate) {
    const nextWeek = buildWeekFromTemplate(currentWeek, activeTemplate);
    nextWeek.training_block_id = activeBlockId;
    nextWeek.training_block_name = normalizeTrainingBlockName(activeBlock?.name);
    nextWeek.training_block_description = normalizeTrainingBlockDescription(activeBlock?.description);
    const existingTemplate = extractChecklistTemplate(currentWeek);
    const nextTemplate = extractChecklistTemplate(nextWeek);
    if (
      JSON.stringify(existingTemplate ?? null) !== JSON.stringify(nextTemplate ?? null) ||
      currentWeek.training_block_id !== nextWeek.training_block_id ||
      currentWeek.training_block_name !== nextWeek.training_block_name ||
      currentWeek.training_block_description !== nextWeek.training_block_description
    ) {
      const storedWeek = upsertCanonicalWeekFromChecklistTemplateWeek(data, nextWeek);
      if (storedWeek) currentWeek = nextWeek;
      if (!domains.includes(SETTINGS_CHECKLIST_FIELD)) domains.push(SETTINGS_CHECKLIST_FIELD);
      if (!changesApplied.includes("Updated training checklist template.")) {
        changesApplied.push("Updated training checklist template.");
      }
    }
  }
  setTrackingMetadata(data, metadata);

  if (changesApplied.length) {
    const versionMeta = appendSettingsHistoryEvent(data, { domains });
    await writeTrackingData(data);
    const refreshedCurrentWeek = await ensureCurrentWeek();
    return {
      changesApplied,
      updated: {
        ...getSettingsProfiles(data),
      },
      week: isPlainObject(refreshedCurrentWeek) ? refreshedCurrentWeek : currentWeek,
      settingsVersion: versionMeta.settingsVersion,
      effectiveFrom: versionMeta.effectiveFrom,
      followupQuestion: null,
      requiresTimingChoice: false,
    };
  }

  return {
    changesApplied,
    updated: null,
    week: currentWeek,
    settingsVersion: Number.isInteger(getTrackingMetadata(data)?.settings_version)
      ? getTrackingMetadata(data).settings_version
      : null,
    effectiveFrom: null,
    followupQuestion: null,
    requiresTimingChoice: false,
  };
}

async function saveSettingsProfilesDirect(changes) {
  if (!isPlainObject(changes)) throw new Error("Invalid settings profiles payload.");
  const data = await readTrackingData();
  const changesApplied = [];
  const domains = [];
  const profile = ensureTrackingProfile(data);
  const currentProfiles = getSettingsProfiles(data);
  for (const field of SETTINGS_PROFILE_FIELDS) {
    const hasField = field in changes;
    if (!hasField) continue;
    const nextValue = readSettingsProfileInput(changes, field);
    if (typeof nextValue !== "string") throw new Error(`Invalid field: ${field}`);
    if (normalizeProfileText(currentProfiles[field]) === nextValue) continue;
    profile[field] = nextValue;
    domains.push(field);
    const label = SETTINGS_PROFILE_LABELS[field] ?? field;
    changesApplied.push(`Updated ${label}.`);
  }
  if (changesApplied.length) {
    const versionMeta = appendSettingsHistoryEvent(data, { domains });
    await writeTrackingData(data);
    return {
      changesApplied,
      updated: getSettingsProfiles(data),
      settingsVersion: versionMeta.settingsVersion,
      effectiveFrom: versionMeta.effectiveFrom,
    };
  }
  return {
    changesApplied,
    updated: getSettingsProfiles(data),
    settingsVersion: Number.isInteger(getTrackingMetadata(data)?.settings_version)
      ? getTrackingMetadata(data).settings_version
      : null,
    effectiveFrom: null,
  };
}

app.get("/api/settings/state", async (_req, res) => {
  try {
    const data = await readTrackingData();
    res.json({
      ok: true,
      profiles: getSettingsProfiles(data),
      settings_version: Number.isInteger(getTrackingMetadata(data)?.settings_version)
        ? getTrackingMetadata(data).settings_version
        : null,
      training_blocks: summarizeTrainingBlocks(data),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/settings/profiles", async (req, res) => {
  try {
    const payload = isPlainObject(req.body) ? req.body : {};
    const hasAnyField = SETTINGS_PROFILE_INPUT_FIELDS.some((field) => field in payload);
    if (!hasAnyField) return res.status(400).json({ ok: false, error: "Provide at least one profile field to save." });

    const saved = await saveSettingsProfilesDirect(payload);
    res.json({
      ok: true,
      changes_applied: saved.changesApplied,
      updated: saved.updated,
      settings_version: saved.settingsVersion,
      effective_from: saved.effectiveFrom,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidationError = message.startsWith("Invalid field:");
    res.status(isValidationError ? 400 : 500).json({ ok: false, error: message });
  }
});

app.post("/api/settings/bootstrap", async (_req, res) => {
  try {
    const currentWeek = await ensureCurrentWeek();
    const data = await readTrackingData();
    const seededAlready = hasSeedMarker(data);
    if (seededAlready) {
      return res.json({
        ok: true,
        seeded_now: false,
        already_seeded: true,
        default_open_view: null,
        starter_summary: {
          profile_seeded: false,
          checklist_seeded: false,
        },
        updated_profiles: null,
      });
    }

    const seeded = applyStarterSeed(data, { now: new Date(), currentWeek });
    if (seeded.changed) await writeTrackingData(data);

    return res.json({
      ok: true,
      seeded_now: true,
      already_seeded: false,
      default_open_view: "settings",
      starter_summary: seeded.summary,
      updated_profiles: getSettingsProfiles(data),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/context", async (_req, res) => {
  try {
    await ensureCurrentWeek();
    const data = await readTrackingData();
    const rules = getTrackingRules(data);
    res.json({
      ok: true,
      suggested_date: getSuggestedLogDate(),
      diet_philosophy: rules.diet_philosophy ?? null,
      fitness_philosophy: rules.fitness_philosophy ?? null,
      user_profile_goals: {
        diet_goals: [],
        fitness_goals: [],
        health_goals: [],
      },
      profiles: getSettingsProfiles(data),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/user/export", async (req, res) => {
  try {
    const data = await readTrackingData();
    const exportData = toImportExportDataShape(data);
    res.json({
      ok: true,
      export: {
        exported_at: new Date().toISOString(),
        user_id: req.user?.id ?? null,
        data: exportData,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/user/import/analyze", importUpload.single("file"), async (req, res) => {
  try {
    const file = req.file ?? null;
    const pastedText =
      typeof req.body?.raw_text === "string" && req.body.raw_text.trim()
        ? req.body.raw_text.trim()
        : typeof req.body?.text === "string" && req.body.text.trim()
          ? req.body.text.trim()
          : "";
    if (!file && !pastedText) {
      return res.status(400).json({ ok: false, error: "Provide a file upload or pasted JSON text." });
    }

    const rawText = file ? file.buffer.toString("utf8") : pastedText;
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return res.status(400).json({ ok: false, error: "Invalid JSON input." });
    }

    const analysis = analyzeImportPayload(parsed);
    const importToken = analysis.has_importable_domain
      ? createImportSession({
          plan: analysis.plan,
          userId: req.user?.id ?? null,
        })
      : null;

    return res.json({
      ok: true,
      detected_shape: analysis.detected_shape,
      summary: analysis.summary,
      warnings: analysis.warnings,
      normalized_preview: analysis.normalized_preview,
      import_token: importToken,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/user/import/confirm", async (req, res) => {
  try {
    const importToken = typeof req.body?.import_token === "string" ? req.body.import_token.trim() : "";
    const confirmText = typeof req.body?.confirm_text === "string" ? req.body.confirm_text.trim() : "";
    if (!importToken) return res.status(400).json({ ok: false, error: "Missing field: import_token" });
    if (confirmText !== "IMPORT") {
      return res.status(400).json({ ok: false, error: "Type IMPORT to confirm data replacement." });
    }

    const session = consumeImportSession({
      token: importToken,
      userId: req.user?.id ?? null,
    });
    if (!session) {
      return res.status(400).json({ ok: false, error: "Import session expired or invalid. Re-analyze the file." });
    }

    const currentData = await readTrackingData();
    const applied = applyImportPlan({
      existingData: currentData,
      plan: session.plan,
      nowIso: formatSeattleIso(new Date()),
    });

    if (!Array.isArray(applied.applied_domains) || !applied.applied_domains.length) {
      return res.status(400).json({
        ok: false,
        error: "No importable domains were found to apply.",
        skipped_domains: applied.skipped_domains ?? [],
        warnings: applied.warnings ?? [],
      });
    }

    await writeTrackingData(applied.data);
    return res.json({
      ok: true,
      applied_domains: applied.applied_domains,
      skipped_domains: applied.skipped_domains,
      warnings: applied.warnings,
      stats: applied.stats,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/settings/chat", async (req, res) => {
  try {
    const stream = isStreamingRequest(req.body?.stream) || isStreamingRequest(req.query?.stream);
    if (stream) enableSseHeaders(res);

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message) return res.status(400).json({ ok: false, error: "Missing field: message" });
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const result = stream
      ? await streamSettingsAssistant({
          message,
          messages,
          onText: (delta) => sendStreamingAssistantChunk(res, delta),
        })
      : await askSettingsAssistant({ message, messages });

    const changes = normalizeSettingsProposal(result?.changes ?? {});
    const hasProposal = hasPendingSettingsChanges(changes);
    const applied = hasProposal
      ? await applySettingsChanges({ proposal: changes })
      : {
          changesApplied: [],
          updated: null,
          week: null,
          settingsVersion: null,
          effectiveFrom: null,
          followupQuestion: null,
          requiresTimingChoice: false,
        };
    const assistantMessage = typeof result?.assistant_message === "string" ? result.assistant_message.trim() : "";
    const canonicalWeek = await getCurrentActivityWeek();

    const payload = {
      ok: true,
      assistant_message: assistantMessage,
      followup_question: applied.followupQuestion ?? result.followup_question ?? null,
      requires_confirmation: false,
      proposal_id: null,
      proposal: applied.requiresTimingChoice ? changes : null,
      changes_applied: applied.changesApplied,
      updated: applied.updated,
      settings_version: applied.settingsVersion,
      effective_from: applied.effectiveFrom,
      week: canonicalWeek,
    };
    if (stream) {
      sendStreamingAssistantDone(res, payload);
      return res.end();
    }
    return res.json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidationError =
      message === "Invalid settings proposal payload." ||
      message.startsWith("Invalid training block configuration:");
    if (isStreamingRequest(req.body?.stream) || isStreamingRequest(req.query?.stream)) {
      sendStreamingAssistantError(res, err);
      if (!res.writableEnded) res.end();
      return;
    }
    res.status(isValidationError ? 400 : 500).json({ ok: false, error: message });
  }
});

app.post("/api/settings/confirm", async (req, res) => {
  try {
    const proposal = req.body?.proposal;
    if (!isValidSettingsProposal(proposal) || !hasPendingSettingsChanges(proposal)) {
      return res.status(400).json({ ok: false, error: "Missing or invalid proposal." });
    }
    const applied = await applySettingsChanges({ proposal });
    if (applied.requiresTimingChoice) {
      return res.status(400).json({ ok: false, error: applied.followupQuestion || "Missing phase apply timing." });
    }
    const canonicalWeek = await getCurrentActivityWeek();
    res.json({
      ok: true,
      changes_applied: applied.changesApplied,
      updated: applied.updated,
      week: canonicalWeek,
      settings_version: applied.settingsVersion,
      effective_from: applied.effectiveFrom,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidationError =
      message === "Invalid settings proposal payload." ||
      message.startsWith("Invalid training block configuration:");
    res.status(isValidationError ? 400 : 500).json({ ok: false, error: message });
  }
});

app.post("/api/assistant/ask", async (req, res) => {
  try {
    const question = typeof req.body?.question === "string" && req.body.question.trim() ? req.body.question.trim() : null;
    if (!question) return res.status(400).json({ ok: false, error: "Missing field: question" });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    if (isClearFoodCommand(question)) {
      const targetDate = resolveClearFoodDate({ message: question, selectedDate: date });
      const cleared = await clearFoodEntriesForDate(targetDate);
      const removed = Number(cleared?.removed_count) || 0;
      const answer =
        removed > 0
          ? `Cleared ${removed} food ${removed === 1 ? "entry" : "entries"} for ${targetDate}.`
          : `No food entries were found for ${targetDate}.`;
      return res.json({ ok: true, answer });
    }
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const stream = isStreamingRequest(req.body?.stream) || isStreamingRequest(req.query?.stream);

    if (stream) {
      enableSseHeaders(res);
      try {
        const answer = await streamAssistantResponse({
          question,
          date,
          messages,
          onText: (delta) => sendStreamingAssistantChunk(res, delta),
        });
        sendStreamingAssistantDone(res, { ok: true, answer, action: "question" });
      } catch (error) {
        sendStreamingAssistantError(res, error);
      } finally {
        res.end();
      }
      return;
    }

    const answer = await askAssistant({ question, date, messages });
    res.json({ ok: true, answer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/assistant/ingest", upload.single("image"), async (req, res) => {
  try {
    const file = req.file ?? null;
    if (file && !file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message && !file) return res.status(400).json({ ok: false, error: "Provide a message or an image." });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const eventId = typeof req.body?.event_id === "string" && req.body.event_id.trim() ? req.body.event_id.trim() : null;
    const clientRequestId =
      typeof req.body?.client_request_id === "string" && req.body.client_request_id.trim()
        ? req.body.client_request_id.trim()
        : null;
    let messages = [];
    if (typeof req.body?.messages === "string" && req.body.messages.trim()) {
      try {
        const parsed = JSON.parse(req.body.messages);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    }
    const stream = isStreamingRequest(req.body?.stream);

    if (!file && isClearFoodCommand(message)) {
      const targetDate = resolveClearFoodDate({ message, selectedDate: date });
      const cleared = await clearFoodEntriesForDate(targetDate);
      const removed = Number(cleared?.removed_count) || 0;
      const assistantMessage =
        removed > 0
          ? `Cleared ${removed} food ${removed === 1 ? "entry" : "entries"} for ${targetDate}.`
          : `No food entries were found for ${targetDate}.`;
      const responsePayload = {
        ok: true,
        action: "food",
        assistant_message: assistantMessage,
        followup_question: null,
        food_result: {
          ok: true,
          date: targetDate,
          log_action: "cleared",
          removed_count: removed,
          day: cleared?.day ?? null,
        },
        activity_updates: null,
        answer: null,
        date: targetDate,
        log_action: "cleared",
      };
      if (stream) {
        enableSseHeaders(res);
        sendStreamingAssistantDone(res, responsePayload);
        return res.end();
      }
      return res.json(responsePayload);
    }

    if (!file && looksLikeBulkFoodImportText(message)) {
      const responsePayload = {
        ok: true,
        action: "clarify",
        assistant_message:
          "That looks like multi-day import data. I did not log it as today's meal. Use Account > Import data to upload or paste JSON, then confirm IMPORT.",
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer: null,
      };
      if (stream) {
        enableSseHeaders(res);
        sendStreamingAssistantDone(res, responsePayload);
        return res.end();
      }
      return res.json(responsePayload);
    }

    const decision = await decideIngestAction({
      message,
      hasImage: Boolean(file),
      imageBuffer: file?.buffer ?? null,
      imageMimeType: file?.mimetype ?? null,
      date,
      messages,
    });
    const confidence = typeof decision?.confidence === "number" ? decision.confidence : 0;
    const intent = decision?.intent ?? "clarify";

    if (confidence < 0.55 && intent !== "clarify") {
      return res.json({
        ok: true,
        action: "clarify",
        assistant_message:
          decision?.clarifying_question ??
          "Do you want to log food, log an activity, or ask a question?",
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer: null,
      });
    }

    if (intent === "question") {
      const questionText = decision?.question?.trim() || message;
      if (stream) {
        enableSseHeaders(res);
        try {
          const answer = await streamAssistantResponse({
            question: questionText,
            date,
            messages,
            onText: (delta) => sendStreamingAssistantChunk(res, delta),
          });
          sendStreamingAssistantDone(res, {
            ok: true,
            action: "question",
            assistant_message: answer,
            followup_question: null,
            food_result: null,
            activity_updates: null,
            answer,
          });
        } catch (error) {
          sendStreamingAssistantError(res, error);
        } finally {
          res.end();
        }
        return;
      }
      const answer = await askAssistant({ question: questionText, date, messages });
      res.json({
        ok: true,
        action: "question",
        assistant_message: answer,
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer,
      });
      return;
    }

    if (intent === "food") {
      const payload = await logFoodFromInputs({
        file,
        descriptionText: message,
        notes: "",
        date,
        eventId,
        clientRequestId,
      });
      let mealResponse = summarizeFoodResult(payload);
      try {
        const generated = await composeMealEntryResponse({
          payload,
          date: payload?.date ?? date,
          messages,
        });
        const assistantMessage = formatMealEntryAssistantMessage(generated);
        mealResponse = {
          assistant_message: assistantMessage || summarizeFoodResult(payload).assistant_message,
          followup_question: generated?.followup_question ?? null,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("Meal response generation failed, using fallback summary.", err);
      }

      const responsePayload = {
        ok: true,
        action: "food",
        assistant_message: mealResponse.assistant_message,
        followup_question: mealResponse.followup_question,
        food_result: payload,
        activity_updates: null,
        answer: null,
        date: payload?.date ?? null,
        log_action: payload?.log_action ?? null,
      };
      if (stream) {
        enableSseHeaders(res);
        sendStreamingAssistantDone(res, responsePayload);
        return res.end();
      }
      return res.json(responsePayload);
    }

    if (intent === "activity") {
      const currentWeek = await ensureCurrentWeek();
      const { resolved, errors } = resolveActivitySelections(decision?.activity?.selections, currentWeek);
      if (!resolved.length || errors.length) {
        return res.json({
          ok: true,
          action: "clarify",
          assistant_message:
            decision?.activity?.followup_question ??
            decision?.clarifying_question ??
            "Which checklist item should I log this under?",
          followup_question: null,
          food_result: null,
          activity_updates: null,
          answer: null,
        });
      }

      const activityDate = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : getSuggestedLogDate();
      const updates = resolved.map((u) => ({
        category: u.category,
        index: u.index,
        checked: true,
        details: u.details,
        date: activityDate,
      }));
      const hasExistingEntries = updates.some((u) => isExistingActivityEntry(currentWeek, u));

      const updatedWeek = await updateCurrentWeekItems(updates);
      await refreshCurrentWeekSummaryForActivity(updatedWeek);
      const canonicalWeek = await getCurrentActivityWeek();

      const responsePayload = {
        ok: true,
        action: "activity",
        activity_log_state: hasExistingEntries ? "updated" : "saved",
        assistant_message: summarizeActivityUpdates(resolved),
        followup_question: decision?.activity?.followup_question ?? null,
        food_result: null,
        activity_updates: resolved,
        week: canonicalWeek,
        answer: null,
      };
      if (stream) {
        enableSseHeaders(res);
        sendStreamingAssistantDone(res, responsePayload);
        return res.end();
      }
      return res.json(responsePayload);
    }

    const responsePayload = {
      ok: true,
      action: "clarify",
      assistant_message:
        decision?.clarifying_question ?? "Do you want to log food, log an activity, or ask a question?",
      followup_question: null,
      food_result: null,
      activity_updates: null,
      answer: null,
    };
    if (stream) {
      enableSseHeaders(res);
      sendStreamingAssistantDone(res, responsePayload);
      return res.end();
    }
    return res.json(responsePayload);
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

function normalizeDietDayPatchInput(body) {
  const safe = isPlainObject(body) ? body : {};
  const date = typeof safe.date === "string" ? safe.date.trim() : "";
  if (!date) throw new Error("Missing field: date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid field: date");

  const toNumberOrNull = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };

  const patch = {
    date,
    weight_lb: toNumberOrNull(safe.weight_lb),
    calories: toNumberOrNull(safe.calories),
    fat_g: toNumberOrNull(safe.fat_g),
    carbs_g: toNumberOrNull(safe.carbs_g),
    protein_g: toNumberOrNull(safe.protein_g),
    fiber_g: toNumberOrNull(safe.fiber_g),
    status: normalizeDayStatusValue(safe.status ?? safe.on_track),
    ai_summary: typeof safe.ai_summary === "string" ? safe.ai_summary : typeof safe.details === "string" ? safe.details : "",
  };

  return patch;
}

async function buildFoodDayPayload(date) {
  const data = await readTrackingData();
  const days = Array.isArray(data?.food?.days) ? data.food.days : [];
  const day = days.find((row) => row && row.date === date) ?? null;
  const toNumberOrNull = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
  const dayTotals = day
    ? {
        calories: toNumberOrNull(day.calories) ?? 0,
        fat_g: toNumberOrNull(day.fat_g) ?? 0,
        carbs_g: toNumberOrNull(day.carbs_g) ?? 0,
        protein_g: toNumberOrNull(day.protein_g) ?? 0,
        fiber_g: toNumberOrNull(day.fiber_g),
      }
    : {
        calories: 0,
        fat_g: 0,
        carbs_g: 0,
        protein_g: 0,
        fiber_g: null,
      };
  return {
    date,
    day,
    day_totals: dayTotals,
  };
}

app.get("/api/food/day", async (req, res) => {
  try {
    const date = typeof req.query?.date === "string" && req.query.date.trim() ? req.query.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing query param: date" });
    const payload = await buildFoodDayPayload(date);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/day", async (req, res) => {
  try {
    const patch = normalizeDietDayPatchInput(req.body);
    const data = await readTrackingData();
    const existing = Array.isArray(data?.food?.days) ? data.food.days : [];
    const nextDays = [...existing.filter((row) => row && row.date !== patch.date), patch].sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    );

    if (!isPlainObject(data.food)) data.food = {};
    data.food.days = nextDays;
    const metadata = { ...getTrackingMetadata(data), last_updated: formatSeattleIso(new Date()) };
    setTrackingMetadata(data, metadata);
    await writeTrackingData(data);

    const payload = await buildFoodDayPayload(patch.date);
    return res.json({ ok: true, ...payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isInputError = message.startsWith("Missing field:") || message.startsWith("Invalid field:");
    return res.status(isInputError ? 400 : 500).json({ ok: false, error: message });
  }
});

app.get("/api/food/log", async (req, res) => {
  try {
    const limitRaw = typeof req.query?.limit === "string" ? req.query.limit.trim() : null;
    const from = typeof req.query?.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
    const to = typeof req.query?.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;
    const limit = limitRaw ? Number(limitRaw) : 0;
    const rows = await listFoodDays({ limit, from, to });
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/log", upload.single("image"), async (req, res) => {
  try {
    const file = req.file ?? null;
    if (file && !file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    const descriptionText = typeof req.body?.description === "string" ? req.body.description : "";
    const eventId = typeof req.body?.event_id === "string" && req.body.event_id.trim() ? req.body.event_id.trim() : null;
    const clientRequestId =
      typeof req.body?.client_request_id === "string" && req.body.client_request_id.trim()
        ? req.body.client_request_id.trim()
        : null;

    const payload = await logFoodFromInputs({ file, descriptionText, notes, date, eventId, clientRequestId });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isInputError =
      msg === "Provide either an image or a meal description." ||
      msg === "Missing nutrients" ||
      msg.startsWith("Invalid date:") ||
      msg.startsWith("Food event not found:") ||
      msg === "Invalid event id";
    res.status(isInputError ? 400 : 500).json({ ok: false, error: msg });
  }
});

app.get("/api/fitness/current", async (_req, res) => {
  try {
    const week = await getCurrentActivityWeek();
    res.json({ ok: true, week });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/fitness/current/item", async (req, res) => {
  try {
    const index = typeof req.body?.workout_index === "number" ? req.body.workout_index : Number(req.body?.workout_index);
    const checked = typeof req.body?.checked === "boolean" ? req.body.checked : null;
    const details = typeof req.body?.details === "string" ? req.body.details : "";
    const dateRaw = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    if (dateRaw !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
      return res.status(400).json({ ok: false, error: "Invalid field: date" });
    }

    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ ok: false, error: "Invalid field: workout_index" });
    if (checked === null) return res.status(400).json({ ok: false, error: "Missing field: checked" });

    await updateCurrentActivityWorkout({ index, completed: checked, details, date: dateRaw });
    const checklistWeek = await ensureCurrentWeek();
    await refreshCurrentWeekSummaryForActivity(checklistWeek);
    const week = await getCurrentActivityWeek();
    res.json({ ok: true, week });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isInputError =
      message.startsWith("Invalid workout index:") ||
      message.startsWith("Invalid completed value") ||
      message.startsWith("Invalid details value") ||
      message.startsWith("Invalid date:") ||
      message.startsWith("Workout not found");
    res.status(isInputError ? 400 : 500).json({ ok: false, error: message });
  }
});

app.post("/api/fitness/current/summary", async (req, res) => {
  try {
    const summary =
      typeof req.body?.summary === "string"
        ? req.body.summary
        : typeof req.body?.ai_summary === "string"
          ? req.body.ai_summary
          : "";
    const week = await updateCurrentActivityWeekSummary(summary);
    res.json({ ok: true, week });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/fitness/history", async (req, res) => {
  try {
    const limitRaw = typeof req.query?.limit === "string" ? req.query.limit : null;
    const limit = limitRaw ? Number(limitRaw) : 12;
    const weeks = await listActivityWeeks({ limit });
    res.json({ ok: true, weeks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

async function start() {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    app.use(express.static(distDir, { index: false }));
    app.use(async (req, res) => {
      if (req.originalUrl.startsWith("/api")) {
        return res.status(404).json({ ok: false, error: "Not found" });
      }
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);

    app.use(async (req, res, next) => {
      try {
        const url = req.originalUrl;
        if (url.startsWith("/api")) {
          return res.status(404).json({ ok: false, error: "Not found" });
        }
        const template = await fs.readFile(path.join(clientRoot, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err);
        next(err);
      }
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Tracker listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
