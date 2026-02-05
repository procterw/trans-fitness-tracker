import "dotenv/config";

import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { estimateNutritionFromImage } from "./visionNutrition.js";
import {
  addFoodEvent,
  getDailyFoodEventTotals,
  getSuggestedLogDate,
  readTrackingData,
} from "./trackingData.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, "..", "public");
app.use(express.static(publicDir));

app.get("/api/context", async (_req, res) => {
  try {
    const data = await readTrackingData();
    res.json({
      ok: true,
      suggested_date: getSuggestedLogDate(),
      diet_philosophy: data.diet_philosophy ?? null,
      fitness_philosophy: data.fitness_philosophy ?? null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/photo", upload.single("image"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ ok: false, error: "Missing image file field: image" });
    if (!file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    const effectiveDate = date ?? getSuggestedLogDate();

    const estimate = await estimateNutritionFromImage({
      imageBuffer: file.buffer,
      imageMimeType: file.mimetype,
      userNotes: notes,
    });

    const event = await addFoodEvent({
      date: effectiveDate,
      source: "photo",
      description: estimate.meal_title,
      notes,
      nutrients: estimate.totals,
      model: estimate.model,
      confidence: estimate.confidence,
      raw_items: estimate.items,
    });

    const totalsForDay = await getDailyFoodEventTotals(effectiveDate);

    res.json({
      ok: true,
      date: effectiveDate,
      event,
      estimate,
      day_totals_from_events: totalsForDay,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Tracker listening on http://localhost:${port}`);
});
