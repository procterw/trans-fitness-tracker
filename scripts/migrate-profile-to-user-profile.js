import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { deriveGoalsListsFromGoalsText, normalizeGoalsText } from "../src/goalsText.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const profilePath = process.env.TRACKING_PROFILE_FILE
  ? path.resolve(process.env.TRACKING_PROFILE_FILE)
  : path.resolve(repoRoot, "tracking-profile.json");
const legacyTrackingPath = process.env.TRACKING_DATA_FILE ? path.resolve(process.env.TRACKING_DATA_FILE) : null;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizeCycleHormonalContext(value) {
  const safe = asObject(value);
  return {
    relevant: safe.relevant === true,
    context_type: typeof safe.context_type === "string" ? safe.context_type : "",
    phase_or_cycle_day: typeof safe.phase_or_cycle_day === "string" ? safe.phase_or_cycle_day : null,
    symptom_patterns: asStringArray(safe.symptom_patterns),
    training_nutrition_adjustments: asStringArray(safe.training_nutrition_adjustments),
  };
}

function normalizeUserProfile(value, { fallbackTransitionContext = {} } = {}) {
  const safe = asObject(value);
  const safeModules = asObject(safe.modules);
  const transFromProfile = asObject(safeModules.trans_care);
  const fallbackTrans = asObject(fallbackTransitionContext);
  const transCare = Object.keys(transFromProfile).length ? transFromProfile : fallbackTrans;
  const legacyGoals = asObject(safe.goals);
  const goalsText = normalizeGoalsText(asObject(safe.goals_text), { legacyGoals });
  const derivedGoals = deriveGoalsListsFromGoalsText({ goalsText, legacyGoals });
  const metadata = asObject(safe.metadata);

  return {
    ...safe,
    schema_version: Number.isInteger(safe.schema_version) ? safe.schema_version : 1,
    general: asObject(safe.general),
    medical: {
      ...asObject(safe.medical),
      history: asStringArray(asObject(safe.medical).history),
      medications: asStringArray(asObject(safe.medical).medications),
      surgeries: asStringArray(asObject(safe.medical).surgeries),
      allergies: asStringArray(asObject(safe.medical).allergies),
      cycle_hormonal_context: normalizeCycleHormonalContext(asObject(asObject(safe.medical).cycle_hormonal_context)),
    },
    nutrition: {
      ...asObject(safe.nutrition),
      food_restrictions: asStringArray(asObject(safe.nutrition).food_restrictions),
      food_allergies: asStringArray(asObject(safe.nutrition).food_allergies),
      preferences: asStringArray(asObject(safe.nutrition).preferences),
      recipes_refs: asStringArray(asObject(safe.nutrition).recipes_refs),
    },
    fitness: {
      ...asObject(safe.fitness),
      experience_level: typeof asObject(safe.fitness).experience_level === "string" ? asObject(safe.fitness).experience_level : "",
      injuries_limitations: asStringArray(asObject(safe.fitness).injuries_limitations),
      equipment_access: asStringArray(asObject(safe.fitness).equipment_access),
    },
    goals_text: goalsText,
    goals: {
      ...legacyGoals,
      diet_goals: asStringArray(derivedGoals.diet_goals),
      fitness_goals: asStringArray(derivedGoals.fitness_goals),
      health_goals: asStringArray(derivedGoals.health_goals),
    },
    behavior: {
      ...asObject(safe.behavior),
      motivation_barriers: asStringArray(asObject(safe.behavior).motivation_barriers),
      adherence_triggers: asStringArray(asObject(safe.behavior).adherence_triggers),
    },
    modules: {
      ...safeModules,
      trans_care: transCare,
    },
    assistant_preferences: {
      ...asObject(safe.assistant_preferences),
      tone: typeof asObject(safe.assistant_preferences).tone === "string" ? asObject(safe.assistant_preferences).tone : "supportive",
      verbosity:
        typeof asObject(safe.assistant_preferences).verbosity === "string"
          ? asObject(safe.assistant_preferences).verbosity
          : "concise",
    },
    metadata: {
      ...metadata,
      updated_at: typeof metadata.updated_at === "string" ? metadata.updated_at : null,
      settings_version: Number.isInteger(metadata.settings_version)
        ? metadata.settings_version
        : 1,
      goals_text_updated_at: typeof metadata.goals_text_updated_at === "string" ? metadata.goals_text_updated_at : null,
      goals_derivation_version: Number.isInteger(metadata.goals_derivation_version)
        ? metadata.goals_derivation_version
        : 1,
    },
  };
}

async function main() {
  const targets = Array.from(new Set([profilePath, legacyTrackingPath].filter(Boolean)));
  let migrated = 0;

  for (const filePath of targets) {
    let raw;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }

    const parsed = asObject(JSON.parse(raw));
    const transitionContext = asObject(parsed.transition_context);
    const userProfile = normalizeUserProfile(parsed.user_profile, {
      fallbackTransitionContext: transitionContext,
    });

    const next = {
      ...parsed,
      user_profile: userProfile,
    };
    delete next.transition_context;

    await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    migrated += 1;
    // eslint-disable-next-line no-console
    console.log(`Migrated profile payload: ${filePath}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Done. Migrated ${migrated} file(s).`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
