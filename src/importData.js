const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHAPE_CURRENT_EXPORT = "current_export";
const SHAPE_CANONICAL = "canonical";
const SHAPE_UNSUPPORTED_FORMAT = "unsupported_format";
const SHAPE_UNKNOWN = "unknown";
const DAY_STATUS_VALUES = new Set(["green", "yellow", "red", "incomplete"]);

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

function normalizeOptionalText(value) {
  return asString(value).replace(/\r\n/g, "\n");
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

function normalizeDayStatus(value) {
  if (value === null || value === undefined) return "incomplete";
  const text = normalizeText(value).toLowerCase();
  return DAY_STATUS_VALUES.has(text) ? text : "incomplete";
}

function detectShape(raw) {
  const safe = asObject(raw);
  const exportData = asObject(asObject(safe.export).data);
  if (Object.keys(exportData).length) return SHAPE_CURRENT_EXPORT;

  const embeddedData = asObject(safe.data);
  if (Object.keys(embeddedData).length) return SHAPE_CURRENT_EXPORT;

  if (
    safe.profile ||
    safe.activity ||
    safe.food ||
    safe.rules ||
    safe.training ||
    safe.user_profile ||
    Array.isArray(safe.diet)
  ) {
    return SHAPE_CANONICAL;
  }

  if (
    safe.food_log ||
    safe.food_events ||
    safe.fitness_weeks ||
    safe.training_profile ||
    safe.diet_profile ||
    safe.agent_profile
  ) {
    return SHAPE_UNSUPPORTED_FORMAT;
  }

  return SHAPE_UNKNOWN;
}

function extractSource(raw, detectedShape) {
  const safe = asObject(raw);
  if (detectedShape === SHAPE_CURRENT_EXPORT) {
    const exportData = asObject(asObject(safe.export).data);
    if (Object.keys(exportData).length) return exportData;
    const embeddedData = asObject(safe.data);
    if (Object.keys(embeddedData).length) return embeddedData;
  }
  return safe;
}

function normalizeProfile(profile) {
  const safe = asObject(profile);
  return {
    general: normalizeOptionalText(safe.general),
    fitness: normalizeOptionalText(safe.fitness),
    diet: normalizeOptionalText(safe.diet),
    agent: normalizeOptionalText(safe.agent),
  };
}

function normalizeWorkoutDefinition(entry) {
  const safe = asObject(entry);
  const name = normalizeText(safe.name);
  if (!name) return null;
  return {
    name,
    description: normalizeOptionalText(safe.description),
    category: normalizeOptionalText(safe.category) || "General",
    optional: safe.optional === true,
  };
}

function normalizeBlock(entry) {
  const safe = asObject(entry);
  const blockId = normalizeText(safe.block_id || safe.id);
  if (!blockId) return null;

  const workouts = [];
  const seen = new Set();
  for (const row of asArray(safe.workouts)) {
    const normalized = normalizeWorkoutDefinition(row);
    if (!normalized) continue;
    const token = normalized.name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    workouts.push(normalized);
  }

  return {
    block_id: blockId,
    block_start: hasIsoDate(safe.block_start) ? safe.block_start : "",
    block_end: hasIsoDate(safe.block_end) ? safe.block_end : "",
    block_name: normalizeOptionalText(safe.block_name || safe.name),
    block_details: normalizeOptionalText(safe.block_details || safe.description),
    workouts,
  };
}

function normalizeWeekWorkout(entry) {
  const safe = asObject(entry);
  const name = normalizeText(safe.name);
  if (!name) return null;
  return {
    name,
    details: normalizeOptionalText(safe.details),
    completed: safe.completed === true || safe.checked === true,
  };
}

function normalizeWeek(entry) {
  const safe = asObject(entry);
  const weekStart = normalizeText(safe.week_start);
  if (!hasIsoDate(weekStart)) return null;

  const workouts = [];
  const seen = new Set();
  for (const row of asArray(safe.workouts)) {
    const normalized = normalizeWeekWorkout(row);
    if (!normalized) continue;
    const token = normalized.name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    workouts.push(normalized);
  }

  return {
    week_start: weekStart,
    week_end: hasIsoDate(safe.week_end) ? safe.week_end : "",
    block_id: normalizeOptionalText(safe.block_id),
    workouts,
    ai_summary: normalizeOptionalText(safe.ai_summary || safe.summary),
    context: normalizeOptionalText(safe.context),
  };
}

function normalizeDietDay(row) {
  const safe = asObject(row);
  const date = normalizeText(safe.date);
  if (!hasIsoDate(date)) return null;
  return {
    date,
    weight_lb: toNumberOrNull(safe.weight_lb),
    calories: toNumberOrNull(safe.calories),
    fat_g: toNumberOrNull(safe.fat_g),
    carbs_g: toNumberOrNull(safe.carbs_g),
    protein_g: toNumberOrNull(safe.protein_g),
    fiber_g: toNumberOrNull(safe.fiber_g),
    status: normalizeDayStatus(safe.status || safe.on_track),
    ai_summary: normalizeOptionalText(safe.ai_summary || safe.details),
  };
}

function canonicalizeByKey(rows, key) {
  const out = [];
  const seen = new Set();
  for (const row of asArray(rows)) {
    const value = asString(row?.[key]);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(row);
  }
  out.sort((a, b) => String(a?.[key] ?? "").localeCompare(String(b?.[key] ?? "")));
  return out;
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

function normalizeRulesDomain(source) {
  const rootRules = asObject(asObject(source).rules);
  const metadata = asObject(rootRules.metadata);
  const dietPhilosophy = asObject(rootRules.diet_philosophy);
  const fitnessPhilosophy = asObject(rootRules.fitness_philosophy);
  const assistantRules = asObject(rootRules.assistant_rules);

  const present =
    Object.keys(rootRules).length > 0 ||
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

  if (detectedShape === SHAPE_UNSUPPORTED_FORMAT) {
    warnings.push("Older import formats are no longer supported. Import a current canonical export instead.");
  }

  const profileRootSource = asObject(source.profile);
  const profileRoot = Object.keys(profileRootSource).length ? profileRootSource : asObject(source.user_profile);
  const profilePresent = Object.keys(profileRoot).length > 0;
  const profileValue = normalizeProfile(profileRoot);
  const profileFields = ["general", "fitness", "diet", "agent"].filter((field) => field in profileRoot);
  const profileImportable = profileFields.length > 0;

  const foodRoot = asObject(source.food);
  const foodDaysSource = foodRoot.days !== undefined ? foodRoot.days : source.diet;
  const foodDaysRaw = asArray(foodDaysSource);
  const foodDaysPresent = foodDaysSource !== undefined;
  const foodDays = canonicalizeByKey(foodDaysRaw.map((row) => normalizeDietDay(row)).filter(Boolean), "date");
  if (foodDaysPresent && !foodDays.length) warnings.push("diet (or food.days) was present but no valid day rows were found.");

  const activityRoot = asObject(source.activity);
  const trainingRoot = asObject(source.training);

  const blocksRaw = asArray(activityRoot.blocks !== undefined ? activityRoot.blocks : trainingRoot.blocks);
  const blocksPresent = activityRoot.blocks !== undefined || trainingRoot.blocks !== undefined;
  const blocks = canonicalizeByKey(blocksRaw.map((row) => normalizeBlock(row)).filter(Boolean), "block_id");
  if (blocksPresent && !blocks.length) warnings.push("training/activity blocks were present but no valid blocks were found.");

  const weeksRaw = asArray(activityRoot.weeks !== undefined ? activityRoot.weeks : trainingRoot.weeks);
  const weeksPresent = activityRoot.weeks !== undefined || trainingRoot.weeks !== undefined;
  const weeks = canonicalizeByKey(weeksRaw.map((row) => normalizeWeek(row)).filter(Boolean), "week_start");
  if (weeksPresent && !weeks.length) warnings.push("training/activity weeks were present but no valid weeks were found.");

  const rules = normalizeRulesDomain(source);

  const domains = {
    profile: {
      present: profilePresent,
      importable: profileImportable,
      value: profileValue,
      fields: profileFields,
      count: profileFields.length,
    },
    food_days: {
      present: foodDaysPresent,
      importable: foodDays.length > 0,
      value: foodDays,
      count: foodDays.length,
    },
    activity_blocks: {
      present: blocksPresent,
      importable: blocks.length > 0,
      value: blocks,
      count: blocks.length,
    },
    activity_weeks: {
      present: weeksPresent,
      importable: weeks.length > 0,
      value: weeks,
      count: weeks.length,
    },
    rules,
  };

  const summary = {
    profile: {
      present: domains.profile.present,
      importable: domains.profile.importable,
      count: domains.profile.count,
      fields: domains.profile.fields,
    },
    food_days: {
      present: domains.food_days.present,
      importable: domains.food_days.importable,
      count: domains.food_days.count,
    },
    activity_blocks: {
      present: domains.activity_blocks.present,
      importable: domains.activity_blocks.importable,
      count: domains.activity_blocks.count,
    },
    activity_weeks: {
      present: domains.activity_weeks.present,
      importable: domains.activity_weeks.importable,
      count: domains.activity_weeks.count,
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
      food_days: domains.food_days.count,
      activity_blocks: domains.activity_blocks.count,
      activity_weeks: domains.activity_weeks.count,
      profile_fields: domains.profile.count,
    },
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

  if (!next.profile || typeof next.profile !== "object" || Array.isArray(next.profile)) next.profile = {};
  if (!next.activity || typeof next.activity !== "object" || Array.isArray(next.activity)) next.activity = {};
  if (!next.food || typeof next.food !== "object" || Array.isArray(next.food)) next.food = {};
  if (!next.rules || typeof next.rules !== "object" || Array.isArray(next.rules)) next.rules = {};

  if (domains.profile?.present) {
    if (domains.profile.importable) {
      const safeProfile = normalizeProfile(domains.profile.value);
      const fields = asArray(domains.profile.fields);
      for (const field of fields) {
        if (field === "general" || field === "fitness" || field === "diet" || field === "agent") {
          next.profile[field] = safeProfile[field];
        }
      }
      applied_domains.push("profile");
      stats.profile = fields.length;
    } else {
      skipped_domains.push({ domain: "profile", reason: "invalid_or_empty" });
    }
  }

  if (domains.food_days?.present) {
    if (domains.food_days.importable) {
      next.food.days = asArray(domains.food_days.value);
      applied_domains.push("food_days");
      stats.food_days = next.food.days.length;
    } else {
      skipped_domains.push({ domain: "food_days", reason: "invalid_or_empty" });
    }
  }

  if (domains.activity_blocks?.present) {
    if (domains.activity_blocks.importable) {
      next.activity.blocks = asArray(domains.activity_blocks.value);
      applied_domains.push("activity_blocks");
      stats.activity_blocks = next.activity.blocks.length;
    } else {
      skipped_domains.push({ domain: "activity_blocks", reason: "invalid_or_empty" });
    }
  }

  if (domains.activity_weeks?.present) {
    if (domains.activity_weeks.importable) {
      next.activity.weeks = asArray(domains.activity_weeks.value);
      applied_domains.push("activity_weeks");
      stats.activity_weeks = next.activity.weeks.length;
    } else {
      skipped_domains.push({ domain: "activity_weeks", reason: "invalid_or_empty" });
    }
  }

  if (domains.rules?.present) {
    if (domains.rules.importable) {
      const safeRules = asObject(domains.rules.value);
      const existingRules = asObject(next.rules);
      next.rules = {
        ...existingRules,
        metadata: {
          ...asObject(existingRules.metadata),
          ...filterSafeMetadata(safeRules.metadata),
        },
      };
      if (Object.keys(asObject(safeRules.diet_philosophy)).length) next.rules.diet_philosophy = asObject(safeRules.diet_philosophy);
      if (Object.keys(asObject(safeRules.fitness_philosophy)).length) next.rules.fitness_philosophy = asObject(safeRules.fitness_philosophy);
      if (Object.keys(asObject(safeRules.assistant_rules)).length) next.rules.assistant_rules = asObject(safeRules.assistant_rules);
      applied_domains.push("rules");
      stats.rules = 1;
    } else {
      skipped_domains.push({ domain: "rules", reason: "invalid_or_empty" });
    }
  }

  const metadata = asObject(next.rules.metadata);
  const timestamp = normalizeText(nowIso) || new Date().toISOString();
  if (!normalizeText(metadata.settings_seeded_at)) metadata.settings_seeded_at = timestamp;
  metadata.settings_seed_version = Number.isInteger(metadata.settings_seed_version) ? metadata.settings_seed_version : 1;
  metadata.onboarding = {
    ...asObject(metadata.onboarding),
    stage: "complete",
    completed_at: normalizeText(asObject(metadata.onboarding).completed_at) || timestamp,
    last_active_at: timestamp,
  };
  metadata.updated_at = timestamp;
  metadata.last_updated = timestamp;
  next.rules.metadata = metadata;

  return {
    data: next,
    applied_domains,
    skipped_domains,
    warnings,
    stats,
  };
}
