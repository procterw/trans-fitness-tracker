function normalizeText(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalizeFoodEntry(entry) {
  if (typeof entry === "string") {
    return normalizeText(entry);
  }

  if (!entry || typeof entry !== "object") {
    return "";
  }

  const safe = entry;
  const name = normalizeText(safe.name || safe.label || safe.item || safe.food || safe.text || safe.title || safe.entry);
  if (!name) return "";

  const portion = normalizeText(safe.portion || safe.amount || safe.qty || safe.quantity);
  return portion ? `${name} (${portion})` : name;
}

function parseLegacyFoodSummary(summaryText) {
  const normalized = normalizeText(summaryText);
  if (!normalized) return [];
  const stripped = normalized.replace(/^foods and meals:\s*/i, "");
  if (!stripped) return [];

  return stripped
    .split(/[;\n]/)
    .map((value) => normalizeText(value).replace(/\.$/, ""))
    .filter(Boolean);
}

function normalizeFoodEntries(value, fallbackSummary = "") {
  const parsed = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [{ text: value }]
      : [];

  const normalized = parsed
    .map((entry) => normalizeFoodEntry(entry))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);

  if (normalized.length) return normalized;
  return parseLegacyFoodSummary(fallbackSummary);
}

export function getFoodEntriesFromDay(day, { fallbackSummary = "" } = {}) {
  if (!day || typeof day !== "object") {
    return normalizeFoodEntries([], fallbackSummary);
  }

  return normalizeFoodEntries(
    day.food_entries,
    fallbackSummary || normalizeText(day.ai_summary) || normalizeText(day.details),
  );
}

export function formatFoodEntries(entries) {
  const normalized = Array.isArray(entries) ? entries : [];
  if (!normalized.length) return "";
  return normalized.join("; ");
}

function numberOrNull(value) {
  const num = typeof value === "number" && Number.isFinite(value) ? value : null;
  return num;
}

function formatSentence(parts) {
  return parts.filter(Boolean).join(" ");
}

function buildEnergySummary(calories, fat, carbs, protein, fiber) {
  if ([calories, fat, carbs, protein, fiber].every((value) => value === null)) {
    return "No nutrition totals yet.";
  }

  if (calories !== null && calories < 2000) {
    return "Just below target so far; higher activity days may need one more meal for energy sufficiency.";
  }

  if (calories !== null && calories < 2900) {
    return "Solid surplus with clear calorie sufficiency for activity and steady progress.";
  }

  if (calories !== null) {
    return "Large surplus day with high energy availability.";
  }

  return "Energy availability is incomplete from the current payload.";
}

export function buildFoodDaySummary({ totals = null, foodEntries = null, summaryText = "" }) {
  const calorieValue = numberOrNull(totals?.calories);
  const fat = numberOrNull(totals?.fat_g);
  const carbs = numberOrNull(totals?.carbs_g);
  const protein = numberOrNull(totals?.protein_g);
  const fiber = numberOrNull(totals?.fiber_g);

  const normalizedEntries = Array.isArray(foodEntries) && foodEntries.length
    ? foodEntries
    : getFoodEntriesFromDay(totals, { fallbackSummary: summaryText });

  const energySentence = buildEnergySummary(calorieValue, fat, carbs, protein, fiber);

  let macroSentence = "Mixed carb/fat intake pattern across the day.";
  if (carbs !== null && fat !== null) {
    if (carbs >= 220 && carbs >= fat * 1.4) {
      macroSentence = "Carb-forward fueling pattern, consistent with endurance-oriented activity support.";
    } else if (fat >= 95 && fat >= carbs * 0.7) {
      macroSentence = "Fat-forward, calorie-dense intake pattern.";
    }
  }

  let proteinSentence = "Protein total is incomplete.";
  if (protein !== null && protein <= 95) {
    proteinSentence = `Protein at ${Math.round(protein)}g stayed moderate and generally aligned with slow atrophy goals.`;
  } else if (protein !== null && protein <= 120) {
    proteinSentence = `Protein at ${Math.round(protein)}g was slightly elevated but diffuse and fat-paired, still broadly compatible with goals.`;
  } else if (protein !== null) {
    proteinSentence = `Protein at ${Math.round(protein)}g was elevated, but spread across meals and fat-paired, which softens muscle-retention signaling.`;
  }

  const fiberSentence = fiber !== null && fiber < 15 ? "Fiber ran low relative to intake quality." : "";

  const notes = formatSentence([energySentence, macroSentence, proteinSentence, fiberSentence]);
  if (!notes || !normalizedEntries.length) {
    return notes || "No foods logged yet.";
  }

  return notes;
}

