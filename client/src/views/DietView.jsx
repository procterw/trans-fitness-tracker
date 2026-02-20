import React from "react";

function classifyFoodText(rawText) {
  const text = String(rawText || "").toLowerCase();
  return {
    produce: /\b(salad|veg|vegetable|fruit|berries|greens?|broccoli|spinach|bean|lentil)\b/.test(text),
    carbForward: /\b(rice|oat|oatmeal|bread|pasta|potato|cereal|noodle|tortilla)\b/.test(text),
    proteinForward: /\b(chicken|fish|salmon|tofu|egg|yogurt|turkey|beef|tempeh|shrimp|protein)\b/.test(text),
    fatForward: /\b(avocado|nut|peanut|olive oil|butter|cheese)\b/.test(text),
    treatHeavy: /\b(chocolate|dessert|cookie|cake|ice cream|candy|pastry|soda)\b/.test(text),
    fastFoodLike: /\b(fried|takeout|fast food|burger|fries|pizza)\b/.test(text),
  };
}

function buildTodayNarrative({ day, totals }) {
  const hasAnyTotal =
    typeof totals?.calories === "number" ||
    typeof totals?.fat_g === "number" ||
    typeof totals?.carbs_g === "number" ||
    typeof totals?.protein_g === "number" ||
    typeof totals?.fiber_g === "number";

  if (!day && !hasAnyTotal) {
    return "Quiet start so far. No meals logged yet today. A steady next step is one balanced meal with carbs, fats, and fiber-forward foods.";
  }

  const detailsText = typeof day?.ai_summary === "string" ? day.ai_summary : "";
  const info = classifyFoodText(detailsText);
  const tags = [];
  if (info.produce) tags.push("produce/fiber-forward foods");
  if (info.carbForward) tags.push("carb staples");
  if (info.proteinForward) tags.push("protein-forward choices");
  if (info.fatForward) tags.push("fat-forward foods");
  if (info.treatHeavy) tags.push("some sweets");
  if (info.fastFoodLike) tags.push("some higher-processed items");

  const mixSentence = tags.length
    ? `From notes, today includes ${tags.slice(0, 4).join(", ")}${tags.length > 4 ? ", and more" : ""}.`
    : detailsText.trim()
      ? "Notes are present; food-type mix is still somewhat general."
      : "No detailed food notes yet.";

  const proteinTotal = typeof totals?.protein_g === "number" ? totals.protein_g : null;
  let proteinNote = "Protein is not logged yet.";
  if (proteinTotal !== null) {
    if (proteinTotal >= 110) proteinNote = "Protein looks high for feminization-focused targets.";
    else if (proteinTotal >= 80) proteinNote = "Protein is moderate-high; consider lighter protein later.";
    else if (proteinTotal >= 40) proteinNote = "Protein looks moderate and generally aligned.";
    else proteinNote = "Protein is still light, which can be fine with steady energy intake.";
  }

  const calorieTotal = typeof totals?.calories === "number" ? totals.calories : null;
  const energyNote = calorieTotal === null ? "Calories are not logged yet." : `Energy so far is about ${Math.round(calorieTotal)} kcal.`;

  return `${mixSentence} ${energyNote} ${proteinNote}`;
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
  const dayEatingSummary = buildTodayNarrative({ day: dashDay, totals });

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
          <blockquote className="fitnessSummary dietTodaySummary">{dayEatingSummary}</blockquote>
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
                  <tr>
                    <td className="notesCell" colSpan={6} title={typeof dashDay?.ai_summary === "string" ? dashDay.ai_summary : ""}>
                      {typeof dashDay?.ai_summary === "string" && dashDay.ai_summary.trim()
                        ? dashDay.ai_summary
                        : "No summary logged yet."}
                    </td>
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
                  {historyRows.map((row) => (
                    <tr key={row.date}>
                      <td>{row.date}</td>
                      <td>{fmt(row.calories)}</td>
                      <td>{fmt(row.fat_g)}</td>
                      <td>{fmt(row.carbs_g)}</td>
                      <td>{fmt(row.protein_g)}</td>
                      <td>{fmt(row.fiber_g)}</td>
                      <td>{row.status ?? "incomplete"}</td>
                      <td className="notesCell" title={row.ai_summary ?? ""}>
                        {row.ai_summary ?? ""}
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
      </section>
    </div>
  );
}
