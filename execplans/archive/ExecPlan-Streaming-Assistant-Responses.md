# Add SSE streaming for assistant chat responses

This plan is now complete: users receive assistant text progressively while keeping existing non-stream JSON behavior for non-stream endpoints.

```md
## Purpose / Big Picture

Stream the assistant/chat response body so the interface updates while the model is generating output, reducing perceived latency during unified input flows. The non-streaming API contract should remain intact for legacy clients.

## Progress

- [x] Added streaming-aware response utility in `src/assistant.js` using `responses.create({ stream: true })`.
- [x] Added SSE support in `src/server.js` for `/api/assistant/ask` and `/api/assistant/ingest` when `stream` is enabled.
- [x] Added streaming client API in `client/src/api.js` to parse SSE events.
- [x] Updated `client/src/App.jsx` submit flow to render assistant deltas while streaming and finalize messages on completion.

## Decision Log

- Decision: Stream only when no photo attachments are included in the unified ingest request.
  Rationale: image-based food logging is usually short and can return structured JSON payloads; streaming is most valuable for text-only conversational paths.
  Date/Author: 2026-02-15, assistant.

## Outcomes & Retrospective

The feature now sends `data:` events over `text/event-stream` with chunk and done events.

- Streaming endpoint returns chunk events (`type: "chunk"`, `delta`) while generating.
- Streaming endpoints then return a final done payload (`type: "done"`) that matches the previous non-stream response contract.
- Non-stream pathways remain unchanged and continue returning JSON as before.
```
