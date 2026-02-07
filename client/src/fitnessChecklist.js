const RESERVED_WEEK_KEYS = new Set([
  "week_start",
  "week_label",
  "summary",
  "category_order",
  "category_labels",
  "checklist",
]);

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toCategoryLabel(key) {
  const token = typeof key === "string" ? key.trim() : "";
  if (!token) return "Category";

  return token
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getFitnessCategoryKeys(week) {
  const safeWeek = asObject(week);
  const preferred = Array.isArray(safeWeek.category_order) ? safeWeek.category_order : [];
  const discovered = Object.keys(safeWeek).filter((key) => !RESERVED_WEEK_KEYS.has(key) && Array.isArray(safeWeek[key]));

  const keys = [];
  const seen = new Set();

  const push = (value) => {
    if (typeof value !== "string") return;
    const key = value.trim();
    if (!key) return;
    if (seen.has(key)) return;
    if (!Array.isArray(safeWeek[key])) return;
    seen.add(key);
    keys.push(key);
  };

  for (const key of preferred) push(key);
  for (const key of discovered) push(key);

  return keys;
}

export function getFitnessCategories(week) {
  const safeWeek = asObject(week);
  const labels = asObject(safeWeek.category_labels);

  return getFitnessCategoryKeys(safeWeek).map((key) => ({
    key,
    label: typeof labels[key] === "string" && labels[key].trim() ? labels[key].trim() : toCategoryLabel(key),
    items: Array.isArray(safeWeek[key]) ? safeWeek[key] : [],
  }));
}
