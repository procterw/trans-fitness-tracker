export function isStreamingRequest(value) {
  if (value === true) return true;
  if (typeof value === "string") return value === "true" || value === "1";
  if (typeof value === "number") return value === 1;
  return false;
}

function writeSsePayload(res, payload) {
  // SSE messages are emitted as JSON payloads on `data:` lines.
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function sendStreamingAssistantDone(res, payload) {
  writeSsePayload(res, { type: "done", payload });
}

export function sendStreamingAssistantChunk(res, delta) {
  if (!delta) return;
  writeSsePayload(res, { type: "chunk", delta });
  res.flush?.();
}

export function sendStreamingAssistantError(res, error) {
  writeSsePayload(res, {
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

export function enableSseHeaders(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}
