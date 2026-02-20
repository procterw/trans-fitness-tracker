import React from "react";

import AutoGrowTextarea from "../components/AutoGrowTextarea.jsx";
import { localDateString } from "../utils/date.js";

function workoutKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
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
                return (
                  <td
                    key={`${week?.week_start ?? weekIdx}_${workout.key}`}
                    className={`fitnessHistoryCell ${completed ? "checked" : "unchecked"}`}
                    title={details || undefined}
                  >
                    <div className="fitnessHistoryCellInner">
                      <span className={`fitnessHistoryMark ${completed ? "ok" : "error"}`}>{completed ? "✓" : "×"}</span>
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
      {groups.map((group, idx) => (
        <details key={group.id} open={idx === 0} className="fitnessHistoryPhaseGroup">
          <summary className="fitnessHistoryPhaseSummary">
            <strong>{group.name}</strong>
            <span className="muted">
              {group.description ? ` ${group.description} • ` : " "}
              {group.weeks.length} week{group.weeks.length === 1 ? "" : "s"}
            </span>
          </summary>
          {renderFitnessHistoryTableForWeeks({ weeks: group.weeks })}
        </details>
      ))}
    </div>
  );
}

function WorkoutItemRow({ workout, index, fitnessLoading, onToggleFitness, onEditFitnessDetails }) {
  const checkboxId = `fit_workout_${index}`;
  const name = typeof workout?.name === "string" ? workout.name : `Workout ${index + 1}`;
  const description = typeof workout?.description === "string" ? workout.description.trim() : "";
  const category = typeof workout?.category === "string" ? workout.category.trim() : "";
  const details = typeof workout?.details === "string" ? workout.details : "";
  const completed = workout?.completed === true;

  return (
    <div className={`fitnessChecklistItem ${completed ? "checked" : ""}`}>
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
        {description ? <span className="fitnessChecklistLabelDescription">{description}</span> : null}
        {category ? <span className="fitnessChecklistLabelDescription">{category}</span> : null}
      </label>
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
}) {
  const workouts = Array.isArray(fitnessWeek?.workouts) ? fitnessWeek.workouts : [];

  return (
    <div className="mainScroll workoutsView">
      <section className="card fitnessCard workoutsCard">
        <h2>
          Workouts this week
          {fitnessWeek ? (
            <span className="muted fitnessWeekLabel">
              {fitnessWeek.week_label ? <code>{fitnessWeek.week_label}</code> : null}
            </span>
          ) : null}
        </h2>

        <section className="workoutsWeeklySummarySection">
          <blockquote className="fitnessSummary">{fitnessWeek?.summary ? fitnessWeek.summary : "No summary yet."}</blockquote>
        </section>

        {fitnessWeek ? (
          <>
            <section className="workoutsChecklistSection">
              {workouts.length ? (
                <section className="fitnessCategory">
                  <div className="fitnessCategoryHeader">
                    <h3 className="fitnessCategoryTitle">Checklist</h3>
                  </div>
                  <div className="fitnessChecklist" aria-label="Workout checklist">
                    {workouts.map((workout, index) => (
                      <WorkoutItemRow
                        key={workoutKey(workout?.name) || index}
                        workout={workout}
                        index={index}
                        fitnessLoading={fitnessLoading}
                        onToggleFitness={onToggleFitness}
                        onEditFitnessDetails={onEditFitnessDetails}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <p className="muted">No workouts yet.</p>
              )}
            </section>

            <section className="fitnessHistory workoutsHistorySection">
              <h3>History</h3>
              <div className="fitnessHistoryBody">
                {fitnessHistoryError ? <p className="error">{fitnessHistoryError}</p> : null}
                {fitnessHistoryLoading ? <p className="muted">Loading…</p> : null}
                {!fitnessHistoryLoading ? renderFitnessHistoryByPhase({ fitnessHistory }) : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
