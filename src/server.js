import "dotenv/config";

import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { askAssistant, decideIngestAction } from "./assistant.js";
import { createSupabaseAuth } from "./auth/supabaseAuth.js";
import { estimateNutritionFromImage, estimateNutritionFromText } from "./visionNutrition.js";
import {
  addFoodEvent,
  ensureCurrentWeek,
  getFoodEventsForDate,
  getFoodLogForDate,
  getDailyFoodEventTotals,
  getSuggestedLogDate,
  listFitnessWeeks,
  listFoodLog,
  readTrackingData,
  rollupFoodLogFromEvents,
  syncFoodEventsToFoodLog,
  updateCurrentWeekItems,
  updateCurrentWeekItem,
  updateCurrentWeekSummary,
} from "./trackingData.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const authRequired = String(process.env.SUPABASE_AUTH_REQUIRED || "").toLowerCase() === "true";
const supabaseAuth = createSupabaseAuth({
  supabaseUrl: process.env.SUPABASE_URL || "",
  required: authRequired,
});
app.use("/api", supabaseAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..", "client");
const distDir = path.resolve(__dirname, "..", "dist");

async function logFoodFromInputs({ file, descriptionText, notes, date }) {
  const trimmedDescription = typeof descriptionText === "string" ? descriptionText.trim() : "";
  const trimmedNotes = typeof notes === "string" ? notes.trim() : "";

  if (!file && !trimmedDescription) {
    throw new Error("Provide either an image or a meal description.");
  }

  const effectiveDate = date ?? getSuggestedLogDate();

  const userNotesForModel = [trimmedDescription, trimmedNotes].filter(Boolean).join("\n");

  const source = file ? "photo" : "manual";
  const estimate = file
    ? await estimateNutritionFromImage({
        imageBuffer: file.buffer,
        imageMimeType: file.mimetype,
        userNotes: userNotesForModel,
      })
    : await estimateNutritionFromText({
        mealText: trimmedDescription,
        userNotes: trimmedNotes,
      });

  const { event, food_log } = await addFoodEvent({
    date: effectiveDate,
    source,
    description: estimate.meal_title,
    input_text: trimmedDescription || null,
    notes: trimmedNotes,
    nutrients: estimate.totals,
    model: estimate.model,
    confidence: estimate.confidence,
    raw_items: estimate.items,
  });

  const totalsForDay = await getDailyFoodEventTotals(effectiveDate);

  return {
    ok: true,
    date: effectiveDate,
    event,
    estimate,
    day_totals_from_events: totalsForDay,
    food_log,
  };
}

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function formatActivityDetails(selection) {
  const parts = [];
  if (typeof selection?.duration_min === "number" && Number.isFinite(selection.duration_min)) {
    parts.push(`${Math.round(selection.duration_min)} min`);
  }
  if (selection?.intensity) parts.push(selection.intensity);
  if (typeof selection?.notes === "string" && selection.notes.trim()) {
    parts.push(selection.notes.trim());
  }
  return parts.join(" • ") || "Logged";
}

function resolveActivitySelections(selections, currentWeek) {
  const resolved = [];
  const errors = [];
  const dedupe = new Map();

  if (!Array.isArray(selections) || selections.length === 0) {
    return { resolved, errors: ["No activity selections."] };
  }

  for (const sel of selections) {
    const category = sel?.category;
    const list = Array.isArray(currentWeek?.[category]) ? currentWeek[category] : [];
    if (!list.length) {
      errors.push(`No items found for category: ${category}`);
      continue;
    }

    let index = Number.isInteger(sel?.index) ? sel.index : -1;
    if (!list[index]) {
      const target = normalizeLabel(sel?.label);
      if (target) {
        const foundIndex = list.findIndex((it) => normalizeLabel(it?.item) === target);
        if (foundIndex >= 0) index = foundIndex;
      }
    }

    if (!list[index]) {
      errors.push(`Could not map activity to category ${category}.`);
      continue;
    }

    const label = typeof list[index]?.item === "string" ? list[index].item : sel?.label || "Activity";
    const details = formatActivityDetails(sel);
    const key = `${category}:${index}`;
    dedupe.set(key, { category, index, label, details });
  }

  for (const value of dedupe.values()) resolved.push(value);
  return { resolved, errors };
}

function summarizeFoodResult(payload) {
  const title = payload?.estimate?.meal_title ?? "Meal logged";
  const totals = payload?.estimate?.totals ?? {};
  const calories = typeof totals.calories === "number" ? `${Math.round(totals.calories)} kcal` : null;
  const protein = typeof totals.protein_g === "number" ? `${totals.protein_g} g protein` : null;
  const parts = [calories, protein].filter(Boolean);
  return parts.length ? `Logged meal: ${title}. ${parts.join(" • ")}.` : `Logged meal: ${title}.`;
}

function summarizeActivityUpdates(updates) {
  if (!updates.length) return "Logged activity.";
  const parts = updates.map((u) => (u.details ? `${u.label} (${u.details})` : u.label));
  return `Logged activity: ${parts.join("; ")}.`;
}

app.get("/api/context", async (_req, res) => {
  try {
    await ensureCurrentWeek();
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

app.post("/api/assistant/ask", async (req, res) => {
  try {
    const question = typeof req.body?.question === "string" && req.body.question.trim() ? req.body.question.trim() : null;
    if (!question) return res.status(400).json({ ok: false, error: "Missing field: question" });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];

    const answer = await askAssistant({ question, date, messages });
    res.json({ ok: true, answer });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/assistant/ingest", upload.single("image"), async (req, res) => {
  try {
    const file = req.file ?? null;
    if (file && !file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    if (!message && !file) return res.status(400).json({ ok: false, error: "Provide a message or an image." });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    let messages = [];
    if (typeof req.body?.messages === "string" && req.body.messages.trim()) {
      try {
        const parsed = JSON.parse(req.body.messages);
        if (Array.isArray(parsed)) messages = parsed;
      } catch {
        messages = [];
      }
    }

    const decision = await decideIngestAction({ message, hasImage: Boolean(file), date, messages });
    const confidence = typeof decision?.confidence === "number" ? decision.confidence : 0;
    const intent = decision?.intent ?? "clarify";

    if (confidence < 0.55 && intent !== "clarify") {
      return res.json({
        ok: true,
        action: "clarify",
        assistant_message:
          decision?.clarifying_question ??
          "Do you want to log food, log an activity, or ask a question?",
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer: null,
      });
    }

    if (intent === "question") {
      const questionText = decision?.question?.trim() || message;
      const answer = await askAssistant({ question: questionText, date, messages });
      return res.json({
        ok: true,
        action: "question",
        assistant_message: answer,
        followup_question: null,
        food_result: null,
        activity_updates: null,
        answer,
      });
    }

    if (intent === "food") {
      const payload = await logFoodFromInputs({ file, descriptionText: message, notes: "", date });
      return res.json({
        ok: true,
        action: "food",
        assistant_message: summarizeFoodResult(payload),
        followup_question: null,
        food_result: payload,
        activity_updates: null,
        answer: null,
        date: payload?.date ?? null,
      });
    }

    if (intent === "activity") {
      const currentWeek = await ensureCurrentWeek();
      const { resolved, errors } = resolveActivitySelections(decision?.activity?.selections, currentWeek);
      if (!resolved.length || errors.length) {
        return res.json({
          ok: true,
          action: "clarify",
          assistant_message:
            decision?.activity?.followup_question ??
            decision?.clarifying_question ??
            "Which checklist item should I log this under?",
          followup_question: null,
          food_result: null,
          activity_updates: null,
          answer: null,
        });
      }

      const updates = resolved.map((u) => ({
        category: u.category,
        index: u.index,
        checked: true,
        details: u.details,
      }));

      await updateCurrentWeekItems(updates);

      return res.json({
        ok: true,
        action: "activity",
        assistant_message: summarizeActivityUpdates(resolved),
        followup_question: decision?.activity?.followup_question ?? null,
        food_result: null,
        activity_updates: resolved,
        answer: null,
      });
    }

    return res.json({
      ok: true,
      action: "clarify",
      assistant_message:
        decision?.clarifying_question ?? "Do you want to log food, log an activity, or ask a question?",
      followup_question: null,
      food_result: null,
      activity_updates: null,
      answer: null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/food/events", async (req, res) => {
  try {
    const date = typeof req.query?.date === "string" && req.query.date.trim() ? req.query.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing query param: date" });
    const events = await getFoodEventsForDate(date);
    const totalsForDay = await getDailyFoodEventTotals(date);
    const logRow = await getFoodLogForDate(date);
    res.json({ ok: true, date, events, day_totals_from_events: totalsForDay, food_log: logRow });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/food/log", async (req, res) => {
  try {
    const limitRaw = typeof req.query?.limit === "string" ? req.query.limit.trim() : null;
    const from = typeof req.query?.from === "string" && req.query.from.trim() ? req.query.from.trim() : null;
    const to = typeof req.query?.to === "string" && req.query.to.trim() ? req.query.to.trim() : null;
    const limit = limitRaw ? Number(limitRaw) : 0;
    const rows = await listFoodLog({ limit, from, to });
    res.json({ ok: true, rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/rollup", async (req, res) => {
  try {
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing field: date" });
    const overwrite = typeof req.body?.overwrite === "boolean" ? req.body.overwrite : false;
    const result = await rollupFoodLogFromEvents(date, { overwrite });
    res.json({ ok: true, date, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/sync", async (req, res) => {
  try {
    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    if (!date) return res.status(400).json({ ok: false, error: "Missing field: date" });
    const onlyUnsynced = typeof req.body?.only_unsynced === "boolean" ? req.body.only_unsynced : true;
    const result = await syncFoodEventsToFoodLog({ date, onlyUnsynced });
    res.json({ ok: true, date, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/log", upload.single("image"), async (req, res) => {
  try {
    const file = req.file ?? null;
    if (file && !file.mimetype?.startsWith("image/")) {
      return res.status(400).json({ ok: false, error: `Unsupported mimetype: ${file.mimetype}` });
    }

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes : "";
    const descriptionText = typeof req.body?.description === "string" ? req.body.description : "";

    const payload = await logFoodFromInputs({ file, descriptionText, notes, date });
    res.json(payload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isInputError = msg === "Provide either an image or a meal description.";
    res.status(isInputError ? 400 : 500).json({ ok: false, error: msg });
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
    const descriptionText = typeof req.body?.description === "string" ? req.body.description.trim() : "";
    const effectiveDate = date ?? getSuggestedLogDate();

    const estimate = await estimateNutritionFromImage({
      imageBuffer: file.buffer,
      imageMimeType: file.mimetype,
      userNotes: [descriptionText, notes].filter(Boolean).join("\n"),
    });

    const { event, food_log } = await addFoodEvent({
      date: effectiveDate,
      source: "photo",
      description: estimate.meal_title,
      input_text: descriptionText || null,
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
      food_log,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/food/manual", async (req, res) => {
  try {
    const description =
      typeof req.body?.description === "string" && req.body.description.trim() ? req.body.description.trim() : null;
    if (!description) return res.status(400).json({ ok: false, error: "Missing field: description" });

    const date = typeof req.body?.date === "string" && req.body.date.trim() ? req.body.date.trim() : null;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    const effectiveDate = date ?? getSuggestedLogDate();

    const estimate = await estimateNutritionFromText({
      mealText: description,
      userNotes: notes,
    });

    const { event, food_log } = await addFoodEvent({
      date: effectiveDate,
      source: "manual",
      description: estimate.meal_title,
      input_text: description,
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
      food_log,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/fitness/current", async (_req, res) => {
  try {
    const current = await ensureCurrentWeek();
    res.json({ ok: true, current_week: current });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/fitness/current/item", async (req, res) => {
  try {
    const category = typeof req.body?.category === "string" ? req.body.category : null;
    const index = typeof req.body?.index === "number" ? req.body.index : Number(req.body?.index);
    const checked = typeof req.body?.checked === "boolean" ? req.body.checked : null;
    const details = typeof req.body?.details === "string" ? req.body.details : "";

    if (!category) return res.status(400).json({ ok: false, error: "Missing field: category" });
    if (!Number.isInteger(index) || index < 0) return res.status(400).json({ ok: false, error: "Invalid field: index" });
    if (checked === null) return res.status(400).json({ ok: false, error: "Missing field: checked" });

    const current = await updateCurrentWeekItem({ category, index, checked, details });
    res.json({ ok: true, current_week: current });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/fitness/current/summary", async (req, res) => {
  try {
    const summary = typeof req.body?.summary === "string" ? req.body.summary : "";
    const current = await updateCurrentWeekSummary(summary);
    res.json({ ok: true, current_week: current });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

app.get("/api/fitness/history", async (req, res) => {
  try {
    const limitRaw = typeof req.query?.limit === "string" ? req.query.limit : null;
    const limit = limitRaw ? Number(limitRaw) : 12;
    const weeks = await listFitnessWeeks({ limit });
    res.json({ ok: true, weeks });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

async function start() {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd) {
    app.use(express.static(distDir, { index: false }));
    app.use(async (req, res) => {
      if (req.originalUrl.startsWith("/api")) {
        return res.status(404).json({ ok: false, error: "Not found" });
      }
      res.sendFile(path.join(distDir, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: clientRoot,
      server: { middlewareMode: true },
      appType: "custom",
    });
    app.use(vite.middlewares);

    app.use(async (req, res, next) => {
      try {
        const url = req.originalUrl;
        if (url.startsWith("/api")) {
          return res.status(404).json({ ok: false, error: "Not found" });
        }
        const template = await fs.readFile(path.join(clientRoot, "index.html"), "utf8");
        const html = await vite.transformIndexHtml(url, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        vite.ssrFixStacktrace(err);
        next(err);
      }
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Tracker listening on http://localhost:${port}`);
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
