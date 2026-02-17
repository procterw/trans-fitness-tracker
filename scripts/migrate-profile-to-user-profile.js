import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const profilePath = process.env.TRACKING_PROFILE_FILE
  ? path.resolve(process.env.TRACKING_PROFILE_FILE)
  : path.resolve(repoRoot, "tracking-profile.json");
const legacyTrackingPath = process.env.TRACKING_DATA_FILE ? path.resolve(process.env.TRACKING_DATA_FILE) : null;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeProfileText(value) {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n/g, "\n");
}

function normalizeProfileBlobs(value) {
  const safe = asObject(value);
  return {
    user_profile: normalizeProfileText(safe.user_profile),
    training_profile: normalizeProfileText(safe.training_profile),
    diet_profile: normalizeProfileText(safe.diet_profile),
    agent_profile: normalizeProfileText(safe.agent_profile),
  };
}

async function main() {
  const targets = Array.from(new Set([profilePath, legacyTrackingPath].filter(Boolean)));
  let migrated = 0;

  for (const filePath of targets) {
    let raw;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (err) {
      if (err?.code === "ENOENT") continue;
      throw err;
    }

    const parsed = asObject(JSON.parse(raw));
    const next = {
      ...parsed,
      ...normalizeProfileBlobs(parsed),
    };
    delete next.transition_context;

    await fs.writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    migrated += 1;
    // eslint-disable-next-line no-console
    console.log(`Migrated profile payload: ${filePath}`);
  }

  // eslint-disable-next-line no-console
  console.log(`Done. Migrated ${migrated} file(s).`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
