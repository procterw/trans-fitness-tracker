import React, { useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  askAssistant,
  getContext,
  getFitnessCurrent,
  getFitnessHistory,
  getFoodForDate,
  getFoodLog,
  logFood,
  rollupFoodForDate,
  syncFoodForDate,
  updateFitnessItem,
  updateFitnessSummary,
} from "./api.js";
import EstimateResult from "./components/EstimateResult.jsx";
import MarkdownContent from "./components/MarkdownContent.jsx";
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

function useDebouncedKeyedCallback(fn, ms) {
  const fnRef = useRef(fn);
  const timeoutMapRef = useRef(new Map());

  useEffect(() => {
    fnRef.current = fn;
  }, [fn]);

  useEffect(() => {
    return () => {
      for (const t of timeoutMapRef.current.values()) clearTimeout(t);
      timeoutMapRef.current.clear();
    };
  }, []);

  return useMemo(() => {
    return (key, ...args) => {
      const map = timeoutMapRef.current;
      const prev = map.get(key);
      if (prev) clearTimeout(prev);
      map.set(
        key,
        setTimeout(() => {
          map.delete(key);
          fnRef.current(...args);
        }, ms),
      );
    };
  }, [ms]);
}

function useSerialQueue() {
  const chainRef = useRef(Promise.resolve());
  return useMemo(() => {
    return (fn) => {
      const next = chainRef.current.catch(() => {}).then(fn);
      chainRef.current = next;
      return next;
    };
  }, []);
}

