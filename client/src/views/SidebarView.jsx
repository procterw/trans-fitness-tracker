import React from "react";

import TabButton from "../components/TabButton.jsx";
import { getFitnessCategories } from "../fitnessChecklist.js";

export default function SidebarView({
  activeView,
  onChangeView,
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
  const fitnessCategories = getFitnessCategories(fitnessWeek);

  return (
    <aside id="app-sidebar-nav" className="sidebar">
      <nav className="sidebarTabs" aria-label="Sections">
        <TabButton active={activeView === "chat"} onClick={() => onChangeView("chat")}>
          <span className="tabIcon" aria-hidden="true">
            💬
          </span>
          <span>Chat</span>
        </TabButton>
        <TabButton active={activeView === "workouts"} onClick={() => onChangeView("workouts")}>
          <span className="tabIcon" aria-hidden="true">
            ⚖️
          </span>
          <span>Workouts</span>
        </TabButton>
        <TabButton active={activeView === "diet"} onClick={() => onChangeView("diet")}>
          <span className="tabIcon" aria-hidden="true">
            🍎
          </span>
          <span>Diet</span>
        </TabButton>
        <TabButton active={activeView === "settings"} onClick={() => onChangeView("settings")}>
          <span className="tabIcon" aria-hidden="true">
            ⚙️
          </span>
          <span>Settings</span>
        </TabButton>
      </nav>

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
              <span className="sidebarListLabel">Meals</span>
              <span>{sidebarDayMealsSummary}</span>
            </li>
            <li className="sidebarListItem">
              <span className="sidebarListLabel">Totals</span>
              <span>
                {fmt(sidebarCalories)} kcal • P {fmt(sidebarProtein)} g • C {fmt(sidebarCarbs)} g • F {fmt(sidebarFat)} g
              </span>
            </li>
            <li className="sidebarListItem">
              <span className="sidebarListLabel">Quality</span>
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
            {fitnessCategories.length ? (
              fitnessCategories.map(({ key, label, items }) => (
                <div key={key} className="sidebarChecklistGroup">
                  <h3 className="sidebarChecklistHeader">{label}</h3>
                  <div className="sidebarChecklistItems">
                    {items.length ? (
                      items.map((it, idx) => (
                        <div key={idx} className={`sidebarChecklistItem ${it.checked ? "done" : "todo"}`}>
                          <span className={`sidebarChecklistMark ${it.checked ? "checked" : "unchecked"}`} aria-hidden="true">
                            {it.checked ? "✓" : ""}
                          </span>
                          <span>{it.item}</span>
                        </div>
                      ))
                    ) : (
                      <div className="sidebarChecklistItem muted">No items.</div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="sidebarChecklistItem muted">No checklist categories yet.</div>
            )}
          </div>
        )}
      </section>
    </aside>
  );
}
