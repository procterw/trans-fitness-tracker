#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function setupIsolatedTrackingEnv(root) {
  process.env.TRACKING_FOOD_FILE = path.join(root, "tracking-food.json");
  process.env.TRACKING_ACTIVITY_FILE = path.join(root, "tracking-activity.json");
  process.env.TRACKING_PROFILE_FILE = path.join(root, "tracking-profile.json");
  process.env.TRACKING_RULES_FILE = path.join(root, "tracking-rules.json");
  process.env.TRACKING_DATA_FILE = path.join(root, "tracking-data.json");
}

function makeMockClient({ intent = "activity" } = {}) {
  const calls = [];
  const client = {
    responses: {
      parse: async (payload) => {
        calls.push(payload);
        return {
          output_parsed: {
            intent,
            confidence: 0.9,
            question: null,
            clarifying_question: null,
            activity:
              intent === "activity"
                ? {
                    selections: [
                      {
                        category: "endurance",
                        index: 0,
                        label: "Run",
                        duration_min: 45,
                        intensity: "moderate",
                        notes: "from screenshot",
                      },
                    ],
                    followup_question: null,
                  }
                : null,
          },
        };
      },
    },
  };
  return { client, calls };
}

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tracker-mocked-ingest-harness-"));
  setupIsolatedTrackingEnv(tmpRoot);

  const { decideIngestAction } = await import("../src/assistant.js");
  const sampleImagePath = path.resolve("samples/avocado-toast.png");
  const imageBuffer = await fs.readFile(sampleImagePath);

  const imageCall = makeMockClient({ intent: "activity" });
  const imageResult = await decideIngestAction({
    message: "",
    hasImage: true,
    imageBuffer,
    imageMimeType: "image/png",
    clientOverride: imageCall.client,
  });
  assert.equal(imageResult.intent, "activity");
  assert.equal(imageCall.calls.length, 1);
  const imagePayload = imageCall.calls[0];
  const imageUserMessage = imagePayload.input.at(-1);
  assert.ok(Array.isArray(imageUserMessage.content), "expected multipart user content with image");
  const imagePart = imageUserMessage.content.find((part) => part?.type === "input_image");
  assert.ok(imagePart, "expected input_image in ingest classifier payload");
  assert.ok(String(imagePart.image_url || "").startsWith("data:image/png;base64,"), "expected data URL image payload");

  const contextMessage = imagePayload.input.find((entry) => entry?.role === "developer");
  assert.ok(contextMessage?.content?.includes('"has_image": true'), "expected has_image=true context");

  const textCall = makeMockClient({ intent: "clarify" });
  const textResult = await decideIngestAction({
    message: "worked out",
    hasImage: false,
    clientOverride: textCall.client,
  });
  assert.equal(textResult.intent, "clarify");
  assert.equal(textCall.calls.length, 1);
  const textUserMessage = textCall.calls[0].input.at(-1);
  assert.equal(typeof textUserMessage.content, "string");
  assert.equal(textUserMessage.content, "worked out");

  const missingImageCall = makeMockClient({ intent: "clarify" });
  await decideIngestAction({
    message: "",
    hasImage: true,
    imageBuffer: null,
    imageMimeType: null,
    clientOverride: missingImageCall.client,
  });
  const missingImageUserMessage = missingImageCall.calls[0].input.at(-1);
  assert.equal(missingImageUserMessage.content, "[Image attached]");

  console.log("Mocked ingest harness passed:");
  console.log("- image inputs are sent as model-readable input_image content");
  console.log("- text-only inputs stay text-only");
  console.log("- fallback behavior for missing image bytes is stable");
}

main().catch((err) => {
  console.error("Mocked ingest harness failed.");
  console.error(err);
  process.exit(1);
});
