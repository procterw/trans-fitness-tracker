import OpenAI from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";

import { readTrackingData } from "./trackingData.js";

let cachedClient = null;
function getOpenAIClient() {
  if (cachedClient) return cachedClient;
  if (!process.env.OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY in environment.");
  cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return cachedClient;
}

const NutrientsSchema = z.object({
  calories: z.number().nonnegative(),
  fat_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative().nullable(),
  potassium_mg: z.number().nonnegative().nullable(),
  magnesium_mg: z.number().nonnegative().nullable(),
  omega3_mg: z.number().nonnegative().nullable(),
  calcium_mg: z.number().nonnegative().nullable(),
  iron_mg: z.number().nonnegative().nullable(),
});

const ItemSchema = z.object({
  name: z.string(),
  portion: z.string(),
  nutrients: NutrientsSchema,
  notes: z.string().optional(),
});

const EstimateSchema = z.object({
  meal_title: z.string(),
  items: z.array(ItemSchema),
  totals: NutrientsSchema,
  confidence: z.object({
    overall: z.number().min(0).max(1),
    notes: z.string(),
  }),
  warnings: z.array(z.string()).optional(),
  followup_questions: z.array(z.string()).optional(),
});

function roundTo(number, digits) {
  const m = 10 ** digits;
  return Math.round(number * m) / m;
}

function normalizeNutrients(n) {
  const safe = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const safeNullable = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  return {
    calories: Math.round(safe(n.calories)),
    fat_g: roundTo(safe(n.fat_g), 1),
    carbs_g: roundTo(safe(n.carbs_g), 1),
    protein_g: roundTo(safe(n.protein_g), 1),
    fiber_g: n.fiber_g === null ? null : roundTo(safeNullable(n.fiber_g) ?? 0, 1),
    potassium_mg: n.potassium_mg === null ? null : Math.round(safeNullable(n.potassium_mg) ?? 0),
    magnesium_mg: n.magnesium_mg === null ? null : Math.round(safeNullable(n.magnesium_mg) ?? 0),
    omega3_mg: n.omega3_mg === null ? null : Math.round(safeNullable(n.omega3_mg) ?? 0),
    calcium_mg: n.calcium_mg === null ? null : Math.round(safeNullable(n.calcium_mg) ?? 0),
    iron_mg: n.iron_mg === null ? null : roundTo(safeNullable(n.iron_mg) ?? 0, 1),
  };
}

function sumItemNutrients(items) {
  const totals = {
    calories: 0,
    fat_g: 0,
    carbs_g: 0,
    protein_g: 0,
    fiber_g: 0,
    potassium_mg: 0,
    magnesium_mg: 0,
    omega3_mg: 0,
    calcium_mg: 0,
    iron_mg: 0,
  };

  const unknown = {
    fiber_g: false,
    potassium_mg: false,
    magnesium_mg: false,
    omega3_mg: false,
    calcium_mg: false,
    iron_mg: false,
  };

  for (const item of items) {
    const n = item.nutrients;
    totals.calories += typeof n.calories === "number" ? n.calories : 0;
    totals.fat_g += typeof n.fat_g === "number" ? n.fat_g : 0;
    totals.carbs_g += typeof n.carbs_g === "number" ? n.carbs_g : 0;
    totals.protein_g += typeof n.protein_g === "number" ? n.protein_g : 0;

    if (n.fiber_g === null) unknown.fiber_g = true;
    else totals.fiber_g += typeof n.fiber_g === "number" ? n.fiber_g : 0;

    if (n.potassium_mg === null) unknown.potassium_mg = true;
    else totals.potassium_mg += typeof n.potassium_mg === "number" ? n.potassium_mg : 0;

    if (n.magnesium_mg === null) unknown.magnesium_mg = true;
    else totals.magnesium_mg += typeof n.magnesium_mg === "number" ? n.magnesium_mg : 0;

    if (n.omega3_mg === null) unknown.omega3_mg = true;
    else totals.omega3_mg += typeof n.omega3_mg === "number" ? n.omega3_mg : 0;

    if (n.calcium_mg === null) unknown.calcium_mg = true;
    else totals.calcium_mg += typeof n.calcium_mg === "number" ? n.calcium_mg : 0;

    if (n.iron_mg === null) unknown.iron_mg = true;
    else totals.iron_mg += typeof n.iron_mg === "number" ? n.iron_mg : 0;
  }

  return {
    calories: Math.round(totals.calories),
    fat_g: roundTo(totals.fat_g, 1),
    carbs_g: roundTo(totals.carbs_g, 1),
    protein_g: roundTo(totals.protein_g, 1),
    fiber_g: unknown.fiber_g ? null : roundTo(totals.fiber_g, 1),
    potassium_mg: unknown.potassium_mg ? null : Math.round(totals.potassium_mg),
    magnesium_mg: unknown.magnesium_mg ? null : Math.round(totals.magnesium_mg),
    omega3_mg: unknown.omega3_mg ? null : Math.round(totals.omega3_mg),
    calcium_mg: unknown.calcium_mg ? null : Math.round(totals.calcium_mg),
    iron_mg: unknown.iron_mg ? null : roundTo(totals.iron_mg, 1),
  };
}

export async function estimateNutritionFromImage({ imageBuffer, imageMimeType, userNotes }) {
  const client = getOpenAIClient();
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const tracking = await readTrackingData();
  const foodDefs = tracking?.metadata?.food_definitions ?? {};

  const dataUrl = `data:${imageMimeType};base64,${imageBuffer.toString("base64")}`;

  const system = [
    "You estimate nutrition from a meal photo.",
    "Return a best-effort estimate for: calories, fat_g, carbs_g, protein_g, fiber_g, potassium_mg, magnesium_mg, omega3_mg, calcium_mg, iron_mg.",
    "If you truly cannot estimate a micronutrient from the image/context, set it to null (do not guess wildly).",
    "Give itemized estimates + a totals object that equals the sum of items (within rounding).",
    "Be explicit about assumptions and uncertainty in confidence.notes and any warnings.",
  ].join(" ");

  const userText = [
    userNotes ? `User notes: ${userNotes}` : "User notes: (none)",
    "If the user notes refer to any of these defined foods, prefer those definitions:",
    JSON.stringify(
      {
        chocolate: foodDefs.chocolate ?? null,
        smoothie: foodDefs.smoothie ?? null,
        oatmeal: foodDefs.oatmeal ?? null,
        chili: foodDefs.chili ?? null,
        fish_oil: foodDefs.fish_oil ?? null,
        soy_milk: foodDefs.soy_milk ?? null,
      },
      null,
      2,
    ),
  ].join("\n");

  const response = await client.responses.parse({
    model,
    input: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "input_text", text: userText },
          { type: "input_image", image_url: dataUrl, detail: "high" },
        ],
      },
    ],
    text: { format: zodTextFormat(EstimateSchema, "nutrition_estimate") },
  });

  const parsed = response.output_parsed;
  if (!parsed) throw new Error("OpenAI response did not include parsed output.");

  const normalizedItems = parsed.items.map((it) => ({
    ...it,
    nutrients: normalizeNutrients(it.nutrients),
  }));
  const normalizedTotalsFromModel = normalizeNutrients(parsed.totals);
  const normalizedTotals = sumItemNutrients(normalizedItems);
  const warnings = [...(parsed.warnings ?? [])];
  if (Math.abs(normalizedTotalsFromModel.calories - normalizedTotals.calories) >= 75) {
    warnings.push("Totals were adjusted to match the sum of the itemized estimates.");
  }

  return {
    model,
    meal_title: parsed.meal_title,
    items: normalizedItems,
    totals: normalizedTotals,
    confidence: parsed.confidence,
    warnings,
    followup_questions: parsed.followup_questions ?? [],
  };
}
