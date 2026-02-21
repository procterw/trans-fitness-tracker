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

async function seedWorkoutIfMissing({ readTrackingData, writeTrackingData, getCurrentActivityWeek, ensureCurrentWeek, dateA }) {
  let week = await getCurrentActivityWeek();
  if (Array.isArray(week?.workouts) && week.workouts.length > 0) return;

  const ensuredLegacyWeek = await ensureCurrentWeek();
  const weekStart = week?.week_start || ensuredLegacyWeek?.week_start || dateA;
  const weekEnd = week?.week_end || `${weekStart}`;

  const seeded = await readTrackingData();
  const activity = seeded.activity && typeof seeded.activity === "object" ? seeded.activity : {};
  const blocks = Array.isArray(activity.blocks) ? [...activity.blocks] : [];
  const weeks = Array.isArray(activity.weeks) ? [...activity.weeks] : [];

  const blockId = "harness-block";
  const harnessBlock = {
    block_id: blockId,
    block_start: weekStart,
    block_name: "Harness Block",
    block_details: "",
    workouts: [
      {
        name: "Run",
        description: "Easy run",
        category: "Cardio",
        optional: false,
      },
    ],
  };

  const nextBlocks = blocks.filter((block) => block?.block_id !== blockId);
  nextBlocks.push(harnessBlock);

  const nextWeeks = weeks.filter((row) => row?.week_start !== weekStart);
  nextWeeks.push({
    week_start: weekStart,
    week_end: week?.week_end || weekEnd,
    block_id: blockId,
    workouts: [{ name: "Run", details: "", completed: false }],
    summary: week?.summary || "",
  });

  seeded.activity = {
    ...activity,
    blocks: nextBlocks,
    weeks: nextWeeks,
  };

  await writeTrackingData(seeded);
}

