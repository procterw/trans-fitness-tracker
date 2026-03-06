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
  ingestAssistant,
  ingestAssistantStream,
  confirmSettingsChanges,
  updateFitnessItem,
  updateFitnessWeekContext,
  updateFitnessSummary,
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
import { getFoodEntriesFromDay } from "./utils/foodSummary.js";
import { normalizeProfileText, normalizeSettingsProfiles, settingsProfilesEqual } from "./utils/settingsProfiles.js";
import SettingsView from "./views/SettingsView.jsx";

const UUID_LIKE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getTrainingImportPayload(raw) {
  const safe = asObject(raw);
  const rootTraining = asObject(safe.training);
  if (Object.keys(rootTraining).length) return rootTraining;

  const rootActivity = asObject(safe.activity);
  if (Object.keys(rootActivity).length) return rootActivity;

  const nestedExport = asObject(asObject(safe.export).data);
  const exportTraining = asObject(nestedExport.training);
  if (Object.keys(exportTraining).length) return exportTraining;

  const exportActivity = asObject(nestedExport.activity);
  if (Object.keys(exportActivity).length) return exportActivity;

  const rootData = asObject(safe.data);
  const dataTraining = asObject(rootData.training);
  if (Object.keys(dataTraining).length) return dataTraining;

  return asObject(rootData.activity);
}

function validateSettingsTrainingImport(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return {
      valid: false,
      error: "Paste a JSON object containing training.blocks and training.weeks before importing.",
      blocksCount: 0,
      weeksCount: 0,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      valid: false,
      error: "Invalid JSON.",
      blocksCount: 0,
      weeksCount: 0,
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      valid: false,
      error: "Import payload must be a JSON object.",
      blocksCount: 0,
      weeksCount: 0,
    };
  }

  const training = getTrainingImportPayload(parsed);
  const blocks = asArray(training?.blocks);
  const weeks = asArray(training?.weeks);

  if (!Array.isArray(training?.blocks) || !Array.isArray(training?.weeks)) {
    return {
      valid: false,
      error: "Training payload must include both `blocks` and `weeks` arrays.",
      blocksCount: blocks.length,
      weeksCount: weeks.length,
    };
  }

  if (!blocks.length && !weeks.length) {
    return {
      valid: false,
      error: "Training blocks and weeks must not both be empty.",
      blocksCount: 0,
      weeksCount: 0,
    };
  }

  return {
    valid: true,
    error: "",
    blocksCount: blocks.length,
    weeksCount: weeks.length,
  };
}

function normalizeWorkoutRow(row, fallbackCategory = "Workouts") {
  const safe = asObject(row);
  const name = typeof safe.name === "string" ? safe.name.trim() : typeof safe.item === "string" ? safe.item.trim() : "";
  if (!name) return null;
  const date = typeof safe.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(safe.date) ? safe.date : "";
  return {
    name,
    description: typeof safe.description === "string" ? safe.description : "",
    category:
      typeof safe.category === "string" && safe.category.trim()
        ? safe.category.trim()
        : fallbackCategory,
    optional: safe.optional === true,
    details: typeof safe.details === "string" ? safe.details : "",
    completed: safe.completed === true || safe.checked === true,
    date,
  };
}

function normalizeFitnessWeek(value) {
  const safe = asObject(value);
  if (!Object.keys(safe).length) return null;

  let workouts = Array.isArray(safe.workouts)
    ? safe.workouts.map((row) => normalizeWorkoutRow(row)).filter(Boolean)
    : [];

  if (!workouts.length) {
    const categories = getFitnessCategories(safe);
    const seen = new Set();
    for (const category of categories) {
      const label =
        typeof category?.label === "string" && category.label.trim()
          ? category.label.trim()
          : "Workouts";
      const items = Array.isArray(category?.items) ? category.items : [];
      for (const item of items) {
        const normalized = normalizeWorkoutRow(
          {
            name: item?.item,
            description: item?.description,
            details: item?.details,
            completed: item?.checked === true,
          },
          label,
        );
        if (!normalized) continue;
        const token = normalized.name.toLowerCase();
        if (seen.has(token)) continue;
        seen.add(token);
        workouts.push(normalized);
      }
    }
  }

  const weekStart = typeof safe.week_start === "string" ? safe.week_start : "";
  const weekEnd = typeof safe.week_end === "string" ? safe.week_end : "";
  const fallbackLabel = weekStart && weekEnd ? `${weekStart} -> ${weekEnd}` : weekStart || "";
  const weekLabel = typeof safe.week_label === "string" && safe.week_label.trim() ? safe.week_label.trim() : fallbackLabel;

  return {
    week_start: weekStart,
    week_end: weekEnd,
    week_label: weekLabel,
    block_id: typeof safe.block_id === "string" ? safe.block_id : typeof safe.training_block_id === "string" ? safe.training_block_id : "",
    block_start: typeof safe.block_start === "string" ? safe.block_start : "",
    block_end: typeof safe.block_end === "string" ? safe.block_end : "",
    block_name:
      typeof safe.block_name === "string"
        ? safe.block_name
        : typeof safe.training_block_name === "string"
          ? safe.training_block_name
          : "",
    block_details:
      typeof safe.block_details === "string"
        ? safe.block_details
        : typeof safe.training_block_description === "string"
          ? safe.training_block_description
          : "",
    workouts,
    summary: typeof safe.summary === "string" ? safe.summary : "",
    context: typeof safe.context === "string" ? safe.context : "",
  };
}

