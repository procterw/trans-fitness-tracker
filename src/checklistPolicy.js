const CHECKLIST_DISALLOWED_PATTERN =
  /\b(food|foods|meal|meals|eat|eating|eats|diet|diets|nutrition|nutritional|calorie|calories|macro|macros)\b/i;

function normalizeItemToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function containsDisallowedChecklistLanguage(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;
  return CHECKLIST_DISALLOWED_PATTERN.test(text);
}

export function normalizeChecklistCategories(value) {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((entry) => {
      const key = typeof entry?.key === "string" ? entry.key.trim() : "";
      if (!key || containsDisallowedChecklistLanguage(key)) return null;

      const labelRaw = typeof entry?.label === "string" ? entry.label.trim() : "";
      if (labelRaw && containsDisallowedChecklistLanguage(labelRaw)) return null;

      const seen = new Set();
      const items = Array.isArray(entry?.items)
        ? entry.items
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
            .filter((item) => !containsDisallowedChecklistLanguage(item))
            .filter((item) => {
              const token = normalizeItemToken(item);
              if (!token || seen.has(token)) return false;
              seen.add(token);
              return true;
            })
        : [];
      if (!items.length) return null;

      return {
        key,
        label: labelRaw || null,
        items,
      };
    })
    .filter(Boolean);

  return cleaned.length ? cleaned : null;
}

export function formatChecklistCategoriesMarkdown(
  checklistTemplate,
  { heading = "Here is your current workout checklist structure:" } = {},
) {
  const categories = Array.isArray(checklistTemplate) ? checklistTemplate : [];
  if (!categories.length) return "I don't have a checklist template yet.";

  const lines = [heading];
  for (const category of categories) {
    const label = typeof category?.label === "string" && category.label.trim() ? category.label.trim() : category?.key || "Category";
    lines.push(`- **${label}**`);
    const items = Array.isArray(category?.items) ? category.items : [];
    if (!items.length) {
      lines.push("  - [ ] (no items)");
      continue;
    }
    for (const item of items) {
      const itemText = typeof item === "string" ? item.trim() : "";
      if (!itemText) continue;
      lines.push(`  - [ ] ${itemText}`);
    }
  }
  return lines.join("\n");
}
