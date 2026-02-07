import React, { useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  getContext,
  getFitnessCurrent,
  getFitnessHistory,
  getFoodForDate,
  getFoodLog,
  ingestAssistant,
  rollupFoodForDate,
  syncFoodForDate,
  updateFitnessItem,
  updateFitnessSummary,
} from "./api.js";
import EstimateResult from "./components/EstimateResult.jsx";
import MarkdownContent from "./components/MarkdownContent.jsx";
import NutrientsTable from "./components/NutrientsTable.jsx";
import {
  getSession,
  isSupabaseEnabled,
  onAuthStateChange,
  signInWithGoogle,
  signOut,
} from "./supabaseClient.js";

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
  const composerInputRef = useRef(null);
  const chatMessagesRef = useRef(null);

  // Food tab state (unified: photo + manual)
  const [foodDate, setFoodDate] = useState("");
  const [composerInput, setComposerInput] = useState("");
  const [foodFile, setFoodFile] = useState(null);
  const [composerStatus, setComposerStatus] = useState("");
  const [composerError, setComposerError] = useState("");
  const [foodResult, setFoodResult] = useState(null);
  const [composerLoading, setComposerLoading] = useState(false);
  const [composerMessages, setComposerMessages] = useState([]);
  const [sidebarDaySummary, setSidebarDaySummary] = useState(null);
  const [sidebarDayStatus, setSidebarDayStatus] = useState("");
  const [sidebarDayError, setSidebarDayError] = useState("");
  const sidebarDaySeqRef = useRef(0);

  // Fitness tab state
  const [fitnessStatus, setFitnessStatus] = useState("");
  const [fitnessError, setFitnessError] = useState("");
  const [fitnessWeek, setFitnessWeek] = useState(null);
  const [fitnessLoading, setFitnessLoading] = useState(false);
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
  const [authEnabled] = useState(isSupabaseEnabled());
  const [authSession, setAuthSession] = useState(null);
  const [authStatus, setAuthStatus] = useState("");

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

  useEffect(() => {
    if (!authEnabled) return;
    let mounted = true;
    setAuthStatus("Checking session…");
    getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setAuthSession(data?.session ?? null);
        setAuthStatus("");
      })
      .catch(() => {
        if (!mounted) return;
        setAuthStatus("Could not load session.");
      });

    const { data } = onAuthStateChange((_event, session) => {
      setAuthSession(session ?? null);
    });

    return () => {
      mounted = false;
      data?.subscription?.unsubscribe?.();
    };
  }, [authEnabled]);

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
    loadFitness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSidebarDaySummary = async (date) => {
    if (!date) return;
    const seq = ++sidebarDaySeqRef.current;
    setSidebarDayError("");
    setSidebarDayStatus("Loading…");
    try {
      const json = await getFoodForDate(date);
      if (seq !== sidebarDaySeqRef.current) return;
      setSidebarDaySummary({
        date,
        totals: json?.day_totals_from_events ?? null,
        events: Array.isArray(json?.events) ? json.events : [],
        eventsCount: Array.isArray(json?.events) ? json.events.length : 0,
      });
      setSidebarDayStatus("");
    } catch (e) {
      if (seq !== sidebarDaySeqRef.current) return;
      setSidebarDayError(e instanceof Error ? e.message : String(e));
      setSidebarDayStatus("");
    }
  };

  useEffect(() => {
    if (!foodDate) return;
    loadSidebarDaySummary(foodDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodDate]);

  useEffect(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [composerMessages, composerLoading, foodResult]);

  useEffect(() => {
    if (composerLoading) return;
    composerInputRef.current?.focus();
  }, [composerLoading]);

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
    if (composerLoading) return;
    const inputEl = composerInputRef.current;
    const wasFocused = document.activeElement === inputEl;
    setComposerError("");
    setComposerStatus("");

    const messageText = composerInput.trim();
    if (!foodFile && !messageText) {
      setComposerError("Type a message or add a photo.");
      return;
    }

    setComposerLoading(true);
    setComposerStatus("Thinking…");
    const previous = composerMessages;
    const userMessage = {
      role: "user",
      content: messageText || (foodFile ? "📷 Photo attached." : ""),
    };
    setComposerMessages((prev) => [...prev, userMessage]);
    setComposerInput("");
    requestAnimationFrame(() => autosizeComposerTextarea(composerInputRef.current));
    requestAnimationFrame(() => composerInputRef.current?.focus());
    if (wasFocused) setTimeout(() => inputEl?.focus(), 0);
    try {
      const json = await ingestAssistant({
        message: messageText,
        file: foodFile,
        date: foodDate,
        messages: previous,
      });
      if (json?.food_result) {
        setFoodResult(json.food_result);
        if (json.food_result?.date) setDashDate(json.food_result.date);
      }
      const assistantMessages = [];
      if (json?.assistant_message) assistantMessages.push({ role: "assistant", content: json.assistant_message });
      if (json?.followup_question) assistantMessages.push({ role: "assistant", content: json.followup_question });
      if (assistantMessages.length) {
        setComposerMessages((prev) => [...prev, ...assistantMessages]);
      }
      setComposerStatus("");
      clearFoodFile();
      const summaryDate = json?.food_result?.date || foodDate;
      if (summaryDate) loadSidebarDaySummary(summaryDate);
    } catch (e2) {
      setComposerError(e2 instanceof Error ? e2.message : String(e2));
      setComposerStatus("");
    } finally {
      setComposerLoading(false);
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

  const onToggleFitness = (category, index, checked) => {
    setFitnessWeek((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      next[category][index].checked = checked;
      if (!checked) next[category][index].details = "";
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

  const renderFitnessCategory = (title, category) => {
    const list = Array.isArray(fitnessWeek?.[category]) ? fitnessWeek[category] : [];
    const entries = list.map((it, idx) => ({ it, idx }));

    return (
      <section key={category} className="fitnessCategory">
        <div className="fitnessCategoryHeader">
          <h3 className="fitnessCategoryTitle">{title}</h3>
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
                  {it.checked ? (
                    <AutoGrowTextarea
                      rows={1}
                      className="fitnessChecklistDetails"
                      value={it.details ?? ""}
                      disabled={fitnessLoading}
                      placeholder="Details…"
                      onChange={(e) => onEditFitnessDetails(category, idx, e.target.value)}
                      aria-label={`${it.item} details`}
                    />
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="muted">No items.</p>
          )}
        </div>
      </section>
    );
  };

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

  const sidebarFitnessCategories = [
    { key: "cardio", label: "Cardio" },
    { key: "strength", label: "Strength" },
    { key: "mobility", label: "Mobility" },
    { key: "other", label: "Other" },
  ];

  const localDateString = (date) => {
    const d = date instanceof Date ? date : new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  const sidebarDayEvents = Array.isArray(sidebarDaySummary?.events) ? sidebarDaySummary.events : [];
  const sidebarDayEventNames = sidebarDayEvents
    .map((event) => (event?.description ? String(event.description) : "Meal"))
    .filter(Boolean);
  const sidebarDayMealsSummary = sidebarDayEventNames.length
    ? `${sidebarDayEventNames.slice(0, 3).join(", ")}${sidebarDayEventNames.length > 3 ? ` +${sidebarDayEventNames.length - 3} more` : ""}`
    : "No meals logged yet.";

  const sidebarTotals = sidebarDaySummary?.totals ?? {};
  const sidebarCalories = typeof sidebarTotals.calories === "number" ? sidebarTotals.calories : null;
  const sidebarProtein = typeof sidebarTotals.protein_g === "number" ? sidebarTotals.protein_g : null;
  const sidebarCarbs = typeof sidebarTotals.carbs_g === "number" ? sidebarTotals.carbs_g : null;
  const sidebarFat = typeof sidebarTotals.fat_g === "number" ? sidebarTotals.fat_g : null;

  const now = new Date();
  const isToday = sidebarDaySummary?.date === localDateString(now);
  const hourNow = now.getHours();
  const dayPart = hourNow < 11 ? "morning" : hourNow < 17 ? "afternoon" : "evening";
  const timeLabel = isToday ? dayPart : "day";

  let calorieNote = "No calorie data yet.";
  if (sidebarCalories !== null) {
    const target = isToday ? (dayPart === "morning" ? 450 : dayPart === "afternoon" ? 1000 : 1600) : 1600;
    if (sidebarCalories < target * 0.6) calorieNote = `Light for this ${timeLabel}.`;
    else if (sidebarCalories > target * 1.6) calorieNote = `Heavy for this ${timeLabel}.`;
    else calorieNote = `On track for this ${timeLabel}.`;
  }

  let proteinNote = "Protein data missing.";
  if (sidebarProtein !== null) {
    if (sidebarProtein >= 110) proteinNote = "Protein high vs feminization goals.";
    else if (sidebarProtein >= 80) proteinNote = "Protein moderate-high.";
    else if (sidebarProtein >= 40) proteinNote = "Protein moderate (aligned).";
    else proteinNote = "Protein low (aligned).";
  }

  const sidebarQualitySummary = `${calorieNote} ${proteinNote}`.trim();

  const renderFitnessHistoryTable = () => {
    const weeks = Array.isArray(fitnessHistory) ? [...fitnessHistory].reverse() : [];
    if (!weeks.length) return <p className="muted">No past weeks yet.</p>;
    const template = fitnessWeek ?? weeks[0] ?? {};
    const categories = [
      ["cardio", "Cardio"],
      ["strength", "Strength"],
      ["mobility", "Mobility"],
      ["other", "Other"],
    ];

    return (
      <div className="tableScroll fitnessHistoryTableScroll" role="region" aria-label="Fitness history table">
        <table className="fitnessHistoryTable">
          <thead>
            <tr>
              <th className="fitnessHistoryWeekCol">Activity</th>
              {weeks.map((week, idx) => (
                <th key={week?.week_start ?? `week_${idx}`} className="fitnessHistoryWeekHeader">
                  <div className="fitnessHistoryWeekTitle">{week?.week_label ?? "—"}</div>
                  <div className="fitnessHistoryWeekMeta muted">
                    <code>{week?.week_start ?? "—"}</code>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map(([catKey, catLabel]) => {
              const items = Array.isArray(template?.[catKey]) ? template[catKey] : [];
              if (!items.length) return null;
              return (
                <React.Fragment key={catKey}>
                  <tr className="fitnessHistoryCategoryRow">
                    <td className="fitnessHistoryCategoryCell" colSpan={weeks.length + 1}>
                      {catLabel}
                    </td>
                  </tr>
                  {items.map((item, itemIdx) => (
                    <tr key={`${catKey}_${itemIdx}`}>
                      <td className="fitnessHistoryActivityCell">{item?.item ?? `${catLabel} ${itemIdx + 1}`}</td>
                      {weeks.map((week, weekIdx) => {
                        const list = Array.isArray(week?.[catKey]) ? week[catKey] : [];
                        const it = list[itemIdx];
                        const checked = Boolean(it?.checked);
                        const details = checked ? (it?.details ?? "").trim() : "";
                        return (
                          <td
                            key={`${week?.week_start ?? weekIdx}_${catKey}_${itemIdx}`}
                            className={`fitnessHistoryCell ${checked ? "checked" : "unchecked"}`}
                            title={details || undefined}
                          >
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
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div>
          <h1 className="appTitle">Health &amp; Fitness Tracker</h1>
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
                <button type="button" className="secondary" onClick={() => signOut()}>
                  Sign out
                </button>
              </div>
            ) : (
              <div className="authMeta">
                <p className="muted">Sign in to sync your data.</p>
                <button type="button" onClick={() => signInWithGoogle()}>
                  Sign in with Google
                </button>
              </div>
            )}
          </section>
        ) : null}

        <nav className="tabs sidebarTabs" aria-label="Sections">
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
            <>
              <div className="sidebarChecklist">
                {sidebarFitnessCategories.map(({ key, label }) => {
                  const items = Array.isArray(fitnessWeek?.[key]) ? fitnessWeek[key] : [];
                  return (
                    <div key={key} className="sidebarChecklistGroup">
                      <div className="sidebarChecklistHeader">
                        <span>{label}</span>
                      </div>
                      <div className="sidebarChecklistItems">
                        {items.length ? (
                          items.map((it, idx) => (
                            <div key={idx} className={`sidebarChecklistItem ${it.checked ? "done" : "todo"}`}>
                              <span className="sidebarChecklistEmoji" aria-hidden="true">
                                {it.checked ? "✅" : "⬜️"}
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
            </>
          )}
        </section>
      </aside>

      <main className="mainColumn">
        {tab === "food" ? (
          <section className="chatPanel">
            <div className="chatBox chatBoxFull">
              <div ref={chatMessagesRef} className="chatMessages" aria-label="Conversation">
                {composerMessages.length ? (
                  composerMessages.map((m, idx) => (
                    <div key={idx} className={`chatMsg ${m.role === "assistant" ? "assistant" : "user"}`}>
                      <div className="chatRole">{m.role === "assistant" ? "Assistant" : "You"}</div>
                      <div className={`chatContent ${m.role === "assistant" ? "markdown" : "plain"}`}>
                        {m.role === "assistant" ? <MarkdownContent content={m.content} /> : m.content}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="muted">No messages yet.</div>
                )}

                {composerLoading && !composerError ? (
                  <div className="chatMsg assistant thinking">
                    <div className="chatContent plain">Thinking…</div>
                  </div>
                ) : null}

                {foodResult ? (
                  <div className="chatInlineCard">
                    <EstimateResult payload={foodResult} />
                  </div>
                ) : null}
              </div>

              <form ref={foodFormRef} onSubmit={onSubmitFood} className="foodComposerForm chatComposer">
                <input
                  ref={foodFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden composerFileInput"
                  hidden
                  onChange={(e) => onPickFoodFile(e.target.files?.[0] ?? null)}
                />

                <div className="composerBar" aria-label="Unified input">
                  <button
                    type="button"
                    className="iconButton"
                    aria-label={foodFile ? "Change photo" : "Add photo"}
                    onClick={() => foodFileInputRef.current?.click()}
                  >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2.1l1.1-1.2c.4-.5 1-.8 1.7-.8h1.2c.7 0 1.3.3 1.7.8L15.4 5h2.1A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9z"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9 12.2l2.1 2.1 4.2-4.2"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <input
                  type="date"
                  className="datePillInput composerDateInput"
                  value={foodDate}
                  onChange={(e) => setFoodDate(e.target.value)}
                  aria-label="Log date"
                />

                <textarea
                  ref={composerInputRef}
                  rows={1}
                  className="composerInput"
                  value={composerInput}
                  onChange={(e) => setComposerInput(e.target.value)}
                  onInput={(e) => autosizeComposerTextarea(e.currentTarget)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    if (composerLoading) {
                      e.preventDefault();
                      return;
                    }
                    e.preventDefault();
                    foodFormRef.current?.requestSubmit();
                  }}
                  placeholder="Ask a question or log food/activity… (Shift+Enter for newline)"
                  aria-label="Unified input"
                />

                  <button
                    type="submit"
                    className="sendButton"
                    disabled={composerLoading}
                    aria-label="Send"
                    onMouseDown={(e) => e.preventDefault()}
                  >
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
                          disabled={composerLoading}
                        >
                          ×
                        </button>
                      </span>
                    ) : null}
                  </div>

                  <div className="composerMetaRight" />
                </div>

                {composerError ? (
                  <div className="status composerStatus">
                    <span className="error">{composerError}</span>
                  </div>
                ) : null}
              </form>
            </div>
          </section>
        ) : null}

        {tab === "fitness" ? (
          <div className="mainScroll">
            <section className="card fitnessCard">
              <h2>
                Workouts this week
                {fitnessWeek ? (
                  <span className="muted fitnessWeekLabel">
                    Sun <code>{fitnessWeek.week_label}</code>
                  </span>
                ) : null}
              </h2>

              <blockquote className="fitnessSummary">
                {fitnessWeek.summary ? fitnessWeek.summary : "No summary yet."}
              </blockquote>

              {fitnessWeek ? (
                <>

                  {renderFitnessCategory("Cardio", "cardio")}
                  {renderFitnessCategory("Strength", "strength")}
                  {renderFitnessCategory("Mobility", "mobility")}
                  {renderFitnessCategory("Other", "other")}

                  <section className="fitnessHistory">
                    <h3>History</h3>
                    <div className="fitnessHistoryBody">
                      {fitnessHistoryError ? <p className="error">{fitnessHistoryError}</p> : null}
                      {fitnessHistoryLoading ? <p className="muted">Loading…</p> : null}
                      {!fitnessHistoryLoading ? renderFitnessHistoryTable() : null}
                    </div>
                  </section>
                </>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === "dashboard" ? (
          <div className="mainScroll">
            <section className="card fitnessCard">
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
                  <p className="muted">
                    Healthy: <code>{dashPayload.food_log.healthy ?? "⚪"}</code>
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
                        <th>Healthy</th>
                        <th>Weight</th>
                        <th>Calories</th>
                        <th>Fat</th>
                        <th>Carbs</th>
                        <th>Protein</th>
                        <th>Fiber</th>
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
                          <td>{row.healthy ?? "⚪"}</td>
                          <td>{fmt(row.weight_lb)}</td>
                          <td>{fmt(row.calories)}</td>
                          <td>{fmt(row.fat_g)}</td>
                          <td>{fmt(row.carbs_g)}</td>
                          <td>{fmt(row.protein_g)}</td>
                          <td>{fmt(row.fiber_g)}</td>
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
          </div>
        ) : null}
      </main>
    </div>
  );
}
