#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function createNutrients({ calories, fat_g, carbs_g, protein_g, fiber_g = 0 }) {
  return {
    calories,
    fat_g,
    carbs_g,
    protein_g,
    fiber_g,
    potassium_mg: 300,
    magnesium_mg: 80,
    omega3_mg: 100,
    calcium_mg: 120,
    iron_mg: 2,
  };
}

function setupIsolatedTrackingEnv(root) {
  process.env.TRACKING_BACKEND = "json";
  process.env.TRACKING_DEFAULT_USER_ID = "harness-user";
  process.env.TRACKING_FOOD_FILE = path.join(root, "tracking-food.json");
  process.env.TRACKING_ACTIVITY_FILE = path.join(root, "tracking-activity.json");
  process.env.TRACKING_PROFILE_FILE = path.join(root, "tracking-profile.json");
  process.env.TRACKING_RULES_FILE = path.join(root, "tracking-rules.json");
  delete process.env.TRACKING_DATA_FILE;
  delete process.env.OPENAI_API_KEY;
}

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tracker-deterministic-harness-"));
  setupIsolatedTrackingEnv(tmpRoot);

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const tracking = await import("../src/trackingData.js");
    const {
      addFoodEvent,
      ensureCurrentWeek,
      getDailyFoodEventTotals,
      readTrackingData,
      syncFoodEventsToFoodLog,
      updateCurrentWeekItems,
      updateFoodEvent,
      writeTrackingData,
    } = tracking;

    const results = [];

    const dateA = "2026-02-10";
    const dateB = "2026-02-11";

    const created = await addFoodEvent({
      date: dateA,
      source: "manual",
      description: "oatmeal bowl",
      input_text: "ate oatmeal",
      notes: "",
      nutrients: createNutrients({ calories: 400, fat_g: 12, carbs_g: 55, protein_g: 15, fiber_g: 9 }),
      model: "test",
      confidence: 1,
      raw_items: [],
      idempotency_key: "F01-add-food",
    });
    assert.equal(created.log_action, "created");
    results.push("F01 add food");

    const createdPhoto = await addFoodEvent({
      date: dateA,
      source: "photo",
      description: "avocado toast",
      input_text: "photo meal",
      notes: "",
      nutrients: createNutrients({ calories: 520, fat_g: 24, carbs_g: 58, protein_g: 17, fiber_g: 10 }),
      model: "test",
      confidence: 1,
      raw_items: [],
      idempotency_key: "F02-add-food-photo",
    });
    assert.equal(createdPhoto.log_action, "created");
    results.push("F02 add food photo");

    const idempotentRetry = await addFoodEvent({
      date: dateA,
      source: "manual",
      description: "oatmeal bowl",
      input_text: "ate oatmeal",
      notes: "",
      nutrients: createNutrients({ calories: 400, fat_g: 12, carbs_g: 55, protein_g: 15, fiber_g: 9 }),
      model: "test",
      confidence: 1,
      raw_items: [],
      idempotency_key: "F01-add-food",
    });
    assert.equal(idempotentRetry.log_action, "existing");
    assert.equal(idempotentRetry.event.id, created.event.id);
    results.push("D02 idempotent retry");

    const nearDuplicate = await addFoodEvent({
      date: dateA,
      source: "manual",
      description: "apple",
      input_text: "had an apple",
      notes: "",
      nutrients: createNutrients({ calories: 95, fat_g: 0.3, carbs_g: 25, protein_g: 0.5, fiber_g: 4.4 }),
      model: "test",
      confidence: 1,
      raw_items: [],
    });
    const nearDuplicateRetry = await addFoodEvent({
      date: dateA,
      source: "manual",
      description: "apple",
      input_text: "had an apple",
      notes: "",
      nutrients: createNutrients({ calories: 95, fat_g: 0.3, carbs_g: 25, protein_g: 0.5, fiber_g: 4.4 }),
      model: "test",
      confidence: 1,
      raw_items: [],
    });
    assert.equal(nearDuplicateRetry.log_action, "existing");
    assert.equal(nearDuplicateRetry.event.id, nearDuplicate.event.id);
    results.push("D03 near-time duplicate suppression");

    const updated = await updateFoodEvent({
      id: created.event.id,
      date: dateA,
      source: "manual",
      description: "oatmeal bowl (large)",
      input_text: "actually larger oatmeal",
      notes: "updated",
      nutrients: createNutrients({ calories: 600, fat_g: 18, carbs_g: 80, protein_g: 23, fiber_g: 13 }),
      model: "test",
      confidence: 1,
      raw_items: [],
      idempotency_key: "F03-update-food",
    });
    assert.equal(updated.log_action, "updated");
    results.push("F03 update food");

    const updatedPhoto = await updateFoodEvent({
      id: createdPhoto.event.id,
      date: dateA,
      source: "photo",
      description: "avocado toast (larger)",
      input_text: "updated from photo",
      notes: "updated photo",
      nutrients: createNutrients({ calories: 650, fat_g: 30, carbs_g: 70, protein_g: 21, fiber_g: 12 }),
      model: "test",
      confidence: 1,
      raw_items: [],
      idempotency_key: "F04-update-food-photo",
    });
    assert.equal(updatedPhoto.log_action, "updated");
    results.push("F04 update food photo");

    await updateFoodEvent({
      id: created.event.id,
      date: dateB,
      source: "manual",
      description: "oatmeal bowl (moved)",
      input_text: "move to next day",
      notes: "date corrected",
      nutrients: createNutrients({ calories: 600, fat_g: 18, carbs_g: 80, protein_g: 23, fiber_g: 13 }),
      model: "test",
      confidence: 1,
      raw_items: [],
      idempotency_key: "F05-move-date",
    });

    const totalsA = await getDailyFoodEventTotals(dateA);
    const totalsB = await getDailyFoodEventTotals(dateB);
    assert.equal(totalsB.calories, 600);
    assert.ok(totalsA.calories > 0);
    assert.ok(totalsA.calories < 600 + 650 + 95);
    results.push("F05 move date recalculates both days");

    const dataBeforeSync = await readTrackingData();
    for (const event of dataBeforeSync.food_events ?? []) {
      if (event?.date === dateA) event.applied_to_food_log = false;
    }
    await writeTrackingData(dataBeforeSync);

    await syncFoodEventsToFoodLog({ date: dateA, onlyUnsynced: false });
    const afterSync1 = await readTrackingData();
    const caloriesAfterSync1 = afterSync1.food_log.find((row) => row?.date === dateA)?.calories ?? null;
    await syncFoodEventsToFoodLog({ date: dateA, onlyUnsynced: false });
    const afterSync2 = await readTrackingData();
    const caloriesAfterSync2 = afterSync2.food_log.find((row) => row?.date === dateA)?.calories ?? null;
    assert.equal(caloriesAfterSync1, caloriesAfterSync2);
    results.push("S01 sync idempotence");

    let week = await ensureCurrentWeek();
    let categoryKeys = Object.keys(week).filter((key) => Array.isArray(week[key]));
    if (!categoryKeys.length) {
      const seeded = await readTrackingData();
      seeded.current_week = {
        week_start: week?.week_start ?? dateA,
        week_label: week?.week_label ?? "",
        summary: "",
        category_order: ["endurance"],
        category_labels: { endurance: "Endurance" },
        endurance: [{ item: "Run", checked: false, details: "" }],
      };
      await writeTrackingData(seeded);
      week = seeded.current_week;
      categoryKeys = ["endurance"];
    }
    const firstCategory = categoryKeys[0];
    const firstItem = week[firstCategory][0];
    assert.ok(firstItem, "expected at least one checklist item");
    await updateCurrentWeekItems([{ category: firstCategory, index: 0, checked: true, details: "45 min moderate run" }]);
    const afterActivity = await readTrackingData();
    assert.equal(afterActivity.current_week[firstCategory][0].checked, true);
    results.push("A01 add activity");

    const finalData = await readTrackingData();
    const uniqueIds = new Set((finalData.food_events ?? []).map((event) => event.id));
    assert.equal(uniqueIds.size, (finalData.food_events ?? []).length);
    results.push("D01 no duplicate ids across flow");

    console.log("Deterministic harness passed:");
    for (const entry of results) console.log(`- ${entry}`);
    console.log(`Total checks: ${results.length}`);
  } finally {
    console.warn = originalWarn;
  }
}

main().catch((err) => {
  console.error("Deterministic harness failed.");
  console.error(err);
  process.exit(1);
});
