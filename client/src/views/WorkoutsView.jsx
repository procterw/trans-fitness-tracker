import React from "react";

import AutoGrowTextarea from "../components/AutoGrowTextarea.jsx";
import { localDateString } from "../utils/date.js";

function workoutKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function normalizeWorkoutDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : "";
}

function groupWorkoutsByCategory(workouts) {
  const groups = [];
  const byCategory = new Map();
  for (const [index, workout] of (Array.isArray(workouts) ? workouts : []).entries()) {
    const categoryRaw = typeof workout?.category === "string" ? workout.category.trim() : "";
    const category = categoryRaw || "Uncategorized";
    if (!byCategory.has(category)) {
      const group = { category, items: [] };
      byCategory.set(category, group);
      groups.push(group);
    }
    byCategory.get(category).items.push({ workout, index });
  }
  return groups;
}

function collectWorkoutCatalog(weeks) {
  const byKey = new Map();
  for (const week of Array.isArray(weeks) ? weeks : []) {
    const workouts = Array.isArray(week?.workouts) ? week.workouts : [];
    for (const workout of workouts) {
      const name = typeof workout?.name === "string" ? workout.name.trim() : "";
      if (!name) continue;
      const key = workoutKey(name);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        name,
        description: typeof workout?.description === "string" ? workout.description.trim() : "",
        category: typeof workout?.category === "string" ? workout.category.trim() : "",
      });
    }
  }
  return Array.from(byKey.values());
}

function findWorkoutInWeek(week, name) {
  const target = workoutKey(name);
  const workouts = Array.isArray(week?.workouts) ? week.workouts : [];
  return workouts.find((workout) => workoutKey(workout?.name) === target) || null;
}

