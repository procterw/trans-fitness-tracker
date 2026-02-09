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

function buildTodayNarrative({ recentEvents, dayTotals }) {
  if (!recentEvents.length) {
    return "Quiet start so far. No meals logged yet today. A steady next step is one balanced meal with carbs, fats, and fiber-forward foods.";
  }

  let produceCount = 0;
  let carbCount = 0;
  let proteinCount = 0;
  let fatCount = 0;
  let treatCount = 0;
  let fastFoodCount = 0;

  for (const event of recentEvents) {
    const info = classifyFoodText(event?.description);
    if (info.produce) produceCount += 1;
    if (info.carbForward) carbCount += 1;
    if (info.proteinForward) proteinCount += 1;
    if (info.fatForward) fatCount += 1;
    if (info.treatHeavy) treatCount += 1;
    if (info.fastFoodLike) fastFoodCount += 1;
  }

  const mixParts = [];
  if (produceCount) mixParts.push("produce/fiber-forward foods");
  if (carbCount) mixParts.push("carb staples");
  if (proteinCount) mixParts.push("protein-forward meals");
  if (fatCount) mixParts.push("fat-forward foods");
  if (treatCount) mixParts.push("some sweets");
  if (fastFoodCount) mixParts.push("some higher-processed items");

  const mixSentence = mixParts.length
    ? `Today includes ${mixParts.slice(0, 4).join(", ")}${mixParts.length > 4 ? ", and more" : ""}.`
    : "Today looks mixed, with meal details still fairly general.";

  const proteinTotal = dayTotals.protein_g;
  let proteinNote = "Protein looks moderate and generally aligned with your stated goals.";
  if (dayTotals.counts.protein_g > 0) {
    if (proteinTotal >= 110) proteinNote = "Protein looks high for your feminization-focused targets.";
    else if (proteinTotal >= 80) proteinNote = "Protein is moderate-high, so keep later meals less protein-heavy.";
    else if (proteinTotal < 35) proteinNote = "Protein is still light, which is generally fine if energy intake stays steady.";
  }

  let qualityNote = "Overall quality looks balanced so far.";
  if (!produceCount && (treatCount || fastFoodCount)) {
    qualityNote = "Quality is a bit snack/processed-leaning so far.";
  } else if (!produceCount) {
    qualityNote = "Quality is okay so far, but fiber-forward foods are still missing.";
  } else if (produceCount >= 2 && !fastFoodCount) {
    qualityNote = "Quality looks solid and whole-food leaning so far.";
  }

  const suggestions = [];
  if (!produceCount) suggestions.push("add a vegetable or fruit-forward side");
  if (!fatCount) suggestions.push("include an energy-dense fat source (avocado, nuts, olive oil)");
  if (proteinTotal >= 80) suggestions.push("favor carbs + fats later instead of another protein-heavy meal");
  if (treatCount >= 2 || fastFoodCount >= 2) suggestions.push("balance with a simpler whole-food meal later");
  if (!suggestions.length) suggestions.push("keep the same pattern with one steady, satisfying meal later");

  const progressSentence = `Progress is steady: you have ${recentEvents.length} logged ${
    recentEvents.length === 1 ? "meal" : "meals"
  } so far.`;
  const suggestionSentence = `For the rest of today, ${suggestions.slice(0, 2).join(" and ")}.`;

  return `${progressSentence} ${mixSentence} ${qualityNote} ${proteinNote} ${suggestionSentence}`;
}

export default function DietView({
  dashError,
  dashRecentEvents,
  dashRecentEventsLoading,
  dashRecentEventsError,
  dashFoodLogRows,
  fmt,
}) {
  const recentEvents = Array.isArray(dashRecentEvents) ? dashRecentEvents : [];
  const historyRows = Array.isArray(dashFoodLogRows) ? dashFoodLogRows : [];
  const dayTotals = recentEvents.reduce(
    (acc, event) => {
      const nutrients = event?.nutrients ?? {};
      const keys = ["calories", "fat_g", "carbs_g", "protein_g", "fiber_g"];
      for (const key of keys) {
        const value = nutrients[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          acc[key] += value;
          acc.counts[key] += 1;
        }
      }
      return acc;
    },
    {
      calories: 0,
      fat_g: 0,
      carbs_g: 0,
      protein_g: 0,
      fiber_g: 0,
      counts: {
        calories: 0,
        fat_g: 0,
        carbs_g: 0,
        protein_g: 0,
        fiber_g: 0,
      },
    },
  );
  const showTotal = (key) => (dayTotals.counts[key] > 0 ? fmt(dayTotals[key]) : "—");
  const dayEatingSummary = buildTodayNarrative({ recentEvents, dayTotals });

  return (
    <div className="mainScroll">
      <section className="card fitnessCard dietCard">
        <h2>Diet</h2>

        {dashError ? (
          <div className="status dietErrorStatus">
            <span className="error">{dashError}</span>
          </div>
        ) : null}

        <section className="dietRecentSection">
          <h3>Today</h3>
          <blockquote className="fitnessSummary dietTodaySummary">{dayEatingSummary}</blockquote>
          {dashRecentEventsError ? <p className="error">{dashRecentEventsError}</p> : null}
          {dashRecentEventsLoading ? <p className="muted">Loading…</p> : null}
          {!dashRecentEventsLoading ? (
            !dashRecentEventsError ? (
              <div className="tableScroll">
                <table className="dietRecentTable">
                  <thead>
                    <tr>
                      <th>Food</th>
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
                      <td>{showTotal("calories")}</td>
                      <td>{showTotal("fat_g")}</td>
                      <td>{showTotal("carbs_g")}</td>
                      <td>{showTotal("protein_g")}</td>
                      <td>{showTotal("fiber_g")}</td>
                    </tr>
                    {recentEvents.map((event) => (
                      <tr key={event.key}>
                        <td>{event.description ?? "(no description)"}</td>
                        <td>{fmt(event?.nutrients?.calories)}</td>
                        <td>{fmt(event?.nutrients?.fat_g)}</td>
                        <td>{fmt(event?.nutrients?.carbs_g)}</td>
                        <td>{fmt(event?.nutrients?.protein_g)}</td>
                        <td>{fmt(event?.nutrients?.fiber_g)}</td>
                      </tr>
                    ))}
                    {!recentEvents.length ? (
                      <tr>
                        <td colSpan={6} className="muted">
                          No food entries today.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            ) : null
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
      </section>
    </div>
  );
}
