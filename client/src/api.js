export async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.ok) {
    const msg = json?.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json;
}

export async function getContext() {
  return fetchJson("/api/context");
}

export async function logFoodPhoto({ file, date, notes }) {
  const fd = new FormData();
  fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("notes", notes ?? "");
  return fetchJson("/api/food/photo", { method: "POST", body: fd });
}

export async function logFoodManual({ description, date, notes }) {
  const body = { description, notes: notes ?? "" };
  if (date) body.date = date;
  return fetchJson("/api/food/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function getFoodForDate(date) {
  return fetchJson(`/api/food/events?date=${encodeURIComponent(date)}`);
}

export async function rollupFoodForDate({ date, overwrite = false }) {
  return fetchJson("/api/food/rollup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, overwrite }),
  });
}

export async function syncFoodForDate({ date, onlyUnsynced = true }) {
  return fetchJson("/api/food/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, only_unsynced: onlyUnsynced }),
  });
}

export async function getFitnessCurrent() {
  return fetchJson("/api/fitness/current");
}

export async function updateFitnessItem({ category, index, checked, details }) {
  return fetchJson("/api/fitness/current/item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ category, index, checked, details }),
  });
}

export async function updateFitnessSummary(summary) {
  return fetchJson("/api/fitness/current/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });
}
