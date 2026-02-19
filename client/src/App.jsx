import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import "./styles.css";
import {
  getContext,
  exportUserData,
  analyzeUserImport,
  confirmUserImport,
  getFitnessCurrent,
  getFitnessHistory,
  getFoodForDate,
  getFoodLog,
  getSettingsState,
  saveSettingsProfiles,
  settingsBootstrap,
  ingestAssistantStream,
  settingsChatStream,
  updateFitnessItem,
} from "./api.js";
import { getFitnessCategories } from "./fitnessChecklist.js";
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
import StatusMessage from "./components/StatusMessage.jsx";
import useDebouncedKeyedCallback from "./hooks/useDebouncedKeyedCallback.js";
import useSerialQueue from "./hooks/useSerialQueue.js";
import { addDaysIso, localDateString } from "./utils/date.js";
import { normalizeProfileText, normalizeSettingsProfiles, settingsProfilesEqual } from "./utils/settingsProfiles.js";
import SettingsView from "./views/SettingsView.jsx";

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
  const importFileInputRef = useRef(null);
  const settingsFormRef = useRef(null);
  const settingsInputRef = useRef(null);
  const settingsMessagesRef = useRef(null);

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
  const [settingsProfilesSaving, setSettingsProfilesSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const settingsMessageIdRef = useRef(0);
  const settingsProfilesSaveSeqRef = useRef(0);
  const [settingsBootstrapChecking, setSettingsBootstrapChecking] = useState(false);
  const settingsBootstrapRoutedRef = useRef(false);
  const [sidebarDaySummary, setSidebarDaySummary] = useState(null);
  const [sidebarDayStatus, setSidebarDayStatus] = useState("");
  const [sidebarDayError, setSidebarDayError] = useState("");
  const sidebarDaySeqRef = useRef(0);
  const [settingsProfilesSaved, setSettingsProfilesSaved] = useState(() => normalizeSettingsProfiles({}));
  const [settingsProfilesDraft, setSettingsProfilesDraft] = useState(() => normalizeSettingsProfiles({}));

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
  const [exportStatus, setExportStatus] = useState("");
  const [exportActionLoading, setExportActionLoading] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importActionLoading, setImportActionLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importError, setImportError] = useState("");
  const [importAnalysis, setImportAnalysis] = useState(null);
  const [importPasteText, setImportPasteText] = useState("");
  const [importConfirmText, setImportConfirmText] = useState("");
  const [importResult, setImportResult] = useState(null);
  const signedOut = authEnabled && !authSession?.user;

  useEffect(() => {
    const setAppHeight = () => {
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      document.documentElement.style.setProperty("--app-height", `${viewportHeight}px`);
    };

    setAppHeight();
    const onViewportChange = () => requestAnimationFrame(setAppHeight);
    const viewport = window.visualViewport;

    window.addEventListener("resize", onViewportChange);
    window.addEventListener("orientationchange", onViewportChange);
    window.addEventListener("focusin", onViewportChange);

    if (viewport) {
      viewport.addEventListener("resize", onViewportChange);
      viewport.addEventListener("scroll", onViewportChange);
    }

    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("orientationchange", onViewportChange);
      window.removeEventListener("focusin", onViewportChange);
      if (viewport) {
        viewport.removeEventListener("resize", onViewportChange);
        viewport.removeEventListener("scroll", onViewportChange);
      }
    };
  }, []);

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

  const settingsProfilesDirty = useMemo(
    () => JSON.stringify(settingsProfilesDraft) !== JSON.stringify(settingsProfilesSaved),
    [settingsProfilesDraft, settingsProfilesSaved],
  );

  const refreshAppContext = useCallback(async () => {
    const json = await getContext();
    const date = typeof json?.suggested_date === "string" ? json.suggested_date : "";
    setSuggestedDate(date);
    setFoodDate((prev) => prev || date);
    setDashDate((prev) => prev || date);
    return json;
  }, []);

  const loadSettingsProfilesState = useCallback(async () => {
    const json = await getSettingsState();
    const normalized = normalizeSettingsProfiles(json?.profiles);
    setSettingsProfilesSaved(normalized);
    setSettingsProfilesDraft(normalized);
    return normalized;
  }, []);

  useEffect(() => {
    if (signedOut) return;
    refreshAppContext().catch(() => {});
  }, [refreshAppContext, signedOut]);

  useEffect(() => {
    if (signedOut) return;
    loadSettingsProfilesState().catch(() => {});
  }, [loadSettingsProfilesState, signedOut]);

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
    if (!authEnabled || signedOut) {
      settingsBootstrapRoutedRef.current = false;
      setSettingsBootstrapChecking(false);
      return;
    }

    let canceled = false;
    setSettingsBootstrapChecking(true);

    settingsBootstrap({ clientTimezone: getClientTimezone() })
      .then((json) => {
        if (canceled) return;
        if (json?.seeded_now) {
          settingsMessageIdRef.current += 1;
          setSettingsMessages((prev) => [
            {
              id: settingsMessageIdRef.current,
              role: "assistant",
              content: "Starter settings profile and checklist were added. Tell me what you want to change.",
              format: "plain",
              tone: "status",
            },
            ...prev,
          ]);
        }
        loadSettingsProfilesState().catch(() => {});
        if (!settingsBootstrapRoutedRef.current && json?.default_open_view === "settings") {
          settingsBootstrapRoutedRef.current = true;
          setView("settings");
        }
      })
      .catch((err) => {
        if (canceled) return;
        setAuthStatus(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (canceled) return;
        setSettingsBootstrapChecking(false);
      });

    return () => {
      canceled = true;
    };
  }, [authEnabled, signedOut, authSession?.user?.id, loadSettingsProfilesState]);

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
      const anchor = suggestedDate || localDateString(new Date());
      loadDashboard(anchor);
      loadSidebarDaySummary(anchor);
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
      const details =
        typeof json?.day?.details === "string" ? json.day.details : "";
      const syntheticEvents = details.trim()
        ? details
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line, index) => ({
              id: `line_${date}_${index}`,
              description: line,
            }))
        : [];
      const detailLines = syntheticEvents;
      setSidebarDaySummary({
        date,
        totals: json?.day_totals ?? null,
        detail_lines: detailLines,
        detail_line_count: detailLines.length,
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
    if (settingsLoading || settingsProfilesSaving) return;
    const activeEl = document.activeElement;
    if (
      activeEl instanceof HTMLElement &&
      (activeEl.classList.contains("settingsProfileTextarea") || activeEl.closest(".settingsProfilesPanel"))
    ) {
      return;
    }
    settingsInputRef.current?.focus();
  }, [settingsLoading, settingsProfilesSaving, view]);

  useEffect(() => {
    if (signedOut) return;
    if (settingsLoading || settingsProfilesSaving || !settingsProfilesDirty) return;

    const profileSnapshot = normalizeSettingsProfiles(settingsProfilesDraft);
    const timeoutId = setTimeout(async () => {
      const saveSeq = ++settingsProfilesSaveSeqRef.current;
      setSettingsProfilesSaving(true);
      try {
        const json = await saveSettingsProfiles({
          general: profileSnapshot.general,
          fitness: profileSnapshot.fitness,
          diet: profileSnapshot.diet,
          agent: profileSnapshot.agent,
        });
        const normalized = normalizeSettingsProfiles(json?.updated ?? profileSnapshot);
        setSettingsProfilesSaved(normalized);
        setSettingsProfilesDraft((prev) => (settingsProfilesEqual(prev, profileSnapshot) ? normalized : prev));
        setSettingsError("");
      } catch (err) {
        if (saveSeq === settingsProfilesSaveSeqRef.current) {
          setSettingsError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (saveSeq === settingsProfilesSaveSeqRef.current) {
          setSettingsProfilesSaving(false);
        }
      }
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [settingsProfilesDraft, settingsProfilesDirty, settingsLoading, settingsProfilesSaving, signedOut]);

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

  const onExportData = async () => {
    if (exportActionLoading) return;
    setExportActionLoading(true);
    setExportStatus("");
    try {
      const json = await exportUserData();
      const exported = json?.export;
      if (!exported || typeof exported !== "object") throw new Error("Export payload was empty.");

      const now = new Date();
      const dateLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const filename = `data_export_${dateLabel}.json`;
      const content = JSON.stringify(exported, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objectUrl);
      setExportStatus(`Saved ${filename}`);
    } catch (err) {
      setExportStatus(err instanceof Error ? err.message : "Could not export data.");
    } finally {
      setExportActionLoading(false);
    }
  };

  const resetImportState = () => {
    setImportError("");
    setImportAnalysis(null);
    setImportPasteText("");
    setImportConfirmText("");
    setImportResult(null);
    const input = importFileInputRef.current;
    if (input) input.value = "";
  };

  const onOpenImportModal = async () => {
    setImportStatus("");
    resetImportState();
    setImportModalOpen(true);
  };

  const onCloseImportModal = () => {
    if (importActionLoading) return;
    setImportModalOpen(false);
    resetImportState();
  };

  const onSelectImportFile = async (file) => {
    if (!file) return;
    setImportActionLoading(true);
    setImportError("");
    setImportResult(null);
    setImportAnalysis(null);
    setImportConfirmText("");
    try {
      const json = await analyzeUserImport({ file });
      setImportAnalysis(json);
      if (!json?.import_token) {
        setImportError("No importable domains were found in this file.");
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportActionLoading(false);
    }
  };

  const onAnalyzeImportText = async () => {
    const rawText = typeof importPasteText === "string" ? importPasteText.trim() : "";
    if (!rawText) {
      setImportError("Paste JSON text first.");
      return;
    }
    setImportActionLoading(true);
    setImportError("");
    setImportResult(null);
    setImportAnalysis(null);
    setImportConfirmText("");
    try {
      const json = await analyzeUserImport({ rawText });
      setImportAnalysis(json);
      if (!json?.import_token) {
        setImportError("No importable domains were found in this pasted data.");
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportActionLoading(false);
    }
  };

  const onConfirmImport = async () => {
    if (importActionLoading) return;
    const token = typeof importAnalysis?.import_token === "string" ? importAnalysis.import_token : "";
    if (!token) {
      setImportError("Analyze a file or pasted JSON first.");
      return;
    }
    if (importConfirmText.trim() !== "IMPORT") {
      setImportError("Type IMPORT to confirm.");
      return;
    }

    setImportActionLoading(true);
    setImportError("");
    try {
      const json = await confirmUserImport({
        importToken: token,
        confirmText: importConfirmText.trim(),
      });
      setImportResult(json);
      const applied = Array.isArray(json?.applied_domains) ? json.applied_domains : [];
      setImportStatus(applied.length ? `Import complete: ${applied.join(", ")}` : "Import complete.");

      await refreshAppContext();
      await loadSettingsProfilesState();
      await loadFitness();
      await loadFitnessHistory();
      await loadDashboardFoodLog();
      const selectedDashDate = dashDate || suggestedDate || foodDate;
      if (selectedDashDate) {
        await loadDashboard(selectedDashDate);
        await loadSidebarDaySummary(selectedDashDate);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImportActionLoading(false);
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
      if (summaryDate) {
        loadSidebarDaySummary(summaryDate);
        loadDashboard(summaryDate);
        loadDashboardFoodLog();
      }
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

  const sendSettingsMessage = async (rawMessage) => {
    if (settingsLoading || settingsProfilesSaving) return;
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

      if (Array.isArray(json?.changes_applied) && json.changes_applied.length) {
        settingsMessageIdRef.current += 1;
        const versionLabel =
          typeof json?.settings_version === "number" ? ` (settings v${json.settings_version})` : "";
        const effectiveLabel =
          typeof json?.effective_from === "string" && json.effective_from
            ? ` Effective: ${json.effective_from}.`
            : "";
        assistantMessages.push({
          id: settingsMessageIdRef.current,
          role: "assistant",
          content: `✓ ${json.changes_applied.join(" ")}${versionLabel}.${effectiveLabel}`,
          format: "plain",
          tone: "status",
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
      if (responsePayload?.current_week) setFitnessWeek(responsePayload.current_week);
      const updatedProfiles = normalizeSettingsProfiles(responsePayload?.updated);
      if (responsePayload?.updated) {
        setSettingsProfilesSaved(updatedProfiles);
        setSettingsProfilesDraft(updatedProfiles);
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

  const onSettingsProfileChange = (field, value) => {
    if (!["general", "fitness", "diet", "agent"].includes(field)) return;
    setSettingsError("");
    setSettingsProfilesDraft((prev) => ({ ...prev, [field]: normalizeProfileText(value) }));
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

  const dashDay = dashPayload?.day ?? null;
  const dashDayTotals = dashPayload?.day_totals ?? null;

  const sidebarDayDetailLines = Array.isArray(sidebarDaySummary?.detail_lines) ? sidebarDaySummary.detail_lines : [];
  const sidebarDayLineNames = sidebarDayDetailLines
    .map((line) => (line?.description ? String(line.description) : "Meal"))
    .filter(Boolean);
  const sidebarDayMealsSummary = sidebarDayLineNames.length
    ? `${sidebarDayLineNames.slice(0, 3).join(", ")}${sidebarDayLineNames.length > 3 ? ` +${sidebarDayLineNames.length - 3} more` : ""}`
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

  if (authEnabled && !signedOut && settingsBootstrapChecking) {
    return (
      <div className="signedOutShell">
        <section className="signedOutCard">
          <h1 className="signedOutTitle">Get fit and hot</h1>
          <p className="signedOutDescription">Loading your profile…</p>
        </section>
      </div>
    );
  }

  return (
    <div className={`appShell`}>
      <main className="mainColumn">
        <AppNavbar
          title="Get fit and hot"
          activeView={view}
          authEnabled={authEnabled}
          authSession={authSession}
          authStatus={authStatus}
          exportStatus={exportStatus}
          importStatus={importStatus}
          authActionLoading={authActionLoading}
          exportActionLoading={exportActionLoading}
          importActionLoading={importActionLoading}
          onSignIn={onSignIn}
          onSignOut={onSignOut}
          onExportData={onExportData}
          onImportData={onOpenImportModal}
          mobileNavOpen={mobileNavOpen}
          onToggleMobileNav={() => setMobileNavOpen((open) => !open)}
          onChangeView={(nextView) => {
            setView(nextView);
            setMobileNavOpen(false);
          }}
        />

        {view === "settings" ? (
          <SettingsView
            settingsMessagesRef={settingsMessagesRef}
            settingsFormRef={settingsFormRef}
            settingsInputRef={settingsInputRef}
            settingsMessages={settingsMessages}
            settingsInput={settingsInput}
            settingsLoading={settingsLoading}
            settingsProfilesSaving={settingsProfilesSaving}
            settingsError={settingsError}
            settingsProfiles={settingsProfilesDraft}
            settingsProfilesDirty={settingsProfilesDirty}
            onSubmitSettings={onSubmitSettings}
            onSettingsInputChange={setSettingsInput}
            onSettingsInputAutoSize={autosizeComposerTextarea}
            onSettingsProfileChange={onSettingsProfileChange}
            checklistCategories={getFitnessCategories(fitnessWeek)}
            checklistWeekLabel={fitnessWeek?.week_label || ""}
            checklistPhaseName={fitnessWeek?.training_block_name || ""}
            checklistPhaseDescription={fitnessWeek?.training_block_description || ""}
          />
        ) : (
          <div className="mainContentRow">
            <SidebarView
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
            <div className="mainPrimaryColumn">
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
                  dashLoading={dashLoading}
                  dashDay={dashDay}
                  dashDayTotals={dashDayTotals}
                  dashFoodLogRows={dashFoodLogRows}
                  fmt={fmt}
                />
              ) : null}
            </div>
          </div>
        )}

        {importModalOpen ? (
          <div className="importModalOverlay" role="dialog" aria-modal="true" aria-label="Import tracking data">
            <div className="importModalCard">
              <div className="importModalHeader">
                <h2>Import data</h2>
                <button
                  type="button"
                  className="secondary small"
                  onClick={onCloseImportModal}
                  disabled={importActionLoading}
                >
                  Close
                </button>
              </div>

              <p className="muted">
                Upload a JSON export/legacy file or paste JSON text. Import replaces matching domains in your current data.
              </p>

              <div className="importModalRow">
                <label htmlFor="import_file_input">
                  <strong>Upload file</strong>
                </label>
                <input
                  id="import_file_input"
                  ref={importFileInputRef}
                  type="file"
                  accept=".json,application/json,text/json"
                  disabled={importActionLoading}
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (!file) return;
                    onSelectImportFile(file);
                  }}
                />
              </div>

              <div className="importModalRow">
                <label htmlFor="import_paste_text">
                  <strong>Paste JSON</strong>
                </label>
                <textarea
                  id="import_paste_text"
                  value={importPasteText}
                  disabled={importActionLoading}
                  onChange={(e) => setImportPasteText(e.target.value)}
                  placeholder='Paste export JSON or legacy payload (for example: {"export":{"data":...}})'
                  rows={8}
                />
                <div className="importModalInlineActions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={onAnalyzeImportText}
                    disabled={importActionLoading || !importPasteText.trim()}
                  >
                    Analyze pasted JSON
                  </button>
                </div>
              </div>

              {importAnalysis ? (
                <div className="importSummary">
                  <p>
                    <strong>Detected shape:</strong> <code>{importAnalysis.detected_shape || "unknown"}</code>
                  </p>
                  <p>
                    <strong>Domains:</strong>
                  </p>
                  <ul>
                    {Object.entries(importAnalysis.summary || {}).map(([key, entry]) => (
                      <li key={key}>
                        <code>{key}</code>: {entry?.importable ? "importable" : "skipped"}{" "}
                        {typeof entry?.count === "number" ? `(${entry.count})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {Array.isArray(importAnalysis?.warnings) && importAnalysis.warnings.length ? (
                <div className="importWarnings">
                  <p>
                    <strong>Warnings:</strong>
                  </p>
                  <ul>
                    {importAnalysis.warnings.map((warning, idx) => (
                      <li key={idx}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {importResult ? (
                <div className="importSummary">
                  <p>
                    <strong>Applied:</strong> {(importResult.applied_domains || []).join(", ") || "(none)"}
                  </p>
                  {Array.isArray(importResult.skipped_domains) && importResult.skipped_domains.length ? (
                    <p>
                      <strong>Skipped:</strong>{" "}
                      {importResult.skipped_domains
                        .map((entry) => `${entry.domain}${entry.reason ? ` (${entry.reason})` : ""}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="importConfirmRow">
                <label htmlFor="import_confirm_text">
                  Type <code>IMPORT</code> to confirm:
                </label>
                <input
                  id="import_confirm_text"
                  type="text"
                  value={importConfirmText}
                  disabled={importActionLoading}
                  onChange={(e) => setImportConfirmText(e.target.value)}
                  placeholder="IMPORT"
                />
              </div>

              <StatusMessage error={importError} className="composerStatus" />

              <div className="importModalActions">
                <button
                  type="button"
                  className="sendButton"
                  onClick={onConfirmImport}
                  disabled={importActionLoading || !importAnalysis?.import_token || importConfirmText.trim() !== "IMPORT"}
                >
                  {importActionLoading ? "Importing…" : "Confirm import"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