function normalizeSettingsTrainingBlocks(value) {
  const safe = asObject(value);
  const rawBlocks = Array.isArray(safe.blocks) ? safe.blocks : [];
  const blocks = rawBlocks
    .map((row) => {
      const safeRow = asObject(row);
      const id = typeof safeRow.id === "string" ? safeRow.id.trim() : "";
      if (!id) return null;
      return {
        id,
        name: typeof safeRow.name === "string" ? safeRow.name.trim() : "",
        description: typeof safeRow.description === "string" ? safeRow.description.trim() : "",
        category_order: Array.isArray(safeRow.category_order)
          ? safeRow.category_order.filter((key) => typeof key === "string" && key.trim())
          : [],
        category_labels: safeRow.category_labels && typeof safeRow.category_labels === "object" ? safeRow.category_labels : {},
        workouts: Array.isArray(safeRow.workouts)
          ? safeRow.workouts
              .map((row) => {
                const safeWorkout = asObject(row);
                const name = typeof safeWorkout.name === "string" ? safeWorkout.name.trim() : "";
                if (!name) return null;
                return {
                  name,
                  description: typeof safeWorkout.description === "string" ? safeWorkout.description : "",
                  category:
                    typeof safeWorkout.category === "string" && safeWorkout.category.trim()
                      ? safeWorkout.category.trim()
                      : "Workouts",
                  optional: safeWorkout.optional === true,
                  details: "",
                };
              })
              .filter(Boolean)
          : [],
        block_start: typeof safeRow.block_start === "string" ? safeRow.block_start : "",
        block_end: typeof safeRow.block_end === "string" ? safeRow.block_end : "",
        updated_at: typeof safeRow.updated_at === "string" ? safeRow.updated_at : "",
      };
    })
    .filter(Boolean);

  const activeRaw = typeof safe.active_block_id === "string" ? safe.active_block_id.trim() : "";
  const hasActive = activeRaw && blocks.some((row) => row.id === activeRaw);
  return {
    active_block_id: hasActive ? activeRaw : "",
    blocks,
  };
}

function sortTrainingBlocksMostCurrentFirst(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  return [...list].sort((a, b) => {
    const aStart = typeof a?.block_start === "string" ? a.block_start : "";
    const bStart = typeof b?.block_start === "string" ? b.block_start : "";
    if (aStart !== bStart) return bStart.localeCompare(aStart);

    const aUpdated = typeof a?.updated_at === "string" ? a.updated_at : "";
    const bUpdated = typeof b?.updated_at === "string" ? b.updated_at : "";
    if (aUpdated !== bUpdated) return bUpdated.localeCompare(aUpdated);

    return String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

function formatBlockDateRangeLabel(blockStart, blockEnd) {
  const start = typeof blockStart === "string" ? blockStart.trim() : "";
  const end = typeof blockEnd === "string" ? blockEnd.trim() : "";
  if (start && end) return `${start} to ${end}`;
  if (start) return `${start} onward`;
  if (end) return `through ${end}`;
  return "";
}

function normalizeChecklistEditorRow(row, fallbackId = "") {
  const safe = asObject(row);
  const name = typeof safe.name === "string" ? safe.name : "";
  return {
    id: typeof safe.id === "string" && safe.id ? safe.id : fallbackId || "row",
    name,
    description: typeof safe.description === "string" ? safe.description : "",
    category:
      typeof safe.category === "string" && safe.category.trim()
        ? safe.category.trim()
        : "Workouts",
    optional: safe.optional === true,
  };
}

function normalizeChecklistEditorRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row, index) => normalizeChecklistEditorRow(row, `row_${index}`));
}

function normalizeSettingsBlockDraft(raw, fallbackId = "") {
  const safe = asObject(raw);
  const fallback = typeof fallbackId === "string" ? fallbackId : "";
  return {
    id:
      typeof safe.id === "string" && safe.id.trim()
        ? safe.id.trim()
        : fallback,
    name: typeof safe.name === "string" ? safe.name.trim() : "",
    description: typeof safe.description === "string" ? safe.description.trim() : "",
    category_order: Array.isArray(safe.category_order)
      ? safe.category_order.filter((value) => typeof value === "string" && value.trim())
      : [],
    category_labels: asObject(safe.category_labels),
    workouts: normalizeChecklistEditorRows(Array.isArray(safe.workouts) ? safe.workouts : []),
    block_start: typeof safe.block_start === "string" ? safe.block_start : "",
    block_end: typeof safe.block_end === "string" ? safe.block_end : "",
    updated_at: typeof safe.updated_at === "string" ? safe.updated_at : "",
  };
}

function normalizeSettingsBlockForComparison(raw) {
  const safe = normalizeSettingsBlockDraft(raw);
  return {
    id: safe.id,
    name: safe.name,
    description: safe.description,
    category_order: safe.category_order,
    category_labels: safe.category_labels,
    block_start: safe.block_start,
    block_end: safe.block_end,
    workouts: normalizeWorkoutsForCompare(safe.workouts),
  };
}

function normalizeSettingsBlockForProposal(raw) {
  const safe = normalizeSettingsBlockDraft(raw);
  return {
    ...safe,
    workouts: workoutsFromChecklistEditorRows(safe.workouts),
  };
}

function blockDraftToJson(raw) {
  return JSON.stringify(normalizeSettingsBlockDraft(raw), null, 2);
}

function workoutsFromChecklistEditorRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const safe = asObject(row);
    const name = typeof safe.name === "string" ? safe.name.trim() : "";
    if (!name) continue;
    const token = name.toLowerCase();
    if (seen.has(token)) continue;
    seen.add(token);
    out.push({
      name,
      description: typeof safe.description === "string" ? safe.description : "",
      category:
        typeof safe.category === "string" && safe.category.trim()
          ? safe.category.trim()
          : "Workouts",
      optional: safe.optional === true,
    });
  }
  return out;
}

