import React from "react";

export default function SidebarView({
  foodDate,
  suggestedDate,
  sidebarDayError,
  sidebarDayStatus,
  sidebarDayMealsSummary,
  sidebarCalories,
  sidebarProtein,
  sidebarCarbs,
  sidebarFat,
  sidebarQualitySummary,
  fitnessWeek,
  fmt,
}) {
  const workouts = Array.isArray(fitnessWeek?.workouts) ? fitnessWeek.workouts : [];

  return (
    <aside id="app-sidebar-nav" className="sidebar">
      <section className="sidebarCard">
        <div className="sidebarSectionHeader">
          <h2 className="sidebarHeading">Day so far</h2>
          <span className="sidebarDate">{foodDate || suggestedDate || "—"}</span>
        </div>

        {sidebarDayError ? <p className="error">{sidebarDayError}</p> : null}
        {!sidebarDayError && sidebarDayStatus ? <p className="muted">{sidebarDayStatus}</p> : null}

        {!sidebarDayStatus && !sidebarDayError ? (
          <ul className="sidebarList">
            <li className="sidebarListItem">
              <span className="sidebarSectionLabel">Meals</span>
              <span>{sidebarDayMealsSummary}</span>
            </li>
            <li className="sidebarListItem">
              <span className="sidebarSectionLabel">Totals</span>
              <span>
                {fmt(sidebarCalories)} kcal • P {fmt(sidebarProtein)} g • C {fmt(sidebarCarbs)} g • F {fmt(sidebarFat)} g
              </span>
            </li>
            <li className="sidebarListItem">
              <span className="sidebarSectionLabel">Quality</span>
              <span>{sidebarQualitySummary}</span>
            </li>
          </ul>
        ) : null}
      </section>

      <section className="sidebarCard">
        <div className="sidebarSectionHeader">
          <h2 className="sidebarHeading">Weekly activity</h2>
          {fitnessWeek?.week_label ? <span className="sidebarDate">{fitnessWeek.week_label}</span> : null}
        </div>

        {!fitnessWeek ? (
          <p className="muted">Loading week…</p>
        ) : (
          <div className="sidebarChecklist">
            {workouts.length ? (
              <div className="sidebarChecklistGroup">
                <h3 className="sidebarSectionLabel">{fitnessWeek?.block_name || "Current block"}</h3>
                <div className="sidebarChecklistItems">
                  {workouts.map((workout, idx) => {
                    const itemLabel = typeof workout?.name === "string" ? workout.name : "";
                    const itemDescription = typeof workout?.description === "string" ? workout.description.trim() : "";
                    const itemCategory = typeof workout?.category === "string" ? workout.category.trim() : "";
                    const completed = workout?.completed === true;
                    return (
                      <div key={`${itemLabel || "workout"}_${idx}`} className={`sidebarChecklistItem ${completed ? "done" : "todo"}`}>
                        <span className={`sidebarChecklistMark ${completed ? "checked" : "unchecked"}`} aria-hidden="true">
                          {completed ? "✓" : ""}
                        </span>
                        <span className="sidebarChecklistText">
                          <span>{itemLabel}</span>
                          {itemDescription ? <span className="sidebarChecklistDescription">{itemDescription}</span> : null}
                          {itemCategory ? <span className="sidebarChecklistDescription">{itemCategory}</span> : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="sidebarChecklistItem muted">No workouts yet.</div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
