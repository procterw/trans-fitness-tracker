import React from "react";

import NutrientsTable from "../components/NutrientsTable.jsx";

export default function DietView({
  dashHeadingRef,
  dashDate,
  dashLoading,
  dashError,
  dashStatus,
  dashPayload,
  dashFoodLogRows,
  onDashDateChange,
  onRefreshDashboard,
  onRefreshAll,
  onSyncDash,
  onRollupDash,
  onPickDashDateFromAllDays,
  fmt,
}) {
  return (
    <div className="mainScroll">
      <section className="card fitnessCard">
        <h2 ref={dashHeadingRef} tabIndex={-1}>
          Diet
        </h2>
        <div className="row">
          <label>
            Date
            <input type="date" value={dashDate} onChange={(e) => onDashDateChange(e.target.value)} />
          </label>
          <div className="actionsRow">
            <button type="button" className="secondary" disabled={dashLoading} onClick={() => onRefreshDashboard(dashDate)}>
              Refresh
            </button>
            <button type="button" className="secondary" disabled={dashLoading} onClick={onRefreshAll}>
              Refresh all
            </button>
            <button type="button" className="secondary" disabled={dashLoading} onClick={onSyncDash}>
              Sync unsynced events
            </button>
            <button type="button" className="danger" disabled={dashLoading} onClick={onRollupDash}>
              Recalculate daily log from events
            </button>
          </div>
        </div>

        <p className="muted">
          <strong>Sync unsynced events</strong> applies older <code>food_events</code> into <code>food_log</code> if they
          haven&apos;t been applied yet. <strong>Recalculate</strong> overwrites the day&apos;s <code>food_log</code> totals to equal the
          sum of all <code>food_events</code> for that date (keeps notes/status/weight).
        </p>

        <div className="status">{dashError ? <span className="error">{dashError}</span> : dashStatus}</div>

        {dashPayload ? (
          <>
            <h3>Totals (from events)</h3>
            <NutrientsTable nutrients={dashPayload.day_totals_from_events} />

            <h3>Events</h3>
            {dashPayload.events?.length ? (
              <ul>
                {dashPayload.events.map((event, idx) => (
                  <li key={idx}>
                    <strong>{event.description ?? "(no description)"}</strong>
                    {typeof event?.nutrients?.calories === "number" ? <> — {event.nutrients.calories} kcal</> : null}
                    {event.notes ? <div className="muted">Notes: {event.notes}</div> : null}
                    <br />
                    <span className="muted">
                      <code>{event.source}</code> • <code>{event.logged_at}</code>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No food events for this date yet.</p>
            )}

            <h3>Daily log (food_log)</h3>
            {dashPayload.food_log ? (
              <>
                <p className="muted">
                  Status: <code>{dashPayload.food_log.status ?? ""}</code>
                </p>
                <p className="muted">
                  Healthy: <code>{dashPayload.food_log.healthy ?? "⚪"}</code>
                </p>
                <NutrientsTable nutrients={dashPayload.food_log} />
                {dashPayload.food_log.notes ? <p className="muted">{dashPayload.food_log.notes}</p> : null}
              </>
            ) : (
              <p className="muted">No daily log row for this date yet.</p>
            )}

            <h3>All days (food_log)</h3>
            <p className="muted">Pick a date to jump up and view that day&apos;s totals, events, and daily log.</p>
            {dashFoodLogRows?.length ? (
              <div className="tableScroll">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Day</th>
                      <th>Status</th>
                      <th>Healthy</th>
                      <th>Weight</th>
                      <th>Calories</th>
                      <th>Fat</th>
                      <th>Carbs</th>
                      <th>Protein</th>
                      <th>Fiber</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashFoodLogRows.map((row) => (
                      <tr key={row.date} className={row.date === dashDate ? "selectedRow" : ""}>
                        <td>
                          <button
                            type="button"
                            className="linkButton"
                            aria-current={row.date === dashDate ? "date" : undefined}
                            onClick={() => onPickDashDateFromAllDays(row.date)}
                          >
                            {row.date}
                            {row.date === dashDate ? (
                              <span className="muted"> {dashLoading ? "(loading…)" : "(viewing)"}</span>
                            ) : null}
                          </button>
                        </td>
                        <td>{row.day_of_week ?? "—"}</td>
                        <td>{row.status ?? "—"}</td>
                        <td>{row.healthy ?? "⚪"}</td>
                        <td>{fmt(row.weight_lb)}</td>
                        <td>{fmt(row.calories)}</td>
                        <td>{fmt(row.fat_g)}</td>
                        <td>{fmt(row.carbs_g)}</td>
                        <td>{fmt(row.protein_g)}</td>
                        <td>{fmt(row.fiber_g)}</td>
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
          </>
        ) : null}
      </section>
    </div>
  );
}