async function main() {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tracker-deterministic-harness-"));
  setupIsolatedTrackingEnv(tmpRoot);

  const tracking = await import("../src/trackingData.js");
  const {
    addFoodEvent,
    ensureCurrentWeek,
    getCurrentActivityWeek,
    getDailyTotalsForDate,
    readTrackingData,
    summarizeTrainingBlocks,
    updateCurrentActivityWorkout,
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
  assert.equal(idempotentRetry.log_action, "created");
  results.push("D02 repeated add appends to day");

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
  assert.equal(nearDuplicate.log_action, "created");
  assert.equal(nearDuplicateRetry.log_action, "created");
  results.push("D03 near-time repeats append to day");

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

  const totalsA = await getDailyTotalsForDate(dateA);
  const totalsB = await getDailyTotalsForDate(dateB);
  assert.equal(totalsB.calories, 600);
  assert.ok(totalsA.calories > 0);
  assert.ok(totalsA.calories < 600 + 650 + 95);
  results.push("F05 move date recalculates both days");

  await seedWorkoutIfMissing({
    readTrackingData,
    writeTrackingData,
    getCurrentActivityWeek,
    ensureCurrentWeek,
    dateA,
  });

  const weekBefore = await getCurrentActivityWeek();
  assert.ok(Array.isArray(weekBefore?.workouts) && weekBefore.workouts.length > 0, "expected at least one workout item");

  await updateCurrentActivityWorkout({
    index: 0,
    completed: true,
    details: "45 min moderate run",
  });

  const weekAfter = await getCurrentActivityWeek();
  assert.equal(weekAfter.workouts[0].completed, true);
  results.push("A01 add activity");

  const finalData = await readTrackingData();
  const dayDates = (finalData.food?.days ?? []).map((row) => row?.date).filter(Boolean);
  const uniqueDates = new Set(dayDates);
  assert.equal(uniqueDates.size, dayDates.length);
  results.push("D01 no duplicate day rows across flow");

  // Settings block CRUD deterministic checks via direct apply engine.
  const serverModule = await import("../src/server.js");
  const applySettingsChanges = serverModule.applySettingsChanges;
  assert.equal(typeof applySettingsChanges, "function");

  const initialBlocksState = summarizeTrainingBlocks(await readTrackingData());
  const selectedBlockId = initialBlocksState?.blocks?.[0]?.id || "";
  assert.ok(selectedBlockId, "expected at least one training block for settings tests");

  const addOptionalProposal = {
    training_block: {
      operation: "add_workouts",
      workouts_add: [
        {
          name: "Easy gym session",
          description: "",
          category: "Strength",
          optional: true,
        },
      ],
    },
  };
  const addOptionalRes = await applySettingsChanges({ proposal: addOptionalProposal, selectedBlockId });
  assert.ok(Array.isArray(addOptionalRes.changesApplied) && addOptionalRes.changesApplied.length > 0);
  const stateAfterAdd = summarizeTrainingBlocks(await readTrackingData());
  const blockAfterAdd = (stateAfterAdd?.blocks || []).find((block) => block?.id === selectedBlockId) || null;
  const easyGym = (blockAfterAdd?.workouts || []).find((workout) => String(workout?.name || "").toLowerCase() === "easy gym session");
  assert.ok(easyGym, "expected easy gym session in selected block");
  assert.equal(easyGym.optional, true);
  results.push("S01 add optional workout to selected block");

  // Simulate a lossy legacy block.workouts payload and ensure add_workouts preserves
  // richer checklist-derived metadata for existing workouts.
  const lossyData = await readTrackingData();
  const rules = lossyData?.rules && typeof lossyData.rules === "object" ? lossyData.rules : {};
  const metadata =
    rules?.metadata && typeof rules.metadata === "object"
      ? rules.metadata
      : lossyData?.metadata && typeof lossyData.metadata === "object"
        ? lossyData.metadata
        : {};
  const trainingBlocks =
    metadata?.training_blocks && typeof metadata.training_blocks === "object"
      ? metadata.training_blocks
      : { active_block_id: "", blocks: [] };
  const rawBlocks = Array.isArray(trainingBlocks.blocks) ? trainingBlocks.blocks : [];
  const lossyBlocks = rawBlocks.map((block) => {
    if (block?.id !== selectedBlockId) return block;
    const workouts = Array.isArray(block?.workouts) ? block.workouts : [];
    return {
      ...block,
      workouts: workouts
        .map((workout) => {
          const name = typeof workout?.name === "string" ? workout.name : "";
          if (!name) return null;
          return { name, optional: workout?.optional === true };
        })
        .filter(Boolean),
    };
  });
  const nextMetadata = {
    ...metadata,
    training_blocks: {
      ...trainingBlocks,
      blocks: lossyBlocks,
    },
  };
  lossyData.rules = {
    ...rules,
    metadata: nextMetadata,
  };
  lossyData.metadata = nextMetadata;
  await writeTrackingData(lossyData);

  const preserveMetadataProposal = {
    training_block: {
      operation: "add_workouts",
      workouts_add: [
        {
          name: "Tempo run",
          description: "30 min moderate",
          category: "Cardio",
          optional: false,
        },
      ],
    },
  };
  const preserveMetadataRes = await applySettingsChanges({ proposal: preserveMetadataProposal, selectedBlockId });
  assert.ok(Array.isArray(preserveMetadataRes.changesApplied) && preserveMetadataRes.changesApplied.length > 0);
  const stateAfterPreserve = summarizeTrainingBlocks(await readTrackingData());
  const blockAfterPreserve = (stateAfterPreserve?.blocks || []).find((block) => block?.id === selectedBlockId) || null;
  const runAfterPreserve = (blockAfterPreserve?.workouts || []).find(
    (workout) => String(workout?.name || "").toLowerCase() === "run",
  );
  assert.equal(runAfterPreserve?.description || "", "Easy run");
  assert.equal(String(runAfterPreserve?.category || "").toLowerCase(), "cardio");
  results.push("S01b add_workouts preserves existing workout description/category");

  // Simulate LLM mistake: replace_workouts with name-only rows. Existing matched
  // workouts should retain prior description/category/optional metadata.
  const replaceNameOnlyProposal = {
    training_block: {
      operation: "replace_workouts",
      workouts: [
        { name: "Run" },
        { name: "Easy gym session" },
        { name: "Tempo run" },
        { name: "Hill sprints", description: "8 x 30s hard", category: "Cardio", optional: false },
      ],
    },
  };
  const replaceNameOnlyRes = await applySettingsChanges({ proposal: replaceNameOnlyProposal, selectedBlockId });
  assert.ok(Array.isArray(replaceNameOnlyRes.changesApplied) && replaceNameOnlyRes.changesApplied.length > 0);
  const stateAfterReplaceNameOnly = summarizeTrainingBlocks(await readTrackingData());
  const blockAfterReplaceNameOnly =
    (stateAfterReplaceNameOnly?.blocks || []).find((block) => block?.id === selectedBlockId) || null;
  const runAfterReplaceNameOnly = (blockAfterReplaceNameOnly?.workouts || []).find(
    (workout) => String(workout?.name || "").toLowerCase() === "run",
  );
  assert.equal(runAfterReplaceNameOnly?.description || "", "Easy run");
  assert.equal(String(runAfterReplaceNameOnly?.category || "").toLowerCase(), "cardio");
  results.push("S01c replace_workouts hydrates missing metadata from existing definitions");

  const blockBeforeAddInvariant = blockAfterReplaceNameOnly;
  const existingDefinitionsBeforeAdd = new Map(
    (blockBeforeAddInvariant?.workouts || []).map((workout) => [
      String(workout?.name || "").toLowerCase(),
      {
        description: String(workout?.description || ""),
        category: String(workout?.category || ""),
        optional: workout?.optional === true,
      },
    ]),
  );
  const strictAddProposal = {
    training_block: {
      operation: "add_workouts",
      workouts_add: [
        {
          name: "Light social gym workout",
          description: "Low-intensity gym session with friends",
          category: "Strength",
          optional: true,
        },
      ],
    },
  };
  const strictAddRes = await applySettingsChanges({ proposal: strictAddProposal, selectedBlockId });
  assert.ok(Array.isArray(strictAddRes.changesApplied) && strictAddRes.changesApplied.length > 0);
  const stateAfterStrictAdd = summarizeTrainingBlocks(await readTrackingData());
  const blockAfterStrictAdd = (stateAfterStrictAdd?.blocks || []).find((block) => block?.id === selectedBlockId) || null;
  const existingDefinitionsAfterAdd = new Map(
    (blockAfterStrictAdd?.workouts || []).map((workout) => [
      String(workout?.name || "").toLowerCase(),
      {
        description: String(workout?.description || ""),
        category: String(workout?.category || ""),
        optional: workout?.optional === true,
      },
    ]),
  );
  for (const [name, before] of existingDefinitionsBeforeAdd.entries()) {
    const after = existingDefinitionsAfterAdd.get(name);
    assert.deepEqual(after, before, `existing workout metadata changed for ${name}`);
  }
  const socialWorkout = (blockAfterStrictAdd?.workouts || []).find(
    (workout) => String(workout?.name || "").toLowerCase() === "light social gym workout",
  );
  assert.ok(socialWorkout, "expected strict add workout to exist");
  results.push("S01d add_workouts does not mutate existing workout definitions");

  const removeWithHistoryProposal = {
    training_block: {
      operation: "remove_workouts",
      workouts_remove: [{ name: "Run" }],
    },
  };
  const removeWithHistoryRes = await applySettingsChanges({ proposal: removeWithHistoryProposal, selectedBlockId });
  assert.equal(removeWithHistoryRes.requiresConfirmation, true, "expected history delete to require confirmation");
  assert.ok(
    typeof removeWithHistoryRes.confirmationPhrase === "string" &&
      removeWithHistoryRes.confirmationPhrase.startsWith("CONFIRM "),
  );
  assert.ok(removeWithHistoryRes.proposal && typeof removeWithHistoryRes.proposal === "object");

  const removeConfirmRes = await applySettingsChanges({
    proposal: removeWithHistoryRes.proposal,
    selectedBlockId,
    confirmationPhrase: removeWithHistoryRes.confirmationPhrase,
  });
  assert.ok(Array.isArray(removeConfirmRes.changesApplied) && removeConfirmRes.changesApplied.length > 0);
  const stateAfterRemove = summarizeTrainingBlocks(await readTrackingData());
  const blockAfterRemove = (stateAfterRemove?.blocks || []).find((block) => block?.id === selectedBlockId) || null;
  const runAfterRemove = (blockAfterRemove?.workouts || []).find((workout) => String(workout?.name || "").toLowerCase() === "run");
  assert.equal(Boolean(runAfterRemove), false);
  results.push("S02 remove with history requires confirm phrase");

  const createNonMondayProposal = {
    training_block: {
      operation: "create_block",
      name: "Harness March Block",
      description: "Date correction test",
      block_start: "2026-03-03",
      apply_timing: "next_week",
      workouts_add: [
        {
          name: "Short run",
          description: "20 min easy",
          category: "Cardio",
          optional: false,
        },
      ],
    },
  };
  const createNeedsConfirm = await applySettingsChanges({ proposal: createNonMondayProposal, selectedBlockId });
  assert.equal(createNeedsConfirm.requiresConfirmation, true, "expected non-Monday create to require confirmation");
  assert.equal(createNeedsConfirm.proposal?.training_block?.block_start, "2026-03-02");

  const createConfirmed = await applySettingsChanges({
    proposal: createNeedsConfirm.proposal,
    selectedBlockId,
    confirmationPhrase: createNeedsConfirm.confirmationPhrase,
  });
  assert.ok(Array.isArray(createConfirmed.changesApplied) && createConfirmed.changesApplied.length > 0);
  const stateAfterCreate = summarizeTrainingBlocks(await readTrackingData());
  const allBlocksAfterCreate = Array.isArray(stateAfterCreate?.blocks) ? stateAfterCreate.blocks : [];
  const createdBlock = allBlocksAfterCreate.find((block) => block?.name === "Harness March Block") || null;
  assert.ok(createdBlock, "expected created March block");
  assert.equal(createdBlock.block_start, "2026-03-02");
  const predecessor = allBlocksAfterCreate.find((block) => block?.id === selectedBlockId) || null;
  assert.equal(predecessor?.block_end, "2026-03-01");
  results.push("S03 create block with Monday correction + predecessor auto-close");

  console.log("Deterministic harness passed:");
  for (const entry of results) console.log(`- ${entry}`);
  console.log(`Total checks: ${results.length}`);
}

main().catch((err) => {
  console.error("Deterministic harness failed.");
  console.error(err);
  process.exit(1);
});
