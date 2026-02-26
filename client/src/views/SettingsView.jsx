import React, { useEffect, useMemo, useRef } from "react";

import SettingsYearCalendar2026 from "../components/SettingsYearCalendar2026.jsx";
import StatusMessage from "../components/StatusMessage.jsx";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function highlightJson(value) {
  const escaped = escapeHtml(value);
  const tokenPattern = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g;
  return escaped.replace(tokenPattern, (token) => {
    let className = "jsonTokenNumber";
    if (/^"/.test(token)) {
      className = /:$/.test(token) ? "jsonTokenKey" : "jsonTokenString";
    } else if (token === "true" || token === "false") {
      className = "jsonTokenBoolean";
    } else if (token === "null") {
      className = "jsonTokenNull";
    }
    return `<span class="${className}">${token}</span>`;
  });
}

const WEEK_ROW_HEIGHT_PX = 24;
const WEEK_ROW_HEIGHT_OVERLAP_PX = 28;
const MONTH_GAP_ROW_HEIGHT_PX = 6;

function parseDate(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function addMonths(value, months) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  return new Date(Date.UTC(year, month, 1));
}

function firstDayOfMonthFor(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function lastDayOfMonthFor(value) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

function parseBlockRange(blocks = [], selectedStart = "", selectedEnd = "") {
  const points = [];
  blocks.forEach((block) => {
    const start = parseDate(block?.block_start);
    const end = parseDate(block?.block_end);
    if (start) points.push(start);
    if (end) points.push(end);
  });

  const selectedParsedStart = parseDate(selectedStart);
  const selectedParsedEnd = parseDate(selectedEnd);
  if (selectedParsedStart) points.push(selectedParsedStart);
  if (selectedParsedEnd) points.push(selectedParsedEnd);

  if (!points.length) {
    const now = new Date();
    const fallback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return { start: fallback, end: fallback };
  }

  const minDate = points.reduce((acc, value) => (value < acc ? value : acc), points[0]);
  const maxDate = points.reduce((acc, value) => (value > acc ? value : acc), points[0]);
  return { start: minDate, end: maxDate };
}

function getMondayStart(value) {
  const date = new Date(value.getTime());
  const weekday = date.getUTCDay();
  const offsetToMonday = (weekday + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offsetToMonday);
  return date;
}

function monthIdForDate(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function getMonthIdsForWeek(week) {
  const monthIds = new Set();
  monthIds.add(monthIdForDate(week.startDate));
  monthIds.add(monthIdForDate(week.endDate));
  return monthIds;
}

function getCurrentWeekIndex(weeks = []) {
  if (!weeks.length) {
    return 0;
  }

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const currentWeekStart = getMondayStart(todayUtc);
  const firstWeekStart = weeks[0].startDate;
  const weekIndex = Math.floor((currentWeekStart - firstWeekStart) / (7 * 24 * 60 * 60 * 1000));
  return Math.max(0, Math.min(weeks.length - 1, weekIndex));
}

function generateWeeksForRange(rangeStart, rangeEnd) {
  const firstWeekStart = getMondayStart(rangeStart);
  const rows = [];
  let weekStart = new Date(firstWeekStart);
  while (weekStart <= rangeEnd) {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    rows.push({
      index: rows.length,
      startDate: new Date(weekStart),
      endDate: new Date(weekEnd),
    });
    weekStart = new Date(weekStart);
    weekStart.setUTCDate(weekStart.getUTCDate() + 7);
  }
  return rows;
}

function isOverlapWeek(week) {
  const startMonth = week.startDate.getUTCMonth();
  const endMonth = week.endDate.getUTCMonth();
  return startMonth !== endMonth;
}

function computeVisibleWeeksAndRange(blockOptions, selectedStart, selectedEnd) {
  const { start: selectedDateStart, end: selectedDateEnd } = parseBlockRange(
    blockOptions,
    selectedStart,
    selectedEnd
  );
  const visibleStart = addMonths(firstDayOfMonthFor(selectedDateStart), -1);
  const visibleEnd = lastDayOfMonthFor(addMonths(firstDayOfMonthFor(selectedDateEnd), 2));
  const rawWeeks = generateWeeksForRange(visibleStart, visibleEnd).map((week) => ({
    ...week,
    rowHeight: isOverlapWeek(week) ? WEEK_ROW_HEIGHT_OVERLAP_PX : WEEK_ROW_HEIGHT_PX,
  }));
  const weeks = rawWeeks.map((week) => ({
    ...week,
    hasMonthGapAfter: false,
  }));
  for (let i = 0; i < weeks.length - 1; i += 1) {
    const currentMonthIds = getMonthIdsForWeek(weeks[i]);
    const nextMonthIds = getMonthIdsForWeek(weeks[i + 1]);
    const hasMonthTransitionAfter =
      [...currentMonthIds].length !== [...nextMonthIds].length ||
      [...currentMonthIds].some((monthId) => !nextMonthIds.has(monthId)) ||
      [...nextMonthIds].some((monthId) => !currentMonthIds.has(monthId));
    const isTransitionWithoutOverlap =
      hasMonthTransitionAfter &&
      currentMonthIds.size === 1 &&
      nextMonthIds.size === 1 &&
      [...currentMonthIds][0] !== [...nextMonthIds][0];

    if (isTransitionWithoutOverlap) {
      weeks[i].hasMonthGapAfter = true;
    }
  }
  return { weeks, visibleStart, visibleEnd };
}

export default function SettingsView({
  settingsError,
  settingsBlocksSaving = false,
  settingsProfiles,
  onSettingsProfileChange,
  blockOptions = [],
  selectedBlockId = "",
  onSelectBlock = () => {},
  onAddBlock = () => {},
  onDeleteBlock = () => {},
  onOpenTrainingImport = () => {},
  checklistJsonValue = "{}",
  checklistJsonError = "",
  onChecklistJsonChange = () => {},
  selectedBlockStartDate = "",
  selectedBlockEndDate = "",
}) {
  const profiles = settingsProfiles && typeof settingsProfiles === "object" ? settingsProfiles : {};
  const checklistJsonText = typeof checklistJsonValue === "string" ? checklistJsonValue : "{}";
  const checklistJsonHighlighted = useMemo(() => highlightJson(checklistJsonText), [checklistJsonText]);
  const checklistJsonHighlightRef = useRef(null);
  const calendarViewportRef = useRef(null);
  const hasBlocks = Array.isArray(blockOptions) && blockOptions.length > 0;
  const selectedExists = hasBlocks && blockOptions.some((block) => block?.id === selectedBlockId);
  const selectValue = selectedExists ? selectedBlockId : hasBlocks ? blockOptions[0].id : "";
  const { weeks: calendarWeeks, visibleStart, visibleEnd } = useMemo(
    () => computeVisibleWeeksAndRange(blockOptions, selectedBlockStartDate, selectedBlockEndDate),
    [blockOptions, selectedBlockStartDate, selectedBlockEndDate]
  );
  const calendarWeekHeightsPrefix = useMemo(() => {
    const prefix = [0];
    for (let i = 0; i < calendarWeeks.length; i += 1) {
      const nextTop = prefix[i] + (calendarWeeks[i].rowHeight || WEEK_ROW_HEIGHT_PX);
      prefix.push(
        nextTop + (calendarWeeks[i].hasMonthGapAfter ? MONTH_GAP_ROW_HEIGHT_PX : 0)
      );
    }
    return prefix;
  }, [calendarWeeks]);
  const minCalendarHeight = calendarWeekHeightsPrefix[calendarWeekHeightsPrefix.length - 1] ?? 0;
  const currentWeekIndex = useMemo(() => getCurrentWeekIndex(calendarWeeks), [calendarWeeks]);
  const weekIndexByStartDate = new Map(
    calendarWeeks.map((week) => [week.startDate.getTime(), week.index])
  );

  const weekTopByIndex = useMemo(
    () =>
      new Map(
        calendarWeeks.map((week, index) => [index, calendarWeekHeightsPrefix[index] || 0])
      ),
    [calendarWeeks, calendarWeekHeightsPrefix]
  );

  const weekBottomByIndex = useMemo(
    () =>
      new Map(
        calendarWeeks.map((week, index) => [
          index,
          (calendarWeekHeightsPrefix[index] || 0) + (week.rowHeight || WEEK_ROW_HEIGHT_PX),
        ])
      ),
    [calendarWeeks, calendarWeekHeightsPrefix]
  );

  const blockSpans = useMemo(
    () =>
      blockOptions.map((block) => {
        const blockStart = parseDate(block?.block_start);
        const blockEnd = parseDate(block?.block_end);

        if (!blockStart) {
          return null;
        }

        const normalizedStart = getMondayStart(blockStart);
        const normalizedEnd = getMondayStart(blockEnd || visibleEnd);
        const clampedStart = normalizedStart < visibleStart ? new Date(visibleStart) : normalizedStart;
        const clampedEnd = normalizedEnd > visibleEnd ? getMondayStart(visibleEnd) : normalizedEnd;

        const startIndex = weekIndexByStartDate.get(clampedStart.getTime());
        const endIndex = weekIndexByStartDate.get(clampedEnd.getTime());

        if (startIndex === undefined || endIndex === undefined) {
          return null;
        }

        const finalStart = Math.min(startIndex, endIndex);
        const finalEnd = Math.max(startIndex, endIndex);
        const top = weekTopByIndex.get(finalStart) || 0;
        const bottom = weekBottomByIndex.get(finalEnd) || 0;
        const height = Math.max(0, bottom - top);
        const blockId = block?.id || "";

        return { ...block, blockId, top, height };
      }).filter(Boolean),
    [
      blockOptions,
      calendarWeekHeightsPrefix,
      calendarWeeks,
      visibleEnd,
      visibleStart,
      weekIndexByStartDate,
      weekTopByIndex,
      weekBottomByIndex,
    ]
  );

  useEffect(() => {
    const viewport = calendarViewportRef.current;
    if (!viewport || !calendarWeeks.length) return;

    const currentWeekTop = weekTopByIndex.get(currentWeekIndex) || 0;
    const targetTop = Math.max(0, currentWeekTop - WEEK_ROW_HEIGHT_PX);
    const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    viewport.scrollTop = Math.min(maxScrollTop, targetTop);
  }, [calendarWeeks, currentWeekIndex, weekTopByIndex]);

  return (
    <section className="chatPanel">
      <div className="chatBox chatBoxFull">
        <div className="settingsEditorSplit">
          <aside className="settingsProfilesPanel" aria-label="Settings profiles">
            <div className="settingsProfilesHeader sidebarSectionHeader">
              <h2 className="sidebarHeading">Settings profiles</h2>
            </div>
            <div className="settingsProfilesFields">
              <label className="settingsProfilesField" htmlFor="general_text">
                <span className="sidebarSectionLabel">General profile</span>
                <textarea
                  id="general_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.general === "string" ? profiles.general : ""}
                  onChange={(e) => onSettingsProfileChange("general", e.target.value)}
                  placeholder="Overall goals, body/health context, lifestyle, meds/conditions, and key coaching context."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="fitness_text">
                <span className="sidebarSectionLabel">Fitness profile</span>
                <textarea
                  id="fitness_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.fitness === "string" ? profiles.fitness : ""}
                  onChange={(e) => onSettingsProfileChange("fitness", e.target.value)}
                  placeholder="Training plan, phases/blocks schedule, fitness goals, injuries, and logging shortcuts."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="diet_text">
                <span className="sidebarSectionLabel">Diet profile</span>
                <textarea
                  id="diet_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.diet === "string" ? profiles.diet : ""}
                  onChange={(e) => onSettingsProfileChange("diet", e.target.value)}
                  placeholder="Diet preferences, recipes, caloric targets, and food logging shortcuts."
                />
              </label>
              <label className="settingsProfilesField" htmlFor="agent_text">
                <span className="sidebarSectionLabel">Agent profile</span>
                <textarea
                  id="agent_text"
                  className="settingsProfileTextarea"
                  value={typeof profiles.agent === "string" ? profiles.agent : ""}
                  onChange={(e) => onSettingsProfileChange("agent", e.target.value)}
                  placeholder="Broad rules for assistant behavior and response style."
                />
              </label>
            </div>
          </aside>

          <aside className="settingsBlocksPanel" aria-label="Blocks editor">
              <div className="settingsBlockHeaderRow">
              <h2 className="sidebarHeading">Blocks</h2>
              <div className="settingsBlockHeaderActions">
                <button type="button" className="secondary small" onClick={onAddBlock} disabled={settingsBlocksSaving}>
                  Add block
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={onOpenTrainingImport}
                  disabled={settingsBlocksSaving}
                >
                  Import
                </button>
                <button
                  type="button"
                  className="secondary small"
                  onClick={onDeleteBlock}
                  disabled={!selectValue || settingsBlocksSaving}
                >
                  Delete block
                </button>
              </div>
            </div>

            <div className="settingsCalendarViewport" ref={calendarViewportRef}>
              <div className="settingsCalendarSelectionRow">
                <SettingsYearCalendar2026
                  activeBlockStartDate={selectedBlockStartDate}
                  activeBlockEndDate={selectedBlockEndDate}
                  blockOptions={blockOptions}
                />
                <div className="settingsBlockListField" role="listbox" aria-label="Block list">
                  <div className="settingsBlockTimeline" style={{ minHeight: `${minCalendarHeight}px` }}>
                    {blockSpans.length > 0 ? (
                      blockSpans.map((block) => {
                        const blockId = block.blockId || "";
                        const isSelected = blockId === selectValue;
                        return (
                          <button
                            key={block.id || block.label}
                            type="button"
                            className={`settingsBlockTimelineItem ${isSelected ? "active" : ""}`}
                            onClick={() => onSelectBlock(blockId)}
                            disabled={settingsBlocksSaving}
                            aria-pressed={isSelected}
                            style={{
                              top: `${block.top}px`,
                              height: `${block.height}px`,
                            }}
                          >
                            <span className="settingsBlockListTitle">
                              {typeof block?.label === "string" && block.label ? block.label : "Block"}
                            </span>
                            {typeof block?.dateRangeLabel === "string" && block.dateRangeLabel ? (
                              <span className="settingsBlockListDateRange">{block.dateRangeLabel}</span>
                            ) : null}
                          </button>
                        );
                      })
                    ) : (
                      <div className="muted">No blocks yet</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          </aside>

          <aside className="settingsChecklistEditorPanel" aria-label="Block JSON editor">

            <label className="settingsProfilesField settingsChecklistJsonField" htmlFor="settings_checklist_json">
              <div className="settingsChecklistJsonEditor">
                <pre
                  ref={checklistJsonHighlightRef}
                  className="settingsChecklistJsonHighlight"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: checklistJsonHighlighted }}
                />
                <textarea
                  id="settings_checklist_json"
                  className="settingsChecklistJsonTextarea"
                  value={checklistJsonText}
                  onChange={(e) => onChecklistJsonChange(e.target.value)}
                  onScroll={(event) => {
                    const highlightEl = checklistJsonHighlightRef.current;
                    if (!highlightEl) return;
                    highlightEl.scrollTop = event.currentTarget.scrollTop;
                    highlightEl.scrollLeft = event.currentTarget.scrollLeft;
                  }}
                  placeholder='{"id":"...","name":"Block name","description":"...","block_start":"YYYY-MM-DD","block_end":"","workouts":[{"name":"Workout","description":"","category":"Workouts","optional":false}]}'
                  spellCheck={false}
                />
              </div>
            </label>
            {checklistJsonError ? (
              <div className="error">{checklistJsonError}</div>
            ) : (
              <div className="muted">Edit the block as JSON. Save runs automatically after valid edits.</div>
            )}
          </aside>
        </div>

        <StatusMessage error={settingsError} className="composerStatus" />
      </div>
    </section>
  );
}
