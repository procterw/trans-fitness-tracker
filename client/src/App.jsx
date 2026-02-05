import React, { useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  getContext,
  getFitnessCurrent,
  getFoodForDate,
  logFoodManual,
  logFoodPhoto,
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
  const [tab, setTab] = useState("photo");

  const [suggestedDate, setSuggestedDate] = useState("");

  // Photo tab state
  const [photoDate, setPhotoDate] = useState("");
  const [photoNotes, setPhotoNotes] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoStatus, setPhotoStatus] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [photoResult, setPhotoResult] = useState(null);
  const [photoLoading, setPhotoLoading] = useState(false);

  // Manual tab state
  const [manualDate, setManualDate] = useState("");
  const [manualNotes, setManualNotes] = useState("");
  const [manualDesc, setManualDesc] = useState("");
  const [manualStatus, setManualStatus] = useState("");
  const [manualError, setManualError] = useState("");
  const [manualResult, setManualResult] = useState(null);
  const [manualLoading, setManualLoading] = useState(false);

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
  const [dashLoading, setDashLoading] = useState(false);

  useEffect(() => {
    getContext()
      .then((json) => {
        const date = json?.suggested_date ?? "";
        setSuggestedDate(date);
        setPhotoDate((prev) => prev || date);
        setManualDate((prev) => prev || date);
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

  useEffect(() => {
    if (tab === "fitness") loadFitness();
    if (tab === "dashboard") loadDashboard(dashDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onSubmitPhoto = async (e) => {
    e.preventDefault();
    setPhotoError("");
    setPhotoStatus("");
    setPhotoResult(null);

    if (!photoFile) {
      setPhotoError("Pick an image first.");
      return;
    }

    setPhotoLoading(true);
    setPhotoStatus("Analyzing…");
    try {
      const json = await logFoodPhoto({ file: photoFile, date: photoDate, notes: photoNotes });
      setPhotoResult(json);
      setPhotoStatus("Done.");
      if (tab === "dashboard" && dashDate) loadDashboard(dashDate);
    } catch (e2) {
      setPhotoError(e2 instanceof Error ? e2.message : String(e2));
      setPhotoStatus("");
    } finally {
      setPhotoLoading(false);
    }
  };

  const onSubmitManual = async (e) => {
    e.preventDefault();
    setManualError("");
    setManualStatus("");
    setManualResult(null);

    if (!manualDesc.trim()) {
      setManualError("Enter a description.");
      return;
    }

    setManualLoading(true);
    setManualStatus("Estimating…");
    try {
      const json = await logFoodManual({ description: manualDesc.trim(), date: manualDate, notes: manualNotes });
      setManualResult(json);
      setManualStatus("Done.");
      if (tab === "dashboard" && dashDate) loadDashboard(dashDate);
    } catch (e2) {
      setManualError(e2 instanceof Error ? e2.message : String(e2));
      setManualStatus("");
    } finally {
      setManualLoading(false);
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
    setDashError("");
    setDashStatus("Rolling up…");
    try {
      await rollupFoodForDate({ date: dashDate, overwrite: true });
      await loadDashboard(dashDate);
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
        <TabButton active={tab === "photo"} onClick={() => setTab("photo")}>
          Photo
        </TabButton>
        <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
          Manual
        </TabButton>
        <TabButton active={tab === "fitness"} onClick={() => setTab("fitness")}>
          Fitness
        </TabButton>
        <TabButton active={tab === "dashboard"} onClick={() => setTab("dashboard")}>
          Dashboard
        </TabButton>
      </nav>

      {tab === "photo" ? (
        <section className="card">
          <h2>Photo meal log</h2>
          <p className="muted">Upload a meal photo to estimate nutrition and log it. (Suggested date: <code>{suggestedDate || "—"}</code>)</p>

          <form onSubmit={onSubmitPhoto}>
            <label>
              Meal photo
              <input
                type="file"
                accept="image/*"
                required
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <div className="row">
              <label>
                Log date
                <input type="date" value={photoDate} onChange={(e) => setPhotoDate(e.target.value)} />
              </label>
              <label>
                Notes (optional)
                <input type="text" value={photoNotes} onChange={(e) => setPhotoNotes(e.target.value)} />
              </label>
            </div>

            <button type="submit" disabled={photoLoading}>
              Analyze &amp; Log
            </button>
            <div className="status">
              {photoError ? <span className="error">{photoError}</span> : photoStatus}
            </div>
          </form>

          {photoResult ? <EstimateResult payload={photoResult} /> : null}
        </section>
      ) : null}

      {tab === "manual" ? (
        <section className="card">
          <h2>Manual meal log</h2>
          <p className="muted">Describe what you ate; the app will estimate nutrients and log an event.</p>

          <form onSubmit={onSubmitManual}>
            <label>
              Meal description
              <textarea
                rows={3}
                required
                value={manualDesc}
                onChange={(e) => setManualDesc(e.target.value)}
                placeholder="e.g., standard smoothie; 2 slices toast with vegan mayo; handful of chips"
              />
            </label>

            <div className="row">
              <label>
                Log date
                <input type="date" value={manualDate} onChange={(e) => setManualDate(e.target.value)} />
              </label>
              <label>
                Notes (optional)
                <input type="text" value={manualNotes} onChange={(e) => setManualNotes(e.target.value)} />
              </label>
            </div>

            <button type="submit" disabled={manualLoading}>
              Estimate &amp; Log
            </button>
            <div className="status">
              {manualError ? <span className="error">{manualError}</span> : manualStatus}
            </div>
          </form>

          {manualResult ? <EstimateResult payload={manualResult} /> : null}
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
              <button type="button" className="secondary" disabled={dashLoading} onClick={onSyncDash}>
                Sync unsynced events
              </button>
              <button type="button" className="danger" disabled={dashLoading} onClick={onRollupDash}>
                Recalculate daily log from events
              </button>
            </div>
          </div>

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
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
