import crypto from "node:crypto";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESERVED_WEEK_KEYS = new Set([
  "week_start",
  "week_label",
  "summary",
  "category_order",
  "category_labels",
  "checklist",
  "training_block_id",
  "training_block_name",
  "training_block_description",
]);

const PROTECTED_METADATA_KEYS = new Set([
  "data_files",
  "settings_version",
  "settings_history",
  "settings_seeded_at",
  "settings_seed_version",
  "onboarding",
  "training_blocks",
  "checklist_template",
  "updated_at",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function normalizeText(value) {
  return asString(value).replace(/\r\n/g, "\n").trim();
}

function hasIsoDate(value) {
  return typeof value === "string" && ISO_DATE_RE.test(value);
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

function toBoolean(value) {
  return value === true;
}

function hashToUuid(seed) {
  const hex = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 32);
  const variantNibble = ["8", "9", "a", "b"][parseInt(hex[16], 16) % 4];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function toSafeUuid(value, seed) {
  const raw = asString(value).trim();
  if (raw && UUID_RE.test(raw)) return raw;
  return hashToUuid(seed);
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (key in obj) return obj[key];
  }
  return undefined;
}

function detectShape(raw) {
  const safe = asObject(raw);
  if (asObject(safe.export).data && typeof asObject(safe.export).data === "object") return "current_export";
  if (safe.data && typeof safe.data === "object" && (safe.data.food_log || safe.data.fitness_weeks || safe.data.current_week)) {
    return "current_export";
  }
  if (
    safe.food_log ||
    safe.fitness_weeks ||
    safe.current_week ||
    safe.transition_context ||
    safe.diet_philosophy ||
    safe.fitness_philosophy
  ) {
    return "legacy_unified";
  }
  return "unknown";
}

function extractSource(raw, detectedShape) {
  const safe = asObject(raw);
  if (detectedShape === "current_export") {
    const exportData = asObject(asObject(safe.export).data);
    if (Object.keys(exportData).length) return exportData;
    const data = asObject(safe.data);
    if (Object.keys(data).length) return data;
  }
  return safe;
}

function parseItemAndDescription(raw) {
  const text = asString(raw).trim();
  if (!text) return { item: "", description: "" };
  const parts = text.split(/\s+-\s+/);
  if (parts.length < 2) return { item: text, description: "" };
  const item = asString(parts.shift()).trim();
  const description = parts.join(" - ").trim();
  return { item, description: item && description ? description : "" };
}

function normalizeChecklistEntry(entry) {
  if (typeof entry === "string") {
    const parsed = parseItemAndDescription(entry);
    if (!parsed.item) return null;
    return {
      item: parsed.item,
      description: parsed.description,
      checked: false,
      details: "",
    };
  }

  const safe = asObject(entry);
  const rawItem = asString(safe.item).trim();
  if (!rawItem) return null;
  const parsed = parseItemAndDescription(rawItem);
  const description = normalizeText(safe.description) || parsed.description;
  return {
    item: parsed.item,
    description,
    checked: toBoolean(safe.checked),
    details: asString(safe.details),
  };
}

function normalizeWeek(row, { requireWeekStart = true } = {}) {
  const safeBase = asObject(row);
  const safeChecklist = asObject(safeBase.checklist);
  const safe = { ...safeBase, ...safeChecklist };
  const weekStart = asString(safe.week_start).trim();
  if (requireWeekStart && !hasIsoDate(weekStart)) return null;

  const rawCategoryOrder = asArray(safe.category_order).filter((key) => typeof key === "string" && key.trim());
  const discoveredKeys = Object.keys(safe).filter((key) => !RESERVED_WEEK_KEYS.has(key) && Array.isArray(safe[key]));
  const categoryOrder = [];
  const seenKeys = new Set();
  for (const key of [...rawCategoryOrder, ...discoveredKeys]) {
    const trimmed = asString(key).trim();
    if (!trimmed || seenKeys.has(trimmed)) continue;
    if (!Array.isArray(safe[trimmed])) continue;
    seenKeys.add(trimmed);
    categoryOrder.push(trimmed);
  }

  const normalized = {
    week_start: hasIsoDate(weekStart) ? weekStart : "",
    week_label: normalizeText(safe.week_label),
    summary: asString(safe.summary),
  };
  const labels = asObject(safe.category_labels);
  const categoryLabels = {};
  for (const key of categoryOrder) {
    const rows = asArray(safe[key]).map((entry) => normalizeChecklistEntry(entry)).filter(Boolean);
    if (!rows.length) continue;
    normalized[key] = rows;
    const label = normalizeText(labels[key]);
    if (label) categoryLabels[key] = label;
  }
  const validKeys = categoryOrder.filter((key) => Array.isArray(normalized[key]) && normalized[key].length);
  if (!validKeys.length) return null;
  normalized.category_order = validKeys;
  if (Object.keys(categoryLabels).length) normalized.category_labels = categoryLabels;

  const trainingBlockId = normalizeText(safe.training_block_id);
  const trainingBlockName = normalizeText(safe.training_block_name);
  const trainingBlockDescription = normalizeText(safe.training_block_description);
  if (trainingBlockId) normalized.training_block_id = trainingBlockId;
  if (trainingBlockName) normalized.training_block_name = trainingBlockName;
  if (trainingBlockDescription) normalized.training_block_description = trainingBlockDescription;
  if (!normalized.week_label && normalized.week_start) normalized.week_label = normalized.week_start;
  return normalized;
}

function normalizeFoodLogRow(row) {
  const safe = asObject(row);
  const date = asString(safe.date).trim();
  if (!hasIsoDate(date)) return null;
  return {
    date,
    day_of_week: normalizeText(safe.day_of_week) || null,
    weight_lb: toNumberOrNull(safe.weight_lb),
    calories: toNumberOrNull(safe.calories),
    fat_g: toNumberOrNull(safe.fat_g),
    carbs_g: toNumberOrNull(safe.carbs_g),
    protein_g: toNumberOrNull(safe.protein_g),
    fiber_g: toNumberOrNull(safe.fiber_g),
    potassium_mg: toNumberOrNull(safe.potassium_mg),
    magnesium_mg: toNumberOrNull(safe.magnesium_mg),
    omega3_mg: toNumberOrNull(safe.omega3_mg),
    calcium_mg: toNumberOrNull(safe.calcium_mg),
    iron_mg: toNumberOrNull(safe.iron_mg),
    status: asString(safe.status) || null,
    healthy: asString(safe.healthy) || null,
    notes: asString(safe.notes) || null,
  };
}

function normalizeFoodEventRow(row, index) {
  const safe = asObject(row);
  const date = asString(safe.date).trim();
  if (!hasIsoDate(date)) return null;
  const loggedAtRaw = asString(safe.logged_at).trim();
  const parsed = Date.parse(loggedAtRaw);
  const loggedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(`${date}T12:00:00Z`).toISOString();
  const nutrientsRaw = asObject(safe.nutrients);
  const nutrients = {
    calories: toNumberOrNull(nutrientsRaw.calories),
    fat_g: toNumberOrNull(nutrientsRaw.fat_g),
    carbs_g: toNumberOrNull(nutrientsRaw.carbs_g),
    protein_g: toNumberOrNull(nutrientsRaw.protein_g),
    fiber_g: toNumberOrNull(nutrientsRaw.fiber_g),
    potassium_mg: toNumberOrNull(nutrientsRaw.potassium_mg),
    magnesium_mg: toNumberOrNull(nutrientsRaw.magnesium_mg),
    omega3_mg: toNumberOrNull(nutrientsRaw.omega3_mg),
    calcium_mg: toNumberOrNull(nutrientsRaw.calcium_mg),
    iron_mg: toNumberOrNull(nutrientsRaw.iron_mg),
  };
  return {
    id: toSafeUuid(
      safe.id,
      JSON.stringify([
        date,
        loggedAt,
        safe.source ?? "",
        safe.description ?? "",
        safe.input_text ?? "",
        safe.notes ?? "",
        index,
      ]),
    ),
    date,
    logged_at: loggedAt,
    rollover_applied: toBoolean(safe.rollover_applied),
    source: normalizeText(safe.source) || "manual",
    description: normalizeText(safe.description) || null,
    input_text: normalizeText(safe.input_text) || null,
    notes: asString(safe.notes) || null,
    nutrients,
    items: asArray(safe.items ?? safe.raw_items),
    model: normalizeText(safe.model) || null,
    confidence: safe.confidence ?? null,
    applied_to_food_log: toBoolean(safe.applied_to_food_log),
  };
}

function titleCaseFromKey(key) {
  return asString(key)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function stringifyProfileSection(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (value === null || value === undefined) return `${pad}- n/a`;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${pad}- ${String(value)}`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}- (none)`;
    return value.map((entry) => stringifyProfileSection(entry, indent)).join("\n");
  }
  const safe = asObject(value);
  const keys = Object.keys(safe);
  if (!keys.length) return `${pad}- (none)`;
  const lines = [];
  for (const key of keys) {
    lines.push(`${pad}- ${titleCaseFromKey(key)}:`);
    lines.push(stringifyProfileSection(safe[key], indent + 1));
  }
  return lines.join("\n");
}

function transitionContextToUserProfileText(transitionContext) {
  const safe = asObject(transitionContext);
  const keys = Object.keys(safe);
  if (!keys.length) return "";
  const lines = ["Imported Transition Context (Legacy):"];
  for (const key of keys) {
    lines.push("");
    lines.push(`${titleCaseFromKey(key)}:`);
    lines.push(stringifyProfileSection(safe[key], 0));
  }
  return lines.join("\n").trim();
}

function normalizeProfiles(source, warnings) {
  const safe = asObject(source);
  const profilesRoot = asObject(safe.profiles);
  const pickProfileField = (keys) => {
    for (const key of keys) {
      if (key in safe) return { value: normalizeText(safe[key]), provided: true };
    }
    for (const key of keys) {
      if (key in profilesRoot) return { value: normalizeText(profilesRoot[key]), provided: true };
    }
    return { value: "", provided: false };
  };
  const userField = pickProfileField(["user_profile", "userProfile"]);
  const trainingField = pickProfileField(["training_profile", "trainingProfile"]);
  const dietField = pickProfileField(["diet_profile", "dietProfile"]);
  const agentField = pickProfileField(["agent_profile", "agentProfile"]);
  const out = {
    user_profile: userField.value,
    training_profile: trainingField.value,
    diet_profile: dietField.value,
    agent_profile: agentField.value,
  };
  const provided = {
    user_profile: userField.provided,
    training_profile: trainingField.provided,
    diet_profile: dietField.provided,
    agent_profile: agentField.provided,
  };

  const transitionContext = asObject(pickFirst(safe, ["transition_context", "transitionContext"]));
  let usedTransition = false;
  if (!provided.user_profile && !out.user_profile && Object.keys(transitionContext).length) {
    out.user_profile = transitionContextToUserProfileText(transitionContext);
    usedTransition = Boolean(out.user_profile);
    provided.user_profile = usedTransition;
  }
  if (usedTransition) {
    warnings.push("Mapped legacy transition_context to user_profile text.");
  }

  const present = Object.values(provided).some(Boolean) || Object.values(out).some((value) => Boolean(value));
  const fields = Object.entries(provided)
    .filter(([, isProvided]) => isProvided)
    .map(([field]) => field);
  return {
    present,
    importable: present,
    value: out,
    provided,
    usedTransition,
    fields,
  };
}

function filterSafeMetadata(metadata) {
  const safe = asObject(metadata);
  const out = {};
  for (const [key, value] of Object.entries(safe)) {
    if (PROTECTED_METADATA_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function normalizeRulesAndMetadata(source) {
  const safe = asObject(source);
  const metadata = asObject(pickFirst(safe, ["metadata"]));
  const dietPhilosophy = asObject(pickFirst(safe, ["diet_philosophy", "dietPhilosophy"]));
  const fitnessPhilosophy = asObject(pickFirst(safe, ["fitness_philosophy", "fitnessPhilosophy"]));
  const assistantRules = asObject(pickFirst(safe, ["assistant_rules", "assistantRules"]));
  const present =
    Object.keys(metadata).length > 0 ||
    Object.keys(dietPhilosophy).length > 0 ||
    Object.keys(fitnessPhilosophy).length > 0 ||
    Object.keys(assistantRules).length > 0;
  return {
    present,
    importable: present,
    value: {
      metadata: filterSafeMetadata(metadata),
      diet_philosophy: dietPhilosophy,
      fitness_philosophy: fitnessPhilosophy,
      assistant_rules: assistantRules,
    },
  };
}

export function analyzeImportPayload(raw) {
  const warnings = [];
  const detectedShape = detectShape(raw);
  const source = extractSource(raw, detectedShape);

  const foodLogRaw = pickFirst(source, ["food_log", "foodLog", "food_logs"]);
  const foodLogPresent = foodLogRaw !== undefined;
  const foodLogRows = asArray(foodLogRaw).map((row) => normalizeFoodLogRow(row)).filter(Boolean);
  if (foodLogPresent && !foodLogRows.length) warnings.push("food_log was present but no valid rows were found.");

  const foodEventsRaw = pickFirst(source, ["food_events", "foodEvents", "events"]);
  const foodEventsPresent = foodEventsRaw !== undefined;
  let foodEventRows = [];
  if (foodEventsPresent) {
    foodEventRows = asArray(foodEventsRaw)
      .map((row, idx) => normalizeFoodEventRow(row, idx))
      .filter(Boolean);
    if (!foodEventRows.length) warnings.push("food_events was present but no valid rows were found.");
  } else if (detectedShape === "legacy_unified" && foodLogRows.length) {
    warnings.push("Event-level meal history absent; day totals imported only.");
  }

  const currentWeekRaw = pickFirst(source, ["current_week", "currentWeek"]);
  const currentWeekPresent = currentWeekRaw !== undefined;
  const currentWeek = normalizeWeek(currentWeekRaw, { requireWeekStart: false });
  if (currentWeekPresent && !currentWeek) warnings.push("current_week was present but invalid and will be skipped.");

  const fitnessWeeksRaw = pickFirst(source, ["fitness_weeks", "fitnessWeeks", "weeks"]);
  const fitnessWeeksPresent = fitnessWeeksRaw !== undefined;
  const fitnessWeeks = asArray(fitnessWeeksRaw)
    .map((week) => normalizeWeek(week, { requireWeekStart: true }))
    .filter(Boolean);
  if (fitnessWeeksPresent && !fitnessWeeks.length) warnings.push("fitness_weeks was present but no valid weeks were found.");

  const profiles = normalizeProfiles(source, warnings);
  const rules = normalizeRulesAndMetadata(source);

  const hasLegacyTransition = Boolean(Object.keys(asObject(pickFirst(source, ["transition_context", "transitionContext"]))).length);

  const domains = {
    food_log: {
      present: foodLogPresent,
      importable: foodLogRows.length > 0,
      value: foodLogRows,
      count: foodLogRows.length,
    },
    food_events: {
      present: foodEventsPresent || (detectedShape === "legacy_unified" && foodLogRows.length > 0),
      importable: foodEventsPresent ? foodEventRows.length > 0 : detectedShape === "legacy_unified" && foodLogRows.length > 0,
      value: foodEventsPresent ? foodEventRows : detectedShape === "legacy_unified" && foodLogRows.length ? [] : null,
      count: foodEventsPresent ? foodEventRows.length : 0,
    },
    current_week: {
      present: currentWeekPresent,
      importable: Boolean(currentWeek),
      value: currentWeek,
      count: currentWeek ? 1 : 0,
    },
    fitness_weeks: {
      present: fitnessWeeksPresent,
      importable: fitnessWeeks.length > 0,
      value: fitnessWeeks,
      count: fitnessWeeks.length,
    },
    profiles,
    rules,
  };

  const summary = {
    food_log: { present: domains.food_log.present, importable: domains.food_log.importable, count: domains.food_log.count },
    food_events: {
      present: domains.food_events.present,
      importable: domains.food_events.importable,
      count: domains.food_events.count,
    },
    current_week: {
      present: domains.current_week.present,
      importable: domains.current_week.importable,
      count: domains.current_week.count,
    },
    fitness_weeks: {
      present: domains.fitness_weeks.present,
      importable: domains.fitness_weeks.importable,
      count: domains.fitness_weeks.count,
    },
    profiles: {
      present: profiles.present,
      importable: profiles.importable,
      fields: profiles.fields,
      used_transition_context: profiles.usedTransition,
    },
    rules: {
      present: rules.present,
      importable: rules.importable,
      metadata_keys: Object.keys(rules.value.metadata),
      has_diet_philosophy: Object.keys(rules.value.diet_philosophy).length > 0,
      has_fitness_philosophy: Object.keys(rules.value.fitness_philosophy).length > 0,
      has_assistant_rules: Object.keys(rules.value.assistant_rules).length > 0,
    },
  };

  const normalized_preview = {
    detected_shape: detectedShape,
    counts: {
      food_log: domains.food_log.count,
      food_events: domains.food_events.count,
      fitness_weeks: domains.fitness_weeks.count,
      current_week: domains.current_week.count,
    },
    profile_fields: profiles.fields,
    used_transition_context: hasLegacyTransition && profiles.usedTransition,
    warnings_count: warnings.length,
  };

  const hasImportableDomain = Object.values(domains).some((domain) => domain && domain.importable);
  if (!hasImportableDomain) warnings.push("No importable domains found in file.");

  const plan = {
    detected_shape: detectedShape,
    warnings,
    domains,
  };

  return {
    detected_shape: detectedShape,
    summary,
    warnings,
    normalized_preview,
    has_importable_domain: hasImportableDomain,
    plan,
  };
}

export function applyImportPlan({ existingData, plan, nowIso }) {
  const current = asObject(existingData);
  const next = structuredClone(current);
  const domains = asObject(plan?.domains);
  const warnings = asArray(plan?.warnings);
  const applied_domains = [];
  const skipped_domains = [];
  const stats = {};

  if (domains.food_log?.present) {
    if (domains.food_log.importable) {
      next.food_log = asArray(domains.food_log.value);
      applied_domains.push("food_log");
      stats.food_log = next.food_log.length;
    } else {
      skipped_domains.push({ domain: "food_log", reason: "invalid_or_empty" });
    }
  }

  if (domains.food_events?.present) {
    if (domains.food_events.importable) {
      next.food_events = asArray(domains.food_events.value);
      applied_domains.push("food_events");
      stats.food_events = next.food_events.length;
    } else {
      skipped_domains.push({ domain: "food_events", reason: "invalid_or_empty" });
    }
  }

  if (domains.current_week?.present) {
    if (domains.current_week.importable) {
      next.current_week = asObject(domains.current_week.value);
      applied_domains.push("current_week");
      stats.current_week = 1;
    } else {
      skipped_domains.push({ domain: "current_week", reason: "invalid_or_empty" });
    }
  }

  if (domains.fitness_weeks?.present) {
    if (domains.fitness_weeks.importable) {
      next.fitness_weeks = asArray(domains.fitness_weeks.value);
      applied_domains.push("fitness_weeks");
      stats.fitness_weeks = next.fitness_weeks.length;
    } else {
      skipped_domains.push({ domain: "fitness_weeks", reason: "invalid_or_empty" });
    }
  }

  if (domains.profiles?.present) {
    if (domains.profiles.importable) {
      const safeProfiles = asObject(domains.profiles.value);
      const providedProfiles = asObject(domains.profiles.provided);
      if (providedProfiles.user_profile) next.user_profile = safeProfiles.user_profile ?? "";
      if (providedProfiles.training_profile) next.training_profile = safeProfiles.training_profile ?? "";
      if (providedProfiles.diet_profile) next.diet_profile = safeProfiles.diet_profile ?? "";
      if (providedProfiles.agent_profile) next.agent_profile = safeProfiles.agent_profile ?? "";
      applied_domains.push("profiles");
      stats.profiles = Object.values(providedProfiles).filter(Boolean).length;
    } else {
      skipped_domains.push({ domain: "profiles", reason: "invalid_or_empty" });
    }
  }

  if (domains.rules?.present) {
    if (domains.rules.importable) {
      const safeRules = asObject(domains.rules.value);
      if (Object.keys(asObject(safeRules.diet_philosophy)).length) next.diet_philosophy = asObject(safeRules.diet_philosophy);
      if (Object.keys(asObject(safeRules.fitness_philosophy)).length) {
        next.fitness_philosophy = asObject(safeRules.fitness_philosophy);
      }
      if (Object.keys(asObject(safeRules.assistant_rules)).length) next.assistant_rules = asObject(safeRules.assistant_rules);
      const existingMeta = asObject(next.metadata);
      next.metadata = {
        ...existingMeta,
        ...filterSafeMetadata(safeRules.metadata),
      };
      applied_domains.push("rules");
      stats.rules = 1;
    } else {
      skipped_domains.push({ domain: "rules", reason: "invalid_or_empty" });
    }
  }

  const metadata = asObject(next.metadata);
  const timestamp = normalizeText(nowIso) || new Date().toISOString();
  if (!normalizeText(metadata.settings_seeded_at)) metadata.settings_seeded_at = timestamp;
  metadata.settings_seed_version = Number.isInteger(metadata.settings_seed_version)
    ? metadata.settings_seed_version
    : 1;
  metadata.onboarding = {
    ...(asObject(metadata.onboarding)),
    stage: "complete",
    completed_at: normalizeText(asObject(metadata.onboarding).completed_at) || timestamp,
    last_active_at: timestamp,
  };
  metadata.updated_at = timestamp;
  metadata.last_updated = timestamp;
  next.metadata = metadata;

  delete next.transition_context;

  return {
    data: next,
    applied_domains,
    skipped_domains,
    warnings,
    stats,
  };
}
