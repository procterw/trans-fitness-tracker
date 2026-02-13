function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asStringArray(value) {
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

export function normalizeGoalTextValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseGoalsTextToList(value) {
  const text = normalizeGoalTextValue(value);
  if (!text) return [];
  const chunks = text
    .split(/\n|;|•/g)
    .map((part) => part.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);
  return asStringArray(chunks);
}

function toTextBlock(items) {
  const list = asStringArray(items);
  if (!list.length) return "";
  return list.join("\n");
}

export function buildGoalsTextFromLegacyGoals(legacyGoals) {
  const legacy = asObject(legacyGoals);
  const diet = asStringArray(legacy.diet_goals);
  const fitness = asStringArray(legacy.fitness_goals);
  const health = asStringArray(legacy.health_goals);
  const overallParts = [...health];
  if (diet.length) overallParts.push(`Diet focus: ${diet.slice(0, 3).join("; ")}`);
  if (fitness.length) overallParts.push(`Fitness focus: ${fitness.slice(0, 3).join("; ")}`);
  return {
    overall_goals: toTextBlock(overallParts),
    fitness_goals: toTextBlock(fitness),
    diet_goals: toTextBlock(diet),
  };
}

export function deriveGoalsListsFromGoalsText({ goalsText, legacyGoals = null }) {
  const text = asObject(goalsText);
  const legacy = asObject(legacyGoals);
  const legacyDiet = asStringArray(legacy.diet_goals);
  const legacyFitness = asStringArray(legacy.fitness_goals);
  const legacyHealth = asStringArray(legacy.health_goals);

  const dietGoals = parseGoalsTextToList(text.diet_goals);
  const fitnessGoals = parseGoalsTextToList(text.fitness_goals);
  const overallGoals = parseGoalsTextToList(text.overall_goals);

  return {
    diet_goals: dietGoals.length ? dietGoals : legacyDiet,
    fitness_goals: fitnessGoals.length ? fitnessGoals : legacyFitness,
    health_goals: overallGoals.length ? overallGoals : legacyHealth,
  };
}

export function normalizeGoalsText(value, { legacyGoals = null } = {}) {
  const safe = asObject(value);
  const fallback = buildGoalsTextFromLegacyGoals(legacyGoals);
  return {
    overall_goals: normalizeGoalTextValue(safe.overall_goals) || fallback.overall_goals || "",
    fitness_goals: normalizeGoalTextValue(safe.fitness_goals) || fallback.fitness_goals || "",
    diet_goals: normalizeGoalTextValue(safe.diet_goals) || fallback.diet_goals || "",
  };
}
