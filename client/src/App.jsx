import React, { useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  askAssistant,
  getContext,
  getFitnessCurrent,
  getFoodForDate,
  getFoodLog,
  logFood,
  rollupFoodForDate,
  syncFoodForDate,
  updateFitnessItem,
  updateFitnessSummary,
} from "./api.js";
import EstimateResult from "./components/EstimateResult.jsx";
import NutrientsTable from "./components/NutrientsTable.jsx";

function useDebouncedCallback(fn, ms) {
  const timeoutRef = useRef(null);
  return useMemo(() => {
    return (...args) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => fn(...args), ms);
    };
  }, [fn, ms]);
}

function TabButton({ active, onClick, children }) {
  return (
    <button type="button" className={`tab ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState("food");

  const [suggestedDate, setSuggestedDate] = useState("");

  // Food tab state (unified: photo + manual)
  const [foodDate, setFoodDate] = useState("");
  const [foodNotes, setFoodNotes] = useState("");
  const [foodDesc, setFoodDesc] = useState("");
  const [foodFile, setFoodFile] = useState(null);
  const [foodStatus, setFoodStatus] = useState("");
  const [foodError, setFoodError] = useState("");
  const [foodResult, setFoodResult] = useState(null);
  const [foodLoading, setFoodLoading] = useState(false);

  // Assistant chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStatus, setChatStatus] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Fitness tab state
  const [fitnessStatus, setFitnessStatus] = useState("");
  const [fitnessError, setFitnessError] = useState("");
  const [fitnessWeek, setFitnessWeek] = useState(null);
  const [fitnessLoading, setFitnessLoading] = useState(false);

  // Dashboard tab state
  const [dashDate, setDashDate] = useState("");
  const [dashStatus, setDashStatus] = useState("");
  const [dashError, setDashError] = useState("");
  const [dashPayload, setDashPayload] = useState(null);
  const [dashFoodLogRows, setDashFoodLogRows] = useState([]);
  const [dashLoading, setDashLoading] = useState(false);

  const fmt = (n) => {
    if (n === null || n === undefined) return "—";
    if (typeof n !== "number") return String(n);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };

  useEffect(() => {
    getContext()
      .then((json) => {
        const date = json?.suggested_date ?? "";
        setSuggestedDate(date);
        setFoodDate((prev) => prev || date);
        setDashDate((prev) => prev || date);
      })
      .catch(() => {});
  }, []);

  const loadFitness = async () => {
    setFitnessLoading(true);
    setFitnessError("");
    setFitnessStatus("Loading…");
    try {
      const json = await getFitnessCurrent();
      setFitnessWeek(json.current_week);
      setFitnessStatus("Loaded.");
    } catch (e) {
      setFitnessError(e instanceof Error ? e.message : String(e));
      setFitnessStatus("");
    } finally {
      setFitnessLoading(false);
    }
  };

  const loadDashboard = async (date) => {
    if (!date) return;
    setDashLoading(true);
    setDashError("");
    setDashStatus("Loading…");
    try {
      const json = await getFoodForDate(date);
      setDashPayload(json);
      setDashStatus("Loaded.");
    } catch (e) {
      setDashError(e instanceof Error ? e.message : String(e));
      setDashStatus("");
    } finally {
      setDashLoading(false);
    }
  };

  const loadDashboardFoodLog = async () => {
    setDashError("");
    try {
      const json = await getFoodLog();
      setDashFoodLogRows(Array.isArray(json.rows) ? json.rows : []);
    } catch (e) {
      setDashError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    if (tab === "fitness") loadFitness();
    if (tab === "dashboard") {
      loadDashboard(dashDate);
      loadDashboardFoodLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "dashboard") return;
    if (!dashDate) return;
    loadDashboard(dashDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashDate, tab]);

  const onSubmitFood = async (e) => {
    e.preventDefault();
    setFoodError("");
    setFoodStatus("");
    setFoodResult(null);

    if (!foodFile && !foodDesc.trim()) {
      setFoodError("Add a photo or type a description.");
      return;
    }

    setFoodLoading(true);
    setFoodStatus(foodFile ? "Analyzing… " : "Estimating… ");
    try {
      const json = await logFood({
        file: foodFile,
        description: foodDesc.trim(),
        date: foodDate,
        notes: foodNotes,
      });
      setFoodResult(json);
      setFoodStatus("Logged.");
      if (json?.date) setDashDate(json.date);
    } catch (e2) {
      setFoodError(e2 instanceof Error ? e2.message : String(e2));
      setFoodStatus("");
    } finally {
      setFoodLoading(false);
    }
  };

  const onAsk = async (questionText) => {
    const q = questionText.trim();
    if (!q) return;

    setChatError("");
    setChatStatus("Thinking…");
    setChatLoading(true);

    const previous = chatMessages;
    const nextLocal = [...previous, { role: "user", content: q }];
    setChatMessages(nextLocal);
    setChatInput("");

    try {
      const json = await askAssistant({ question: q, date: foodDate, messages: previous });
      setChatMessages([...nextLocal, { role: "assistant", content: json.answer ?? "" }]);
      setChatStatus("Done.");
    } catch (e) {
      setChatError(e instanceof Error ? e.message : String(e));
      setChatStatus("");
    } finally {
      setChatLoading(false);
    }
  };

  const debouncedSaveFitnessItem = useDebouncedCallback(async ({ category, index, checked, details }) => {
    setFitnessError("");
    setFitnessStatus("Saving…");
    try {
      const json = await updateFitnessItem({ category, index, checked, details });
      setFitnessWeek(json.current_week);
      setFitnessStatus("Saved.");
    } catch (e) {
      setFitnessError(e instanceof Error ? e.message : String(e));
      setFitnessStatus("");
    }
  }, 450);

  const onToggleFitness = (category, index, checked) => {
    setFitnessWeek((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next[category][index].checked = checked;
      debouncedSaveFitnessItem({
        category,
        index,
        checked,
        details: next[category][index].details ?? "",
      });
      return next;
    });
  };

  const onEditFitnessDetails = (category, index, details) => {
    setFitnessWeek((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next[category][index].details = details;
      debouncedSaveFitnessItem({
        category,
        index,
        checked: Boolean(next[category][index].checked),
        details,
      });
      return next;
    });
  };

  const onSaveFitnessSummary = async () => {
    setFitnessError("");
    setFitnessStatus("Saving…");
    try {
      const json = await updateFitnessSummary(fitnessWeek?.summary ?? "");
      setFitnessWeek(json.current_week);
      setFitnessStatus("Saved.");
    } catch (e) {
      setFitnessError(e instanceof Error ? e.message : String(e));
      setFitnessStatus("");
    }
  };

  const onRollupDash = async () => {
    if (!dashDate) return;
    const ok = window.confirm(
      `Recalculate food_log for ${dashDate} from food_events?\n\nThis overwrites the daily totals with the sum of all events for that day. (Notes/status/weight are preserved.)`,
    );
    if (!ok) return;
    setDashError("");
    setDashStatus("Rolling up…");
    try {
      await rollupFoodForDate({ date: dashDate, overwrite: true });
      await loadDashboard(dashDate);
      await loadDashboardFoodLog();
      setDashStatus("Recalculated from events.");
    } catch (e) {
      setDashError(e instanceof Error ? e.message : String(e));
      setDashStatus("");
    }
  };

  const onSyncDash = async () => {
    if (!dashDate) return;
    setDashError("");
    setDashStatus("Syncing…");
    try {
      const result = await syncFoodForDate({ date: dashDate, onlyUnsynced: true });
      await loadDashboard(dashDate);
      await loadDashboardFoodLog();
      setDashStatus(result.synced_count ? `Synced ${result.synced_count} event(s).` : "No unsynced events.");
    } catch (e) {
      setDashError(e instanceof Error ? e.message : String(e));
      setDashStatus("");
    }
  };

  const renderFitnessCategory = (title, category) => {
    const list = fitnessWeek?.[category] ?? [];
    return (
      <div key={category}>
        <h3>{title}</h3>
        <table>
          <thead>
            <tr>
              <th>Done</th>
              <th>Item</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {list.length ? (
              list.map((it, idx) => (
                <tr key={idx}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(it.checked)}
                      onChange={(e) => onToggleFitness(category, idx, e.target.checked)}
                    />
                  </td>
                  <td>{it.item}</td>
                  <td>
                    <input
                      type="text"
                      value={it.details ?? ""}
                      placeholder="Details…"
                      onChange={(e) => onEditFitnessDetails(category, idx, e.target.value)}
                    />
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={3} className="muted">
                  No items.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <main className="container">
      <h1>Health &amp; Fitness Tracker</h1>
      <p className="muted">Log meals and fitness to <code>tracking-data.json</code>.</p>

      <nav className="tabs" aria-label="Sections">
        <TabButton active={tab === "food"} onClick={() => setTab("food")}>
          Food
        </TabButton>
        <TabButton active={tab === "fitness"} onClick={() => setTab("fitness")}>
          Fitness
        </TabButton>
        <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
          Dashboard
        </TabButton>
      </nav>

      {tab === "food" ? (
        <section className="card">
          <h2>Food (photo + manual)</h2>
          <p className="muted">
            Upload a meal photo and/or describe what you ate. (Suggested date: <code>{suggestedDate || "—"}</code>)
          </p>

          <form onSubmit={onSubmitFood}>
            <label>
              Meal photo (optional)
              <input type="file" accept="image/*" onChange={(e) => setFoodFile(e.target.files?.[0] ?? null)} />
            </label>

            <label>
              Meal description (optional if photo is provided)
              <textarea
                rows={3}
                value={foodDesc}
                onChange={(e) => setFoodDesc(e.target.value)}
                placeholder="e.g., standard smoothie; 2 slices toast with vegan mayo; handful of chips"
              />
            </label>

            <div className="row">
              <label>
                Log date
                <input type="date" value={foodDate} onChange={(e) => setFoodDate(e.target.value)} />
              </label>
              <label>
                Notes (optional)
                <input type="text" value={foodNotes} onChange={(e) => setFoodNotes(e.target.value)} />
              </label>
            </div>

            <div className="buttonRow">
              <button type="submit" disabled={foodLoading}>
                Estimate &amp; Log
              </button>
              {foodResult?.date ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setDashDate(foodResult.date);
                    setTab("dashboard");
                  }}
                >
                  View in dashboard
                </button>
              ) : null}
            </div>
            <div className="status">{foodError ? <span className="error">{foodError}</span> : foodStatus}</div>
          </form>

          {foodResult ? <EstimateResult payload={foodResult} onAsk={onAsk} /> : null}

          <hr className="divider" />

          <h3>Ask a question</h3>
          <p className="muted">
            Uses your tracker context (selected date: <code>{foodDate || "—"}</code>).
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              onAsk(chatInput);
            }}
          >
            <div className="chatBox">
              <div className="chatMessages" aria-label="Conversation">
                {chatMessages.length ? (
                  chatMessages.map((m, idx) => (
                    <div key={idx} className={`chatMsg ${m.role === "assistant" ? "assistant" : "user"}`}>
                      <div className="chatRole">{m.role === "assistant" ? "Assistant" : "You"}</div>
                      <div className="chatContent">{m.content}</div>
                    </div>
                  ))
                ) : (
                  <div className="muted">No questions yet.</div>
                )}
              </div>

              <div className="chatInputRow">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask about trends, today's plan, macros, training load, etc…"
                />
                <button type="submit" disabled={chatLoading}>
                  Ask
                </button>
              </div>
            </div>

            <div className="status">{chatError ? <span className="error">{chatError}</span> : chatStatus}</div>
          </form>
        </section>
      ) : null}

      {tab === "fitness" ? (
        <section className="card">
          <h2>Fitness (current week)</h2>

          <div className="status">
            {fitnessError ? <span className="error">{fitnessError}</span> : fitnessStatus}
          </div>

          {fitnessWeek ? (
            <>
              <p className="muted">
                Week: <code>{fitnessWeek.week_label}</code> • Starts: <code>{fitnessWeek.week_start}</code>
              </p>

              {renderFitnessCategory("Cardio", "cardio")}
              {renderFitnessCategory("Strength", "strength")}
              {renderFitnessCategory("Mobility", "mobility")}
              {renderFitnessCategory("Other", "other")}

              <h3>Summary</h3>
              <textarea
                rows={3}
                value={fitnessWeek.summary ?? ""}
                onChange={(e) => setFitnessWeek((prev) => ({ ...prev, summary: e.target.value }))}
                placeholder="Weekly summary…"
              />
              <button type="button" className="secondary" disabled={fitnessLoading} onClick={onSaveFitnessSummary}>
                Save summary
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === "dashboard" ? (
        <section className="card">
          <h2>Dashboard</h2>
          <div className="row">
            <label>
              Date
              <input type="date" value={dashDate} onChange={(e) => setDashDate(e.target.value)} />
            </label>
            <div className="actionsRow">
              <button type="button" className="secondary" disabled={dashLoading} onClick={() => loadDashboard(dashDate)}>
                Refresh
              </button>
              <button
                type="button"
                className="secondary"
                disabled={dashLoading}
                onClick={() => {
                  loadDashboard(dashDate);
                  loadDashboardFoodLog();
                }}
              >
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
            haven&apos;t been applied yet. <strong>Recalculate</strong> overwrites the day&apos;s <code>food_log</code>{" "}
            totals to equal the sum of all <code>food_events</code> for that date (keeps notes/status/weight).
          </p>

          <div className="status">{dashError ? <span className="error">{dashError}</span> : dashStatus}</div>

          {dashPayload ? (
            <>
              <h3>Totals (from events)</h3>
              <NutrientsTable nutrients={dashPayload.day_totals_from_events} />

              <h3>Events</h3>
              {dashPayload.events?.length ? (
                <ul>
                  {dashPayload.events.map((e, idx) => (
                    <li key={idx}>
                      <strong>{e.description ?? "(no description)"}</strong>
                      {typeof e?.nutrients?.calories === "number" ? <> — {e.nutrients.calories} kcal</> : null}
                      {e.input_text ? (
                        <div className="muted">
                          Input: <code>{e.input_text}</code>
                        </div>
                      ) : null}
                      {e.notes ? <div className="muted">Notes: {e.notes}</div> : null}
                      <br />
                      <span className="muted">
                        <code>{e.source}</code> • <code>{e.logged_at}</code>
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
                  <NutrientsTable nutrients={dashPayload.food_log} />
                  {dashPayload.food_log.notes ? <p className="muted">{dashPayload.food_log.notes}</p> : null}
                </>
              ) : (
                <p className="muted">No daily log row for this date yet.</p>
              )}

              <h3>All days (food_log)</h3>
              {dashFoodLogRows?.length ? (
                <div className="tableScroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Day</th>
                        <th>Status</th>
                        <th>Weight</th>
                        <th>Calories</th>
                        <th>Fat</th>
                        <th>Carbs</th>
                        <th>Protein</th>
                        <th>Fiber</th>
                        <th>Potassium</th>
                        <th>Magnesium</th>
                        <th>Omega‑3</th>
                        <th>Calcium</th>
                        <th>Iron</th>
                        <th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashFoodLogRows.map((row) => (
                        <tr key={row.date}>
                          <td>
                            <button
                              type="button"
                              className="linkButton"
                              onClick={() => {
                                setDashDate(row.date);
                                loadDashboard(row.date);
                              }}
                            >
                              {row.date}
                            </button>
                          </td>
                          <td>{row.day_of_week ?? "—"}</td>
                          <td>{row.status ?? "—"}</td>
                          <td>{fmt(row.weight_lb)}</td>
                          <td>{fmt(row.calories)}</td>
                          <td>{fmt(row.fat_g)}</td>
                          <td>{fmt(row.carbs_g)}</td>
                          <td>{fmt(row.protein_g)}</td>
                          <td>{fmt(row.fiber_g)}</td>
                          <td>{fmt(row.potassium_mg)}</td>
                          <td>{fmt(row.magnesium_mg)}</td>
                          <td>{fmt(row.omega3_mg)}</td>
                          <td>{fmt(row.calcium_mg)}</td>
                          <td>{fmt(row.iron_mg)}</td>
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
      ) : null}
    </main>
  );
}
