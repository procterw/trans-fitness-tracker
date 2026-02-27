import React from "react";

import { formatFoodEntries, getFoodEntriesFromDay } from "../utils/foodSummary.js";

function getTodayFoodEntries(day) {
  return getFoodEntriesFromDay(day, {
    fallbackSummary: typeof day?.ai_summary === "string" ? day.ai_summary : typeof day?.details === "string" ? day.details : "",
  });
}

export default function DietView({
  dashError,
  dashLoading,
  dashDay,
  dashDayTotals,
  dashFoodLogRows,
  fmt,
}) {
  const historyRows = Array.isArray(dashFoodLogRows) ? dashFoodLogRows : [];

  const totals = {
    calories: typeof dashDayTotals?.calories === "number" ? dashDayTotals.calories : null,
    fat_g: typeof dashDayTotals?.fat_g === "number" ? dashDayTotals.fat_g : null,
    carbs_g: typeof dashDayTotals?.carbs_g === "number" ? dashDayTotals.carbs_g : null,
    protein_g: typeof dashDayTotals?.protein_g === "number" ? dashDayTotals.protein_g : null,
    fiber_g: typeof dashDayTotals?.fiber_g === "number" ? dashDayTotals.fiber_g : null,
  };

  const dayFoodEntries = getTodayFoodEntries(dashDay);
  const dayFoodsText = formatFoodEntries(dayFoodEntries);

  return (
    <div className="mainScroll foodLogView">
      <section className="card fitnessCard dietCard">
        <h2>Food log</h2>

        {dashError ? (
          <div className="status dietErrorStatus">
            <span className="error">{dashError}</span>
          </div>
        ) : null}

        <section className="dietRecentSection">
          <h3>Today</h3>
          <blockquote className="fitnessSummary dietTodaySummary">
            {dayFoodsText || "No foods logged yet."}
          </blockquote>
          {dashLoading ? <p className="muted">Loading…</p> : null}

          {!dashLoading ? (
            <div className="tableScroll">
              <table className="dietRecentTable">
                <thead>
                  <tr>
                    <th>Entry</th>
                    <th>Calories</th>
                    <th>Fat (g)</th>
                    <th>Carbs (g)</th>
                    <th>Protein (g)</th>
                    <th>Fiber (g)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="dietTotalsRow">
                    <td>Day total</td>
                    <td>{fmt(totals.calories)}</td>
                    <td>{fmt(totals.fat_g)}</td>
                    <td>{fmt(totals.carbs_g)}</td>
                    <td>{fmt(totals.protein_g)}</td>
                    <td>{fmt(totals.fiber_g)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section className="dietHistorySection">
          <h3>Full history</h3>
          {historyRows.length ? (
            <div className="tableScroll">
              <table className="dietHistoryTable">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Calories</th>
                    <th>Fat</th>
                    <th>Carbs</th>
                    <th>Protein</th>
                    <th>Fiber</th>
                    <th>Status</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map((row) => {
                    const rowFoodEntries = getFoodEntriesFromDay(row, {
                      fallbackSummary: typeof row?.ai_summary === "string" ? row.ai_summary : "",
                    });
                    const rowFoodsText = formatFoodEntries(rowFoodEntries);

                    return (
                      <tr key={row.date}>
                        <td>{row.date}</td>
                        <td>{fmt(row.calories)}</td>
                        <td>{fmt(row.fat_g)}</td>
                        <td>{fmt(row.carbs_g)}</td>
                        <td>{fmt(row.protein_g)}</td>
                        <td>{fmt(row.fiber_g)}</td>
                        <td>{row.status ?? "incomplete"}</td>
                        <td className="notesCell" title={rowFoodsText}>
                          <div>{rowFoodsText || "No foods logged yet."}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No daily log rows found.</p>
          )}
        </section>
      </section>
    </div>
  );
}
