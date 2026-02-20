import React from "react";

function buildShortDetails(value, maxLength = 48) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function groupWorkoutsByCategory(workouts) {
  const groups = [];
  const byCategory = new Map();
  for (const workout of Array.isArray(workouts) ? workouts : []) {
    const categoryRaw = typeof workout?.category === "string" ? workout.category.trim() : "";
    const category = categoryRaw || "Uncategorized";
    if (!byCategory.has(category)) {
      const group = { category, items: [] };
      byCategory.set(category, group);
      groups.push(group);
    }
    byCategory.get(category).items.push(workout);
  }
  return groups;
}

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
  const workoutGroups = groupWorkoutsByCategory(workouts);

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
                {workoutGroups.map((group) => (
                  <div key={group.category} className="sidebarChecklistCategoryGroup">
                    <h4 className="sidebarSectionLabel">{group.category}</h4>
                    <div className="sidebarChecklistItems">
                      {group.items.map((workout, idx) => {
                        const itemLabel = typeof workout?.name === "string" ? workout.name : "";
                        const itemDetails = buildShortDetails(workout?.details);
                        const completed = workout?.completed === true;
                        return (
                          <div key={`${group.category}_${itemLabel || "workout"}_${idx}`} className={`sidebarChecklistItem ${completed ? "done" : "todo"}`}>
                            <span className={`sidebarChecklistMark ${completed ? "checked" : "unchecked"}`} aria-hidden="true">
                              {completed ? "✓" : ""}
                            </span>
                            <span className="sidebarChecklistText">
                              <span>{itemLabel}</span>
                              {itemDetails ? <span className="sidebarChecklistDetails">{itemDetails}</span> : null}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
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
