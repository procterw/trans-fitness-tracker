import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  chatOnboardingStream,
  confirmOnboarding,
  restartOnboardingForDebug,
  getOnboardingState,
  getContext,
  getFitnessCurrent,
  getFitnessHistory,
  getFoodForDate,
  getFoodLog,
  confirmSettingsChanges,
  ingestAssistantStream,
  rollupFoodForDate,
  settingsChatStream,
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
import OnboardingView from "./views/OnboardingView.jsx";
import { getFitnessCategories } from "./fitnessChecklist.js";

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

function normalizeGoalSummary(value) {
  const asList = (items) => {
    if (!Array.isArray(items)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of items) {
      const text = typeof entry === "string" ? entry.trim() : "";
      if (!text) continue;
      const token = text.toLowerCase();
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(text);
    }
    return out;
  };

  const safe = value && typeof value === "object" ? value : {};
  return {
    diet_goals: asList(safe.diet_goals),
    fitness_goals: asList(safe.fitness_goals),
    health_goals: asList(safe.health_goals),
  };
}

function parseChecklistItemText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return { item: "", description: "" };
  const parts = text.split(/\s+-\s+/);
  if (parts.length < 2) return { item: text, description: "" };
  const item = (parts.shift() ?? "").trim();
  const description = parts.join(" - ").trim();
  return {
    item,
    description: item && description ? description : "",
  };
}

function categoriesFromWeek(week) {
  return getFitnessCategories(week)
    .map((category) => ({
      key: category.key,
      label: category.label,
      items: (Array.isArray(category.items) ? category.items : [])
        .map((item) => {
          const label = typeof item?.item === "string" ? item.item.trim() : "";
          const description = typeof item?.description === "string" ? item.description.trim() : "";
          return {
            item: label,
            description,
            checked: item?.checked === true,
          };
        })
        .filter((item) => item.item),
    }))
    .filter((category) => category.items.length);
}

function categoriesFromProposal(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((category) => ({
      key: typeof category?.key === "string" ? category.key.trim() : "",
      label: typeof category?.label === "string" ? category.label.trim() : null,
      items: Array.isArray(category?.items)
        ? category.items
            .map((item) => (typeof item === "string" ? parseChecklistItemText(item) : { item: "", description: "" }))
            .filter((item) => item.item)
            .map((item) => ({ ...item, checked: false }))
        : [],
    }))
    .filter((category) => category.key && category.items.length);
}

