import React, { useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  getContext,
  getFitnessCurrent,
  getFitnessHistory,
  getFoodForDate,
  getFoodLog,
  confirmSettingsChanges,
  ingestAssistant,
  rollupFoodForDate,
  settingsChat,
  syncFoodForDate,
  updateFitnessItem,
} from "./api.js";
import {
  getSession,
  isSupabaseEnabled,
  onAuthStateChange,
  signInWithGoogle,
  signOut,
} from "./supabaseClient.js";
import ChatView from "./views/ChatView.jsx";
import DietView from "./views/DietView.jsx";
import SidebarView from "./views/SidebarView.jsx";
import SignedOutView from "./views/SignedOutView.jsx";
import WorkoutsView from "./views/WorkoutsView.jsx";
import AppNavbar from "./components/AppNavbar.jsx";
import SettingsView from "./views/SettingsView.jsx";

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

export default function App() {
  const [view, setView] = useState("chat");

  const [suggestedDate, setSuggestedDate] = useState("");
  const foodFormRef = useRef(null);
  const foodFileInputRef = useRef(null);
  const composerInputRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const settingsFormRef = useRef(null);
  const settingsInputRef = useRef(null);
  const settingsMessagesRef = useRef(null);

  // Chat view state (unified: photo + manual)
  const [foodDate, setFoodDate] = useState("");
  const [composerInput, setComposerInput] = useState("");
  const [foodFile, setFoodFile] = useState(null);
  const [composerError, setComposerError] = useState("");
  const [composerLoading, setComposerLoading] = useState(false);
  const [composerMessages, setComposerMessages] = useState([]);
  const composerMessageIdRef = useRef(0);
  const [settingsInput, setSettingsInput] = useState("");
  const [settingsMessages, setSettingsMessages] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const settingsMessageIdRef = useRef(0);
  const [sidebarDaySummary, setSidebarDaySummary] = useState(null);
  const [sidebarDayStatus, setSidebarDayStatus] = useState("");
  const [sidebarDayError, setSidebarDayError] = useState("");
  const sidebarDaySeqRef = useRef(0);

  // Workouts view state
  const [fitnessStatus, setFitnessStatus] = useState("");
  const [fitnessError, setFitnessError] = useState("");
  const [fitnessWeek, setFitnessWeek] = useState(null);
  const [fitnessLoading, setFitnessLoading] = useState(false);
  const [fitnessHistory, setFitnessHistory] = useState([]);
  const [fitnessHistoryError, setFitnessHistoryError] = useState("");
  const [fitnessHistoryLoading, setFitnessHistoryLoading] = useState(false);

  // Diet view state
  const [dashDate, setDashDate] = useState("");
  const [dashStatus, setDashStatus] = useState("");
  const [dashError, setDashError] = useState("");
  const [dashPayload, setDashPayload] = useState(null);
  const [dashFoodLogRows, setDashFoodLogRows] = useState([]);
  const [dashLoading, setDashLoading] = useState(false);
  const dashHeadingRef = useRef(null);
  const dashSkipNextAutoLoadRef = useRef(false);
  const dashLoadSeqRef = useRef(0);

  // Auth state
  const [authEnabled] = useState(isSupabaseEnabled());
  const [authSession, setAuthSession] = useState(null);
  const [authStatus, setAuthStatus] = useState("");
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const signedOut = authEnabled && !authSession?.user;

  const fmt = (n) => {
    if (n === null || n === undefined) return "—";
    if (typeof n !== "number") return String(n);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };

  useEffect(() => {
    if (signedOut) return;
    getContext()
      .then((json) => {
        const date = json?.suggested_date ?? "";
        setSuggestedDate(date);
        setFoodDate((prev) => prev || date);
        setDashDate((prev) => prev || date);
      })
      .catch(() => {});
  }, [signedOut]);

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
    if (signedOut) return;
    if (view === "workouts") {
      loadFitness();
      loadFitnessHistory();
    }
    if (view === "diet") {
      loadDashboardFoodLog();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, signedOut]);

  useEffect(() => {
    if (signedOut) return;
    loadFitness();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedOut]);

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
    if (signedOut) return;
    if (!foodDate) return;
    loadSidebarDaySummary(foodDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foodDate, signedOut]);

  useEffect(() => {
    const el = chatMessagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [composerMessages, composerLoading]);

  useEffect(() => {
    const el = settingsMessagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [settingsMessages, settingsLoading]);

  useEffect(() => {
    if (composerLoading) return;
    composerInputRef.current?.focus();
  }, [composerLoading]);

  useEffect(() => {
    if (view !== "settings") return;
    if (settingsLoading) return;
    settingsInputRef.current?.focus();
  }, [settingsLoading, view]);

  useEffect(() => {
    if (signedOut) return;
    if (view !== "diet") return;
    if (!dashDate) return;
    if (dashSkipNextAutoLoadRef.current) {
      dashSkipNextAutoLoadRef.current = false;
      return;
    }
    loadDashboard(dashDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashDate, view, signedOut]);

  const onSignIn = async () => {
    setAuthActionLoading(true);
    setAuthStatus("");
    try {
      const { error } = await signInWithGoogle();
      if (error) {
        setAuthStatus(error.message || "Could not start Google sign-in.");
      }
    } catch (err) {
      setAuthStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthActionLoading(false);
    }
  };

  const onSignOut = async () => {
    setAuthActionLoading(true);
    setAuthStatus("");
    try {
      const { error } = await signOut();
      if (error) {
        setAuthStatus(error.message || "Could not sign out.");
      }
    } catch (err) {
      setAuthStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setAuthActionLoading(false);
    }
  };

  const onSubmitFood = async (e) => {
    e.preventDefault();
    if (composerLoading) return;
    const inputEl = composerInputRef.current;
    const wasFocused = document.activeElement === inputEl;
    setComposerError("");

    const messageText = composerInput.trim();
    if (!foodFile && !messageText) {
      setComposerError("Type a message or add a photo.");
      return;
    }

    setComposerLoading(true);
    const previous = composerMessages;
    composerMessageIdRef.current += 1;
    const userMessage = {
      id: composerMessageIdRef.current,
      role: "user",
      content: messageText || (foodFile ? "📷 Photo attached." : ""),
      format: "plain",
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

      if (json?.food_result?.date) setDashDate(json.food_result.date);

      const assistantMessages = [];
      if (json?.action === "food" || json?.action === "activity") {
        composerMessageIdRef.current += 1;
        const activityStatus = json?.activity_log_state === "updated" ? "Updated activity." : "Saved activity.";
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: json.action === "food" ? "✓ Saved meal entry." : `✓ ${activityStatus}`,
          format: "plain",
          tone: "status",
        });
      }
      if (json?.assistant_message) {
        composerMessageIdRef.current += 1;
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: json.assistant_message,
          format: json?.action === "question" || json?.action === "food" ? "markdown" : "plain",
        });
      }
      if (json?.followup_question) {
        composerMessageIdRef.current += 1;
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: json.followup_question,
          format: "plain",
        });
      }
      if (assistantMessages.length) {
        setComposerMessages((prev) => [...prev, ...assistantMessages]);
      }

      clearFoodFile();
      const summaryDate = json?.food_result?.date || foodDate;
      if (summaryDate) loadSidebarDaySummary(summaryDate);
    } catch (e2) {
      setComposerError(e2 instanceof Error ? e2.message : String(e2));
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

  const sendSettingsMessage = async (rawMessage) => {
    if (settingsLoading) return;
    setSettingsError("");

    const messageText = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (!messageText) {
      setSettingsError("Type a settings request.");
      return;
    }

    setSettingsLoading(true);
    const previous = settingsMessages;

    settingsMessageIdRef.current += 1;
    const userMessage = {
      id: settingsMessageIdRef.current,
      role: "user",
      content: messageText,
      format: "plain",
    };
    setSettingsMessages((prev) => [...prev, userMessage]);
    if (messageText === settingsInput.trim()) {
      setSettingsInput("");
    }
    requestAnimationFrame(() => autosizeComposerTextarea(settingsInputRef.current));

    try {
      const json = await settingsChat({ message: messageText, messages: previous });
      const assistantText = typeof json?.assistant_message === "string" ? json.assistant_message.trim() : "";
      const followupText = typeof json?.followup_question === "string" ? json.followup_question.trim() : "";
      const normalizeForCompare = (text) =>
        String(text || "")
          .toLowerCase()
          .replace(/\s+/g, " ")
          .replace(/[?.!]+$/g, "")
          .trim();
      const isDuplicateFollowup =
        Boolean(assistantText && followupText) &&
        normalizeForCompare(assistantText) === normalizeForCompare(followupText);

      if (assistantText) {
        settingsMessageIdRef.current += 1;
        setSettingsMessages((prev) => [
          ...prev,
          {
            id: settingsMessageIdRef.current,
            role: "assistant",
            content: assistantText,
            format: "markdown",
            requiresConfirmation: Boolean(json?.requires_confirmation),
            proposalId: json?.proposal_id ?? null,
            proposal: json?.proposal ?? null,
          },
        ]);
      }

      if (followupText && !isDuplicateFollowup) {
        settingsMessageIdRef.current += 1;
        setSettingsMessages((prev) => [
          ...prev,
          {
            id: settingsMessageIdRef.current,
            role: "assistant",
            content: followupText,
            format: "plain",
          },
        ]);
      }

      if (json?.updated?.current_week) {
        setFitnessWeek(json.updated.current_week);
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsLoading(false);
    }
  };

  const onSubmitSettings = async (e) => {
    e.preventDefault();
    await sendSettingsMessage(settingsInput);
  };

  const onQuickSettingsPrompt = async (prompt) => {
    await sendSettingsMessage(prompt);
  };

  const onConfirmSettingsProposal = async (messageId, applyMode = "now") => {
    if (settingsLoading) return;
    setSettingsError("");

    const target = settingsMessages.find((msg) => msg.id === messageId);
    const proposal = target?.proposal ?? null;
    if (!proposal) return;

    setSettingsLoading(true);
    try {
      const json = await confirmSettingsChanges({ proposal, applyMode });

      setSettingsMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                requiresConfirmation: false,
                proposal: null,
                proposalId: null,
              }
            : msg,
        ),
      );

      if (Array.isArray(json?.changes_applied) && json.changes_applied.length) {
        settingsMessageIdRef.current += 1;
        const versionLabel =
          typeof json?.settings_version === "number" ? ` (settings v${json.settings_version})` : "";
        const effectiveLabel =
          typeof json?.effective_from === "string" && json.effective_from
            ? ` Effective: ${json.effective_from}.`
            : "";
        setSettingsMessages((prev) => [
          ...prev,
          {
            id: settingsMessageIdRef.current,
            role: "assistant",
            content: `✓ ${json.changes_applied.join(" ")}${versionLabel}.${effectiveLabel}`,
            format: "plain",
            tone: "status",
          },
        ]);
      }

      if (json?.updated?.current_week) {
        setFitnessWeek(json.updated.current_week);
      }
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsLoading(false);
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

  const onToggleFitness = (category, index, checked) => {
    setFitnessWeek((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const list = Array.isArray(next?.[category]) ? next[category] : [];
      if (!list[index]) return prev;
      list[index].checked = checked;
      if (!checked) list[index].details = "";
      debouncedSaveFitnessItem(`${category}:${index}`, {
        category,
        index,
        checked,
        details: list[index].details ?? "",
      });
      return next;
    });
  };

  const onEditFitnessDetails = (category, index, details) => {
    setFitnessWeek((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      const list = Array.isArray(next?.[category]) ? next[category] : [];
      if (!list[index]) return prev;
      list[index].details = details;
      debouncedSaveFitnessItem(`${category}:${index}`, {
        category,
        index,
        checked: Boolean(list[index].checked),
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

  if (signedOut) {
    return (
      <SignedOutView authStatus={authStatus} authActionLoading={authActionLoading} onSignIn={onSignIn} />
    );
  }

  return (
    <div className="appShell">
      <SidebarView
        activeView={view}
        onChangeView={setView}
        foodDate={foodDate}
        suggestedDate={suggestedDate}
        sidebarDayError={sidebarDayError}
        sidebarDayStatus={sidebarDayStatus}
        sidebarDayMealsSummary={sidebarDayMealsSummary}
        sidebarCalories={sidebarCalories}
        sidebarProtein={sidebarProtein}
        sidebarCarbs={sidebarCarbs}
        sidebarFat={sidebarFat}
        sidebarQualitySummary={sidebarQualitySummary}
        fitnessWeek={fitnessWeek}
        fmt={fmt}
      />

      <main className="mainColumn">
        <AppNavbar
          title="🍑 Get fit and hot"
          activeView={view}
          onChangeView={setView}
          authEnabled={authEnabled}
          authSession={authSession}
          authStatus={authStatus}
          authActionLoading={authActionLoading}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
        />

        {view === "chat" ? (
          <ChatView
            chatMessagesRef={chatMessagesRef}
            composerMessages={composerMessages}
            composerLoading={composerLoading}
            composerError={composerError}
            foodFormRef={foodFormRef}
            foodFileInputRef={foodFileInputRef}
            composerInputRef={composerInputRef}
            foodFile={foodFile}
            foodDate={foodDate}
            composerInput={composerInput}
            onSubmitFood={onSubmitFood}
            onPickFoodFile={onPickFoodFile}
            onFoodDateChange={setFoodDate}
            onComposerInputChange={setComposerInput}
            onComposerInputAutoSize={autosizeComposerTextarea}
            onClearFoodFile={clearFoodFile}
          />
        ) : null}

        {view === "workouts" ? (
          <WorkoutsView
            fitnessWeek={fitnessWeek}
            fitnessLoading={fitnessLoading}
            fitnessHistory={fitnessHistory}
            fitnessHistoryError={fitnessHistoryError}
            fitnessHistoryLoading={fitnessHistoryLoading}
            onToggleFitness={onToggleFitness}
            onEditFitnessDetails={onEditFitnessDetails}
          />
        ) : null}

        {view === "diet" ? (
          <DietView
            dashHeadingRef={dashHeadingRef}
            dashDate={dashDate}
            dashLoading={dashLoading}
            dashError={dashError}
            dashStatus={dashStatus}
            dashPayload={dashPayload}
            dashFoodLogRows={dashFoodLogRows}
            onDashDateChange={setDashDate}
            onRefreshDashboard={loadDashboard}
            onRefreshAll={() => {
              loadDashboard(dashDate);
              loadDashboardFoodLog();
            }}
            onSyncDash={onSyncDash}
            onRollupDash={onRollupDash}
            onPickDashDateFromAllDays={onPickDashDateFromAllDays}
            fmt={fmt}
          />
        ) : null}

        {view === "settings" ? (
          <SettingsView
            settingsMessagesRef={settingsMessagesRef}
            settingsFormRef={settingsFormRef}
            settingsInputRef={settingsInputRef}
            settingsMessages={settingsMessages}
            settingsInput={settingsInput}
            settingsLoading={settingsLoading}
            settingsError={settingsError}
            onSubmitSettings={onSubmitSettings}
            onConfirmSettingsProposal={onConfirmSettingsProposal}
            onQuickSettingsPrompt={onQuickSettingsPrompt}
            onSettingsInputChange={setSettingsInput}
            onSettingsInputAutoSize={autosizeComposerTextarea}
          />
        ) : null}
      </main>
    </div>
  );
}
