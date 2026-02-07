import React from "react";

import TabButton from "../components/TabButton.jsx";

const SIDEBAR_FITNESS_CATEGORIES = [
  { key: "cardio", label: "Cardio" },
  { key: "strength", label: "Strength" },
  { key: "mobility", label: "Mobility" },
  { key: "other", label: "Other" },
];

export default function SidebarView({
  authEnabled,
  authStatus,
  authSession,
  onSignIn,
  onSignOut,
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
  return (
    <aside className="sidebar">
      <div>
        <h2 className="appTitle">🍑 Get fit and hot</h2>
      </div>

      {authEnabled ? (
        <section className="sidebarCard authCard">
          <div className="sidebarSectionHeader">
            <h2 className="sidebarHeading">Account</h2>
          </div>
          {authStatus ? <p className="muted">{authStatus}</p> : null}
          {authSession?.user ? (
            <div className="authMeta">
              <div className="muted">Signed in as</div>
              <div className="authEmail">{authSession.user.email || "Google user"}</div>
              <button type="button" className="secondary" onClick={onSignOut}>
                Sign out
              </button>
            </div>
          ) : (
            <div className="authMeta">
              <p className="muted">Sign in to sync your data.</p>
              <button type="button" onClick={onSignIn}>
                Sign in with Google
              </button>
            </div>
          )}
        </section>
      ) : null}

      <nav className="tabs sidebarTabs" aria-label="Sections">
        <TabButton active={activeView === "chat"} onClick={() => onChangeView("chat")}>
          Chat
        </TabButton>
        <TabButton active={activeView === "workouts"} onClick={() => onChangeView("workouts")}>
          Workouts
        </TabButton>
        <TabButton active={activeView === "diet"} onClick={() => onChangeView("diet")}>
          Diet
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
            {SIDEBAR_FITNESS_CATEGORIES.map(({ key, label }) => {
              const items = Array.isArray(fitnessWeek?.[key]) ? fitnessWeek[key] : [];
              return (
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
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
}
