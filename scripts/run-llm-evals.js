#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function setupIsolatedTrackingEnv(root) {
  process.env.TRACKING_BACKEND = "json";
  process.env.TRACKING_DEFAULT_USER_ID = "harness-user";
  process.env.TRACKING_FOOD_FILE = path.join(root, "tracking-food.json");
  process.env.TRACKING_ACTIVITY_FILE = path.join(root, "tracking-activity.json");
  process.env.TRACKING_PROFILE_FILE = path.join(root, "tracking-profile.json");
  process.env.TRACKING_RULES_FILE = path.join(root, "tracking-rules.json");
  delete process.env.TRACKING_DATA_FILE;
}

function parseArgs(argv) {
  const out = {
    casesPath: "docs/LLM_EVAL_CASES.json",
    minPassRate: 0.75,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cases" && argv[i + 1]) {
      out.casesPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--min-pass-rate" && argv[i + 1]) {
      out.minPassRate = Number(argv[i + 1]);
      i += 1;
      continue;
    }
  }
  if (!Number.isFinite(out.minPassRate) || out.minPassRate < 0 || out.minPassRate > 1) {
    throw new Error(`Invalid --min-pass-rate: ${out.minPassRate}`);
  }
  return out;
}

function mimeFromImagePath(imagePath) {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return null;
}

async function loadCases(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Cases file must be a JSON array.");
  return parsed;
}

async function loadImageForCase(caseDef) {
  const relativePath = typeof caseDef.image === "string" ? caseDef.image.trim() : "";
  if (!relativePath) return { imageBuffer: null, imageMimeType: null, skipped: false, skipReason: "" };
  const absolute = path.resolve(relativePath);
  try {
    const imageBuffer = await fs.readFile(absolute);
    const imageMimeType = mimeFromImagePath(absolute);
    if (!imageMimeType) {
      return { imageBuffer: null, imageMimeType: null, skipped: true, skipReason: `unknown image extension: ${relativePath}` };
    }
    return { imageBuffer, imageMimeType, skipped: false, skipReason: "" };
  } catch (err) {
    const optional = caseDef.optional === true;
    if (optional) {
      return { imageBuffer: null, imageMimeType: null, skipped: true, skipReason: `optional image missing: ${relativePath}` };
    }
    throw new Error(`Required image missing for case ${caseDef.id}: ${relativePath}`);
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for real-model evals.");
  }

  const args = parseArgs(process.argv.slice(2));
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tracker-llm-evals-"));
  setupIsolatedTrackingEnv(tmpRoot);

  const cases = await loadCases(path.resolve(args.casesPath));
  const { decideIngestAction } = await import("../src/assistant.js");

  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const caseDef of cases) {
    const id = String(caseDef.id || "").trim() || `case-${passed + failed + skipped + 1}`;
    const message = typeof caseDef.message === "string" ? caseDef.message : "";
    const expectedIntents = Array.isArray(caseDef.expected_intents)
      ? caseDef.expected_intents.filter((intent) => typeof intent === "string" && intent.trim())
      : [];
    if (!expectedIntents.length) throw new Error(`Case ${id} missing expected_intents`);

    const image = await loadImageForCase(caseDef);
    if (image.skipped) {
      skipped += 1;
      console.log(`SKIP ${id} (${image.skipReason})`);
      continue;
    }

    const result = await decideIngestAction({
      message,
      hasImage: Boolean(image.imageBuffer),
      imageBuffer: image.imageBuffer,
      imageMimeType: image.imageMimeType,
      date: typeof caseDef.date === "string" ? caseDef.date : null,
    });

    const ok = expectedIntents.includes(result.intent);
    if (ok) passed += 1;
    else failed += 1;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${id} expected=${expectedIntents.join("|")} got=${result.intent} confidence=${result.confidence}`,
    );
  }

  const executed = passed + failed;
  const passRate = executed > 0 ? passed / executed : 0;
  console.log(`\nLLM eval summary: passed=${passed} failed=${failed} skipped=${skipped} pass_rate=${passRate.toFixed(3)}`);
  if (executed === 0) throw new Error("No eval cases were executed.");
  if (passRate < args.minPassRate) {
    throw new Error(`Pass rate ${passRate.toFixed(3)} below threshold ${args.minPassRate}`);
  }
}

main().catch((err) => {
  console.error("LLM eval runner failed.");
  console.error(err.message || err);
  process.exit(1);
});
