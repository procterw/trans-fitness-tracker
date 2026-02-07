import { getAccessToken, isSupabaseEnabled } from "./supabaseClient.js";

async function withAuth(options = {}) {
  if (!isSupabaseEnabled()) return options;
  const token = await getAccessToken();
  if (!token) return options;
  const headers = new Headers(options.headers || {});
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return { ...options, headers };
}

export async function fetchJson(url, options) {
  const res = await fetch(url, await withAuth(options));
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

export async function logFoodPhoto({ file, date, notes = "", description = "" }) {
  const fd = new FormData();
  fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("description", description ?? "");
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

export async function logFood({ file = null, description = "", date = "", notes = "" }) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("description", description ?? "");
  fd.append("notes", notes ?? "");
  return fetchJson("/api/food/log", { method: "POST", body: fd });
}

export async function askAssistant({ question, date = "", messages = [] }) {
  const body = { question, messages };
  if (date) body.date = date;
  return fetchJson("/api/assistant/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function ingestAssistant({ message = "", file = null, date = "", messages = [] }) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("message", message ?? "");
  if (messages?.length) fd.append("messages", JSON.stringify(messages));
  return fetchJson("/api/assistant/ingest", { method: "POST", body: fd });
}

export async function settingsChat({ message = "", messages = [] }) {
  return fetchJson("/api/settings/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, messages }),
  });
}

export async function confirmSettingsChanges({ proposal, applyMode = "now" }) {
  return fetchJson("/api/settings/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proposal,
      apply_mode: applyMode === "next_week" ? "next_week" : "now",
    }),
  });
}

export async function getFoodForDate(date) {
  return fetchJson(`/api/food/events?date=${encodeURIComponent(date)}`);
}

export async function getFoodLog({ limit = 0, from = null, to = null } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchJson(`/api/food/log${qs ? `?${qs}` : ""}`);
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

export async function getFitnessHistory({ limit = 12 } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  const qs = params.toString();
  return fetchJson(`/api/fitness/history${qs ? `?${qs}` : ""}`);
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
