const CHECKLIST_DISALLOWED_PATTERN =
  /\b(food|foods|meal|meals|eat|eating|eats|diet|diets|nutrition|nutritional|calorie|calories|macro|macros)\b/i;
const CHECKLIST_AGGREGATE_SESSIONS_PATTERN =
  /^(?:complete|do|aim for|hit|get in|perform|schedule)?\s*(\d+)\s+(.+?)\s+sessions?(?:\s+this\s+week)?(?:\s*\(.*\))?[.!]*$/i;
const CHECKLIST_PROGRAMMING_VERB_PATTERN = /^(?:include|add|progress)\b/i;
const CHECKLIST_PROGRAMMING_CONTENT_PATTERN =
  /\b(working sets?|sets?\b|reps?\b|load increase|progress one variable|accessory movements?|pattern each session)\b/i;

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

function splitChecklistItemLine(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { name: "", description: "" };

  const parts = text.split(/\s+-\s+/);
  if (parts.length < 2) return { name: text, description: "" };

  const name = parts.shift()?.trim() ?? "";
  const description = parts.join(" - ").trim();
  return {
    name,
    description: name && description ? description : "",
  };
}

function containsDisallowedChecklistItemPattern(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;
  if (CHECKLIST_PROGRAMMING_CONTENT_PATTERN.test(text)) return true;
  if (CHECKLIST_PROGRAMMING_VERB_PATTERN.test(text) && /\b(session|sessions|set|sets|rep|reps|pattern|movement)\b/i.test(text)) {
    return true;
  }
  return false;
}

function sentenceCase(value) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function expandAggregateSessionItem(item) {
  const text = typeof item === "string" ? item.trim() : "";
  if (!text) return [];

  const match = text.match(CHECKLIST_AGGREGATE_SESSIONS_PATTERN);
  if (!match) return [text];

  const count = Number.parseInt(match[1], 10);
  if (!Number.isFinite(count) || count < 2 || count > 14) return [text];

  let focus = match[2].replace(/\b(per week|weekly)\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!focus) return [text];

  focus = focus.replace(/\bsessions?\b$/i, "").trim();
  if (!focus) return [text];

  const labelRoot = sentenceCase(`${focus} session`);
  return Array.from({ length: count }, (_, idx) => `${labelRoot} ${idx + 1}`);
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
      const rawItems = Array.isArray(entry?.items)
        ? entry.items.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean)
        : [];

      const expandedItems = rawItems.flatMap((item) => expandAggregateSessionItem(item));
      const items = expandedItems
        .map((item) => {
          const parsed = splitChecklistItemLine(item);
          if (!parsed.name) return "";
          return parsed.description ? `${parsed.name} - ${parsed.description}` : parsed.name;
        })
        .filter((item) => !containsDisallowedChecklistLanguage(item))
        .filter((item) => !containsDisallowedChecklistItemPattern(item))
        .filter((item) => {
          const parsed = splitChecklistItemLine(item);
          const token = normalizeItemToken(parsed.name);
          if (!token || seen.has(token)) return false;
          seen.add(token);
          return true;
        });
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
      const itemText =
        typeof item === "string"
          ? item.trim()
          : typeof item?.item === "string"
            ? `${item.item.trim()}${
                typeof item?.description === "string" && item.description.trim() ? ` - ${item.description.trim()}` : ""
              }`
            : "";
      if (!itemText) continue;
      lines.push(`  - [ ] ${itemText}`);
    }
  }
  return lines.join("\n");
}
