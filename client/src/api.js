import { getAccessToken, isSupabaseEnabled } from "./supabaseClient.js";

async function withAuth(options = {}) {
  if (!isSupabaseEnabled()) return options;
  const token = await getAccessToken();
  if (!token) return options;
  const headers = new Headers(options.headers || {});
  if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
  return { ...options, headers };
}

async function* parseSsePayloads(response) {
  if (!response.body) throw new Error("Streaming response is missing a body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    const text = decoder.decode(value || new Uint8Array(), { stream: !done });
    buffer += text;

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) break;

      const rawEvent = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent) continue;

      const lines = rawEvent.split("\n").map((line) => line.trim());
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n")
        .trim();

      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Ignore malformed SSE payload lines.
      }
    }

    if (done) break;
  }

  const trailing = buffer.trim();
  if (trailing) {
    const lines = trailing.split("\n").map((line) => line.trim());
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n")
      .trim();
    if (data && data !== "[DONE]") {
      try {
        yield JSON.parse(data);
      } catch {
        // Ignore malformed SSE payload lines.
      }
    }
  }
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

export async function exportUserData() {
  return fetchJson("/api/user/export");
}

export async function analyzeUserImport({ file = null, rawText = "" } = {}) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  if (typeof rawText === "string" && rawText.trim()) fd.append("raw_text", rawText);
  return fetchJson("/api/user/import/analyze", { method: "POST", body: fd });
}

export async function confirmUserImport({ importToken, confirmText }) {
  return fetchJson("/api/user/import/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      import_token: importToken,
      confirm_text: confirmText,
    }),
  });
}

export async function logFoodPhoto({
  file,
  date,
  notes = "",
  description = "",
  eventId = "",
  clientRequestId = "",
}) {
  const fd = new FormData();
  fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("description", description ?? "");
  fd.append("notes", notes ?? "");
  if (eventId) fd.append("event_id", eventId);
  if (clientRequestId) fd.append("client_request_id", clientRequestId);
  return fetchJson("/api/food/photo", { method: "POST", body: fd });
}

export async function logFoodManual({ description, date, notes, eventId = "", clientRequestId = "" }) {
  const body = { description, notes: notes ?? "" };
  if (date) body.date = date;
  if (eventId) body.event_id = eventId;
  if (clientRequestId) body.client_request_id = clientRequestId;
  return fetchJson("/api/food/manual", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function logFood({
  file = null,
  description = "",
  date = "",
  notes = "",
  eventId = "",
  clientRequestId = "",
}) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("description", description ?? "");
  fd.append("notes", notes ?? "");
  if (eventId) fd.append("event_id", eventId);
  if (clientRequestId) fd.append("client_request_id", clientRequestId);
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

export async function* askAssistantStream({
  question,
  date = "",
  messages = [],
}) {
  const body = { question, messages, stream: true };
  if (date) body.date = date;

  const res = await fetch(
    "/api/assistant/ask",
    await withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Request failed (${res.status})`);
  }

  for await (const event of parseSsePayloads(res)) {
    yield event;
  }
}

export async function ingestAssistant({
  message = "",
  file = null,
  date = "",
  messages = [],
  eventId = "",
  clientRequestId = "",
}) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("message", message ?? "");
  if (eventId) fd.append("event_id", eventId);
  if (clientRequestId) fd.append("client_request_id", clientRequestId);
  if (messages?.length) fd.append("messages", JSON.stringify(messages));
  return fetchJson("/api/assistant/ingest", { method: "POST", body: fd });
}

export async function* ingestAssistantStream({
  message = "",
  file = null,
  date = "",
  messages = [],
  eventId = "",
  clientRequestId = "",
}) {
  const fd = new FormData();
  if (file) fd.append("image", file);
  if (date) fd.append("date", date);
  fd.append("message", message ?? "");
  fd.append("stream", "true");
  if (eventId) fd.append("event_id", eventId);
  if (clientRequestId) fd.append("client_request_id", clientRequestId);
  if (messages?.length) fd.append("messages", JSON.stringify(messages));

  const res = await fetch("/api/assistant/ingest", await withAuth({ method: "POST", body: fd }));
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Request failed (${res.status})`);
  }

  for await (const event of parseSsePayloads(res)) {
    yield event;
  }
}

export async function* settingsChatStream({ message = "", messages = [] }) {
  const body = { message, messages, stream: true };

  const res = await fetch(
    "/api/settings/chat",
    await withAuth({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Request failed (${res.status})`);
  }

  for await (const event of parseSsePayloads(res)) {
    yield event;
  }
}

export async function settingsChat({ message = "", messages = [] }) {
  return fetchJson("/api/settings/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, messages }),
  });
}

export async function settingsBootstrap({ clientTimezone = "" } = {}) {
  return fetchJson("/api/settings/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_timezone: clientTimezone || "" }),
  });
}

export async function getSettingsState() {
  return fetchJson("/api/settings/state");
}

export async function saveSettingsProfiles({
  general = "",
  fitness = "",
  diet = "",
  agent = "",
}) {
  return fetchJson("/api/settings/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      general,
      fitness,
      diet,
      agent,
    }),
  });
}

export async function confirmSettingsChanges({ proposal }) {
  return fetchJson("/api/settings/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      proposal,
    }),
  });
}

export async function getFoodForDate(date) {
  return fetchJson(`/api/food/day?date=${encodeURIComponent(date)}`);
}

export async function getFoodLog({ limit = 0, from = null, to = null } = {}) {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return fetchJson(`/api/food/log${qs ? `?${qs}` : ""}`);
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

export async function updateFitnessItem({ workoutIndex, checked, details }) {
  return fetchJson("/api/fitness/current/item", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workout_index: workoutIndex, checked, details }),
  });
}

export async function updateFitnessSummary(summary) {
  return fetchJson("/api/fitness/current/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ summary }),
  });
}
