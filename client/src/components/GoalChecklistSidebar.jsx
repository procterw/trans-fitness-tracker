import React from "react";

function asGoalList(value) {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
    : [];
}

function buildOverallGoalSummary({ dietGoals, fitnessGoals, healthGoals }) {
  const hasDiet = dietGoals.length > 0;
  const hasFitness = fitnessGoals.length > 0;
  const hasHealth = healthGoals.length > 0;
  const coveredAreas = [hasDiet, hasFitness, hasHealth].filter(Boolean).length;

  if (!coveredAreas) return "No goals set yet. Add goals to guide weekly planning.";
  if (coveredAreas === 3) return "Balanced focus across nutrition, training, and overall health.";
  if (hasDiet && hasFitness) return "Combined focus on nutrition and training consistency.";
  if (hasFitness && hasHealth) return "Training-led plan with supporting health priorities.";
  if (hasDiet && hasHealth) return "Nutrition-led plan with broader health support.";
  if (hasFitness) return "Primary focus on workout consistency and activity progression.";
  if (hasDiet) return "Primary focus on nutrition consistency and daily habits.";
  return "Primary focus on health-supportive routines and consistency.";
}

export default function GoalChecklistSidebar({ className = "", goalSummary = null, checklistCategories = [] }) {
  const dietGoals = asGoalList(goalSummary?.diet_goals);
  const fitnessGoals = asGoalList(goalSummary?.fitness_goals);
  const healthGoals = asGoalList(goalSummary?.health_goals);
  const rootClassName = `workflowSidebar settingsGoalChecklistSidebar ${className}`.trim();
  const overallGoalSummary = buildOverallGoalSummary({ dietGoals, fitnessGoals, healthGoals });

  return (
    <aside className={rootClassName} aria-label="Goals and weekly checklist">
      <h3 className="sidebarHeading">Goals</h3>
      <p className="workflowSidebarSummary">{overallGoalSummary}</p>

      <div className="workflowSidebarGoalBlock">
        <h4 className="workflowSidebarSubheading">Diet goals</h4>
        {dietGoals.length ? (
          <ul className="workflowSidebarList">
            {dietGoals.map((goal, idx) => (
              <li key={`diet_${idx}`} className="workflowSidebarListItem">
                {goal}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No diet goals yet.</p>
        )}
      </div>

      <div className="workflowSidebarGoalBlock">
        <h4 className="workflowSidebarSubheading">Fitness goals</h4>
        {fitnessGoals.length ? (
          <ul className="workflowSidebarList">
            {fitnessGoals.map((goal, idx) => (
              <li key={`fitness_${idx}`} className="workflowSidebarListItem">
                {goal}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No fitness goals yet.</p>
        )}
      </div>

      <h3 className="sidebarHeading">Weekly checklist</h3>
      {Array.isArray(checklistCategories) && checklistCategories.length ? (
        <div className="sidebarChecklist">
          {checklistCategories.map((category) => {
            const key = typeof category?.key === "string" ? category.key : "";
            const label = typeof category?.label === "string" && category.label.trim() ? category.label.trim() : key || "Category";
            const items = Array.isArray(category?.items) ? category.items : [];
            return (
              <div key={key || label} className="sidebarChecklistGroup">
                <h4 className="sidebarSectionLabel">{label}</h4>
                <div className="sidebarChecklistItems">
                  {items.length ? (
                    items.map((it, idx) => {
                      const itemLabel = typeof it?.item === "string" ? it.item : "";
                      if (!itemLabel) return null;
                      const itemDescription = typeof it?.description === "string" ? it.description.trim() : "";
                      return (
                        <div key={idx} className="sidebarChecklistItem">
                          <span className="sidebarChecklistText">
                            <span>{itemLabel}</span>
                            {itemDescription ? <span className="sidebarChecklistDescription">{itemDescription}</span> : null}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="sidebarChecklistItem muted">No items.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted">No checklist categories yet.</p>
      )}
    </aside>
  );
}
