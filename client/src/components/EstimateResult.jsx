import React from "react";
import NutrientsTable from "./NutrientsTable.jsx";

function escapeText(value) {
  return typeof value === "string" ? value : "";
}

export default function EstimateResult({ payload, onAsk }) {
  if (!payload) return null;
  const { estimate, day_totals: dayTotals, event, day } = payload;

  return (
    <div>
      <h2>Logged</h2>
      <p className="muted">
        Event: <code>{escapeText(event?.id)}</code> • Date: <code>{escapeText(event?.date)}</code> • Source:{" "}
        <code>{escapeText(event?.source)}</code>
      </p>
      {event?.notes ? <p className="muted">Notes: {escapeText(event.notes)}</p> : null}

      <h3>Estimate: {escapeText(estimate?.meal_title)}</h3>
      <p className="muted">
        Confidence: {(estimate?.confidence?.overall ?? 0).toFixed(2)} — {escapeText(estimate?.confidence?.notes)}
      </p>

      <h3>Meal totals</h3>
      <NutrientsTable nutrients={estimate?.totals} />

      {estimate?.items?.length ? (
        <>
          <h3>Items</h3>
          <ul>
            {estimate.items.map((it, idx) => (
              <li key={idx}>
                <strong>{escapeText(it?.name)}</strong> — {escapeText(it?.portion)}
                {it?.notes ? <div className="muted">{escapeText(it.notes)}</div> : null}
                <NutrientsTable nutrients={it?.nutrients} />
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Running totals for {escapeText(event?.date)}</h3>
      <NutrientsTable nutrients={dayTotals} />

      {day ? (
        <>
          <h3>Daily row</h3>
          <p className="muted">
            Status: <code>{escapeText(day.status || "incomplete")}</code>
          </p>
          <NutrientsTable nutrients={day} />
          {day.ai_summary ? <p className="muted">{escapeText(day.ai_summary)}</p> : null}
        </>
      ) : null}

      {estimate?.warnings?.length ? (
        <>
          <h3>Warnings</h3>
          <ul>
            {estimate.warnings.map((w, idx) => (
              <li key={idx}>{escapeText(w)}</li>
            ))}
          </ul>
        </>
      ) : null}

      {estimate?.followup_questions?.length ? (
        <>
          <h3>Follow‑ups</h3>
          <ul>
            {estimate.followup_questions.map((q, idx) => (
              <li key={idx}>
                {escapeText(q)}{" "}
                {typeof onAsk === "function" ? (
                  <button type="button" className="secondary small" onClick={() => onAsk(String(q))}>
                    Ask
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
