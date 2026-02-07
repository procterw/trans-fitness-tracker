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

export function normalizeFitnessCategoryToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

export function toFitnessCategoryLabel(key) {
  const token = typeof key === "string" ? key.trim() : "";
  if (!token) return "Category";

  return token
    .split(/[_\-\s]+/)
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

export function getFitnessCategoryLabel(week, key) {
  const labels = asObject(asObject(week).category_labels);
  if (typeof labels[key] === "string" && labels[key].trim()) return labels[key].trim();
  return toFitnessCategoryLabel(key);
}

export function getFitnessCategories(week) {
  const safeWeek = asObject(week);
  const keys = getFitnessCategoryKeys(safeWeek);

  return keys.map((key) => ({
    key,
    label: getFitnessCategoryLabel(safeWeek, key),
    items: Array.isArray(safeWeek[key]) ? safeWeek[key] : [],
  }));
}

export function resolveFitnessCategoryKey(week, categoryInput) {
  const safeWeek = asObject(week);
  const keys = getFitnessCategoryKeys(safeWeek);
  if (!keys.length) return null;

  if (typeof categoryInput === "string") {
    const exact = categoryInput.trim();
    if (exact && keys.includes(exact)) return exact;
  }

  const target = normalizeFitnessCategoryToken(categoryInput);
  if (!target) return null;

  for (const key of keys) {
    if (normalizeFitnessCategoryToken(key) === target) return key;
    if (normalizeFitnessCategoryToken(getFitnessCategoryLabel(safeWeek, key)) === target) return key;
  }

  return null;
}

export function toFitnessChecklistStorage(week) {
  const safeWeek = asObject(week);
  const categoryOrder = getFitnessCategoryKeys(safeWeek);
  const checklist = {};

  for (const key of categoryOrder) {
    checklist[key] = Array.isArray(safeWeek[key]) ? safeWeek[key] : [];
  }

  return { checklist, categoryOrder };
}

export function fromFitnessChecklistStorage({ checklist, categoryOrder }) {
  const safeChecklist = asObject(checklist);
  const preferred = Array.isArray(categoryOrder) ? categoryOrder : [];
  const discovered = Object.keys(safeChecklist).filter((key) => Array.isArray(safeChecklist[key]));

  const keys = [];
  const seen = new Set();
  const push = (value) => {
    if (typeof value !== "string") return;
    const key = value.trim();
    if (!key) return;
    if (seen.has(key)) return;
    if (!Array.isArray(safeChecklist[key])) return;
    seen.add(key);
    keys.push(key);
  };

  for (const key of preferred) push(key);
  for (const key of discovered) push(key);

  const weekCategories = {};
  for (const key of keys) {
    weekCategories[key] = Array.isArray(safeChecklist[key]) ? safeChecklist[key] : [];
  }

  if (keys.length) weekCategories.category_order = keys;
  return weekCategories;
}