function normalizeWorkoutsForCompare(rows) {
  return workoutsFromChecklistEditorRows(rows).map((row) => ({
    name: row.name,
    description: row.description,
    category: row.category,
    optional: row.optional === true,
  }));
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
  const importFileInputRef = useRef(null);

  // Chat view state (unified: photo + manual)
  const [foodDate, setFoodDate] = useState("");
  const [composerInput, setComposerInput] = useState("");
  const [foodAttachments, setFoodAttachments] = useState([]);
  const [composerError, setComposerError] = useState("");
  const [composerLoading, setComposerLoading] = useState(false);
  const [composerMessages, setComposerMessages] = useState([]);
  const composerMessageIdRef = useRef(0);
  const composerSubmitInFlightRef = useRef(false);
  const lastFoodEventIdRef = useRef("");
  const [settingsProfilesSaving, setSettingsProfilesSaving] = useState(false);
  const [settingsBlocksSaving, setSettingsBlocksSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const settingsProfilesSaveSeqRef = useRef(0);
  const settingsBlocksSaveSeqRef = useRef(0);
  const [settingsBootstrapChecking, setSettingsBootstrapChecking] = useState(false);
  const settingsBootstrapRoutedRef = useRef(false);
  const [sidebarDaySummary, setSidebarDaySummary] = useState(null);
  const [sidebarDayStatus, setSidebarDayStatus] = useState("");
  const [sidebarDayError, setSidebarDayError] = useState("");
  const sidebarDaySeqRef = useRef(0);
  const [settingsProfilesSaved, setSettingsProfilesSaved] = useState(() => normalizeSettingsProfiles({}));
  const [settingsProfilesDraft, setSettingsProfilesDraft] = useState(() => normalizeSettingsProfiles({}));
  const [settingsTrainingBlocks, setSettingsTrainingBlocks] = useState(() => normalizeSettingsTrainingBlocks({}));
  const [settingsSelectedBlockId, setSettingsSelectedBlockId] = useState("");
  const [settingsBlockDraft, setSettingsBlockDraft] = useState(() => ({
    id: "",
    name: "",
    description: "",
    category_order: [],
    category_labels: {},
    workouts: [],
    block_start: "",
    block_end: "",
    updated_at: "",
  }));
  const [settingsChecklistJsonDraft, setSettingsChecklistJsonDraft] = useState("{}");
  const [settingsChecklistJsonError, setSettingsChecklistJsonError] = useState("");
  const [settingsTrainingImportOpen, setSettingsTrainingImportOpen] = useState(false);
  const [settingsTrainingImportText, setSettingsTrainingImportText] = useState("");
  const [settingsTrainingImportValidation, setSettingsTrainingImportValidation] = useState(() =>
    validateSettingsTrainingImport(""),
  );
  const [settingsTrainingImportConfirmText, setSettingsTrainingImportConfirmText] = useState("");
  const [settingsTrainingImportError, setSettingsTrainingImportError] = useState("");
  const [settingsTrainingImportLoading, setSettingsTrainingImportLoading] = useState(false);
  const [settingsTrainingImportAnalysis, setSettingsTrainingImportAnalysis] = useState(null);
  const [settingsTrainingImportResult, setSettingsTrainingImportResult] = useState(null);

  // Workouts view state
  const [fitnessStatus, setFitnessStatus] = useState("");
  const [fitnessError, setFitnessError] = useState("");
  const [fitnessWeek, setFitnessWeek] = useState(null);
  const [fitnessLoading, setFitnessLoading] = useState(false);
  const [fitnessSummaryGenerating, setFitnessSummaryGenerating] = useState(false);
  const fitnessWeekSaveSeqRef = useRef(0);
  const fitnessSummarySeqRef = useRef(0);
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
    const blocks = normalizeSettingsTrainingBlocks(json?.training_blocks);
    setSettingsProfilesSaved(normalized);
    setSettingsProfilesDraft(normalized);
    setSettingsTrainingBlocks(blocks);
    return { profiles: normalized, trainingBlocks: blocks };
  }, []);

  useEffect(() => {
    const blocks = Array.isArray(settingsTrainingBlocks.blocks) ? settingsTrainingBlocks.blocks : [];
    if (!blocks.length) {
      if (settingsSelectedBlockId) setSettingsSelectedBlockId("");
      return;
    }
    if (settingsSelectedBlockId && blocks.some((row) => row.id === settingsSelectedBlockId)) return;

    const sortedBlocks = sortTrainingBlocksMostCurrentFirst(blocks);
    const fallbackId = settingsTrainingBlocks.active_block_id || sortedBlocks[0]?.id || "";
    setSettingsSelectedBlockId(fallbackId);
  }, [settingsTrainingBlocks, settingsSelectedBlockId]);

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
      setFitnessWeek(normalizeFitnessWeek(json?.week));
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
      const json = await getFitnessHistory({ limit: 0 });
      const weeks = Array.isArray(json?.weeks) ? json.weeks.map((week) => normalizeFitnessWeek(week)).filter(Boolean) : [];
      setFitnessHistory(weeks);
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
    if (view === "workouts" || view === "settings") {
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
      const day = json?.day && typeof json.day === "object" ? json.day : null;
      const totals = json?.day_totals ?? null;
      const daySummaryText =
        typeof day?.ai_summary === "string" ? day.ai_summary : typeof day?.details === "string" ? day.details : "";
      const foodEntries = getFoodEntriesFromDay(day, { fallbackSummary: daySummaryText });
      if (seq !== sidebarDaySeqRef.current) return;
      setSidebarDaySummary({
        date,
        totals,
        food_entries: foodEntries,
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
    if (signedOut) return;
    if (settingsProfilesSaving || !settingsProfilesDirty) return;

    const profileSnapshot = normalizeSettingsProfiles(settingsProfilesDraft);
    const timeoutId = setTimeout(async () => {
      const saveSeq = ++settingsProfilesSaveSeqRef.current;
      setSettingsProfilesSaving(true);
      try {
        const json = await saveSettingsProfiles({
          general: profileSnapshot.general,
          fitness: profileSnapshot.fitness,
          diet: profileSnapshot.diet,
          recipes: profileSnapshot.recipes,
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
  }, [settingsProfilesDraft, settingsProfilesDirty, settingsProfilesSaving, signedOut]);

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

    const appendAssistantMessages = (json, { streamingAssistantMessageId = null, clarificationEventId = "" } = {}) => {
      if (!json) return;
      const isStreamingQuestion = Boolean(streamingAssistantMessageId);
      const assistantMessages = [];

      if (json?.action === "food" || json?.action === "activity") {
        composerMessageIdRef.current += 1;
        const activityStatus = json?.activity_log_state === "updated" ? "Updated activity." : "Saved activity.";
        const foodLogAction = json?.food_result?.log_action ?? json?.log_action ?? null;
        const foodEventId =
          typeof json?.food_result?.event?.id === "string" ? json.food_result.event.id.trim() : "";
        if (json.action === "food" && UUID_LIKE_RE.test(foodEventId)) {
          lastFoodEventIdRef.current = foodEventId;
        }
        const foodTitle = typeof json?.food_result?.event?.description === "string" ? json.food_result.event.description.trim() : "";
        const fallbackFoodTitle =
          typeof json?.food_result?.estimate?.meal_title === "string" ? json.food_result.estimate.meal_title.trim() : "";
        const bestFoodTitle = foodTitle || fallbackFoodTitle || "meal";
        const foodStatus =
          foodLogAction === "updated"
            ? `Updated ${bestFoodTitle}`
            : foodLogAction === "existing"
              ? `${bestFoodTitle} already saved`
              : `Logged ${bestFoodTitle}`;
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: json.action === "food" ? `✓ ${foodStatus}` : `✓ ${activityStatus}`,
          format: "plain",
          tone: "status",
          foodEventId: json.action === "food" && foodEventId ? foodEventId : null,
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
        const explicitFoodEventId =
          json?.action === "food" && typeof json?.food_result?.event?.id === "string"
            ? json.food_result.event.id.trim()
            : "";
        const carriedFoodEventId = json?.action === "clarify" ? String(clarificationEventId || "").trim() : "";
        const followupFoodEventId = explicitFoodEventId || carriedFoodEventId;
        composerMessageIdRef.current += 1;
        assistantMessages.push({
          id: composerMessageIdRef.current,
          role: "assistant",
          content: followupText,
          format: "plain",
          foodFollowup: Boolean(followupFoodEventId),
          foodEventId: followupFoodEventId || null,
        });
      }

      if (assistantMessages.length) {
        setComposerMessages((prev) => [...prev, ...assistantMessages]);
      }

      if (json?.food_result?.date) setDashDate(json.food_result.date);
      if (json?.week) {
        setFitnessWeek(normalizeFitnessWeek(json.week));
      }
      const summaryDate = json?.food_result?.date || foodDate;
      if (summaryDate) {
        loadSidebarDaySummary(summaryDate);
        loadDashboard(summaryDate);
        loadDashboardFoodLog();
      }
      clearFoodAttachments({ revoke: false });
    };

    const isRecoverableFetchError = (error) => {
      if (!(error instanceof Error)) return false;
      return (
        error.name === "TypeError" ||
        /NetworkError/i.test(error.message) ||
        /Failed to fetch/i.test(error.message)
      );
    };
    let fallbackPayload = null;

    try {
      const lastAssistantMessage = [...previous].reverse().find((entry) => entry?.role === "assistant");
      const candidateFollowupEventId =
        !foodAttachments.length &&
        lastAssistantMessage?.foodFollowup === true &&
        typeof lastAssistantMessage?.foodEventId === "string"
          ? lastAssistantMessage.foodEventId.trim()
          : "";
      const followupEventId = UUID_LIKE_RE.test(candidateFollowupEventId) ? candidateFollowupEventId : "";
      const recentFoodEventIdCandidate =
        !foodAttachments.length && typeof lastFoodEventIdRef.current === "string" ? lastFoodEventIdRef.current.trim() : "";
      const recentFoodEventId = UUID_LIKE_RE.test(recentFoodEventIdCandidate) ? recentFoodEventIdCandidate : "";
      const clientRequestId =
        typeof globalThis.crypto?.randomUUID === "function"
          ? globalThis.crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

      const requestPayload = {
        message: messageText,
        file: foodAttachments[0]?.file ?? null,
        date: foodDate,
        messages: previous,
        eventId: followupEventId,
        recentFoodEventId,
        clientRequestId,
      };
      fallbackPayload = requestPayload;

      let streamingMessageId = null;
      let responsePayload = null;
      let streamedText = "";
      const streamIterator = ingestAssistantStream(requestPayload);

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
      appendAssistantMessages(responsePayload, {
        streamingAssistantMessageId: streamingMessageId,
        clarificationEventId: followupEventId,
      });
    } catch (e2) {
      if (!isRecoverableFetchError(e2)) {
        setComposerError(e2 instanceof Error ? e2.message : String(e2));
        return;
      }

      try {
        if (!fallbackPayload) {
          throw new Error("Unable to retry chat request.");
        }

        const fallbackResponse = await ingestAssistant(fallbackPayload);
        appendAssistantMessages(fallbackResponse, {
          clarificationEventId: UUID_LIKE_RE.test(fallbackPayload.eventId) ? fallbackPayload.eventId : "",
        });
      } catch (e3) {
        setComposerError(e3 instanceof Error ? e3.message : String(e3));
      }
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

  const applySettingsProposal = useCallback(
    async ({ proposal, selectedBlockId = "" }) => {
      const response = await confirmSettingsChanges({
        proposal,
        selectedBlockId: selectedBlockId || settingsSelectedBlockId || "",
      });
      if (response?.week) setFitnessWeek(normalizeFitnessWeek(response.week));
      await loadSettingsProfilesState();
      return response;
    },
    [settingsSelectedBlockId, loadSettingsProfilesState],
  );

  const onSettingsProfileChange = (field, value) => {
    if (!["general", "fitness", "diet", "recipes", "agent"].includes(field)) return;
    setSettingsError("");
    setSettingsProfilesDraft((prev) => ({ ...prev, [field]: normalizeProfileText(value) }));
  };

  const enqueueFitnessSave = useSerialQueue();

  const upsertFitnessWeekState = useCallback(
    (week) => {
      if (!week) return;
      const weekStart = typeof week?.week_start === "string" ? week.week_start : "";
      if (!weekStart) return;

      setFitnessWeek((prev) => {
        const currentWeekStart = typeof prev?.week_start === "string" ? prev.week_start : "";
        if (currentWeekStart === weekStart) return week;
        return prev;
      });

      setFitnessHistory((prev) => {
        const rows = Array.isArray(prev) ? prev : [];
        let found = false;
        const nextRows = rows.map((row) => {
          if (row?.week_start === weekStart) {
            found = true;
            return week;
          }
          return row;
        });
        if (found) return nextRows;
        const currentWeekStart = typeof fitnessWeek?.week_start === "string" ? fitnessWeek.week_start : "";
        if (weekStart !== currentWeekStart) return [...rows, week].sort((a, b) => String(a?.week_start).localeCompare(String(b?.week_start)));
        return rows;
      });
    },
    [fitnessWeek],
  );

  const saveFitnessItem = ({ workoutIndex, completed, details, date = undefined, weekStart = "", saveSeq }) => {
    setFitnessError("");
    setFitnessStatus("Saving…");
    enqueueFitnessSave(async () => {
      const json = await updateFitnessItem({ workoutIndex, checked: completed, details, date, weekStart });
      if (saveSeq !== fitnessWeekSaveSeqRef.current) return;

      const nextWeek = normalizeFitnessWeek(json?.week);
      if (nextWeek) upsertFitnessWeekState(nextWeek);
      setFitnessStatus("Saved.");
    }).catch((e) => {
      if (saveSeq === fitnessWeekSaveSeqRef.current) {
        setFitnessError(e instanceof Error ? e.message : String(e));
        setFitnessStatus("");
      }
    });
  };

  const debouncedSaveFitnessItem = useDebouncedKeyedCallback(saveFitnessItem, 450);

  const onToggleFitness = (workoutIndex, completed, weekStart = "") => {
    const saveSeq = ++fitnessWeekSaveSeqRef.current;
    const selectedWeekStart = typeof weekStart === "string" ? weekStart : "";
    const editCurrent = !selectedWeekStart || selectedWeekStart === fitnessWeek?.week_start;

    if (editCurrent) {
      setFitnessWeek((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const list = Array.isArray(next?.workouts) ? next.workouts : [];
        if (!list[workoutIndex]) return prev;
        list[workoutIndex].completed = completed;
        if (!completed) list[workoutIndex].details = "";
        debouncedSaveFitnessItem(`workout:${selectedWeekStart || "current"}:${workoutIndex}`, {
          workoutIndex,
          completed,
          details: list[workoutIndex].details ?? "",
          date: list[workoutIndex].date || "",
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return next;
      });
      return;
    }

    setFitnessHistory((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      let changed = false;
      const nextRows = rows.map((week) => {
        if (week?.week_start !== selectedWeekStart) return week;
        const nextWeek = structuredClone(week);
        const list = Array.isArray(nextWeek?.workouts) ? nextWeek.workouts : [];
        if (!list[workoutIndex]) return week;
        changed = true;
        list[workoutIndex].completed = completed;
        if (!completed) list[workoutIndex].details = "";
        debouncedSaveFitnessItem(`workout:${selectedWeekStart}:${workoutIndex}`, {
          workoutIndex,
          completed,
          details: list[workoutIndex].details ?? "",
          date: list[workoutIndex].date || "",
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return nextWeek;
      });
      return changed ? nextRows : prev;
    });
  };

  const onEditFitnessDetails = (workoutIndex, details, weekStart = "") => {
    const saveSeq = ++fitnessWeekSaveSeqRef.current;
    const selectedWeekStart = typeof weekStart === "string" ? weekStart : "";
    const editCurrent = !selectedWeekStart || selectedWeekStart === fitnessWeek?.week_start;

    if (editCurrent) {
      setFitnessWeek((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const list = Array.isArray(next?.workouts) ? next.workouts : [];
        if (!list[workoutIndex]) return prev;
        list[workoutIndex].details = details;
        debouncedSaveFitnessItem(`workout:${selectedWeekStart || "current"}:${workoutIndex}`, {
          workoutIndex,
          completed: Boolean(list[workoutIndex].completed),
          details,
          date: list[workoutIndex].date || "",
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return next;
      });
      return;
    }

    setFitnessHistory((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      let changed = false;
      const nextRows = rows.map((week) => {
        if (week?.week_start !== selectedWeekStart) return week;
        const nextWeek = structuredClone(week);
        const list = Array.isArray(nextWeek?.workouts) ? nextWeek.workouts : [];
        if (!list[workoutIndex]) return week;
        changed = true;
        list[workoutIndex].details = details;
        debouncedSaveFitnessItem(`workout:${selectedWeekStart}:${workoutIndex}`, {
          workoutIndex,
          completed: Boolean(list[workoutIndex].completed),
          details,
          date: list[workoutIndex].date || "",
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return nextWeek;
      });
      return changed ? nextRows : prev;
    });
  };

  const onEditFitnessDate = (workoutIndex, date, weekStart = "") => {
    const saveSeq = ++fitnessWeekSaveSeqRef.current;
    const selectedWeekStart = typeof weekStart === "string" ? weekStart : "";
    const editCurrent = !selectedWeekStart || selectedWeekStart === fitnessWeek?.week_start;

    if (editCurrent) {
      setFitnessWeek((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        const list = Array.isArray(next?.workouts) ? next.workouts : [];
        if (!list[workoutIndex]) return prev;
        list[workoutIndex].date = date;
        debouncedSaveFitnessItem(`workout:${selectedWeekStart || "current"}:${workoutIndex}`, {
          workoutIndex,
          completed: Boolean(list[workoutIndex].completed),
          details: typeof list[workoutIndex].details === "string" ? list[workoutIndex].details : "",
          date,
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return next;
      });
      return;
    }

    setFitnessHistory((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      let changed = false;
      const nextRows = rows.map((week) => {
        if (week?.week_start !== selectedWeekStart) return week;
        const nextWeek = structuredClone(week);
        const list = Array.isArray(nextWeek?.workouts) ? nextWeek.workouts : [];
        if (!list[workoutIndex]) return week;
        changed = true;
        list[workoutIndex].date = date;
        debouncedSaveFitnessItem(`workout:${selectedWeekStart}:${workoutIndex}`, {
          workoutIndex,
          completed: Boolean(list[workoutIndex].completed),
          details: typeof list[workoutIndex].details === "string" ? list[workoutIndex].details : "",
          date,
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return nextWeek;
      });
      return changed ? nextRows : prev;
    });
  };

  const saveFitnessWeekContext = ({ context, weekStart = "", saveSeq }) => {
    setFitnessError("");
    setFitnessStatus("Saving…");
    enqueueFitnessSave(async () => {
      const json = await updateFitnessWeekContext(context, { weekStart });
      if (saveSeq !== fitnessWeekSaveSeqRef.current) return;

      const nextWeek = normalizeFitnessWeek(json?.week);
      if (nextWeek) upsertFitnessWeekState(nextWeek);
      setFitnessStatus("Saved.");
    }).catch((e) => {
      if (saveSeq === fitnessWeekSaveSeqRef.current) {
        setFitnessError(e instanceof Error ? e.message : String(e));
        setFitnessStatus("");
      }
    });
  };

  const debouncedSaveFitnessWeekContext = useDebouncedKeyedCallback(saveFitnessWeekContext, 450);

  const onGenerateFitnessSummary = () => {
    const saveSeq = ++fitnessSummarySeqRef.current;
    setFitnessError("");
    setFitnessStatus("Generating AI summary…");
    setFitnessSummaryGenerating(true);
    enqueueFitnessSave(async () => {
      try {
        const json = await updateFitnessSummary();
        if (saveSeq !== fitnessSummarySeqRef.current) return;
        const nextWeek = normalizeFitnessWeek(json?.week);
        if (nextWeek) setFitnessWeek(nextWeek);
        setFitnessStatus("AI summary generated.");
      } finally {
        if (saveSeq === fitnessSummarySeqRef.current) setFitnessSummaryGenerating(false);
      }
    }).catch((e) => {
      if (saveSeq === fitnessSummarySeqRef.current) {
        setFitnessError(e instanceof Error ? e.message : String(e));
        setFitnessStatus("");
        setFitnessSummaryGenerating(false);
      }
    });
  };

  const onEditWeekContext = (context, weekStart = "") => {
    const value = typeof context === "string" ? context : "";
    const saveSeq = ++fitnessWeekSaveSeqRef.current;
    const selectedWeekStart = typeof weekStart === "string" ? weekStart : "";
    const editCurrent = !selectedWeekStart || selectedWeekStart === fitnessWeek?.week_start;

    if (editCurrent) {
      setFitnessWeek((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        next.context = value;
        debouncedSaveFitnessWeekContext(`fitness-week-context:${selectedWeekStart || "current"}`, {
          context: value,
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return next;
      });
      return;
    }

    setFitnessHistory((prev) => {
      const rows = Array.isArray(prev) ? prev : [];
      let changed = false;
      const nextRows = rows.map((week) => {
        if (week?.week_start !== selectedWeekStart) return week;
        changed = true;
        const nextWeek = structuredClone(week);
        nextWeek.context = value;
        debouncedSaveFitnessWeekContext(`fitness-week-context:${selectedWeekStart}`, {
          context: value,
          weekStart: selectedWeekStart,
          saveSeq,
        });
        return nextWeek;
      });
      return changed ? nextRows : prev;
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
  const settingsBlockOptions = useMemo(() => {
    const blocks = Array.isArray(settingsTrainingBlocks.blocks) ? settingsTrainingBlocks.blocks : [];
    const sorted = sortTrainingBlocksMostCurrentFirst(blocks);
    return sorted.map((row) => ({
      ...normalizeSettingsBlockDraft(row),
      id: row.id,
      dateRangeLabel: formatBlockDateRangeLabel(row.block_start, row.block_end),
      label: row.name || "Untitled block",
    }));
  }, [settingsTrainingBlocks]);

  const selectedBlockOption =
    settingsBlockOptions.find((row) => row.id === settingsSelectedBlockId) ||
    settingsBlockOptions.find((row) => row.id === (settingsTrainingBlocks.active_block_id || "")) ||
    null;
  const selectedComparable = useMemo(
    () => JSON.stringify(normalizeSettingsBlockForComparison(selectedBlockOption)),
    [selectedBlockOption],
  );
  const draftComparable = useMemo(() => JSON.stringify(normalizeSettingsBlockForComparison(settingsBlockDraft)), [settingsBlockDraft]);
  const settingsBlockDraftDirty =
    settingsBlockDraft.id === (selectedBlockOption?.id || "") && draftComparable !== selectedComparable;

  useEffect(() => {
    const nextDraft = normalizeSettingsBlockDraft(selectedBlockOption || {});

    setSettingsBlockDraft((prev) => {
      const nextComparable = JSON.stringify(normalizeSettingsBlockForComparison(nextDraft));
      const prevComparable = JSON.stringify(normalizeSettingsBlockForComparison(prev));
      if (nextComparable === prevComparable) return prev;
      return nextDraft;
    });
  }, [selectedBlockOption]);

  useEffect(() => {
    const nextChecklistJson = blockDraftToJson(settingsBlockDraft);
    setSettingsChecklistJsonDraft((prev) => (prev === nextChecklistJson ? prev : nextChecklistJson));
    setSettingsChecklistJsonError("");
  }, [settingsBlockDraft]);

  useEffect(() => {
    if (signedOut) return;
    if (!settingsBlockDraftDirty) return;
    if (!settingsSelectedBlockId || settingsProfilesSaving) return;

    const snapshot = normalizeSettingsBlockForProposal(settingsBlockDraft);

    const timeoutId = setTimeout(async () => {
      const saveSeq = ++settingsBlocksSaveSeqRef.current;
      setSettingsBlocksSaving(true);
      try {
        setSettingsError("");
        await applySettingsProposal({
          proposal: {
            training_block: {
              operation: "replace_workouts",
              id: snapshot.id,
              name: snapshot.name,
              description: snapshot.description,
              block_start: snapshot.block_start,
              block_end: snapshot.block_end,
              workouts: snapshot.workouts,
              apply_timing: "immediate",
            },
          },
          selectedBlockId: settingsSelectedBlockId,
        });
      } catch (err) {
        if (saveSeq === settingsBlocksSaveSeqRef.current) {
          setSettingsError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (saveSeq === settingsBlocksSaveSeqRef.current) {
          setSettingsBlocksSaving(false);
        }
      }
    }, 700);

    return () => clearTimeout(timeoutId);
  }, [
    settingsBlockDraft,
    settingsBlockDraftDirty,
    settingsSelectedBlockId,
    settingsProfilesSaving,
    signedOut,
    applySettingsProposal,
  ]);

  const onAddBlock = async () => {
    if (settingsBlocksSaving) return;
    const newBlockId =
      typeof window !== "undefined" && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : `block_${Date.now()}`;
    try {
      setSettingsBlocksSaving(true);
      setSettingsError("");
      await applySettingsProposal({
        proposal: {
          training_block: {
            operation: "create_block",
            id: newBlockId,
            name: "New block",
            description: "",
            workouts: [
              {
                name: "New checklist item",
                description: "",
                category: "Workouts",
                optional: false,
              },
            ],
            apply_timing: "immediate",
          },
        },
        selectedBlockId: settingsSelectedBlockId,
      });
      setSettingsSelectedBlockId(newBlockId);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBlocksSaving(false);
    }
  };

  const onDeleteBlock = async () => {
    if (!settingsSelectedBlockId || settingsBlocksSaving) return;
    if (!window.confirm("Delete this block?")) return;
    try {
      setSettingsBlocksSaving(true);
      setSettingsError("");
      await applySettingsProposal({
        proposal: {
          training_block: {
            operation: "delete_block",
            id: settingsSelectedBlockId,
            apply_timing: "immediate",
          },
        },
        selectedBlockId: settingsSelectedBlockId,
      });
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsBlocksSaving(false);
    }
  };

  const onOpenSettingsTrainingImport = () => {
    if (settingsBlocksSaving) return;
    setSettingsTrainingImportText("");
    setSettingsTrainingImportValidation(validateSettingsTrainingImport(""));
    setSettingsTrainingImportConfirmText("");
    setSettingsTrainingImportAnalysis(null);
    setSettingsTrainingImportError("");
    setSettingsTrainingImportResult(null);
    setSettingsTrainingImportOpen(true);
  };

  const onCloseSettingsTrainingImport = () => {
    if (settingsTrainingImportLoading) return;
    setSettingsTrainingImportOpen(false);
    setSettingsTrainingImportText("");
    setSettingsTrainingImportValidation(validateSettingsTrainingImport(""));
    setSettingsTrainingImportConfirmText("");
    setSettingsTrainingImportError("");
    setSettingsTrainingImportAnalysis(null);
    setSettingsTrainingImportResult(null);
  };

  const onSettingsTrainingImportTextChange = (value) => {
    const nextValue = typeof value === "string" ? value : "";
    setSettingsTrainingImportText(nextValue);
    setSettingsTrainingImportValidation(validateSettingsTrainingImport(nextValue));
    setSettingsTrainingImportError("");
    setSettingsTrainingImportAnalysis(null);
    setSettingsTrainingImportResult(null);
  };

  const onSubmitSettingsTrainingImport = async () => {
    if (settingsTrainingImportLoading) return;
    if (!settingsTrainingImportValidation.valid) {
      setSettingsTrainingImportError(settingsTrainingImportValidation.error || "Training JSON structure is invalid.");
      return;
    }
    if (settingsTrainingImportConfirmText.trim() !== "IMPORT") {
      setSettingsTrainingImportError("Type IMPORT to confirm.");
      return;
    }

    setSettingsTrainingImportLoading(true);
    setSettingsTrainingImportError("");
    setSettingsTrainingImportResult(null);

    try {
      const analysis = await analyzeUserImport({ rawText: settingsTrainingImportText });
      setSettingsTrainingImportAnalysis(analysis);
      const token = typeof analysis?.import_token === "string" ? analysis.import_token : "";
      if (!token) {
        setSettingsTrainingImportError("No importable training domains were found in this JSON.");
        return;
      }

      const summary = analysis?.summary || {};
      const hasTrainingBlocks = Boolean(summary.activity_blocks?.importable);
      const hasTrainingWeeks = Boolean(summary.activity_weeks?.importable);
      if (!hasTrainingBlocks || !hasTrainingWeeks) {
        setSettingsTrainingImportError("Import JSON must include importable training blocks and tracking weeks.");
        return;
      }

      const result = await confirmUserImport({ importToken: token, confirmText: "IMPORT" });
      setSettingsTrainingImportResult(result);
      setImportStatus("Training import complete.");

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
      setSettingsTrainingImportOpen(false);
    } catch (err) {
      setSettingsTrainingImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setSettingsTrainingImportLoading(false);
    }
  };

  const onChecklistJsonChange = (value) => {
    const nextValue = typeof value === "string" ? value : "";
    setSettingsChecklistJsonDraft(nextValue);
    try {
      const parsed = JSON.parse(nextValue);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Block JSON must be an object.");
      }
      const nextDraft = normalizeSettingsBlockDraft(parsed, settingsBlockDraft.id || settingsSelectedBlockId);
      setSettingsChecklistJsonError("");
      setSettingsBlockDraft({
        ...nextDraft,
        id: settingsBlockDraft.id || nextDraft.id,
      });
    } catch (err) {
      setSettingsChecklistJsonError(err instanceof Error ? err.message : "Invalid block JSON.");
    }
  };

  const sidebarDayEntries = Array.isArray(sidebarDaySummary?.food_entries) ? sidebarDaySummary.food_entries : [];
  const sidebarDayMealsSummary = sidebarDayEntries.length
    ? `${sidebarDayEntries.slice(0, 3).join(", ")}${sidebarDayEntries.length > 3 ? ` +${sidebarDayEntries.length - 3} more` : ""}`
    : "No meals logged yet.";

  const sidebarTotals = sidebarDaySummary?.totals ?? {};
  const sidebarCalories = typeof sidebarTotals.calories === "number" ? sidebarTotals.calories : null;
  const sidebarProtein = typeof sidebarTotals.protein_g === "number" ? sidebarTotals.protein_g : null;
  const sidebarCarbs = typeof sidebarTotals.carbs_g === "number" ? sidebarTotals.carbs_g : null;
  const sidebarFat = typeof sidebarTotals.fat_g === "number" ? sidebarTotals.fat_g : null;
  const shouldShowSidebar = view !== "workouts" && view !== "diet";

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
            settingsError={settingsError}
            settingsBlocksSaving={settingsBlocksSaving}
            settingsProfiles={settingsProfilesDraft}
            onSettingsProfileChange={onSettingsProfileChange}
            blockOptions={settingsBlockOptions}
            selectedBlockId={selectedBlockOption?.id || ""}
            onSelectBlock={setSettingsSelectedBlockId}
            onAddBlock={onAddBlock}
            onDeleteBlock={onDeleteBlock}
            onOpenTrainingImport={onOpenSettingsTrainingImport}
            checklistJsonValue={settingsChecklistJsonDraft}
            checklistJsonError={settingsChecklistJsonError}
            onChecklistJsonChange={onChecklistJsonChange}
          />
        ) : (
          <div className={`mainContentRow${shouldShowSidebar ? "" : " noSidebar"}`}>
            {shouldShowSidebar ? (
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
                fitnessWeek={fitnessWeek}
                fmt={fmt}
              />
            ) : null}
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
                  fitnessSummaryGenerating={fitnessSummaryGenerating}
                  fitnessHistory={fitnessHistory}
                  fitnessHistoryError={fitnessHistoryError}
                  fitnessHistoryLoading={fitnessHistoryLoading}
                  onToggleFitness={onToggleFitness}
                  onEditFitnessDetails={onEditFitnessDetails}
                  onEditFitnessDate={onEditFitnessDate}
                  onEditWeekContext={onEditWeekContext}
                  onGenerateFitnessSummary={onGenerateFitnessSummary}
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

        {settingsTrainingImportOpen ? (
          <div
            className="importModalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label="Import training data"
          >
            <div className="importModalCard">
              <div className="importModalHeader">
                <h2>Import training</h2>
                <button
                  type="button"
                  className="secondary small"
                  onClick={onCloseSettingsTrainingImport}
                  disabled={settingsTrainingImportLoading}
                >
                  Close
                </button>
              </div>

              <p className="muted">
                This will <strong>overwrite all existing training blocks and tracked workouts</strong>. This cannot be undone.
              </p>

              <div className="importModalRow">
                <label htmlFor="settings_training_import_text">
                  <strong>Paste training JSON</strong>
                </label>
                <textarea
                  id="settings_training_import_text"
                  value={settingsTrainingImportText}
                  disabled={settingsTrainingImportLoading}
                  onChange={(e) => onSettingsTrainingImportTextChange(e.target.value)}
                  placeholder='{"export":{"data":{"training":{"blocks":[...],"weeks":[...]}}}}'
                  rows={10}
                />
              </div>

              {settingsTrainingImportValidation.valid ? (
                <div className="importSummary">
                  <p>
                    <strong>Detected training shape:</strong>{" "}
                    {settingsTrainingImportValidation.blocksCount} blocks,{" "}
                    {settingsTrainingImportValidation.weeksCount} weeks
                  </p>
                </div>
              ) : (
                <div className="error">{settingsTrainingImportValidation.error}</div>
              )}

              {Array.isArray(settingsTrainingImportAnalysis?.warnings) && settingsTrainingImportAnalysis.warnings.length ? (
                <div className="importWarnings">
                  <p>
                    <strong>Server warnings:</strong>
                  </p>
                  <ul>
                    {settingsTrainingImportAnalysis.warnings.map((warning, idx) => (
                      <li key={idx}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {settingsTrainingImportResult ? (
                <div className="importSummary">
                  <p>
                    <strong>Applied:</strong> {(settingsTrainingImportResult.applied_domains || []).join(", ") || "(none)"}
                  </p>
                  {Array.isArray(settingsTrainingImportResult.skipped_domains) && settingsTrainingImportResult.skipped_domains.length ? (
                    <p>
                      <strong>Skipped:</strong>{" "}
                      {settingsTrainingImportResult.skipped_domains
                        .map((entry) => `${entry.domain}${entry.reason ? ` (${entry.reason})` : ""}`)
                        .join(", ")}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="importConfirmRow">
                <label htmlFor="settings_training_import_confirm_text">
                  Type <code>IMPORT</code> to confirm overwrite:
                </label>
                <input
                  id="settings_training_import_confirm_text"
                  type="text"
                  value={settingsTrainingImportConfirmText}
                  disabled={settingsTrainingImportLoading}
                  onChange={(e) => setSettingsTrainingImportConfirmText(e.target.value)}
                  placeholder="IMPORT"
                />
              </div>

              <StatusMessage error={settingsTrainingImportError} className="composerStatus" />

              <div className="importModalActions">
                <button
                  type="button"
                  className="danger"
                  onClick={onSubmitSettingsTrainingImport}
                  disabled={
                    settingsTrainingImportLoading ||
                    !settingsTrainingImportValidation.valid ||
                    settingsTrainingImportConfirmText.trim() !== "IMPORT"
                  }
                >
                  {settingsTrainingImportLoading ? "Importing…" : "Overwrite training"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

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

              <p className="muted">Upload a canonical JSON export or paste JSON text. Import replaces matching domains in your current data.</p>

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
                  placeholder='Paste export JSON (for example: {"export":{"data":...}})'
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
