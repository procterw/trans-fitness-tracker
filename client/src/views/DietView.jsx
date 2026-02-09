import React from "react";

export default function DietView({
  dashError,
  dashRecentEvents,
  dashRecentEventsLoading,
  dashRecentEventsError,
  dashFoodLogRows,
  dietWeeklySummary,
  fmt,
}) {
  const recentEvents = Array.isArray(dashRecentEvents) ? dashRecentEvents : [];
  const historyRows = Array.isArray(dashFoodLogRows) ? dashFoodLogRows : [];
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;

  return (
    <div className="mainScroll">
      <section className="card fitnessCard">
        <h2>Diet</h2>

        {dashError ? <div className="status"><span className="error">{dashError}</span></div> : null}

        <h3>Weekly summary</h3>
        <blockquote className="fitnessSummary">{dietWeeklySummary || "No weekly summary yet."}</blockquote>

        <h3>Last three days</h3>
        {dashRecentEventsError ? <p className="error">{dashRecentEventsError}</p> : null}
        {dashRecentEventsLoading ? <p className="muted">Loading…</p> : null}
        {!dashRecentEventsLoading ? (
          recentEvents.length ? (
            <div className="tableScroll">
              <table className="dietRecentTable">
                <thead>
                  <tr>
                    <th>Food</th>
                    <th>Date</th>
                    <th>Calories</th>
                    <th>Fat (g)</th>
                    <th>Carbs (g)</th>
                    <th>Protein (g)</th>
                    <th>Fiber (g)</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((event) => (
                    <tr
                      key={event.key}
                      className={`dietDayBand ${event?.date === todayIso ? "dietDayToday" : "dietDayOther"}`}
                    >
                      <td>{event.description ?? "(no description)"}</td>
                      <td>{event.date ?? "—"}</td>
                      <td>{fmt(event?.nutrients?.calories)}</td>
                      <td>{fmt(event?.nutrients?.fat_g)}</td>
                      <td>{fmt(event?.nutrients?.carbs_g)}</td>
                      <td>{fmt(event?.nutrients?.protein_g)}</td>
                      <td>{fmt(event?.nutrients?.fiber_g)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No food entries in the last three days.</p>
          )
        ) : null}

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
                  <th>On track</th>
                  <th>Healthy</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row) => (
                  <tr key={row.date}>
                    <td>{row.date}</td>
                    <td>{fmt(row.calories)}</td>
                    <td>{fmt(row.fat_g)}</td>
                    <td>{fmt(row.carbs_g)}</td>
                    <td>{fmt(row.protein_g)}</td>
                    <td>{fmt(row.fiber_g)}</td>
                    <td>{row.status ?? "—"}</td>
                    <td>{row.healthy ?? "⚪"}</td>
                    <td className="notesCell" title={row.notes ?? ""}>
                      {row.notes ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No daily log rows found.</p>
        )}
      </section>
    </div>
  );
}
