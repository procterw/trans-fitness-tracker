import { getFitnessCategoryKeys, getFitnessCategoryLabel } from "./fitnessChecklist.js";

function cleanText(value, maxLen = 64) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return "";
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

function formatExamples(examples, limit = 3) {
  return examples
    .slice(0, limit)
    .map((entry) => cleanText(entry))
    .filter(Boolean)
    .join("; ");
}

export function generateWeeklyFitnessSummary(week) {
  const categoryKeys = getFitnessCategoryKeys(week);
  if (!categoryKeys.length) {
    return "No workout checklist items yet. Add activities to generate a weekly progress summary and plan.";
  }

  const progressParts = [];
  const completedExamples = [];
  const remainingExamples = [];
  const priority = [];
  let totalItems = 0;
  let completedItems = 0;

  for (const key of categoryKeys) {
    const list = Array.isArray(week?.[key]) ? week[key] : [];
    if (!list.length) continue;

    const label = getFitnessCategoryLabel(week, key);
    const done = list.filter((item) => item?.checked === true).length;
    const remaining = Math.max(0, list.length - done);

    totalItems += list.length;
    completedItems += done;
    progressParts.push(`${label} ${done}/${list.length}`);
    priority.push({ label, remaining });

    for (const item of list) {
      const itemLabel = cleanText(item?.item || "Activity");
      if (!itemLabel) continue;
      if (item?.checked === true) completedExamples.push(`${label}: ${itemLabel}`);
      else remainingExamples.push(`${label}: ${itemLabel}`);
    }
  }

  if (!totalItems) {
    return "No workout checklist items yet. Add activities to generate a weekly progress summary and plan.";
  }

  const pct = Math.round((completedItems / totalItems) * 100);
  const remainingCount = Math.max(0, totalItems - completedItems);
  const lines = [];
  lines.push(`Work done so far: ${completedItems}/${totalItems} activities complete (${pct}%).`);
  lines.push(`Category progress: ${progressParts.join("; ")}.`);

  if (completedExamples.length) {
    lines.push(`Completed highlights: ${formatExamples(completedExamples)}.`);
  } else {
    lines.push("Completed highlights: none yet.");
  }

  if (remainingCount === 0) {
    lines.push("Rest-of-week plan: checklist is complete. Keep any extra sessions easy/recovery-focused.");
    return lines.join("\n");
  }

  const priorityLabels = priority
    .filter((entry) => entry.remaining > 0)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 2)
    .map((entry) => entry.label);
  const priorityText = priorityLabels.length ? priorityLabels.join(" and ") : "remaining categories";
  const nextFocus = formatExamples(remainingExamples);

  lines.push(
    `Rest-of-week plan: prioritize ${priorityText} and spread the remaining ${remainingCount} item${remainingCount === 1 ? "" : "s"} across your remaining training days.`,
  );
  if (nextFocus) lines.push(`Next focus: ${nextFocus}.`);

  return lines.join("\n");
}