function TabButton({ active, onClick, children }) {
  return (
    <button type="button" className={`tab ${active ? "active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function AutoGrowTextarea({ value, onChange, className = "", maxHeight = 220, ...props }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
  }, [value, maxHeight]);

  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={className}
      {...props}
    />
  );
}

export default function App() {
  const [tab, setTab] = useState("food");

  const [suggestedDate, setSuggestedDate] = useState("");
  const foodFormRef = useRef(null);
  const foodFileInputRef = useRef(null);

  // Food tab state (unified: photo + manual)
  const [foodDate, setFoodDate] = useState("");
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
  const [fitnessShowRemainingOnly, setFitnessShowRemainingOnly] = useState(false);
  const [fitnessHistory, setFitnessHistory] = useState([]);
  const [fitnessHistoryError, setFitnessHistoryError] = useState("");
  const [fitnessHistoryLoading, setFitnessHistoryLoading] = useState(false);

  // Dashboard tab state
  const [dashDate, setDashDate] = useState("");
  const [dashStatus, setDashStatus] = useState("");
  const [dashError, setDashError] = useState("");
  const [dashPayload, setDashPayload] = useState(null);
  const [dashFoodLogRows, setDashFoodLogRows] = useState([]);
  const [dashLoading, setDashLoading] = useState(false);
  const dashHeadingRef = useRef(null);
  const dashSkipNextAutoLoadRef = useRef(false);
  const dashLoadSeqRef = useRef(0);

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

  const loadFitnessHistory = async () => {
    setFitnessHistoryLoading(true);
    setFitnessHistoryError("");
    try {
      const json = await getFitnessHistory({ limit: 8 });
      setFitnessHistory(Array.isArray(json.weeks) ? json.weeks : []);
    } catch (e) {
      setFitnessHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setFitnessHistoryLoading(false);
    }
  };

  const loadDashboard = async (date) => {
    if (!date) return;
    const seq = ++dashLoadSeqRef.current;
    setDashLoading(true);
    setDashError("");
    setDashStatus("Loading…");
    try {
      const json = await getFoodForDate(date);
      if (seq !== dashLoadSeqRef.current) return;
      setDashPayload(json);
      setDashStatus("Loaded.");
    } catch (e) {
      if (seq !== dashLoadSeqRef.current) return;
      setDashError(e instanceof Error ? e.message : String(e));
      setDashStatus("");
    } finally {
      if (seq === dashLoadSeqRef.current) setDashLoading(false);
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
    if (tab === "fitness") {
      loadFitness();
      loadFitnessHistory();
    }
    if (tab === "dashboard") {
      loadDashboardFoodLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (tab !== "dashboard") return;
    if (!dashDate) return;
    if (dashSkipNextAutoLoadRef.current) {
      dashSkipNextAutoLoadRef.current = false;
      return;
    }
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
      });
      setFoodResult(json);
      setFoodStatus("");
      if (json?.date) setDashDate(json.date);
    } catch (e2) {
      setFoodError(e2 instanceof Error ? e2.message : String(e2));
      setFoodStatus("");
    } finally {
      setFoodLoading(false);
    }
  };

  const onPickFoodFile = (file) => {
    setFoodFile(file ?? null);
  };

  const clearFoodFile = () => {
    setFoodFile(null);
    const input = foodFileInputRef.current;
    if (input) input.value = "";
  };

  const autosizeComposerTextarea = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
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

  const enqueueFitnessSave = useSerialQueue();

  const saveFitnessItem = ({ category, index, checked, details }) => {
    setFitnessError("");
    setFitnessStatus("Saving…");
    enqueueFitnessSave(async () => {
      const json = await updateFitnessItem({ category, index, checked, details });
      setFitnessWeek(json.current_week);
      setFitnessStatus("Saved.");
    }).catch((e) => {
      setFitnessError(e instanceof Error ? e.message : String(e));
      setFitnessStatus("");
    });
  };

  const debouncedSaveFitnessItem = useDebouncedKeyedCallback(saveFitnessItem, 450);

  const saveFitnessSummary = (summaryText) => {
    setFitnessError("");
    setFitnessStatus("Saving…");
    enqueueFitnessSave(async () => {
      const json = await updateFitnessSummary(summaryText ?? "");
      setFitnessWeek(json.current_week);
      setFitnessStatus("Saved.");
    }).catch((e) => {
      setFitnessError(e instanceof Error ? e.message : String(e));
      setFitnessStatus("");
    });
  };

  const debouncedSaveFitnessSummary = useDebouncedCallback(saveFitnessSummary, 650);

  const onToggleFitness = (category, index, checked) => {
    setFitnessWeek((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next[category][index].checked = checked;
      debouncedSaveFitnessItem(`${category}:${index}`, {
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
      debouncedSaveFitnessItem(`${category}:${index}`, {
        category,
        index,
        checked: Boolean(next[category][index].checked),
        details,
      });
      return next;
    });
  };

  const onSaveFitnessSummary = () => {
    saveFitnessSummary(fitnessWeek?.summary ?? "");
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

  const focusDashboardHeading = () => {
    const el = dashHeadingRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus();
    }
  };

  const onPickDashDateFromAllDays = (date) => {
    if (!date) return;
    dashSkipNextAutoLoadRef.current = true;
    setDashDate(date);
    loadDashboard(date);
    focusDashboardHeading();
  };

  const countDone = (items) => (Array.isArray(items) ? items.filter((it) => Boolean(it?.checked)).length : 0);
  const countTotal = (items) => (Array.isArray(items) ? items.length : 0);


  const renderFitnessCategory = (title, category) => {
    const list = Array.isArray(fitnessWeek?.[category]) ? fitnessWeek[category] : [];
    const done = countDone(list);
    const total = countTotal(list);
    const pct = total ? Math.round((done / total) * 100) : 0;
    const entries = list
      .map((it, idx) => ({ it, idx }))
      .filter(({ it }) => (!fitnessShowRemainingOnly ? true : !it.checked));

    return (
      <section key={category} className="fitnessCategory">
        <div className="fitnessCategoryHeader">
          <h3 className="fitnessCategoryTitle">{title}</h3>
          <div className="fitnessCategoryMeta">
            <span className="pill">
              {done}/{total}
            </span>
            <span className="muted">{pct}%</span>
          </div>
        </div>
        <div className="fitnessChecklist" aria-label={`${title} checklist`}>
          {entries.length ? (
            entries.map(({ it, idx }) => {
              const checkboxId = `fit_${category}_${idx}`;
              return (
                <div key={idx} className={`fitnessChecklistItem ${it.checked ? "checked" : ""}`}>
                  <input
                    id={checkboxId}
                    className="fitnessChecklistCheckbox"
                    type="checkbox"
                    checked={Boolean(it.checked)}
                    disabled={fitnessLoading}
                    onChange={(e) => onToggleFitness(category, idx, e.target.checked)}
                  />
                  <label htmlFor={checkboxId} className="fitnessChecklistLabel">
                    {it.item}
                  </label>
                  <AutoGrowTextarea
                    rows={1}
                    className="fitnessChecklistDetails"
                    value={it.details ?? ""}
                    disabled={fitnessLoading}
                    placeholder="Details…"
                    onChange={(e) => onEditFitnessDetails(category, idx, e.target.value)}
                    aria-label={`${it.item} details`}
                  />
                </div>
              );
            })
          ) : (
            <p className="muted">{fitnessShowRemainingOnly ? "No remaining items." : "No items."}</p>
          )}
        </div>
      </section>
    );
  };

  const totalFitnessDone =
    countDone(fitnessWeek?.cardio) +
    countDone(fitnessWeek?.strength) +
    countDone(fitnessWeek?.mobility) +
    countDone(fitnessWeek?.other);
  const totalFitnessItems =
    countTotal(fitnessWeek?.cardio) +
    countTotal(fitnessWeek?.strength) +
    countTotal(fitnessWeek?.mobility) +
    countTotal(fitnessWeek?.other);
  const totalFitnessPct = totalFitnessItems ? Math.round((totalFitnessDone / totalFitnessItems) * 100) : 0;

  const historyColumns = (() => {
    const template = fitnessWeek;
    if (!template) return [];
    const cols = [];
    const cats = [
      ["cardio", "Cardio"],
      ["strength", "Strength"],
      ["mobility", "Mobility"],
      ["other", "Other"],
    ];
    for (const [catKey, catLabel] of cats) {
      const items = Array.isArray(template[catKey]) ? template[catKey] : [];
      for (let i = 0; i < items.length; i++) {
        cols.push({
          key: `${catKey}:${i}`,
          category: catKey,
          index: i,
          label: items[i]?.item ? String(items[i].item) : `${catLabel} ${i + 1}`,
        });
      }
    }
    return cols;
  })();

  const renderFitnessHistoryTable = () => {
    const weeks = Array.isArray(fitnessHistory) ? [...fitnessHistory].reverse() : [];
    if (!weeks.length) return <p className="muted">No past weeks yet.</p>;

    return (
      <div className="tableScroll fitnessHistoryTableScroll" role="region" aria-label="Fitness history table">
        <table className="fitnessHistoryTable">
          <thead>
            <tr>
              <th className="fitnessHistoryWeekCol">Week</th>
              {historyColumns.map((c) => (
                <th key={c.key} title={c.label}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, idx) => {
              const done =
                countDone(week?.cardio) + countDone(week?.strength) + countDone(week?.mobility) + countDone(week?.other);
              const total =
                countTotal(week?.cardio) +
                countTotal(week?.strength) +
                countTotal(week?.mobility) +
                countTotal(week?.other);
              const pct = total ? Math.round((done / total) * 100) : 0;
              const key = week?.week_start ?? `week_${idx}`;

              return (
                <tr key={key}>
                  <td className="fitnessHistoryWeekCell">
                    <div className="fitnessHistoryWeekTitle">{week?.week_label ?? "—"}</div>
                    <div className="fitnessHistoryWeekMeta muted">
                      <code>{week?.week_start ?? "—"}</code> • {done}/{total} • {pct}%
                    </div>
                    {week?.summary ? (
                      <div className="fitnessHistoryWeekSummaryText muted" title={week.summary}>
                        {week.summary}
                      </div>
                    ) : null}
                  </td>
                  {historyColumns.map((c) => {
                    const list = Array.isArray(week?.[c.category]) ? week[c.category] : [];
                    const it = list[c.index];
                    const checked = Boolean(it?.checked);
                    const details = (it?.details ?? "").trim();
                    return (
                      <td key={c.key} className={`fitnessHistoryCell ${checked ? "checked" : "unchecked"}`}>
                        <div className="fitnessHistoryCellInner">
                          <span className={`fitnessHistoryMark ${checked ? "ok" : "error"}`}>
                            {checked ? "✓" : "×"}
                          </span>
                          {details ? <div className="fitnessHistoryText">{details}</div> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
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

          <form ref={foodFormRef} onSubmit={onSubmitFood} className="foodComposerForm">
            <input
              ref={foodFileInputRef}
              type="file"
              accept="image/*"
              className="hidden composerFileInput"
              hidden
              onChange={(e) => onPickFoodFile(e.target.files?.[0] ?? null)}
            />

            <div className="composerBar" aria-label="Meal log input">
              <button
                type="button"
                className="iconButton"
                aria-label={foodFile ? "Change photo" : "Add photo"}
                onClick={() => foodFileInputRef.current?.click()}
                disabled={foodLoading}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 5v14M5 12h14"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              <textarea
                rows={1}
                className="composerInput"
                value={foodDesc}
                onChange={(e) => setFoodDesc(e.target.value)}
                onInput={(e) => autosizeComposerTextarea(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!foodLoading) foodFormRef.current?.requestSubmit();
                  }
                }}
                placeholder="Add your workout or describe what you ate"
                aria-label="Meal description"
              />

              <button type="submit" className="sendButton" disabled={foodLoading} aria-label="Estimate and log">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M3 11.2L21 3l-8.2 18-2.2-6.2L3 11.2z"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>

            <div className="composerMetaRow">
              <div className="composerMetaLeft">
                {foodFile ? (
                  <span className="filePill" title={foodFile.name}>
                    <span className="filePillLabel">Photo:</span> {foodFile.name}
                    <button
                      type="button"
                      className="filePillRemove"
                      aria-label="Remove photo"
                      onClick={clearFoodFile}
                      disabled={foodLoading}
                    >
                      ×
                    </button>
                  </span>
                ) : null}
              </div>

              <div className="composerMetaRight">
                <label className="metaLabel">
                  Date
                  <input
                    type="date"
                    className="datePillInput"
                    value={foodDate}
                    onChange={(e) => setFoodDate(e.target.value)}
                    disabled={foodLoading}
                  />
                </label>
              </div>
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
                      <div className={`chatContent ${m.role === "assistant" ? "markdown" : "plain"}`}>
                        {m.role === "assistant" ? <MarkdownContent content={m.content} /> : m.content}
                      </div>
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
          <h2>Fitness</h2>

          <div className="status">
            {fitnessError ? <span className="error">{fitnessError}</span> : fitnessStatus}
          </div>

          {fitnessWeek ? (
            <>
              <div className="fitnessTop">
                <div className="fitnessTopRow">
                  <div>
                    <div className="muted">
                      Current week: <code>{fitnessWeek.week_label}</code> • Starts: <code>{fitnessWeek.week_start}</code>
                    </div>
                    <div className="pillRow">
                      <span className="pill">
                        Overall: {totalFitnessDone}/{totalFitnessItems}
                      </span>
                      <span className="pill subtle">{totalFitnessPct}%</span>
                    </div>
                  </div>

                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={fitnessShowRemainingOnly}
                      disabled={fitnessLoading}
                      onChange={(e) => setFitnessShowRemainingOnly(e.target.checked)}
                    />
                    Show remaining only
                  </label>
                </div>

                <div className="progressBar" role="img" aria-label="Overall weekly progress">
                  <div className="progressBarFill" style={{ width: `${totalFitnessPct}%` }} />
                </div>
              </div>

              {renderFitnessCategory("Cardio", "cardio")}
              {renderFitnessCategory("Strength", "strength")}
              {renderFitnessCategory("Mobility", "mobility")}
              {renderFitnessCategory("Other", "other")}

              <h3>Summary</h3>
              <textarea
                rows={3}
                value={fitnessWeek.summary ?? ""}
                disabled={fitnessLoading}
                onChange={(e) => {
                  const v = e.target.value;
                  setFitnessWeek((prev) => (prev ? { ...prev, summary: v } : prev));
                  debouncedSaveFitnessSummary(v);
                }}
                placeholder="Weekly summary…"
              />
              <div className="buttonRow">
                <button type="button" className="secondary" disabled={fitnessLoading} onClick={onSaveFitnessSummary}>
                Save summary
                </button>
              </div>

              <details className="fitnessHistory">
                <summary>History</summary>
                <div className="fitnessHistoryBody">
                  {fitnessHistoryError ? <p className="error">{fitnessHistoryError}</p> : null}
                  {fitnessHistoryLoading ? <p className="muted">Loading…</p> : null}
                  {!fitnessHistoryLoading ? renderFitnessHistoryTable() : null}
                  {!fitnessHistoryLoading && fitnessHistory?.length ? <p className="muted">Most recent week first.</p> : null}
                </div>
              </details>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === "dashboard" ? (
        <section className="card">
          <h2 ref={dashHeadingRef} tabIndex={-1}>
            Dashboard
          </h2>
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
              <p className="muted">Pick a date to jump up and view that day&apos;s totals, events, and daily log.</p>
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
                        <tr key={row.date} className={row.date === dashDate ? "selectedRow" : ""}>
                          <td>
                            <button
                              type="button"
                              className="linkButton"
                              aria-current={row.date === dashDate ? "date" : undefined}
                              onClick={() => onPickDashDateFromAllDays(row.date)}
                            >
                              {row.date}
                              {row.date === dashDate ? (
                                <span className="muted">
                                  {" "}
                                  {dashLoading ? "(loading…)" : "(viewing)"}
                                </span>
                              ) : null}
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