export default function App() {
  const [view, setView] = useState("chat");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isMobileViewport = () =>
    typeof window !== "undefined" && window.matchMedia("(max-width: 1000px)").matches;

  const [suggestedDate, setSuggestedDate] = useState("");
  const foodFormRef = useRef(null);
  const foodFileInputRef = useRef(null);
  const composerInputRef = useRef(null);
  const chatMessagesRef = useRef(null);
  const composerAttachmentIdRef = useRef(0);
  const previewUrlsRef = useRef(new Set());
  const settingsFormRef = useRef(null);
  const settingsInputRef = useRef(null);
  const settingsMessagesRef = useRef(null);
  const onboardingFormRef = useRef(null);
  const onboardingInputRef = useRef(null);
  const onboardingMessagesRef = useRef(null);

  // Chat view state (unified: photo + manual)
  const [foodDate, setFoodDate] = useState("");
  const [composerInput, setComposerInput] = useState("");
  const [foodAttachments, setFoodAttachments] = useState([]);
  const [composerError, setComposerError] = useState("");
  const [composerLoading, setComposerLoading] = useState(false);
  const [composerMessages, setComposerMessages] = useState([]);
  const composerMessageIdRef = useRef(0);
  const composerSubmitInFlightRef = useRef(false);
  const [settingsInput, setSettingsInput] = useState("");
  const [settingsMessages, setSettingsMessages] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const settingsMessageIdRef = useRef(0);
  const [onboardingInput, setOnboardingInput] = useState("");
  const [onboardingMessages, setOnboardingMessages] = useState([]);
  const [onboardingState, setOnboardingState] = useState(null);
  const [onboardingLoading, setOnboardingLoading] = useState(false);
  const [onboardingChecking, setOnboardingChecking] = useState(false);
  const [onboardingChecked, setOnboardingChecked] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");
  const [onboardingReplayLoading, setOnboardingReplayLoading] = useState(false);
  const onboardingMessageIdRef = useRef(0);
  const [sidebarDaySummary, setSidebarDaySummary] = useState(null);
  const [sidebarDayStatus, setSidebarDayStatus] = useState("");
  const [sidebarDayError, setSidebarDayError] = useState("");
  const sidebarDaySeqRef = useRef(0);
  const [profileGoalSummary, setProfileGoalSummary] = useState({
    diet_goals: [],
    fitness_goals: [],
    health_goals: [],
  });

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
  const [dashRecentEvents, setDashRecentEvents] = useState([]);
  const [dashRecentEventsLoading, setDashRecentEventsLoading] = useState(false);
  const [dashRecentEventsError, setDashRecentEventsError] = useState("");
  const [dashWeeklyEvents, setDashWeeklyEvents] = useState([]);
  const [dashWeeklyEventsError, setDashWeeklyEventsError] = useState("");
  const [dashLoading, setDashLoading] = useState(false);
  const dashHeadingRef = useRef(null);
  const dashSkipNextAutoLoadRef = useRef(false);
  const dashLoadSeqRef = useRef(0);
  const dashRecentEventsSeqRef = useRef(0);
  const dashWeeklyEventsSeqRef = useRef(0);

  // Auth state
  const [authEnabled] = useState(isSupabaseEnabled());
  const [authSession, setAuthSession] = useState(null);
  const [authStatus, setAuthStatus] = useState("");
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const onboardingDevToolsEnabled = Boolean(
    import.meta.env.DEV || String(import.meta.env.VITE_ENABLE_ONBOARDING_DEV_TOOLS || "").toLowerCase() === "true",
  );
  const signedOut = authEnabled && !authSession?.user;
  const onboardingRequired = authEnabled && !signedOut && onboardingChecked && onboardingState?.needs_onboarding === true;

  const fmt = (n) => {
    if (n === null || n === undefined) return "—";
    if (typeof n !== "number") return String(n);
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  };

  const getClientTimezone = () => {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return typeof tz === "string" ? tz : "";
    } catch {
      return "";
    }
  };

  const normalizeForCompare = (text) =>
    String(text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[?.!]+$/g, "")
      .trim();

  const refreshAppContext = useCallback(async () => {
    const json = await getContext();
    const date = typeof json?.suggested_date === "string" ? json.suggested_date : "";
    setSuggestedDate(date);
    setFoodDate((prev) => prev || date);
    setDashDate((prev) => prev || date);
    setProfileGoalSummary(normalizeGoalSummary(json?.user_profile_goals));
    return json;
  }, []);

  const seedOnboardingMessagesFromResponse = (json) => {
    onboardingMessageIdRef.current = 0;
    if (!json?.needs_onboarding) {
      setOnboardingMessages([]);
      return;
    }

    const seed = [];
    const assistantText = typeof json?.assistant_message === "string" ? json.assistant_message.trim() : "";
    const followupText = typeof json?.followup_question === "string" ? json.followup_question.trim() : "";
    const isDuplicateFollowup =
      Boolean(assistantText && followupText) &&
      normalizeForCompare(assistantText) === normalizeForCompare(followupText);

    if (assistantText) {
      onboardingMessageIdRef.current += 1;
      seed.push({
        id: onboardingMessageIdRef.current,
        role: "assistant",
        content: assistantText,
        format: "markdown",
      });
    }

    if (followupText && !isDuplicateFollowup) {
      onboardingMessageIdRef.current += 1;
      seed.push({
        id: onboardingMessageIdRef.current,
        role: "assistant",
        content: followupText,
        format: "plain",
      });
    }

    setOnboardingMessages(seed);
  };

  useEffect(() => {
    if (signedOut) return;
    refreshAppContext().catch(() => {});
  }, [refreshAppContext, signedOut]);

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

  useEffect(() => {
    if (!authEnabled) {
      setOnboardingChecked(true);
      setOnboardingState(null);
      return;
    }

    if (signedOut) {
      setOnboardingChecked(false);
      setOnboardingChecking(false);
      setOnboardingLoading(false);
      setOnboardingState(null);
      setOnboardingMessages([]);
      setOnboardingInput("");
      setOnboardingError("");
      onboardingMessageIdRef.current = 0;
      return;
    }

    let canceled = false;
    setOnboardingChecking(true);
    setOnboardingChecked(false);
    setOnboardingError("");

    getOnboardingState({ clientTimezone: getClientTimezone() })
      .then((json) => {
        if (canceled) return;
        setOnboardingState(json);
        setOnboardingChecked(true);
        seedOnboardingMessagesFromResponse(json);
        if (!json?.needs_onboarding) setOnboardingInput("");
      })
      .catch((err) => {
        if (canceled) return;
        setOnboardingChecked(true);
        setOnboardingError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (canceled) return;
        setOnboardingChecking(false);
      });

    return () => {
      canceled = true;
    };
  }, [authEnabled, signedOut, authSession?.user?.id]);

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

  const addDaysIso = (isoDate, deltaDays) => {
    if (!isoDate) return "";
    const d = new Date(`${isoDate}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + deltaDays);
    return d.toISOString().slice(0, 10);
  };

  const loadRecentEvents = async (anchorDate) => {
    const anchor = typeof anchorDate === "string" && anchorDate ? anchorDate : null;
    if (!anchor) return;
    const seq = ++dashRecentEventsSeqRef.current;
    setDashRecentEventsLoading(true);
    setDashRecentEventsError("");
    try {
      const dates = [anchor];
      const perDay = await Promise.all(
        dates.map(async (date) => {
          const json = await getFoodForDate(date);
          const events = Array.isArray(json?.events) ? json.events : [];
          return events.map((event, index) => ({
            key: event?.id ?? `${date}_${index}`,
            date,
            description: event?.description ?? "(no description)",
            nutrients: event?.nutrients ?? {},
            logged_at: event?.logged_at ?? "",
          }));
        }),
      );
      if (seq !== dashRecentEventsSeqRef.current) return;
      const flattened = perDay.flat().sort((a, b) => {
        if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
        return String(b.logged_at).localeCompare(String(a.logged_at));
      });
      setDashRecentEvents(flattened);
    } catch (e) {
      if (seq !== dashRecentEventsSeqRef.current) return;
      setDashRecentEventsError(e instanceof Error ? e.message : String(e));
      setDashRecentEvents([]);
    } finally {
      if (seq === dashRecentEventsSeqRef.current) setDashRecentEventsLoading(false);
    }
  };

  const loadWeeklyEvents = async (anchorDate) => {
    const anchor = typeof anchorDate === "string" && anchorDate ? anchorDate : null;
    if (!anchor) return;
    const seq = ++dashWeeklyEventsSeqRef.current;
    setDashWeeklyEventsError("");
    try {
      const dates = Array.from({ length: 7 }, (_, idx) => addDaysIso(anchor, -idx)).filter(Boolean);
      const perDay = await Promise.all(
        dates.map(async (date) => {
          const json = await getFoodForDate(date);
          const events = Array.isArray(json?.events) ? json.events : [];
          return events.map((event, index) => ({
            key: event?.id ?? `${date}_${index}`,
            date,
            description: event?.description ?? "(no description)",
            nutrients: event?.nutrients ?? {},
            logged_at: event?.logged_at ?? "",
          }));
        }),
      );
      if (seq !== dashWeeklyEventsSeqRef.current) return;
      const flattened = perDay.flat().sort((a, b) => {
        if (a.date !== b.date) return String(b.date).localeCompare(String(a.date));
        return String(b.logged_at).localeCompare(String(a.logged_at));
      });
      setDashWeeklyEvents(flattened);
    } catch (e) {
      if (seq !== dashWeeklyEventsSeqRef.current) return;
      setDashWeeklyEventsError(e instanceof Error ? e.message : String(e));
      setDashWeeklyEvents([]);
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
      const anchor = suggestedDate || localDateString(new Date());
      loadRecentEvents(anchor);
      loadWeeklyEvents(anchor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, signedOut, suggestedDate]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [view]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onEscape = (event) => {
      if (event.key !== "Escape") return;
      setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
    };
  }, [mobileNavOpen]);

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
    const el = onboardingMessagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [onboardingMessages, onboardingLoading]);

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (composerLoading) return;
    if (isMobileViewport()) return;
    composerInputRef.current?.focus();
  }, [composerLoading]);

  useEffect(() => {
    if (view !== "settings") return;
    if (settingsLoading) return;
    settingsInputRef.current?.focus();
  }, [settingsLoading, view]);

  useEffect(() => {
    if (!onboardingRequired) return;
    if (onboardingLoading || onboardingChecking) return;
    onboardingInputRef.current?.focus();
  }, [onboardingRequired, onboardingLoading, onboardingChecking]);

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
    if (composerLoading || composerSubmitInFlightRef.current) return;
    const inputEl = composerInputRef.current;
    const wasFocused = document.activeElement === inputEl;
    const mobileViewport = isMobileViewport();
    setComposerError("");

    const messageText = composerInput.trim();
    if (!foodAttachments.length && !messageText) {
      setComposerError("Type a message or add a photo.");
      return;
    }

    composerSubmitInFlightRef.current = true;
    setComposerLoading(true);
    const previous = composerMessages;
    const attachmentCopies = foodAttachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      previewUrl: attachment.previewUrl,
    }));
    composerMessageIdRef.current += 1;
    const photoLabel =
      attachmentCopies.length > 1 ? `📷 ${attachmentCopies.length} photos attached.` : "📷 Photo attached.";
    const userMessage = {
      id: composerMessageIdRef.current,
      role: "user",
      content: messageText || (attachmentCopies.length ? photoLabel : ""),
      attachments: attachmentCopies,
      format: "plain",
    };
    setComposerMessages((prev) => [...prev, userMessage]);
    setComposerInput("");
    requestAnimationFrame(() => autosizeComposerTextarea(composerInputRef.current));
    if (mobileViewport) {
      inputEl?.blur();
    } else {
      requestAnimationFrame(() => composerInputRef.current?.focus());
      if (wasFocused) setTimeout(() => inputEl?.focus(), 0);
    }

    const appendAssistantMessages = (json, { streamingAssistantMessageId = null } = {}) => {
      if (!json) return;
      const isStreamingQuestion = Boolean(streamingAssistantMessageId);
      const assistantMessages = [];

      if (json?.action === "food" || json?.action === "activity") {
        composerMessageIdRef.current += 1;
        const activityStatus = json?.activity_log_state === "updated" ? "Updated activity." : "Saved activity.";
        const foodLogAction = json?.food_result?.log_action ?? json?.log_action ?? null;
        const foodStatus =
          foodLogAction === "updated"
            ? "Updated meal entry."
            : foodLogAction === "existing"
              ? "Meal already saved."
              : "Saved meal entry.";
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: json.action === "food" ? `✓ ${foodStatus}` : `✓ ${activityStatus}`,
          format: "plain",
          tone: "status",
        });
      }

      const assistantMessageText =
        typeof json?.assistant_message === "string" ? json.assistant_message.trim() : "";
      if (assistantMessageText) {
        if (isStreamingQuestion) {
          setComposerMessages((prev) =>
            prev.map((message) =>
              message.id === streamingAssistantMessageId
                ? {
                    ...message,
                    content: assistantMessageText,
                    format: "markdown",
                  }
                : message,
            ),
          );
        } else {
          composerMessageIdRef.current += 1;
          assistantMessages.push({
            id: composerMessageIdRef.current,
            role: "assistant",
            content: assistantMessageText,
            format: json?.action === "question" || json?.action === "food" ? "markdown" : "plain",
          });
        }
      }

      const followupText = typeof json?.followup_question === "string" ? json.followup_question.trim() : "";
      if (followupText) {
        composerMessageIdRef.current += 1;
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: followupText,
          format: "plain",
        });
      }

      if (assistantMessages.length) {
        setComposerMessages((prev) => [...prev, ...assistantMessages]);
      }

      if (json?.food_result?.date) setDashDate(json.food_result.date);
      if (json?.current_week) setFitnessWeek(json.current_week);
      const summaryDate = json?.food_result?.date || foodDate;
      if (summaryDate) loadSidebarDaySummary(summaryDate);
      clearFoodAttachments({ revoke: false });
    };

    try {
      const clientRequestId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      let streamingMessageId = null;
      let responsePayload = null;
      let streamedText = "";
      const streamIterator = ingestAssistantStream({
        message: messageText,
        file: foodAttachments[0]?.file ?? null,
        date: foodDate,
        messages: previous,
        clientRequestId,
      });

      for await (const event of streamIterator) {
        if (event?.type === "error") {
          throw new Error(event.error || "Streaming request failed.");
        }
        if (event?.type === "chunk") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (!delta) continue;
          streamedText += delta;
          if (!streamingMessageId) {
            composerMessageIdRef.current += 1;
            streamingMessageId = composerMessageIdRef.current;
            setComposerMessages((prev) => [
              ...prev,
              {
                id: streamingMessageId,
                role: "assistant",
                content: "",
                format: "markdown",
              },
            ]);
          }
          const nextContent = streamedText;
          setComposerMessages((prev) =>
            prev.map((message) => (message.id === streamingMessageId ? { ...message, content: nextContent } : message)),
          );
        }
        if (event?.type === "done") {
          responsePayload = event.payload ?? null;
        }
      }

      if (!responsePayload) {
        throw new Error("Streaming response did not complete.");
      }
      appendAssistantMessages(responsePayload, { streamingAssistantMessageId: streamingMessageId });
    } catch (e2) {
      setComposerError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setComposerLoading(false);
      composerSubmitInFlightRef.current = false;
    }
  };

  const onPickFoodFiles = (files) => {
    const list = Array.from(files || []).filter((file) => file && file.type?.startsWith("image/"));
    if (!list.length) return;
    setFoodAttachments((prev) => [
      ...prev,
      ...list.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
        composerAttachmentIdRef.current += 1;
        return {
          id: composerAttachmentIdRef.current,
          name: file.name || "photo",
          file,
          previewUrl,
        };
      }),
    ]);
    const input = foodFileInputRef.current;
    if (input) input.value = "";
  };

  const removeFoodAttachment = (attachmentId) => {
    setFoodAttachments((prev) => {
      const next = [];
      for (const attachment of prev) {
        if (attachment.id !== attachmentId) {
          next.push(attachment);
          continue;
        }
        if (attachment.previewUrl) {
          URL.revokeObjectURL(attachment.previewUrl);
          previewUrlsRef.current.delete(attachment.previewUrl);
        }
      }
      return next;
    });
    const input = foodFileInputRef.current;
    if (input) input.value = "";
  };

  const clearFoodAttachments = ({ revoke = true } = {}) => {
    setFoodAttachments((prev) => {
      if (revoke) {
        for (const attachment of prev) {
          if (attachment.previewUrl) {
            URL.revokeObjectURL(attachment.previewUrl);
            previewUrlsRef.current.delete(attachment.previewUrl);
          }
        }
      }
      return [];
    });
    const input = foodFileInputRef.current;
    if (input) input.value = "";
  };

  const autosizeComposerTextarea = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const sendOnboardingMessage = async (rawMessage) => {
    if (onboardingLoading || onboardingChecking) return;
    setOnboardingError("");

    const messageText = typeof rawMessage === "string" ? rawMessage.trim() : "";
    if (!messageText) {
      setOnboardingError("Type an answer before sending.");
      return;
    }

    setOnboardingLoading(true);
    const previous = onboardingMessages
      .filter((msg) => msg?.role === "user" || msg?.role === "assistant")
      .map((msg) => ({ role: msg.role, content: String(msg.content || "") }));

    onboardingMessageIdRef.current += 1;
    setOnboardingMessages((prev) => [
      ...prev,
      {
        id: onboardingMessageIdRef.current,
        role: "user",
        content: messageText,
        format: "plain",
      },
    ]);
    if (messageText === onboardingInput.trim()) setOnboardingInput("");

    const appendAssistantMessages = (json, { streamingAssistantMessageId = null } = {}) => {
      const assistantMessages = [];

      const assistantText = typeof json?.assistant_message === "string" ? json.assistant_message.trim() : "";
      const followupText = typeof json?.followup_question === "string" ? json.followup_question.trim() : "";
      const isDuplicateFollowup =
        Boolean(assistantText && followupText) &&
        normalizeForCompare(assistantText) === normalizeForCompare(followupText);

      if (assistantText) {
        if (streamingAssistantMessageId) {
          setOnboardingMessages((prev) =>
            prev.map((message) =>
              message.id === streamingAssistantMessageId
                ? {
                  ...message,
                  content: assistantText,
                  format: "markdown",
                }
              : message,
          ),
        );
        } else {
          onboardingMessageIdRef.current += 1;
          setOnboardingMessages((prev) => [
            ...prev,
            {
              id: onboardingMessageIdRef.current,
              role: "assistant",
              content: assistantText,
              format: "markdown",
            },
          ]);
        }
      }

      if (followupText && !isDuplicateFollowup) {
        onboardingMessageIdRef.current += 1;
        assistantMessages.push({
          id: onboardingMessageIdRef.current,
          role: "assistant",
          content: followupText,
          format: "plain",
        });
      }

      if (assistantMessages.length) {
        setOnboardingMessages((prev) => [...prev, ...assistantMessages]);
      }
    };

    try {
      let streamingMessageId = null;
      let responsePayload = null;
      let streamedText = "";
      const streamIterator = chatOnboardingStream({
        message: messageText,
        messages: previous,
        clientTimezone: getClientTimezone(),
      });

      for await (const event of streamIterator) {
        if (event?.type === "error") {
          throw new Error(event.error || "Streaming request failed.");
        }
        if (event?.type === "chunk") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (!delta) continue;
          streamedText += delta;
          if (!streamingMessageId) {
            onboardingMessageIdRef.current += 1;
            streamingMessageId = onboardingMessageIdRef.current;
            setOnboardingMessages((prev) => [
              ...prev,
              {
                id: streamingMessageId,
                role: "assistant",
                content: "",
                format: "markdown",
              },
            ]);
          }
          const nextContent = streamedText;
          setOnboardingMessages((prev) =>
            prev.map((message) => (message.id === streamingMessageId ? { ...message, content: nextContent } : message)),
          );
        }
        if (event?.type === "done") {
          responsePayload = event.payload ?? null;
        }
      }

      if (!responsePayload) throw new Error("Streaming response did not complete.");

      setOnboardingState(responsePayload);
      setOnboardingChecked(true);
      refreshAppContext().catch(() => {});
      loadFitness();
      appendAssistantMessages(responsePayload, { streamingAssistantMessageId: streamingMessageId });
      if (responsePayload?.onboarding_complete) {
        setView("chat");
      }
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : String(err));
    } finally {
      setOnboardingLoading(false);
    }
  };

  const onSubmitOnboarding = async (e) => {
    e.preventDefault();
    await sendOnboardingMessage(onboardingInput);
  };

  const onExitOnboarding = async () => {
    if (onboardingLoading || onboardingChecking) return;
    setOnboardingError("");
    const stage = onboardingState?.stage;
    if (stage !== "checklist") return;

    setOnboardingLoading(true);
    try {
      const json = await confirmOnboarding({
        action: "finish_onboarding",
        proposal: onboardingState?.proposal ?? null,
        clientTimezone: getClientTimezone(),
      });
      setOnboardingState(json);
      setOnboardingChecked(true);
      refreshAppContext().catch(() => {});
      loadFitness();
      if (json?.onboarding_complete) setView("chat");
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : String(err));
    } finally {
      setOnboardingLoading(false);
    }
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

    const appendAssistantMessages = (json, { streamingAssistantMessageId = null } = {}) => {
      const assistantMessages = [];

      const assistantText = typeof json?.assistant_message === "string" ? json.assistant_message.trim() : "";
      const followupText = typeof json?.followup_question === "string" ? json.followup_question.trim() : "";
      const isDuplicateFollowup =
        Boolean(assistantText && followupText) &&
        normalizeForCompare(assistantText) === normalizeForCompare(followupText);

      if (assistantText) {
        if (streamingAssistantMessageId) {
          setSettingsMessages((prev) =>
            prev.map((message) =>
              message.id === streamingAssistantMessageId
                ? {
                    ...message,
                    content: assistantText,
                    format: "markdown",
                    requiresConfirmation: Boolean(json?.requires_confirmation),
                    proposalId: json?.proposal_id ?? null,
                    proposal: json?.proposal ?? null,
                  }
                : message,
            ),
          );
        } else {
          settingsMessageIdRef.current += 1;
          assistantMessages.push({
            id: settingsMessageIdRef.current,
            role: "assistant",
            content: assistantText,
            format: "markdown",
            requiresConfirmation: Boolean(json?.requires_confirmation),
            proposalId: json?.proposal_id ?? null,
            proposal: json?.proposal ?? null,
          });
        }
      }

      if (followupText && !isDuplicateFollowup) {
        settingsMessageIdRef.current += 1;
        assistantMessages.push({
          id: settingsMessageIdRef.current,
          role: "assistant",
          content: followupText,
          format: "plain",
        });
      }

      if (assistantMessages.length) {
        setSettingsMessages((prev) => [...prev, ...assistantMessages]);
      }
    };

    try {
      let streamingMessageId = null;
      let responsePayload = null;
      let streamedText = "";
      const streamIterator = settingsChatStream({ message: messageText, messages: previous });

      for await (const event of streamIterator) {
        if (event?.type === "error") {
          throw new Error(event.error || "Streaming request failed.");
        }
        if (event?.type === "chunk") {
          const delta = typeof event.delta === "string" ? event.delta : "";
          if (!delta) continue;
          streamedText += delta;
          if (!streamingMessageId) {
            settingsMessageIdRef.current += 1;
            streamingMessageId = settingsMessageIdRef.current;
            setSettingsMessages((prev) => [
              ...prev,
              {
                id: streamingMessageId,
                role: "assistant",
                content: "",
                format: "markdown",
              },
            ]);
          }
          const nextContent = streamedText;
          setSettingsMessages((prev) =>
            prev.map((message) =>
              message.id === streamingMessageId ? { ...message, content: nextContent } : message,
            ),
          );
        }
        if (event?.type === "done") {
          responsePayload = event.payload ?? null;
        }
      }

      if (!responsePayload) throw new Error("Streaming response did not complete.");

      appendAssistantMessages(responsePayload, { streamingAssistantMessageId: streamingMessageId });
      if (responsePayload?.updated?.current_week) {
        setFitnessWeek(responsePayload.updated.current_week);
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
      refreshAppContext().catch(() => {});
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

  const onReplayOnboarding = async () => {
    if (
      !onboardingDevToolsEnabled ||
      signedOut ||
      onboardingReplayLoading ||
      onboardingChecking ||
      onboardingLoading
    ) {
      return;
    }

    setOnboardingReplayLoading(true);
    setOnboardingError("");
    setAuthStatus("");
    try {
      const json = await restartOnboardingForDebug({ clientTimezone: getClientTimezone() });
      setOnboardingState(json);
      setOnboardingChecked(true);
      setOnboardingInput("");
      seedOnboardingMessagesFromResponse(json);
      refreshAppContext().catch(() => {});
      setView("chat");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setOnboardingError(message);
      setAuthStatus(message);
    } finally {
      setOnboardingReplayLoading(false);
    }
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

  const dietWeeklySummary = useMemo(() => {
    const rows = Array.isArray(dashFoodLogRows) ? dashFoodLogRows : [];
    const events = Array.isArray(dashWeeklyEvents) ? dashWeeklyEvents : [];
    const anchor = suggestedDate || localDateString(new Date());
    if (!anchor || !rows.length) return "No logged days yet this week.";

    const rowByDate = new Map(rows.map((row) => [row?.date, row]));
    const dates = Array.from({ length: 7 }, (_, idx) => addDaysIso(anchor, -idx)).filter(Boolean);
    const dateSet = new Set(dates);
    const weekRows = dates.map((date) => rowByDate.get(date)).filter(Boolean);
    if (!weekRows.length) return "No logged days yet this week.";
    const weekEvents = events.filter((event) => dateSet.has(event?.date));

    const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const avg = (values) => {
      const valid = values.filter((v) => v !== null);
      if (!valid.length) return null;
      return valid.reduce((sum, v) => sum + v, 0) / valid.length;
    };

    const caloriesByDay = weekRows.map((row) => num(row?.calories));
    const proteinByDay = weekRows.map((row) => num(row?.protein_g));
    const fiberByDay = weekRows.map((row) => num(row?.fiber_g));
    const avgCalories = avg(caloriesByDay);
    const start = dates[dates.length - 1] ?? anchor;

    const topDescriptions = (() => {
      const counts = new Map();
      for (const event of weekEvents) {
        const label = String(event?.description || "").trim();
        if (!label || label.toLowerCase() === "(no description)") continue;
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([label, count]) => `${label} (${count})`);
    })();

    const typeMix = (() => {
      const categories = new Map();
      const bump = (key) => categories.set(key, (categories.get(key) ?? 0) + 1);
      for (const event of weekEvents) {
        const text = String(event?.description || "").toLowerCase();
        let matched = false;
        if (/\b(salad|veg|vegetable|fruit|berries|bean|lentil|broccoli|spinach|greens?)\b/.test(text)) {
          bump("produce/fiber-forward");
          matched = true;
        }
        if (/\b(rice|oat|bread|pasta|potato|cereal|noodle|tortilla)\b/.test(text)) {
          bump("carb-forward");
          matched = true;
        }
        if (/\b(chicken|fish|salmon|tofu|egg|yogurt|protein|turkey|beef|tempeh|shrimp)\b/.test(text)) {
          bump("protein-forward");
          matched = true;
        }
        if (/\b(avocado|nut|peanut|olive oil|butter|cheese|chocolate)\b/.test(text)) {
          bump("fat-forward");
          matched = true;
        }
        if (!matched) bump("mixed/other");
      }
      return Array.from(categories.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4)
        .map(([label, count]) => `${label}: ${count}`);
    })();

    const proteinTracked = proteinByDay.filter((value) => value !== null);
    const proteinAlignedDays = proteinTracked.filter((value) => value >= 40 && value <= 80).length;
    const fiberTracked = fiberByDay.filter((value) => value !== null);
    const fiberGoalDays = fiberTracked.filter((value) => value >= 25).length;

    const caloriesTracked = caloriesByDay.filter((value) => value !== null);
    let calorieConsistency = "no calorie data";
    if (caloriesTracked.length) {
      const baseline = avg(caloriesTracked);
      if (baseline && baseline > 0) {
        const withinBand = caloriesTracked.filter((value) => Math.abs(value - baseline) / baseline <= 0.2).length;
        calorieConsistency = `${withinBand}/${caloriesTracked.length} days within ±20% of weekly average`;
      }
    }

    const asInt = (value) => (value === null ? "—" : String(Math.round(value)));
    const adherenceParts = [
      `logging ${weekRows.length}/7 days`,
      proteinTracked.length
        ? `moderate protein (40-80 g): ${proteinAlignedDays}/${proteinTracked.length} days`
        : "moderate protein: no data",
      fiberTracked.length ? `fiber >=25 g: ${fiberGoalDays}/${fiberTracked.length} days` : "fiber: no data",
      `calorie consistency: ${calorieConsistency}`,
    ];

    const lines = [
      `Week overview (${start} to ${anchor}): ${weekEvents.length} meals logged across ${weekRows.length}/7 days.`,
      `Energy overview: average ${asInt(avgCalories)} kcal per logged day.`,
      topDescriptions.length ? `Most frequent foods: ${topDescriptions.join("; ")}.` : "Most frequent foods: not enough detail yet.",
      typeMix.length ? `Food-type mix: ${typeMix.join("; ")}.` : "Food-type mix: not enough meal descriptions yet.",
      `Adherence indicators: ${adherenceParts.join("; ")}.`,
    ];
    if (dashWeeklyEventsError) {
      lines.push("Food-type overview is partial because some weekly event data could not be loaded.");
    }
    return lines.join("\n");
  }, [dashFoodLogRows, dashWeeklyEvents, dashWeeklyEventsError, suggestedDate]);

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

  const onboardingGoalSummary = useMemo(() => {
    const profileGoals = onboardingState?.updated_profile?.goals;
    if (profileGoals && typeof profileGoals === "object") return normalizeGoalSummary(profileGoals);
    return profileGoalSummary;
  }, [onboardingState?.updated_profile?.goals, profileGoalSummary]);

  const onboardingProposalCategories = useMemo(() => {
    const proposal = onboardingState?.proposal;
    return Array.isArray(proposal?.checklist_categories) ? proposal.checklist_categories : null;
  }, [onboardingState]);

  const settingsProposalCategories = useMemo(() => {
    for (let i = settingsMessages.length - 1; i >= 0; i -= 1) {
      const msg = settingsMessages[i];
      if (!msg?.requiresConfirmation) continue;
      if (!Array.isArray(msg?.proposal?.checklist_categories)) continue;
      return msg.proposal.checklist_categories;
    }
    return null;
  }, [settingsMessages]);

  const onboardingWorkingChecklist = useMemo(() => {
    const proposal = categoriesFromProposal(onboardingProposalCategories);
    if (proposal.length) return proposal;
    return categoriesFromWeek(fitnessWeek);
  }, [fitnessWeek, onboardingProposalCategories]);

  const settingsWorkingChecklist = useMemo(() => {
    const proposal = categoriesFromProposal(settingsProposalCategories);
    if (proposal.length) return proposal;
    return categoriesFromWeek(fitnessWeek);
  }, [fitnessWeek, settingsProposalCategories]);

  if (signedOut) {
    return (
      <SignedOutView authStatus={authStatus} authActionLoading={authActionLoading} onSignIn={onSignIn} />
    );
  }

  if (authEnabled && !signedOut && !onboardingChecked) {
    return (
      <div className="signedOutShell">
        <section className="signedOutCard">
          <h1 className="signedOutTitle">Get fit and hot</h1>
          <p className="signedOutDescription">Loading your profile…</p>
        </section>
      </div>
    );
  }

  if (onboardingRequired) {
    return (
      <div className="onboardingApp">
        <AppNavbar
          title="Get fit and hot"
          authEnabled={authEnabled}
          authSession={authSession}
          authStatus={authStatus}
          authActionLoading={authActionLoading}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          showReplayOnboarding={onboardingDevToolsEnabled && Boolean(authSession?.user)}
          replayOnboardingLoading={onboardingReplayLoading || onboardingLoading || onboardingChecking}
          onReplayOnboarding={onReplayOnboarding}
          mobileNavOpen={false}
        />
        <main className="onboardingMain">
          <OnboardingView
            onboardingMessagesRef={onboardingMessagesRef}
            onboardingFormRef={onboardingFormRef}
            onboardingInputRef={onboardingInputRef}
            onboardingMessages={onboardingMessages}
            onboardingInput={onboardingInput}
            onboardingLoading={onboardingLoading || onboardingChecking}
            onboardingError={onboardingError}
            onboardingStage={onboardingState?.stage ?? "goals"}
            onboardingStepIndex={onboardingState?.step_index ?? 1}
            onboardingStepTotal={onboardingState?.step_total ?? 2}
            onboardingGoalSummary={onboardingGoalSummary}
            onboardingWorkingChecklist={onboardingWorkingChecklist}
            onSubmitOnboarding={onSubmitOnboarding}
            canExitOnboarding={onboardingState?.stage === "checklist"}
            onExitOnboarding={onExitOnboarding}
            onOnboardingInputChange={setOnboardingInput}
          />
        </main>
      </div>
    );
  }

  return (
    <div className={`appShell ${mobileNavOpen ? "mobileNavOpen" : ""}`}>
      <SidebarView
        activeView={view}
        onChangeView={(nextView) => {
          setView(nextView);
          setMobileNavOpen(false);
        }}
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
      <button
        type="button"
        className="sidebarBackdrop"
        aria-label="Close navigation menu"
        onClick={() => setMobileNavOpen(false)}
      />

      <main className="mainColumn">
        <AppNavbar
          title="Get fit and hot"
          authEnabled={authEnabled}
          authSession={authSession}
          authStatus={authStatus}
          authActionLoading={authActionLoading}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          showReplayOnboarding={onboardingDevToolsEnabled && Boolean(authSession?.user)}
          replayOnboardingLoading={onboardingReplayLoading || onboardingLoading || onboardingChecking}
          onReplayOnboarding={onReplayOnboarding}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
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
            foodAttachments={foodAttachments}
            foodDate={foodDate}
            composerInput={composerInput}
            onSubmitFood={onSubmitFood}
            onPickFoodFiles={onPickFoodFiles}
            onRemoveFoodAttachment={removeFoodAttachment}
            onFoodDateChange={setFoodDate}
            onComposerInputChange={setComposerInput}
            onComposerInputAutoSize={autosizeComposerTextarea}
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
            dashError={dashError}
            dashRecentEvents={dashRecentEvents}
            dashRecentEventsLoading={dashRecentEventsLoading}
            dashRecentEventsError={dashRecentEventsError}
            dashFoodLogRows={dashFoodLogRows}
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
            settingsGoalSummary={profileGoalSummary}
            settingsWorkingChecklist={settingsWorkingChecklist}
            onSubmitSettings={onSubmitSettings}
            onConfirmSettingsProposal={onConfirmSettingsProposal}
            onSettingsInputChange={setSettingsInput}
          />
        ) : null}
      </main>
    </div>
  );
}