function renderFitnessHistoryTableForWeeks({ weeks }) {
  if (!Array.isArray(weeks) || !weeks.length) return <p className="muted">No past weeks yet.</p>;

  const workoutCatalog = collectWorkoutCatalog(weeks);
  if (!workoutCatalog.length) return <p className="muted">No workouts in history yet.</p>;

  return (
    <div className="tableScroll fitnessHistoryTableScroll" role="region" aria-label="Fitness history table">
      <table className="fitnessHistoryTable">
        <thead>
          <tr>
            <th className="fitnessHistoryWeekCol">Workout</th>
            {weeks.map((week, idx) => (
              <th key={week?.week_start ?? `week_${idx}`} className="fitnessHistoryWeekHeader">
                <div className="fitnessHistoryWeekTitle">{week?.week_label ?? week?.week_start ?? "—"}</div>
                <div className="fitnessHistoryWeekMeta muted">
                  <code>{week?.week_start ?? "—"}</code>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {workoutCatalog.map((workout) => (
            <tr key={workout.key}>
              <td className="fitnessHistoryActivityCell">
                <div>{workout.name}</div>
                {workout.description ? (
                  <div className="fitnessHistoryActivityDescription">{workout.description}</div>
                ) : null}
                {workout.category ? <div className="fitnessHistoryActivityDescription muted">{workout.category}</div> : null}
              </td>
              {weeks.map((week, weekIdx) => {
                const row = findWorkoutInWeek(week, workout.name);
                const completed = row?.completed === true;
                const details = typeof row?.details === "string" ? row.details.trim() : "";
                const date = normalizeWorkoutDate(row?.date);
                return (
                  <td
                    key={`${week?.week_start ?? weekIdx}_${workout.key}`}
                    className={`fitnessHistoryCell ${completed ? "checked" : "unchecked"}`}
                    title={details || undefined}
                  >
                    <div className="fitnessHistoryCellInner">
                      {!completed ? <span className="fitnessHistoryMark error">×</span> : null}
                      {date ? <div className="fitnessHistoryText muted">{date}</div> : null}
                      {details ? <div className="fitnessHistoryText">{details}</div> : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderFitnessHistoryByPhase({ fitnessHistory }) {
  const today = localDateString(new Date());
  const weeks = Array.isArray(fitnessHistory)
    ? [...fitnessHistory]
        .filter((week) => {
          const weekStart = typeof week?.week_start === "string" ? week.week_start : "";
          const blockStart = typeof week?.block_start === "string" ? week.block_start : "";
          if (weekStart) return weekStart <= today;
          if (blockStart) return blockStart <= today;
          return true;
        })
        .reverse()
    : [];
  if (!weeks.length) return <p className="muted">No past weeks yet.</p>;

  const groups = [];
  const byId = new Map();
  for (const week of weeks) {
    const id = typeof week?.block_id === "string" && week.block_id.trim() ? week.block_id.trim() : "unassigned";
    const name = typeof week?.block_name === "string" && week.block_name.trim() ? week.block_name.trim() : "Unassigned block";
    const description = typeof week?.block_details === "string" && week.block_details.trim() ? week.block_details.trim() : "";
    if (!byId.has(id)) {
      const group = { id, name, description, weeks: [] };
      byId.set(id, group);
      groups.push(group);
    }
    byId.get(id).weeks.push(week);
  }

  return (
    <div className="fitnessHistoryPhaseGroups">
      {groups.map((group) => {
        const starts = group.weeks
          .map((week) => (typeof week?.week_start === "string" ? week.week_start : ""))
          .filter(Boolean)
          .sort();
        const ends = group.weeks
          .map((week) => (typeof week?.week_end === "string" ? week.week_end : ""))
          .filter(Boolean)
          .sort();
        const rangeStart = starts.length ? starts[0] : "";
        const rangeEnd = ends.length ? ends[ends.length - 1] : rangeStart;
        const rangeText = rangeStart && rangeEnd ? (rangeStart === rangeEnd ? rangeStart : `${rangeStart} to ${rangeEnd}`) : "";

        return (
          <section key={group.id} className="fitnessHistoryPhaseGroup">
            <div className="fitnessHistoryPhaseSummary">
              <div className="fitnessHistoryPhaseTitleRow">
                <h3 className="fitnessHistoryPhaseTitle">{group.name}</h3>
                <span className="fitnessHistoryPhaseMeta muted">
                  {rangeText ? `${rangeText} • ` : ""}
                  {group.weeks.length} week{group.weeks.length === 1 ? "" : "s"}
                </span>
              </div>
              {group.description ? <div className="fitnessHistoryPhaseDescription muted">{group.description}</div> : null}
            </div>
            <div className="workoutsDataPanel">{renderFitnessHistoryTableForWeeks({ weeks: group.weeks })}</div>
          </section>
        );
      })}
    </div>
  );
}

function WorkoutItemRow({ workout, index, fitnessLoading, onToggleFitness, onEditFitnessDetails, onEditFitnessDate }) {
  const checkboxId = `fit_workout_${index}`;
  const name = typeof workout?.name === "string" ? workout.name : `Workout ${index + 1}`;
  const description = typeof workout?.description === "string" ? workout.description.trim() : "";
  const details = typeof workout?.details === "string" ? workout.details : "";
  const date = normalizeWorkoutDate(workout?.date);
  const completed = workout?.completed === true;

  return (
    <div className={`fitnessChecklistItem ${completed ? "checked" : ""}`}>
      <div className="fitnessChecklistPrimary">
        <input
          id={checkboxId}
          className="fitnessChecklistCheckbox"
          type="checkbox"
          checked={completed}
          disabled={fitnessLoading}
          onChange={(e) => onToggleFitness(index, e.target.checked)}
        />
        <label htmlFor={checkboxId} className="fitnessChecklistLabel">
          <span className="fitnessChecklistLabelText">{name}</span>
        </label>
      </div>
      <div className="fitnessChecklistDescriptionCol">{description}</div>
      {completed ? (
        <AutoGrowTextarea
          rows={1}
          className="fitnessChecklistDetails"
          value={details}
          disabled={fitnessLoading}
          placeholder="Details…"
          onChange={(e) => onEditFitnessDetails(index, e.target.value)}
          aria-label={`${name} details`}
        />
      ) : null}
      {completed ? (
        <input
          type="date"
          className="fitnessChecklistDate"
          value={date}
          disabled={fitnessLoading}
          onChange={(e) => onEditFitnessDate(index, e.target.value)}
          aria-label={`${name} date`}
        />
      ) : null}
    </div>
  );
}

export default function WorkoutsView({
  fitnessWeek,
  fitnessLoading,
  fitnessHistory,
  fitnessHistoryError,
  fitnessHistoryLoading,
  onToggleFitness,
  onEditFitnessDetails,
  onEditFitnessDate,
  onEditWeekContext,
}) {
  const workouts = Array.isArray(fitnessWeek?.workouts) ? fitnessWeek.workouts : [];
  const workoutGroups = groupWorkoutsByCategory(workouts);
  const currentBlockName =
    typeof fitnessWeek?.block_name === "string" && fitnessWeek.block_name.trim() ? fitnessWeek.block_name.trim() : "Current block";
  const currentBlockDescription =
    typeof fitnessWeek?.block_details === "string" && fitnessWeek.block_details.trim()
      ? fitnessWeek.block_details.trim()
      : typeof fitnessWeek?.training_block_description === "string" && fitnessWeek.training_block_description.trim()
        ? fitnessWeek.training_block_description.trim()
        : "";
  const currentWeekContext = typeof fitnessWeek?.context === "string" ? fitnessWeek.context : "";
  const currentWeekSummary = typeof fitnessWeek?.ai_summary === "string" ? fitnessWeek.ai_summary : "";

  return (
    <div className="mainScroll workoutsView">
      <section className="card fitnessCard workoutsCard">
        <div className="workoutsNarrow">
          <h2>
            Workouts this week
            {fitnessWeek ? (
              <span className="muted fitnessWeekLabel">
                {fitnessWeek.week_label ? <code>{fitnessWeek.week_label}</code> : null}
              </span>
            ) : null}
          </h2>
          {fitnessWeek ? (
            <div className="workoutsBlockHeaderRow">
              <section className="workoutsBlockMetaSection" aria-label="Current training block">
                <h3 className="workoutsBlockMetaName">{currentBlockName}</h3>
                {currentBlockDescription ? <p className="workoutsBlockMetaDescription">{currentBlockDescription}</p> : null}
              </section>
              <section className="workoutsWeekContextSection" aria-label="Weekly training notes">
                <label htmlFor="fitnessWeekContext" className="workoutsWeekContextLabel">
                  Training week notes
                </label>
                <AutoGrowTextarea
                  id="fitnessWeekContext"
                  rows={3}
                  className="workoutsWeekContextTextarea"
                  value={currentWeekContext}
                  disabled={fitnessLoading}
                  placeholder="Add notes about this week of training…"
                  onChange={(e) => onEditWeekContext?.(e.target.value ?? "")}
                  aria-label="Training week notes"
                />
              </section>
              <section className="workoutsWeekSummarySection" aria-label="Weekly AI summary">
              <h3 className="workoutsBlockMetaName">Summary</h3>
                {currentWeekSummary ? <p className="workoutsBlockMetaDescription">{currentWeekSummary}</p> : <p className="workoutsBlockMetaDescription muted">No summary yet.</p>}
              </section>
            </div>
          ) : null}
        </div>

        {fitnessWeek ? (
          <section className="workoutsChecklistSection workoutsDataPanel">
            {workouts.length ? (
              <>
                {workoutGroups.map((group) => (
                  <section key={group.category} className="fitnessCategory">
                    <div className="fitnessCategoryHeader">
                      <h3 className="fitnessCategoryTitle">{group.category}</h3>
                    </div>
                    <div className="fitnessChecklist" aria-label={`${group.category} workout checklist`}>
                      {group.items.map(({ workout, index }) => (
                        <WorkoutItemRow
                          key={`${group.category}_${workoutKey(workout?.name) || index}`}
                          workout={workout}
                          index={index}
                          fitnessLoading={fitnessLoading}
                          onToggleFitness={onToggleFitness}
                          onEditFitnessDetails={onEditFitnessDetails}
                          onEditFitnessDate={onEditFitnessDate}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </>
            ) : (
              <p className="muted">No workouts yet.</p>
            )}
          </section>
        ) : null}

        {fitnessWeek ? (
          <section className="fitnessHistory workoutsHistorySection">
            <h2>History</h2>
            <div className="fitnessHistoryBody">
              {fitnessHistoryError ? <p className="error">{fitnessHistoryError}</p> : null}
              {fitnessHistoryLoading ? <p className="muted">Loading…</p> : null}
              {!fitnessHistoryLoading ? renderFitnessHistoryByPhase({ fitnessHistory }) : null}
            </div>
          </section>
        ) : null}
      </section>
    </div>
  );
}
