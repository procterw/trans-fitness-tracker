import React from "react";

import AutoGrowTextarea from "../components/AutoGrowTextarea.jsx";
import { getFitnessCategories } from "../fitnessChecklist.js";

function renderFitnessHistoryTable({ fitnessHistory, fitnessWeek }) {
  const weeks = Array.isArray(fitnessHistory) ? [...fitnessHistory].reverse() : [];
  if (!weeks.length) return <p className="muted">No past weeks yet.</p>;

  const categoriesByKey = new Map();
  const collectCategories = (week) => {
    for (const category of getFitnessCategories(week)) {
      if (!categoriesByKey.has(category.key)) categoriesByKey.set(category.key, category);
      else if (!categoriesByKey.get(category.key).items.length && category.items.length) categoriesByKey.set(category.key, category);
    }
  };
  collectCategories(fitnessWeek);
  for (const week of weeks) collectCategories(week);

  const categories = Array.from(categoriesByKey.values());
  if (!categories.length) return <p className="muted">No checklist categories in history yet.</p>;

  return (
    <div className="tableScroll fitnessHistoryTableScroll" role="region" aria-label="Fitness history table">
      <table className="fitnessHistoryTable">
        <thead>
          <tr>
            <th className="fitnessHistoryWeekCol">Activity</th>
            {weeks.map((week, idx) => (
              <th key={week?.week_start ?? `week_${idx}`} className="fitnessHistoryWeekHeader">
                <div className="fitnessHistoryWeekTitle">{week?.week_label ?? "—"}</div>
                <div className="fitnessHistoryWeekMeta muted">
                  <code>{week?.week_start ?? "—"}</code>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map(({ key: catKey, label: catLabel, items }) => {
            if (!items.length) return null;
            return (
              <React.Fragment key={catKey}>
                <tr className="fitnessHistoryCategoryRow">
                  <td className="fitnessHistoryCategoryCell" colSpan={weeks.length + 1}>
                    {catLabel}
                  </td>
                </tr>
                {items.map((item, itemIdx) => (
                  <tr key={`${catKey}_${itemIdx}`}>
                    <td className="fitnessHistoryActivityCell">{item?.item ?? `${catLabel} ${itemIdx + 1}`}</td>
                    {weeks.map((week, weekIdx) => {
                      const list = Array.isArray(week?.[catKey]) ? week[catKey] : [];
                      const it = list[itemIdx];
                      const checked = Boolean(it?.checked);
                      const details = checked ? (it?.details ?? "").trim() : "";
                      return (
                        <td
                          key={`${week?.week_start ?? weekIdx}_${catKey}_${itemIdx}`}
                          className={`fitnessHistoryCell ${checked ? "checked" : "unchecked"}`}
                          title={details || undefined}
                        >
                          <div className="fitnessHistoryCellInner">
                            <span className={`fitnessHistoryMark ${checked ? "ok" : "error"}`}>{checked ? "✓" : "×"}</span>
                            {details ? <div className="fitnessHistoryText">{details}</div> : null}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FitnessCategory({ title, category, fitnessWeek, fitnessLoading, onToggleFitness, onEditFitnessDetails }) {
  const list = Array.isArray(fitnessWeek?.[category]) ? fitnessWeek[category] : [];
  const entries = list.map((it, idx) => ({ it, idx }));

  return (
    <section className="fitnessCategory">
      <div className="fitnessCategoryHeader">
        <h3 className="fitnessCategoryTitle">{title}</h3>
      </div>
      <div className="fitnessChecklist" aria-label={`${title} checklist`}>
        {entries.length ? (
          entries.map(({ it, idx }) => {
            const checkboxId = `fit_${category}_${idx}`;
            return (
              <div key={idx} className={`fitnessChecklistItem ${it.checked ? "checked" : ""}`}>
                <input
                  id={checkboxId}
                  className="fitnessChecklistCheckbox"
                  type="checkbox"
                  checked={Boolean(it.checked)}
                  disabled={fitnessLoading}
                  onChange={(e) => onToggleFitness(category, idx, e.target.checked)}
                />
                <label htmlFor={checkboxId} className="fitnessChecklistLabel">
                  {it.item}
                </label>
                {it.checked ? (
                  <AutoGrowTextarea
                    rows={1}
                    className="fitnessChecklistDetails"
                    value={it.details ?? ""}
                    disabled={fitnessLoading}
                    placeholder="Details…"
                    onChange={(e) => onEditFitnessDetails(category, idx, e.target.value)}
                    aria-label={`${it.item} details`}
                  />
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="muted">No items.</p>
        )}
      </div>
    </section>
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
  const categories = getFitnessCategories(fitnessWeek);

  return (
    <div className="mainScroll">
      <section className="card fitnessCard">
        <h2>
          Workouts this week
          {fitnessWeek ? (
            <span className="muted fitnessWeekLabel">
              Sun <code>{fitnessWeek.week_label}</code>
            </span>
          ) : null}
        </h2>

        <blockquote className="fitnessSummary">{fitnessWeek?.summary ? fitnessWeek.summary : "No summary yet."}</blockquote>

        {fitnessWeek ? (
          <>
            {categories.length ? (
              categories.map((category) => (
                <FitnessCategory
                  key={category.key}
                  title={category.label}
                  category={category.key}
                  fitnessWeek={fitnessWeek}
                  fitnessLoading={fitnessLoading}
                  onToggleFitness={onToggleFitness}
                  onEditFitnessDetails={onEditFitnessDetails}
                />
              ))
            ) : (
              <p className="muted">No checklist categories yet.</p>
            )}

            <section className="fitnessHistory">
              <h3>History</h3>
              <div className="fitnessHistoryBody">
                {fitnessHistoryError ? <p className="error">{fitnessHistoryError}</p> : null}
                {fitnessHistoryLoading ? <p className="muted">Loading…</p> : null}
                {!fitnessHistoryLoading ? renderFitnessHistoryTable({ fitnessHistory, fitnessWeek }) : null}
              </div>
            </section>
          </>
        ) : null}
      </section>
    </div>
  );
}
