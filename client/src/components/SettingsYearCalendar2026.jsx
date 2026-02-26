function parseDate(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function clampMonthDate(value, month) {
  const year = value.getUTCFullYear();
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 0));
  const day = Math.min(value.getUTCDate(), monthEnd.getUTCDate());
  return new Date(Date.UTC(year, month, day));
}

function addMonths(value, months) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  return clampMonthDate(value, month);
}

function firstDayOfMonthFor(value) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function lastDayOfMonthFor(value) {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth();
  return new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
}

function monthIdForDate(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(monthId) {
  const [yearRaw, monthRaw] = monthId.split("-").map(Number);
  const year = yearRaw;
  const month = monthRaw - 1;
  return {
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
  };
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

function generateWeeksForRange(rangeStart, rangeEnd) {
  const weekday = rangeStart.getUTCDay();
  const offsetToMonday = (weekday + 6) % 7;
  const firstWeekStart = new Date(rangeStart);
  firstWeekStart.setUTCDate(firstWeekStart.getUTCDate() - offsetToMonday);

  const rows = [];
  let weekStart = new Date(firstWeekStart);
  while (weekStart <= rangeEnd) {
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    rows.push({
      index: rows.length + 1,
      startDate: new Date(weekStart),
      endDate: new Date(weekEnd),
    });
    weekStart = new Date(weekStart);
    weekStart.setUTCDate(weekStart.getUTCDate() + 7);
  }

  return rows;
}

function buildMonthPaletteIndex(rangeStart, rangeEnd) {
  const start = firstDayOfMonthFor(rangeStart);
  const end = firstDayOfMonthFor(rangeEnd);
  const indexByMonth = new Map();
  let current = new Date(start);
  let index = 0;

  while (current <= end) {
    indexByMonth.set(monthIdForDate(current), index);
    index += 1;
    current = addMonths(current, 1);
  }

  return indexByMonth;
}

function getWeekSegmentsForMonthOverlap(week, monthPaletteIndex = new Map()) {
  const dayToMondayIndex = (date) => (date.getUTCDay() + 6) % 7;
  const monthCandidates = new Set();

  const startMonthId = monthIdForDate(week.startDate);
  const endMonthId = monthIdForDate(week.endDate);

  monthCandidates.add(startMonthId);
  monthCandidates.add(endMonthId);

  const segments = Array.from(monthCandidates).map((monthId) => {
    const { start: monthStart, end: monthEnd } = monthBounds(monthId);
    const segmentStart = new Date(Math.max(week.startDate.getTime(), monthStart.getTime()));
    const segmentEnd = new Date(Math.min(week.endDate.getTime(), monthEnd.getTime()));

    if (segmentStart > segmentEnd) return null;

    const segmentStartOffset = dayToMondayIndex(segmentStart);
    const segmentEndOffset = dayToMondayIndex(segmentEnd);

    const monthColorIndex = monthPaletteIndex.get(monthId) ?? 0;

    return {
      monthId,
      monthStart,
      segmentStart,
      segmentEnd,
      offsetDays: Math.max(0, Math.min(6, segmentStartOffset)),
      weekLengthDays: Math.max(1, Math.min(7, segmentEndOffset - segmentStartOffset + 1)),
      monthColorIndex,
    };
  });

  return segments.filter(Boolean).sort((a, b) => a.offsetDays - b.offsetDays);
}

function getMonthAbbrev(monthId) {
  const monthIndex = Number(monthId.split("-")[1]) - 1;
  return ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"][monthIndex];
}

function getCurrentWeekBounds() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekday = todayUtc.getUTCDay();
  const offsetToMonday = (weekday + 6) % 7;
  const weekStart = new Date(todayUtc);
  weekStart.setUTCDate(weekStart.getUTCDate() - offsetToMonday);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  return { weekStart, weekEnd };
}

function getConnectorInterval(currentOffsetDays, currentLengthDays, adjacentOffsetDays, adjacentLengthDays) {
  const currentStart = currentOffsetDays;
  const currentEnd = currentOffsetDays + currentLengthDays;
  const adjacentStart = adjacentOffsetDays;
  const adjacentEnd = adjacentOffsetDays + adjacentLengthDays;

  if (adjacentStart <= currentStart && adjacentEnd < currentEnd) {
    return {
      offsetDays: adjacentEnd,
      lengthDays: Math.max(1, currentEnd - adjacentEnd),
    };
  }

  if (adjacentEnd >= currentEnd && adjacentStart > currentStart) {
    return {
      offsetDays: currentStart,
      lengthDays: Math.max(1, adjacentStart - currentStart),
    };
  }

  return {
    offsetDays: currentStart,
    lengthDays: currentLengthDays,
  };
}

export default function SettingsYearCalendar2026({
  activeBlockStartDate = "",
  activeBlockEndDate = "",
  blockOptions = [],
}) {
  const { start: selectedDateStart, end: selectedDateEnd } = parseBlockRange(
    blockOptions,
    activeBlockStartDate,
    activeBlockEndDate
  );
  const visibleStart = addMonths(firstDayOfMonthFor(selectedDateStart), -1);
  const visibleEnd = lastDayOfMonthFor(addMonths(firstDayOfMonthFor(selectedDateEnd), 2));
  const monthPaletteIndex = buildMonthPaletteIndex(visibleStart, visibleEnd);
  const currentWeek = getCurrentWeekBounds();

  const rows = generateWeeksForRange(visibleStart, visibleEnd).map((week) => ({
    key: `week-${week.index}`,
    isCurrentWeek: week.startDate.getTime() === currentWeek.weekStart.getTime(),
    segments: (() => {
      const segments = getWeekSegmentsForMonthOverlap(week, monthPaletteIndex);
      if (segments.length === 2 && segments[0].monthColorIndex === segments[1].monthColorIndex) {
        segments[1].monthColorIndex += 1;
      }
      return segments;
    })(),
  })).filter((row) => row.segments.length > 0);

  const seenMonthLabels = new Set();
  const rowsWithMonthLabels = rows.map((row) => ({
    ...row,
    segments: row.segments.map((segment) => ({
      ...segment,
      isCurrentWeek: row.isCurrentWeek,
      showMonthLabel:
        !seenMonthLabels.has(segment.monthId) &&
        segment.weekLengthDays === 7 &&
        segment.offsetDays === 0,
      label: getMonthAbbrev(segment.monthId),
    })).map((segment) => {
      if (segment.showMonthLabel) {
        seenMonthLabels.add(segment.monthId);
      }
      return segment;
    }),
  }));

  const monthSpanById = new Map();
  rowsWithMonthLabels.forEach((row, rowIndex) => {
    row.segments.forEach((segment) => {
      const existing = monthSpanById.get(segment.monthId);
      if (!existing) {
        monthSpanById.set(segment.monthId, {
          firstRow: rowIndex,
          lastRow: rowIndex,
        });
      } else {
        existing.lastRow = rowIndex;
      }
    });
  });

  const rowsWithMonthBorders = rowsWithMonthLabels.map((row, rowIndex) => ({
    ...row,
    segments: row.segments.map((segment) => {
      const span = monthSpanById.get(segment.monthId);
      const previousRow = rowIndex > 0 ? rowsWithMonthLabels[rowIndex - 1] : null;
      const nextRow = rowIndex < rowsWithMonthLabels.length - 1 ? rowsWithMonthLabels[rowIndex + 1] : null;
      const previousSegment = previousRow
        ? previousRow.segments.find((candidate) => candidate.monthId === segment.monthId)
        : null;
      const nextSegment = nextRow
        ? nextRow.segments.find((candidate) => candidate.monthId === segment.monthId)
        : null;
      const hasGeometryChangeFromPrev =
        !!previousSegment &&
        (previousSegment.offsetDays !== segment.offsetDays ||
          previousSegment.weekLengthDays !== segment.weekLengthDays);
      const hasGeometryChangeToNext =
        !!nextSegment &&
        (nextSegment.offsetDays !== segment.offsetDays ||
          nextSegment.weekLengthDays !== segment.weekLengthDays);
      const topConnectorFromPrev =
        !!previousRow &&
        previousRow.segments.length > 1 &&
        hasGeometryChangeFromPrev &&
        !!previousSegment
          ? getConnectorInterval(
              segment.offsetDays,
              segment.weekLengthDays,
              previousSegment.offsetDays,
              previousSegment.weekLengthDays
            )
          : null;
      const bottomConnectorToNext =
        !!nextRow &&
        nextRow.segments.length > 1 &&
        hasGeometryChangeToNext &&
        !!nextSegment
          ? getConnectorInterval(
              segment.offsetDays,
              segment.weekLengthDays,
              nextSegment.offsetDays,
              nextSegment.weekLengthDays
            )
          : null;
      return {
        ...segment,
        isMonthStartRow: span ? span.firstRow === rowIndex : false,
        isMonthEndRow: span ? span.lastRow === rowIndex : false,
        hasGeometryChangeFromPrev,
        hasGeometryChangeToNext,
        hasTopBorder: (span ? span.firstRow === rowIndex : false) || !!topConnectorFromPrev,
        topBorderOffsetDays: topConnectorFromPrev ? topConnectorFromPrev.offsetDays : segment.offsetDays,
        topBorderLengthDays: topConnectorFromPrev ? topConnectorFromPrev.lengthDays : segment.weekLengthDays,
        hasBottomBorder: (span ? span.lastRow === rowIndex : false) || !!bottomConnectorToNext,
        bottomBorderOffsetDays: bottomConnectorToNext ? bottomConnectorToNext.offsetDays : segment.offsetDays,
        bottomBorderLengthDays: bottomConnectorToNext ? bottomConnectorToNext.lengthDays : segment.weekLengthDays,
      };
    }),
  }));

  const rowsWithMonthGaps = rowsWithMonthBorders.map((row, rowIndex) => {
    const currentMonthIds = new Set(row.segments.map((segment) => segment.monthId));
    const nextRow = rowIndex < rowsWithMonthBorders.length - 1 ? rowsWithMonthBorders[rowIndex + 1] : null;
    const nextMonthIds = nextRow ? new Set(nextRow.segments.map((segment) => segment.monthId)) : null;
    const hasMonthTransitionAfter =
      !!nextMonthIds &&
      (currentMonthIds.size !== nextMonthIds.size ||
        [...currentMonthIds].some((monthId) => !nextMonthIds.has(monthId)) ||
        [...nextMonthIds].some((monthId) => !currentMonthIds.has(monthId)));
    const isTransitionWithoutOverlap =
      hasMonthTransitionAfter &&
      currentMonthIds.size === 1 &&
      nextMonthIds &&
      nextMonthIds.size === 1 &&
      [...currentMonthIds][0] !== [...nextMonthIds][0];

    return {
      ...row,
      hasMonthTransitionAfter: isTransitionWithoutOverlap,
    };
  });

  return (
    <section className="settingsCalendarSection" aria-label="2026 calendar rows">
      <div className="settingsCalendarMonthRows">
        {rowsWithMonthGaps.flatMap((row, rowIndex) => {
          const isOverlappingWeek = row.segments.length > 1;
          const rowShadeClass = rowIndex % 2 === 0 ? "settingsCalendarWeekBarEven" : "settingsCalendarWeekBarOdd";
          const rowClassName = `settingsCalendarWeekRow ${isOverlappingWeek ? "settingsCalendarWeekRowOverlap" : ""} ${
            rowIndex % 2 === 0 ? "settingsCalendarWeekRowEven" : "settingsCalendarWeekRowOdd"
          }`.trim();
          const rowElement = (
            <div className={rowClassName} key={row.key}>
              {row.segments.map((segment, index) => {
                const hasNextSegment = index < row.segments.length - 1;
                const baseWidth = (segment.weekLengthDays / 7) * 100;
                const hasMultipleSegments = row.segments.length > 1;
                const displayWidth = Math.max(
                  0,
                  hasNextSegment && !hasMultipleSegments ? baseWidth - 0.5 : baseWidth
                );
                const overlapHorizontalGap = hasMultipleSegments ? 1 : 0;
                const overlapHalfGap = overlapHorizontalGap / 2;
                const isOverlappingSegment = row.segments.length === 2;
                const overlapLeft = isOverlappingSegment && index > 0 ? overlapHalfGap : 0;
                const overlapWidth = isOverlappingSegment ? baseWidth - overlapHalfGap : baseWidth;
                const splitClass =
                  isOverlappingWeek && row.segments.length === 2
                    ? index === 0
                      ? "settingsCalendarWeekBarOverlapTop"
                      : "settingsCalendarWeekBarOverlapBottom"
                    : "";
                const overlapWeekClass = isOverlappingWeek ? "settingsCalendarWeekBarOverlap" : "";
                const weekShadeClass = rowShadeClass;
                const leftOffset = segment.offsetDays / 7;
                const finalLeft = overlapHorizontalGap > 0 ? `${(leftOffset * 100) + overlapLeft}%` : `${leftOffset * 100}%`;
                const finalWidth = isOverlappingSegment ? Math.max(0, overlapWidth) : displayWidth;
                return (
                  <span key={`${row.key}-segment-${index}`}>
                    <span
                      className={`settingsCalendarWeekBar ${
                        segment.isCurrentWeek ? "settingsCalendarWeekBarCurrentWeek" : ""
                      } ${splitClass} ${overlapWeekClass} ${weekShadeClass}`.trim()}
                      style={{
                        left: finalLeft,
                        width: `${finalWidth}%`,
                      }}
                    />
                    {segment.showMonthLabel ? (
                      <span
                        className="settingsCalendarMonthLabel"
                        style={{ left: `${(segment.offsetDays / 7) * 100}%` }}
                      >
                        {segment.label}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </div>
          );

          if (row.hasMonthTransitionAfter) {
            return [
              rowElement,
              <div className="settingsCalendarMonthGapRow" key={`${row.key}-month-gap`} />,
            ];
          }

          return [rowElement];
        })}
        </div>
      </section>
    );
}
